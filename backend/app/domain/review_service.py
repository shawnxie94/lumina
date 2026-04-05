from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from email.utils import format_datetime as format_rfc2822_datetime
from html import escape, unescape
from pathlib import Path
import re
from typing import Any
from urllib.parse import urlencode, urlparse
from zoneinfo import ZoneInfo

from fastapi import HTTPException
from sqlalchemy import and_, case, func, or_
from sqlalchemy.orm import Session, joinedload

from ai_client import ConfigurableAIClient
from app.core.settings import get_settings
from app.domain.article_ai_pipeline_service import ArticleAIPipelineService
from models import (
    AIAnalysis,
    Article,
    Category,
    ModelAPIConfig,
    ReviewComment,
    ReviewIssue,
    ReviewIssueArticle,
    ReviewTemplate,
    now_str,
)

REVIEW_ARTICLE_SECTIONS_PLACEHOLDER = "{{review_article_sections}}"
SINGLE_BRACE_REVIEW_ARTICLE_SECTIONS_PLACEHOLDER = "{review_article_sections}"
SINGLE_BRACE_REVIEW_ARTICLE_SECTIONS_PATTERN = re.compile(
    r"(?<!\{)\{review_article_sections\}(?!\})"
)
ARTICLE_PLACEHOLDER_PATTERN = re.compile(r"\{\{([a-z0-9][a-z0-9-]*)\}\}")
ISSUE_SLUG_VERSION_SUFFIX_PATTERN = re.compile(r"-v\d+$")
DEFAULT_REVIEW_SYSTEM_PROMPT = (
    "你是一名技术内容主编，擅长把一组文章整理成结构清晰、判断克制、可直接发布前再润色的中文回顾草稿。"
)
DEFAULT_REVIEW_PROMPT_TEMPLATE = """你是一名技术内容编辑，请基于给定时间窗口内的文章集合，撰写一篇中文回顾草稿。

要求：
1. 先输出一个简洁的开场导语。
2. 再输出一段本期总览总结，提炼主要趋势、关键词和重点主题。
3. 如有需要，可在导语与总结之间补充 1-2 个简短过渡小节，但整体保持克制。
4. 不要输出文章列表、分类标题或任何文章占位标记，这部分会由系统按分类自动插入。
5. 不要额外新增“相关文章”“延伸阅读”等自定义列表区块。
6. 输出 Markdown 正文，不要输出代码块围栏。

可参考周刊风格，但语气保持克制、清晰、便于后续人工润色。

时间窗口：{period_label}
模板名称：{template_name}

文章信息：
{content}
"""

DEFAULT_REVIEW_TITLE_TEMPLATE = "{period_label} 回顾"
REVIEW_INPUT_MODE_ABSTRACT = "abstract"
REVIEW_INPUT_MODE_SUMMARY = "summary"
REVIEW_INPUT_MODE_FULL_TEXT = "full_text"
MEDIA_ROOT = Path(get_settings().media.root)


@dataclass
class ReviewWindow:
    start: str
    end: str
    period_label: str
    next_run_at: str


class ReviewService:
    RSS_ITEM_LIMIT = 50

    def __init__(self) -> None:
        self.pipeline_service = ArticleAIPipelineService()

    def resolve_window(self, template: ReviewTemplate, now_iso: str | None = None) -> ReviewWindow:
        tz = ZoneInfo((template.timezone or "Asia/Shanghai").strip() or "Asia/Shanghai")
        current_dt = self._parse_datetime(now_iso or template.next_run_at or now_str(), tz)
        current_date = current_dt.date()

        if template.schedule_type == "weekly":
            start_date = current_date - timedelta(days=7)
            weekday = start_date.weekday()
            start_date = start_date - timedelta(days=weekday)
            end_date = start_date + timedelta(days=7)
            period_label = f"{start_date.isoformat()} ~ {(end_date - timedelta(days=1)).isoformat()}"
            next_run_date = end_date + timedelta(days=7)
        elif template.schedule_type == "monthly":
            first_day_this_month = current_date.replace(day=1)
            end_date = first_day_this_month
            start_date = (end_date - timedelta(days=1)).replace(day=1)
            period_label = start_date.strftime("%Y-%m")
            if first_day_this_month.month == 12:
                next_run_date = first_day_this_month.replace(
                    year=first_day_this_month.year + 1,
                    month=1,
                )
            else:
                next_run_date = first_day_this_month.replace(month=first_day_this_month.month + 1)
        elif template.schedule_type == "custom_days":
            interval_days = template.custom_interval_days or 1
            anchor = datetime.strptime(template.anchor_date, "%Y-%m-%d").date()
            elapsed_days = max((current_date - anchor).days, 0)
            intervals = elapsed_days // interval_days
            end_date = anchor + timedelta(days=intervals * interval_days)
            start_date = end_date - timedelta(days=interval_days)
            period_label = f"{start_date.isoformat()} ~ {(end_date - timedelta(days=1)).isoformat()}"
            next_run_date = end_date + timedelta(days=interval_days)
        else:
            raise HTTPException(status_code=400, detail="不支持的回顾周期类型")

        return ReviewWindow(
            start=self._combine_date_with_midnight(start_date, tz),
            end=self._combine_date_with_midnight(end_date, tz),
            period_label=period_label,
            next_run_at=self._combine_date_with_trigger_time(next_run_date, template.trigger_time, tz),
        )

    def resolve_active_window(self, template: ReviewTemplate, now_iso: str | None = None) -> ReviewWindow:
        tz = ZoneInfo((template.timezone or "Asia/Shanghai").strip() or "Asia/Shanghai")
        current_dt = self._parse_datetime(now_iso or now_str(), tz)
        current_date = current_dt.date()

        if template.schedule_type == "weekly":
            start_date = current_date - timedelta(days=current_date.weekday())
            end_date = start_date + timedelta(days=7)
            period_label = f"{start_date.isoformat()} ~ {(end_date - timedelta(days=1)).isoformat()}"
            next_run_date = end_date
        elif template.schedule_type == "monthly":
            start_date = current_date.replace(day=1)
            if start_date.month == 12:
                end_date = start_date.replace(year=start_date.year + 1, month=1)
            else:
                end_date = start_date.replace(month=start_date.month + 1)
            period_label = start_date.strftime("%Y-%m")
            next_run_date = end_date
        elif template.schedule_type == "custom_days":
            interval_days = template.custom_interval_days or 1
            anchor = datetime.strptime(template.anchor_date, "%Y-%m-%d").date()
            elapsed_days = max((current_date - anchor).days, 0)
            intervals = elapsed_days // interval_days
            start_date = anchor + timedelta(days=intervals * interval_days)
            end_date = start_date + timedelta(days=interval_days)
            period_label = f"{start_date.isoformat()} ~ {(end_date - timedelta(days=1)).isoformat()}"
            next_run_date = end_date
        else:
            raise HTTPException(status_code=400, detail="不支持的回顾周期类型")

        return ReviewWindow(
            start=self._combine_date_with_midnight(start_date, tz),
            end=self._combine_date_with_midnight(end_date, tz),
            period_label=period_label,
            next_run_at=self._combine_date_with_trigger_time(next_run_date, template.trigger_time, tz),
        )

    def collect_articles(
        self,
        db: Session,
        template: ReviewTemplate,
        *,
        window_start: str,
        window_end: str,
        article_ids: list[str] | None = None,
    ) -> list[Article]:
        query = (
            db.query(Article)
            .outerjoin(Category, Category.id == Article.category_id)
            .outerjoin(AIAnalysis, AIAnalysis.article_id == Article.id)
            .options(joinedload(Article.category), joinedload(Article.ai_analysis))
            .filter(Article.created_at >= window_start)
            .filter(Article.created_at < window_end)
            .filter(Article.is_visible == True)
        )
        if not template.include_all_categories:
            category_ids = [category.id for category in template.categories]
            if not category_ids:
                return []
            query = query.filter(Article.category_id.in_(category_ids))
        if article_ids is not None:
            normalized_article_ids = self._normalize_article_ids(article_ids)
            if not normalized_article_ids:
                return []
            rows = query.filter(Article.id.in_(normalized_article_ids)).all()
            article_map = {article.id: article for article in rows}
            return [article_map[article_id] for article_id in normalized_article_ids if article_id in article_map]
        return (
            query.order_by(
                func.coalesce(Category.sort_order, 999999).asc(),
                Category.id.asc(),
                Article.created_at.desc(),
                Article.id.asc(),
            )
            .all()
        )

    def resolve_manual_window(
        self,
        template: ReviewTemplate,
        *,
        date_start: str | None,
        date_end: str | None,
        now_iso: str | None = None,
    ) -> ReviewWindow:
        if not date_start and not date_end:
            return self.resolve_active_window(template, now_iso)
        if not date_start or not date_end:
            raise HTTPException(status_code=400, detail="时间区间需同时提供开始和结束日期")
        tz = ZoneInfo((template.timezone or "Asia/Shanghai").strip() or "Asia/Shanghai")
        start_date = self._parse_date_string(date_start)
        end_date = self._parse_date_string(date_end)
        if end_date < start_date:
            raise HTTPException(status_code=400, detail="结束日期不能早于开始日期")
        end_exclusive = end_date + timedelta(days=1)
        return ReviewWindow(
            start=self._combine_date_with_midnight(start_date, tz),
            end=self._combine_date_with_midnight(end_exclusive, tz),
            period_label=f"{start_date.isoformat()} ~ {end_date.isoformat()}",
            next_run_at=self._combine_date_with_trigger_time(end_exclusive, template.trigger_time, tz),
        )

    def serialize_generation_candidate(self, article: Article) -> dict[str, Any]:
        return {
            "id": article.id,
            "slug": article.slug,
            "title": article.title_trans or article.title,
            "summary": ((article.ai_analysis.summary if article.ai_analysis else "") or "").strip(),
            "top_image": article.top_image or "",
            "created_at": article.created_at,
            "category": {
                "id": article.category.id,
                "name": article.category.name,
            }
            if article.category
            else None,
        }

    def build_generation_preview(
        self,
        db: Session,
        template: ReviewTemplate,
        *,
        date_start: str | None,
        date_end: str | None,
        now_iso: str | None = None,
    ) -> dict[str, Any]:
        window = self.resolve_manual_window(
            template,
            date_start=date_start,
            date_end=date_end,
            now_iso=now_iso,
        )
        articles = self.collect_articles(
            db,
            template,
            window_start=window.start,
            window_end=window.end,
        )
        return {
            "template": self._serialize_template_detail(db, template),
            "date_start": self._parse_datetime(window.start, ZoneInfo((template.timezone or "Asia/Shanghai").strip() or "Asia/Shanghai")).date().isoformat(),
            "date_end": (
                self._parse_datetime(window.end, ZoneInfo((template.timezone or "Asia/Shanghai").strip() or "Asia/Shanghai")).date()
                - timedelta(days=1)
            ).isoformat(),
            "window_start": window.start,
            "window_end": window.end,
            "period_label": window.period_label,
            "articles": [self.serialize_generation_candidate(article) for article in articles],
        }

    def enqueue_manual_issue_task(
        self,
        db: Session,
        template: ReviewTemplate,
        *,
        date_start: str | None,
        date_end: str | None,
        article_ids: list[str],
        model_api_config_id: str | None = None,
        now_iso: str | None = None,
    ) -> tuple[ReviewIssue, str]:
        from app.domain.ai_task_service import AITaskService

        normalized_article_ids = self._normalize_article_ids(article_ids)
        if not normalized_article_ids:
            raise HTTPException(status_code=400, detail="请至少选择一篇文章")
        window = self.resolve_manual_window(
            template,
            date_start=date_start,
            date_end=date_end,
            now_iso=now_iso,
        )
        articles = self.collect_articles(
            db,
            template,
            window_start=window.start,
            window_end=window.end,
            article_ids=normalized_article_ids,
        )
        if len(articles) != len(normalized_article_ids):
            raise HTTPException(status_code=400, detail="所选文章不在当前模板筛选范围内")
        tz = ZoneInfo((template.timezone or "Asia/Shanghai").strip() or "Asia/Shanghai")
        current_dt = self._parse_datetime(now_iso or now_str(), tz)
        issue_number = self._get_issue_number_for_window(
            db,
            template.id,
            window.start,
            window.end,
        )
        issue_title = self._render_title(
            template.title_template,
            period_label=window.period_label,
            template_name=template.name,
            issue_number=issue_number,
        )
        issue = ReviewIssue(
            template_id=template.id,
            slug=self._build_issue_slug(
                db,
                template,
                current_dt.date(),
                window.period_label,
            ),
            title=issue_title,
            status="draft",
            window_start=window.start,
            window_end=window.end,
            markdown_content=self.build_default_markdown(issue_title),
            created_at=now_str(),
            updated_at=now_str(),
        )
        db.add(issue)
        db.flush()
        task_service = AITaskService()
        task_id = task_service.enqueue_task(
            db,
            task_type="generate_review_issue",
            payload={
                "template_id": template.id,
                "issue_id": issue.id,
                "article_ids": normalized_article_ids,
                "model_api_config_id": (model_api_config_id or "").strip() or None,
            },
        )
        db.commit()
        db.refresh(issue)
        return issue, task_id

    def render_issue_markdown(self, db: Session, issue: ReviewIssue, *, is_admin: bool) -> str:
        source_markdown = issue.markdown_content or ""
        if REVIEW_ARTICLE_SECTIONS_PLACEHOLDER in source_markdown:
            sections = self.build_article_sections_markdown(db, issue, is_admin=is_admin)
            return source_markdown.replace(REVIEW_ARTICLE_SECTIONS_PLACEHOLDER, sections.strip())
        placeholder_blocks = self.build_article_placeholder_render_blocks(
            db,
            issue,
            is_admin=is_admin,
        )
        return self._render_article_placeholders_markdown(source_markdown, placeholder_blocks)

    def build_article_sections_markdown(
        self,
        db: Session,
        issue: ReviewIssue,
        *,
        is_admin: bool,
    ) -> str:
        outline = self.build_article_placeholder_outline(
            db,
            issue,
            is_admin=is_admin,
        )
        placeholder_blocks = self.build_article_placeholder_render_blocks(
            db,
            issue,
            is_admin=is_admin,
        )
        return self._render_article_placeholders_markdown(outline, placeholder_blocks)

    def get_public_issues(
        self,
        db: Session,
        *,
        page: int,
        size: int,
        is_admin: bool,
        template_id: str | None = None,
        search: str | None = None,
        published_at_start: str | None = None,
        published_at_end: str | None = None,
        visibility: str | None = None,
    ) -> tuple[list[dict[str, Any]], int]:
        base_query = self._build_issue_list_query(
            db,
            is_admin=is_admin,
            template_id=template_id,
            search=search,
            published_at_start=published_at_start,
            published_at_end=published_at_end,
            visibility=visibility,
        )
        ordered_items = base_query.order_by(*self._issue_list_order_by()).all()
        groups = self._group_issue_versions(ordered_items)
        total = len(groups)
        offset = (page - 1) * size
        paged_groups = groups[offset : offset + size]
        return [self.serialize_issue_group_card(db, group) for group in paged_groups], total

    def get_issue_template_filters(
        self,
        db: Session,
        *,
        is_admin: bool,
        search: str | None = None,
        published_at_start: str | None = None,
        published_at_end: str | None = None,
        visibility: str | None = None,
    ) -> list[dict[str, Any]]:
        base_query = self._build_issue_list_query(
            db,
            is_admin=is_admin,
            template_id=None,
            search=search,
            published_at_start=published_at_start,
            published_at_end=published_at_end,
            visibility=visibility,
        )
        ordered_items = base_query.order_by(*self._issue_list_order_by()).all()
        groups = self._group_issue_versions(ordered_items)
        counts_by_template: dict[str, int] = {}
        template_meta: dict[str, dict[str, str]] = {}
        ordered_template_ids: list[str] = []
        for group in groups:
            primary = group[0]
            if not primary.template:
                continue
            template_id_value = primary.template.id
            if template_id_value not in template_meta:
                ordered_template_ids.append(template_id_value)
            counts_by_template[template_id_value] = counts_by_template.get(template_id_value, 0) + 1
            template_meta[template_id_value] = {
                "name": primary.template.name,
                "slug": primary.template.slug,
            }
        total_count = sum(counts_by_template.values())
        items = [
            {
                "id": "",
                "name": "全部",
                "slug": "",
                "count": total_count,
            }
        ]
        items.extend(
            {
                "id": template_id_value,
                "name": template_meta[template_id_value]["name"],
                "slug": template_meta[template_id_value]["slug"],
                "count": counts_by_template[template_id_value],
            }
            for template_id_value in ordered_template_ids
        )
        return items

    def get_public_issue_by_slug(self, db: Session, review_slug: str, *, is_admin: bool) -> ReviewIssue:
        query = (
            db.query(ReviewIssue)
            .options(joinedload(ReviewIssue.template))
            .filter(ReviewIssue.slug == review_slug)
        )
        if not is_admin:
            query = query.filter(ReviewIssue.status == "published")
        issue = query.first()
        if not issue:
            raise HTTPException(status_code=404, detail="回顾不存在")
        return issue

    def get_issue_by_id(self, db: Session, issue_id: str) -> ReviewIssue:
        issue = (
            db.query(ReviewIssue)
            .options(joinedload(ReviewIssue.template))
            .filter(ReviewIssue.id == issue_id)
            .first()
        )
        if not issue:
            raise HTTPException(status_code=404, detail="回顾不存在")
        return issue

    def validate_review_markdown(self, markdown_content: str) -> None:
        count = markdown_content.count(REVIEW_ARTICLE_SECTIONS_PLACEHOLDER)
        article_placeholders = self._extract_article_placeholders(markdown_content)
        if count == 1 and not article_placeholders:
            return
        if count == 0 and article_placeholders:
            return
        if count > 1:
            raise HTTPException(status_code=400, detail="旧版文章段落占位符只能保留一次")
        raise HTTPException(
            status_code=400,
            detail="正文需保留一个旧版总占位符，或至少一个 {{article_slug}} 文章占位符",
        )

    def update_issue(
        self,
        db: Session,
        issue: ReviewIssue,
        *,
        title: str | None,
        published_at: str | None,
        top_image: str | None,
        markdown_content: str,
    ) -> ReviewIssue:
        self.validate_review_markdown(markdown_content)
        if title is not None:
            issue.title = title.strip() or issue.title
        if published_at is not None:
            issue.published_at = published_at.strip() or None
        if top_image is not None:
            issue.top_image = top_image.strip() or None
        issue.markdown_content = markdown_content
        issue.updated_at = now_str()
        db.commit()
        db.refresh(issue)
        return issue

    def publish_issue(self, db: Session, issue: ReviewIssue) -> ReviewIssue:
        sibling_drafts = (
            db.query(ReviewIssue)
            .filter(ReviewIssue.template_id == issue.template_id)
            .filter(ReviewIssue.window_start == issue.window_start)
            .filter(ReviewIssue.window_end == issue.window_end)
            .filter(ReviewIssue.id != issue.id)
            .filter(ReviewIssue.status == "draft")
            .all()
        )
        for sibling in sibling_drafts:
            db.delete(sibling)
        db.flush()
        self._promote_issue_slug_on_publish(db, issue)
        issue.status = "published"
        issue.published_at = (issue.published_at or "").strip() or now_str()
        issue.updated_at = now_str()
        db.commit()
        db.refresh(issue)
        return issue

    def unpublish_issue(self, db: Session, issue: ReviewIssue) -> ReviewIssue:
        issue.status = "draft"
        issue.published_at = None
        issue.updated_at = now_str()
        db.commit()
        db.refresh(issue)
        return issue

    def enqueue_due_review_tasks(self, db: Session, *, now_iso: str | None = None) -> int:
        from app.domain.ai_task_service import AITaskService

        current_iso = now_iso or now_str()
        templates = (
            db.query(ReviewTemplate)
            .filter(ReviewTemplate.is_enabled == True)
            .filter(ReviewTemplate.next_run_at.isnot(None))
            .filter(ReviewTemplate.next_run_at <= current_iso)
            .all()
        )
        created = 0
        task_service = AITaskService()
        for template in templates:
            self._materialize_issue_task(
                db,
                template=template,
                current_iso=current_iso,
                task_service=task_service,
            )
            created += 1
        if created:
            db.commit()
        return created

    def enqueue_template_run_now(
        self,
        db: Session,
        template: ReviewTemplate,
        *,
        now_iso: str | None = None,
    ) -> str:
        from app.domain.ai_task_service import AITaskService

        current_iso = now_iso or template.next_run_at or now_str()
        task_service = AITaskService()
        task_id = self._materialize_issue_task(
            db,
            template=template,
            current_iso=current_iso,
            task_service=task_service,
            window=self.resolve_active_window(template, current_iso),
        )
        db.commit()
        return task_id

    async def generate_issue(
        self,
        db: Session,
        template_id: str,
        issue_id: str,
        *,
        task_id: str | None = None,
        article_ids: list[str] | None = None,
        model_api_config_id: str | None = None,
    ) -> ReviewIssue:
        template = db.query(ReviewTemplate).options(joinedload(ReviewTemplate.categories)).filter(
            ReviewTemplate.id == template_id
        ).first()
        if not template:
            raise HTTPException(status_code=404, detail="回顾模板不存在")
        issue = self.get_issue_by_id(db, issue_id)
        articles = self.collect_articles(
            db,
            template,
            window_start=issue.window_start,
            window_end=issue.window_end,
            article_ids=article_ids,
        )
        issue.articles.clear()
        for index, article in enumerate(articles, start=1):
            category = article.category
            sort_order = category.sort_order if category and category.sort_order is not None else 999999
            issue.articles.append(
                ReviewIssueArticle(
                    article_id=article.id,
                    category_id=category.id if category else None,
                    category_sort_order=sort_order,
                    article_sort_order=index,
                    created_at=now_str(),
                    updated_at=now_str(),
                )
            )

        issue.markdown_content = await self.generate_issue_markdown(
            db,
            template=template,
            issue=issue,
            articles=articles,
            task_id=task_id,
            model_api_config_id=model_api_config_id,
        )
        if not (issue.top_image or "").strip():
            issue.top_image = self._resolve_issue_top_image(articles)
        issue.generated_at = now_str()
        issue.updated_at = now_str()
        db.commit()
        db.refresh(issue)
        return issue

    async def generate_issue_markdown(
        self,
        db: Session,
        *,
        template: ReviewTemplate,
        issue: ReviewIssue,
        articles: list[Article],
        task_id: str | None = None,
        model_api_config_id: str | None = None,
    ) -> str:
        ai_config = self._resolve_review_ai_config(
            db,
            template,
            override_model_config_id=model_api_config_id,
        )
        if not ai_config:
            return self.build_default_markdown(
                issue.title or self._build_fallback_issue_title(db, template, issue),
                article_outline_markdown=self._build_article_placeholder_outline_from_articles(articles),
            )
        article_payload = self._build_generation_article_payload(
            articles,
            input_mode=(template.review_input_mode or REVIEW_INPUT_MODE_SUMMARY),
        )
        article_outline_markdown = self._build_article_placeholder_outline_from_articles(articles)
        prompt_template = template.prompt_template or DEFAULT_REVIEW_PROMPT_TEMPLATE
        prompt = self._build_generation_prompt(
            prompt_template,
            issue=issue,
            template=template,
            article_outline_markdown=article_outline_markdown,
        )
        parameters = dict(ai_config.get("parameters") or {})
        if template.temperature is not None:
            parameters["temperature"] = template.temperature
        if template.max_tokens is not None:
            parameters["max_tokens"] = template.max_tokens
        if template.top_p is not None:
            parameters["top_p"] = template.top_p
        system_prompt = (template.system_prompt or "").strip() or DEFAULT_REVIEW_SYSTEM_PROMPT
        parameters["system_prompt"] = system_prompt
        client = self.pipeline_service.create_ai_client(ai_config)
        try:
            result = await client.generate_summary(
                article_payload,
                prompt=prompt,
                max_tokens=parameters.get("max_tokens", 1800),
                temperature=parameters.get("temperature", 0.4),
                parameters=parameters,
            )
        except Exception as exc:
            self.pipeline_service._log_ai_usage(
                db,
                model_config_id=ai_config.get("model_api_config_id"),
                article_id=None,
                task_type="generate_review_issue",
                content_type="review",
                usage=None,
                latency_ms=None,
                status="failed",
                error_message=str(exc),
                price_input_per_1k=ai_config.get("price_input_per_1k"),
                price_output_per_1k=ai_config.get("price_output_per_1k"),
                currency=ai_config.get("currency"),
                request_payload={
                    "prompt": prompt,
                    "system_prompt": system_prompt,
                    "article_payload": article_payload,
                },
                response_payload=None,
                task_id=task_id,
            )
            raise

        self.pipeline_service._log_ai_usage(
            db,
            model_config_id=ai_config.get("model_api_config_id"),
            article_id=None,
            task_type="generate_review_issue",
            content_type="review",
            usage=result.get("usage"),
            latency_ms=result.get("latency_ms"),
            status="completed",
            error_message=None,
            price_input_per_1k=ai_config.get("price_input_per_1k"),
            price_output_per_1k=ai_config.get("price_output_per_1k"),
            currency=ai_config.get("currency"),
            request_payload=result.get("request_payload")
            or {
                "prompt": prompt,
                "system_prompt": system_prompt,
                "article_payload": article_payload,
            },
            response_payload=result.get("response_payload"),
            task_id=task_id,
            finish_reason=result.get("finish_reason"),
        )
        content = (result.get("content") or "").strip()
        if not content:
            return self.build_default_markdown(
                issue.title or self._build_fallback_issue_title(db, template, issue),
                article_outline_markdown=self._build_article_placeholder_outline_from_articles(articles),
            )
        normalized_markdown = self._normalize_generated_markdown(content)
        return self._materialize_article_outline_markdown(
            normalized_markdown,
            self._build_article_placeholder_outline_from_articles(articles),
        )

    def _build_generation_prompt(
        self,
        prompt_template: str,
        *,
        issue: ReviewIssue,
        template: ReviewTemplate,
        article_outline_markdown: str,
    ) -> str:
        return prompt_template.format(
            content="{content}",
            period_label=self._period_label_for_issue(issue),
            template_name=template.name,
            article_sections_placeholder=REVIEW_ARTICLE_SECTIONS_PLACEHOLDER,
            article_outline_markdown=article_outline_markdown,
        )

    def _resolve_review_ai_config(
        self,
        db: Session,
        template: ReviewTemplate,
        override_model_config_id: str | None = None,
    ) -> dict[str, Any] | None:
        preferred_model_id = (override_model_config_id or template.model_api_config_id or "").strip()
        if preferred_model_id:
            model_config = (
                db.query(ModelAPIConfig)
                .filter(ModelAPIConfig.id == preferred_model_id)
                .first()
            )
            if (
                model_config
                and model_config.is_enabled
                and (model_config.model_type or "general") != "vector"
            ):
                return {
                    "base_url": model_config.base_url,
                    "api_key": model_config.api_key,
                    "model_name": model_config.model_name,
                    "model_api_config_id": model_config.id,
                    "price_input_per_1k": model_config.price_input_per_1k,
                    "price_output_per_1k": model_config.price_output_per_1k,
                    "currency": model_config.currency,
                    "context_window_tokens": model_config.context_window_tokens,
                    "reserve_output_tokens": model_config.reserve_output_tokens,
                    "parameters": None,
                }
        return self.pipeline_service.get_ai_config(db, prompt_type="summary")

    def build_default_markdown(
        self,
        title: str,
        *,
        article_outline_markdown: str | None = None,
    ) -> str:
        article_outline = (article_outline_markdown or "").strip() or REVIEW_ARTICLE_SECTIONS_PLACEHOLDER
        return (
            f"# {title}\n\n"
            "> 自动生成的回顾草稿，可在发布前继续编辑。\n\n"
            "## 本期概览\n\n"
            "请在这里补充本期回顾总结。\n\n"
            f"{article_outline}\n"
        )

    def serialize_issue_card(self, db: Session, issue: ReviewIssue) -> dict[str, Any]:
        categories = self._resolve_issue_category_names(db, issue)
        top_image = self._resolve_issue_top_image_for_output(db, issue)
        return {
            "id": issue.id,
            "slug": issue.slug,
            "title": issue.title,
            "status": issue.status,
            "window_start": issue.window_start,
            "window_end": issue.window_end,
            "top_image": top_image,
            "generated_at": issue.generated_at,
            "published_at": issue.published_at,
            "created_at": issue.created_at,
            "updated_at": issue.updated_at,
            "template": self._serialize_template_summary(issue.template),
            "category_names": categories,
            "summary": self._build_issue_excerpt(issue.markdown_content),
            "view_count": int(issue.view_count or 0),
            "comment_count": self.get_issue_comment_count(
                db,
                issue.id,
                include_hidden=False,
            ),
        }

    def serialize_issue_group_card(
        self,
        db: Session,
        issues: list[ReviewIssue],
    ) -> dict[str, Any]:
        primary_issue = issues[0]
        return {
            **self.serialize_issue_card(db, primary_issue),
            "version_count": len(issues),
            "versions": [self._serialize_issue_version(issue) for issue in issues],
        }

    def serialize_issue_detail(self, db: Session, issue: ReviewIssue, *, is_admin: bool) -> dict[str, Any]:
        prev_review, next_review = self.get_issue_neighbors(db, issue)
        return {
            **self.serialize_issue_card(db, issue),
            "template": self._serialize_template_detail(db, issue.template),
            "selected_article_ids": self.get_issue_selected_article_ids(db, issue) if is_admin else [],
            "markdown_content": issue.markdown_content,
            "article_sections_markdown": self.build_article_sections_markdown(
                db,
                issue,
                is_admin=is_admin,
            ),
            "article_placeholder_blocks": self.build_article_placeholder_render_blocks(
                db,
                issue,
                is_admin=is_admin,
            ),
            "rendered_markdown": self.render_issue_markdown(db, issue, is_admin=is_admin),
            "comment_count": self.get_issue_comment_count(
                db,
                issue.id,
                include_hidden=is_admin,
            ),
            "prev_review": self._serialize_issue_neighbor(prev_review),
            "next_review": self._serialize_issue_neighbor(next_review),
            "recent_reviews": self.get_recent_published_reviews(db, issue, limit=5),
        }

    def get_issue_neighbors(
        self,
        db: Session,
        issue: ReviewIssue,
    ) -> tuple[ReviewIssue | None, ReviewIssue | None]:
        if not issue.template_id or issue.status != "published":
            return None, None
        siblings = (
            db.query(ReviewIssue)
            .filter(ReviewIssue.template_id == issue.template_id)
            .filter(ReviewIssue.status == "published")
            .order_by(
                ReviewIssue.published_at.asc(),
                ReviewIssue.created_at.asc(),
                ReviewIssue.id.asc(),
            )
            .all()
        )
        index_map = {item.id: idx for idx, item in enumerate(siblings)}
        current_index = index_map.get(issue.id)
        if current_index is None:
            return None, None
        prev_issue = siblings[current_index - 1] if current_index > 0 else None
        next_issue = (
            siblings[current_index + 1]
            if current_index < len(siblings) - 1
            else None
        )
        return prev_issue, next_issue

    def get_issue_comment_count(
        self,
        db: Session,
        issue_id: str,
        *,
        include_hidden: bool,
    ) -> int:
        query = db.query(func.count(ReviewComment.id)).filter(ReviewComment.issue_id == issue_id)
        if not include_hidden:
            query = query.filter(
                (ReviewComment.is_hidden == False) | (ReviewComment.is_hidden.is_(None))
            )
        return int(query.scalar() or 0)

    def get_issue_selected_article_ids(self, db: Session, issue: ReviewIssue) -> list[str]:
        rows = (
            db.query(ReviewIssueArticle.article_id)
            .filter(ReviewIssueArticle.issue_id == issue.id)
            .order_by(
                ReviewIssueArticle.category_sort_order.asc(),
                ReviewIssueArticle.article_sort_order.asc(),
                ReviewIssueArticle.id.asc(),
            )
            .all()
        )
        return [row[0] for row in rows if row and row[0]]

    def serialize_review_comment(
        self,
        comment: ReviewComment,
        *,
        review_slug: str,
    ) -> dict[str, Any]:
        return {
            "id": comment.id,
            "review_id": comment.issue_id,
            "review_slug": review_slug,
            "user_id": comment.user_id,
            "user_name": comment.user_name,
            "user_avatar": comment.user_avatar,
            "provider": comment.provider,
            "content": comment.content,
            "reply_to_id": comment.reply_to_id,
            "is_hidden": bool(comment.is_hidden),
            "created_at": comment.created_at,
            "updated_at": comment.updated_at,
        }

    def _build_generation_article_payload(
        self,
        articles: list[Article],
        *,
        input_mode: str = REVIEW_INPUT_MODE_SUMMARY,
    ) -> str:
        lines: list[str] = []
        for article in articles:
            category_name = article.category.name if article.category else "未分类"
            title = (article.title_trans or "").strip() or article.title
            content_label = self._get_review_input_mode_label(input_mode)
            content_value = self._build_review_input_value(article, input_mode)
            lines.append(
                f"- 分类：{category_name}\n"
                f"  标题：{title}\n"
                f"  链接：/article/{article.slug}\n"
                f"  入库时间：{article.created_at}\n"
                f"  {content_label}：{content_value}\n"
            )
        return "\n".join(lines).strip()

    def _get_review_input_mode_label(self, input_mode: str) -> str:
        if input_mode == REVIEW_INPUT_MODE_ABSTRACT:
            return "摘要"
        if input_mode == REVIEW_INPUT_MODE_FULL_TEXT:
            return "全文"
        return "总结"

    def _build_review_input_value(self, article: Article, input_mode: str) -> str:
        if input_mode == REVIEW_INPUT_MODE_ABSTRACT:
            summary = (article.ai_analysis.summary if article.ai_analysis else "") or ""
            return summary.strip() or "暂无摘要"
        if input_mode == REVIEW_INPUT_MODE_FULL_TEXT:
            return self._extract_article_full_text(article) or "暂无全文"
        key_points = (article.ai_analysis.key_points if article.ai_analysis else "") or ""
        if key_points.strip():
            return key_points.strip()
        summary = (article.ai_analysis.summary if article.ai_analysis else "") or ""
        return summary.strip() or "暂无总结"

    def _build_article_abstract(self, article: Article) -> str:
        content = self._extract_article_full_text(article)
        if not content:
            return ""
        return content[:280].strip()

    def _extract_article_full_text(self, article: Article) -> str:
        raw_content = (
            (article.content_trans or "").strip()
            or (article.content_md or "").strip()
            or (article.content_html or "").strip()
        )
        if not raw_content:
            return ""
        if "<" in raw_content and ">" in raw_content:
            raw_content = re.sub(r"<[^>]+>", " ", raw_content)
        raw_content = re.sub(r"!\[[^\]]*\]\([^)]+\)", " ", raw_content)
        raw_content = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", raw_content)
        raw_content = re.sub(r"(^|\s)[>#*_`~-]+", " ", raw_content)
        raw_content = unescape(raw_content)
        raw_content = re.sub(r"\s+", " ", raw_content)
        return raw_content.strip()

    def _normalize_generated_markdown(self, content: str) -> str:
        normalized = SINGLE_BRACE_REVIEW_ARTICLE_SECTIONS_PATTERN.sub(
            REVIEW_ARTICLE_SECTIONS_PLACEHOLDER,
            content,
        ).strip()
        if REVIEW_ARTICLE_SECTIONS_PLACEHOLDER not in normalized:
            return normalized

        head, tail = normalized.split(REVIEW_ARTICLE_SECTIONS_PLACEHOLDER, 1)
        tail_without_duplicates = tail.replace(REVIEW_ARTICLE_SECTIONS_PLACEHOLDER, "").strip()
        normalized_content = f"{head.rstrip()}\n\n{REVIEW_ARTICLE_SECTIONS_PLACEHOLDER}"
        if tail_without_duplicates:
            normalized_content = f"{normalized_content}\n\n{tail_without_duplicates}"
        return normalized_content.strip()

    def build_article_placeholder_outline(
        self,
        db: Session,
        issue: ReviewIssue,
        *,
        is_admin: bool,
    ) -> str:
        grouped = self._group_issue_article_items(db, issue, is_admin=is_admin)
        return self._build_article_placeholder_outline_from_grouped_items(grouped)

    def build_article_placeholder_render_blocks(
        self,
        db: Session,
        issue: ReviewIssue,
        *,
        is_admin: bool,
    ) -> dict[str, str]:
        grouped = self._group_issue_article_items(db, issue, is_admin=is_admin)
        blocks: dict[str, str] = {}
        for items in grouped.values():
            for item in items:
                slug = item.get("slug")
                if not slug:
                    continue
                block_lines: list[str] = [self._build_article_heading_link(item)]
                if item.get("top_image"):
                    block_lines.extend(["", f"![]({item['top_image']})"])
                block_lines.extend(["", item["summary"]])
                blocks[slug] = "\n".join(block_lines).strip()
        return blocks

    def _group_issue_article_items(
        self,
        db: Session,
        issue: ReviewIssue,
        *,
        is_admin: bool,
    ) -> dict[str, list[dict[str, Any]]]:
        rows = (
            db.query(ReviewIssueArticle)
            .options(
                joinedload(ReviewIssueArticle.article).joinedload(Article.ai_analysis),
                joinedload(ReviewIssueArticle.category),
            )
            .filter(ReviewIssueArticle.issue_id == issue.id)
            .order_by(
                ReviewIssueArticle.category_sort_order.asc(),
                ReviewIssueArticle.article_sort_order.asc(),
                ReviewIssueArticle.id.asc(),
            )
            .all()
        )

        grouped: dict[str, list[dict[str, Any]]] = {}
        for row in rows:
            article = row.article
            if not article:
                if not is_admin:
                    continue
                category_name = row.category.name if row.category else "未分类"
                grouped.setdefault(category_name, []).append(
                    {
                        "title": "文章已删除",
                        "slug": None,
                        "summary": "该文章已不存在",
                        "top_image": "",
                        "hidden": True,
                    }
                )
                continue

            if not article.is_visible and not is_admin:
                continue

            category_name = (
                row.category.name if row.category else article.category.name if article.category else "未分类"
            )
            grouped.setdefault(category_name, []).append(
                {
                    "title": (article.title_trans or "").strip() or article.title,
                    "slug": article.slug,
                    "summary": (article.ai_analysis.summary if article.ai_analysis else "") or "（暂无摘要）",
                    "top_image": article.top_image or "",
                    "hidden": not bool(article.is_visible),
                }
            )
        return grouped

    def _build_article_placeholder_outline_from_articles(self, articles: list[Article]) -> str:
        grouped: dict[str, list[dict[str, Any]]] = {}
        for article in articles:
            category_name = article.category.name if article.category else "未分类"
            grouped.setdefault(category_name, []).append(
                {
                    "title": (article.title_trans or "").strip() or article.title,
                    "slug": article.slug,
                    "summary": (article.ai_analysis.summary if article.ai_analysis else "") or "（暂无摘要）",
                    "top_image": article.top_image or "",
                    "hidden": not bool(article.is_visible),
                }
            )
        return self._build_article_placeholder_outline_from_grouped_items(grouped)

    def _build_article_placeholder_outline_from_grouped_items(
        self,
        grouped: dict[str, list[dict[str, Any]]],
    ) -> str:
        lines: list[str] = []
        for category_name, articles in grouped.items():
            if not articles:
                continue
            lines.append(f"## {category_name}")
            lines.append("")
            for item in articles:
                slug = item.get("slug")
                if slug:
                    lines.append(f"### {{{{{slug}}}}}")
                else:
                    title = item["title"]
                    if item.get("hidden"):
                        title = f"{title}（已隐藏）"
                    lines.append(f"### {title}")
                    lines.append("")
                    lines.append(item["summary"])
                    lines.append("")
                    continue
                lines.append("")
            if lines and lines[-1] != "":
                lines.append("")
        return "\n".join(lines).strip()

    def _build_article_heading_link(self, item: dict[str, Any]) -> str:
        title = item["title"]
        if item.get("hidden"):
            title = f"{title}（已隐藏）"
        slug = item.get("slug")
        if slug:
            return f"[{title}](/article/{slug})"
        return title

    def _extract_article_placeholders(self, markdown_content: str | None) -> list[str]:
        placeholders: list[str] = []
        seen: set[str] = set()
        for match in ARTICLE_PLACEHOLDER_PATTERN.finditer(markdown_content or ""):
            value = (match.group(1) or "").strip()
            if not value or value == "review_article_sections" or value in seen:
                continue
            placeholders.append(value)
            seen.add(value)
        return placeholders

    def _materialize_article_outline_markdown(
        self,
        markdown_content: str,
        article_outline_markdown: str | None,
    ) -> str:
        article_outline = (article_outline_markdown or "").strip()
        normalized = (markdown_content or "").strip()
        if not article_outline:
            return normalized
        if REVIEW_ARTICLE_SECTIONS_PLACEHOLDER in normalized:
            return normalized.replace(REVIEW_ARTICLE_SECTIONS_PLACEHOLDER, article_outline).strip()
        if self._extract_article_placeholders(normalized):
            return normalized
        if not normalized:
            return article_outline
        return f"{normalized}\n\n{article_outline}".strip()

    def _render_article_placeholders_markdown(
        self,
        markdown_content: str,
        placeholder_blocks: dict[str, str],
    ) -> str:
        rendered_lines: list[str] = []
        for line in (markdown_content or "").splitlines():
            placeholders = self._extract_article_placeholders(line)
            if not placeholders:
                rendered_lines.append(line)
                continue
            next_line = line
            should_drop_line = False
            for slug in placeholders:
                token = f"{{{{{slug}}}}}"
                replacement = placeholder_blocks.get(slug)
                if replacement:
                    next_line = next_line.replace(token, replacement)
                    continue
                normalized_line = next_line.replace(token, "").strip()
                if not normalized_line or re.fullmatch(r"#{1,6}", normalized_line):
                    should_drop_line = True
                    break
                next_line = next_line.replace(token, "")
            if not should_drop_line:
                rendered_lines.append(next_line.rstrip())
        return "\n".join(rendered_lines).strip()

    def _group_issue_versions(self, issues: list[ReviewIssue]) -> list[list[ReviewIssue]]:
        groups: dict[tuple[str, str, str], list[ReviewIssue]] = {}
        for issue in issues:
            key = (issue.template_id, issue.window_start, issue.window_end)
            groups.setdefault(key, []).append(issue)
        return list(groups.values())

    def _issue_list_order_by(self) -> tuple[Any, ...]:
        return (
            case((ReviewIssue.published_at.is_(None), 0), else_=1).asc(),
            ReviewIssue.published_at.desc(),
            ReviewIssue.created_at.desc(),
            ReviewIssue.id.desc(),
        )

    def _materialize_issue_task(
        self,
        db: Session,
        *,
        template: ReviewTemplate,
        current_iso: str,
        task_service: Any,
        window: ReviewWindow | None = None,
    ) -> str:
        current_dt = datetime.fromisoformat(current_iso.replace("Z", "+00:00"))
        resolved_window = window or self.resolve_window(template, current_iso)
        issue_number = self._get_issue_number_for_window(
            db,
            template.id,
            resolved_window.start,
            resolved_window.end,
        )
        issue_title = self._render_title(
            template.title_template,
            period_label=resolved_window.period_label,
            template_name=template.name,
            issue_number=issue_number,
        )
        issue = ReviewIssue(
            template_id=template.id,
            slug=self._build_issue_slug(
                db,
                template,
                current_dt.date(),
                resolved_window.period_label,
            ),
            title=issue_title,
            status="draft",
            window_start=resolved_window.start,
            window_end=resolved_window.end,
            markdown_content=self.build_default_markdown(issue_title),
            created_at=now_str(),
            updated_at=now_str(),
        )
        db.add(issue)
        db.flush()
        task_id = task_service.enqueue_task(
            db,
            task_type="generate_review_issue",
            payload={"template_id": template.id, "issue_id": issue.id},
        )
        template.last_run_at = current_iso
        template.next_run_at = resolved_window.next_run_at
        template.updated_at = now_str()
        return task_id

    def _build_issue_list_query(
        self,
        db: Session,
        *,
        is_admin: bool,
        template_id: str | None,
        search: str | None,
        published_at_start: str | None,
        published_at_end: str | None,
        visibility: str | None,
    ):
        query = db.query(ReviewIssue).options(joinedload(ReviewIssue.template))
        if is_admin:
            if visibility in {"draft", "published"}:
                query = query.filter(ReviewIssue.status == visibility)
        else:
            query = query.filter(ReviewIssue.status == "published")

        if template_id:
            query = query.filter(ReviewIssue.template_id == template_id)

        normalized_search = (search or "").strip()
        if normalized_search:
            query = query.filter(ReviewIssue.title.ilike(f"%{normalized_search}%"))

        if published_at_start:
            query = query.filter(ReviewIssue.published_at >= published_at_start)
        if published_at_end:
            query = query.filter(ReviewIssue.published_at <= published_at_end)
        return query

    def _period_label_for_issue(self, issue: ReviewIssue) -> str:
        start = issue.window_start[:10]
        end_dt = datetime.fromisoformat(issue.window_end.replace("Z", "+00:00"))
        end_label = (end_dt.date() - timedelta(days=1)).isoformat()
        return f"{start} ~ {end_label}"

    def _resolve_issue_category_names(self, db: Session, issue: ReviewIssue) -> list[str]:
        rows = (
            db.query(Category.name)
            .join(ReviewIssueArticle, ReviewIssueArticle.category_id == Category.id)
            .filter(ReviewIssueArticle.issue_id == issue.id)
            .distinct()
            .all()
        )
        return [row[0] for row in rows]

    def _build_issue_excerpt(self, markdown_content: str | None) -> str:
        raw = (markdown_content or "").replace(REVIEW_ARTICLE_SECTIONS_PLACEHOLDER, "").strip()
        lines = [line.strip() for line in raw.splitlines() if line.strip() and not line.startswith("#")]
        return lines[0] if lines else ""

    def _serialize_issue_version(self, issue: ReviewIssue) -> dict[str, Any]:
        return {
            "id": issue.id,
            "slug": issue.slug,
            "title": issue.title,
            "status": issue.status,
            "generated_at": issue.generated_at,
            "published_at": issue.published_at,
            "created_at": issue.created_at,
            "updated_at": issue.updated_at,
        }

    def _serialize_issue_neighbor(self, issue: ReviewIssue | None) -> dict[str, Any] | None:
        if not issue:
            return None
        return {
            "id": issue.id,
            "slug": issue.slug,
            "title": issue.title,
            "published_at": issue.published_at,
            "updated_at": issue.updated_at,
        }

    def _serialize_template_summary(self, template: ReviewTemplate | None) -> dict[str, Any] | None:
        if not template:
            return None
        return {
            "id": template.id,
            "name": template.name,
            "slug": template.slug,
            "include_all_categories": template.include_all_categories,
            "review_input_mode": template.review_input_mode,
        }

    def _serialize_template_detail(
        self,
        db: Session,
        template: ReviewTemplate | None,
    ) -> dict[str, Any] | None:
        if not template:
            return None
        category_names = (
            ["全部分类"]
            if template.include_all_categories
            else [category.name for category in sorted(
                template.categories,
                key=lambda item: (
                    item.sort_order if item.sort_order is not None else 999999,
                    item.name or "",
                ),
            )]
        )
        return {
            **self._serialize_template_summary(template),
            "model_api_config_id": template.model_api_config_id,
            "description": template.description,
            "schedule_type": template.schedule_type,
            "custom_interval_days": template.custom_interval_days,
            "trigger_time": template.trigger_time,
            "category_names": category_names,
            "temperature": template.temperature,
            "max_tokens": template.max_tokens,
            "top_p": template.top_p,
        }

    def get_recent_published_reviews(
        self,
        db: Session,
        issue: ReviewIssue,
        *,
        limit: int = 5,
    ) -> list[dict[str, Any]]:
        rows = (
            db.query(ReviewIssue)
            .filter(ReviewIssue.status == "published")
            .filter(ReviewIssue.id != issue.id)
            .order_by(
                ReviewIssue.published_at.desc(),
                ReviewIssue.created_at.desc(),
                ReviewIssue.id.desc(),
            )
            .limit(max(1, limit))
            .all()
        )
        return [self._serialize_issue_neighbor(row) for row in rows if row]

    def get_reviews_for_rss(
        self,
        db: Session,
        *,
        template_id: str | None = None,
    ) -> list[ReviewIssue]:
        query = (
            db.query(ReviewIssue)
            .options(joinedload(ReviewIssue.template))
            .filter(ReviewIssue.status == "published")
        )
        if (template_id or "").strip():
            query = query.filter(ReviewIssue.template_id == template_id.strip())
        return (
            query.order_by(
                case((ReviewIssue.published_at.is_(None), 1), else_=0).asc(),
                ReviewIssue.published_at.desc(),
                ReviewIssue.created_at.desc(),
                ReviewIssue.id.desc(),
            )
            .limit(self.RSS_ITEM_LIMIT)
            .all()
        )

    def render_reviews_rss(
        self,
        *,
        reviews: list[ReviewIssue],
        public_base_url: str | None,
        site_name: str,
        site_description: str,
        template_id: str | None = None,
    ) -> str:
        base_url = self._normalize_public_base_url(public_base_url)
        feed_link = self._build_review_feed_url(
            base_url,
            "/reviews",
            template_id=template_id,
        )
        feed_self_link = self._build_review_feed_url(
            base_url,
            "/backend/api/reviews/rss.xml",
            template_id=template_id,
        )
        lines = [
            '<?xml version="1.0" encoding="UTF-8"?>',
            '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:media="http://search.yahoo.com/mrss/">',
            "<channel>",
            f"<title>{escape(site_name or 'Lumina')}</title>",
            f"<description>{escape(site_description or '')}</description>",
            f"<link>{escape(feed_link)}</link>",
            (
                '<atom:link href="'
                f'{escape(feed_self_link)}'
                '" rel="self" type="application/rss+xml" />'
            ),
        ]

        for review in reviews:
            review_link = self._build_review_feed_url(
                base_url,
                f"/reviews/{review.slug}",
            )
            title = (review.title or "").strip() or "回顾"
            summary = self._build_issue_excerpt(review.markdown_content)
            description_parts: list[str] = []
            if summary:
                description_parts.append(f"<p>{escape(summary)}</p>")
            top_image_url = self._normalize_public_asset_url(base_url, review.top_image)
            pub_date = self._to_rfc2822_datetime(review.published_at or review.created_at)
            lines.extend(
                [
                    "<item>",
                    f"<title>{escape(title)}</title>",
                    f"<link>{escape(review_link)}</link>",
                    f'<guid isPermaLink="true">{escape(review_link)}</guid>',
                    (
                        "<description><![CDATA["
                        f"{''.join(description_parts)}"
                        "]]></description>"
                    ),
                ]
            )
            if top_image_url:
                lines.append(
                    f'<enclosure url="{escape(top_image_url)}" type="image/*" />'
                )
                lines.append(
                    f'<media:content url="{escape(top_image_url)}" medium="image" />'
                )
            if pub_date:
                lines.append(f"<pubDate>{escape(pub_date)}</pubDate>")
            lines.append("</item>")

        lines.extend(["</channel>", "</rss>"])
        return "\n".join(lines)

    def _get_next_issue_number(self, db: Session, template_id: str) -> int:
        published_count = (
            db.query(func.count(ReviewIssue.id))
            .filter(ReviewIssue.template_id == template_id)
            .filter(ReviewIssue.status == "published")
            .scalar()
            or 0
        )
        return int(published_count) + 1

    def _get_issue_number_for_window(
        self,
        db: Session,
        template_id: str,
        window_start: str,
        window_end: str,
    ) -> int:
        published_prior_window_count = (
            db.query(func.count(ReviewIssue.id))
            .filter(ReviewIssue.template_id == template_id)
            .filter(ReviewIssue.status == "published")
            .filter(
                or_(
                    ReviewIssue.window_start < window_start,
                    and_(
                        ReviewIssue.window_start == window_start,
                        ReviewIssue.window_end < window_end,
                    ),
                )
            )
            .scalar()
            or 0
        )
        return int(published_prior_window_count) + 1

    def _build_fallback_issue_title(
        self,
        db: Session,
        template: ReviewTemplate,
        issue: ReviewIssue,
    ) -> str:
        return self._render_title(
            template.title_template,
            period_label=self._period_label_for_issue(issue),
            template_name=template.name,
            issue_number=self._get_issue_number_for_window(
                db,
                template.id,
                issue.window_start,
                issue.window_end,
            ),
        )

    def _render_title(
        self,
        title_template: str | None,
        *,
        period_label: str,
        template_name: str,
        issue_number: int,
    ) -> str:
        template = (title_template or DEFAULT_REVIEW_TITLE_TEMPLATE).strip() or DEFAULT_REVIEW_TITLE_TEMPLATE
        return template.format(
            period_label=period_label,
            template_name=template_name,
            issue_number=issue_number,
        )

    def _resolve_issue_top_image(self, articles: list[Article]) -> str | None:
        for article in articles:
            top_image = (article.top_image or "").strip()
            if top_image:
                return top_image
        return None

    def _resolve_issue_top_image_for_output(
        self,
        db: Session,
        issue: ReviewIssue,
    ) -> str:
        current_top_image = (issue.top_image or "").strip()
        if self._is_public_asset_url_available(current_top_image):
            return current_top_image

        fallback_rows = (
            db.query(Article.top_image)
            .join(ReviewIssueArticle, ReviewIssueArticle.article_id == Article.id)
            .filter(ReviewIssueArticle.issue_id == issue.id)
            .order_by(
                ReviewIssueArticle.category_sort_order.asc(),
                ReviewIssueArticle.article_sort_order.asc(),
                ReviewIssueArticle.id.asc(),
            )
            .all()
        )
        for (candidate_top_image,) in fallback_rows:
            normalized_candidate = (candidate_top_image or "").strip()
            if self._is_public_asset_url_available(normalized_candidate):
                return normalized_candidate
        return ""

    def _is_public_asset_url_available(self, url: str | None) -> bool:
        normalized_url = (url or "").strip()
        if not normalized_url:
            return False
        if normalized_url.startswith(("http://", "https://")):
            return True

        rel_path = self._extract_internal_media_rel_path(normalized_url)
        if not rel_path:
            return True
        return (MEDIA_ROOT / rel_path).exists()

    def _extract_internal_media_rel_path(self, url: str) -> str | None:
        normalized_url = (url or "").strip()
        if not normalized_url:
            return None
        parsed = urlparse(normalized_url)
        path = (parsed.path or normalized_url).replace("\\", "/")
        for prefix in ("/media/", "/backend/media/"):
            if path.startswith(prefix):
                rel_path = path[len(prefix) :].lstrip("/")
                return rel_path or None
        return None

    def _build_review_feed_url(
        self,
        base_url: str,
        path: str,
        *,
        template_id: str | None = None,
    ) -> str:
        normalized_base = self._normalize_public_base_url(base_url)
        normalized_path = path if path.startswith("/") else f"/{path}"
        template_value = (template_id or "").strip()
        if not template_value:
            return f"{normalized_base}{normalized_path}"
        return f"{normalized_base}{normalized_path}?{urlencode({'template_id': template_value})}"

    def _normalize_public_base_url(self, public_base_url: str | None) -> str:
        base_url = (public_base_url or "").strip().rstrip("/")
        return base_url or ""

    def _normalize_public_asset_url(self, public_base_url: str | None, url: str | None) -> str:
        normalized_url = (url or "").strip()
        if not normalized_url:
            return ""
        if normalized_url.startswith(("http://", "https://")):
            return normalized_url
        if normalized_url.startswith("/"):
            return f"{self._normalize_public_base_url(public_base_url)}{normalized_url}"
        return normalized_url

    def _to_rfc2822_datetime(self, value: str | None) -> str | None:
        normalized = (value or "").strip()
        if not normalized:
            return None
        try:
            dt = datetime.fromisoformat(normalized.replace("Z", "+00:00"))
        except ValueError:
            return None
        return format_rfc2822_datetime(dt)

    def _build_issue_slug(
        self,
        db: Session,
        template: ReviewTemplate,
        run_date: date,
        period_label: str,
    ) -> str:
        safe_period = period_label.replace(" ", "-").replace("~", "to")
        base_slug = f"{template.slug}-{run_date.isoformat()}-{safe_period}".lower()
        slug = base_slug
        suffix = 2
        while db.query(ReviewIssue.id).filter(ReviewIssue.slug == slug).first():
            slug = f"{base_slug}-v{suffix}"
            suffix += 1
        return slug

    def _promote_issue_slug_on_publish(self, db: Session, issue: ReviewIssue) -> None:
        canonical_slug = self._canonicalize_issue_slug(issue.slug)
        if canonical_slug == issue.slug:
            return

        conflicting_issue = (
            db.query(ReviewIssue)
            .filter(ReviewIssue.slug == canonical_slug)
            .filter(ReviewIssue.id != issue.id)
            .first()
        )
        if conflicting_issue:
            conflicting_issue.slug = self._build_versioned_slug_from_base(
                db,
                canonical_slug,
                ignore_issue_id=conflicting_issue.id,
            )
            db.flush()
        issue.slug = canonical_slug

    def _canonicalize_issue_slug(self, slug: str | None) -> str:
        normalized = (slug or "").strip().lower()
        if not normalized:
            return ""
        return ISSUE_SLUG_VERSION_SUFFIX_PATTERN.sub("", normalized)

    def _build_versioned_slug_from_base(
        self,
        db: Session,
        base_slug: str,
        *,
        ignore_issue_id: str | None = None,
    ) -> str:
        suffix = 2
        while True:
            candidate = f"{base_slug}-v{suffix}"
            query = db.query(ReviewIssue.id).filter(ReviewIssue.slug == candidate)
            if ignore_issue_id:
                query = query.filter(ReviewIssue.id != ignore_issue_id)
            if not query.first():
                return candidate
            suffix += 1

    def _normalize_article_ids(self, article_ids: list[str]) -> list[str]:
        normalized: list[str] = []
        seen: set[str] = set()
        for article_id in article_ids:
            value = (article_id or "").strip()
            if not value or value in seen:
                continue
            normalized.append(value)
            seen.add(value)
        return normalized

    def _parse_date_string(self, value: str) -> date:
        try:
            return datetime.strptime(value, "%Y-%m-%d").date()
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="日期格式应为 YYYY-MM-DD") from exc

    def _parse_datetime(self, value: str, tz: ZoneInfo) -> datetime:
        raw = value.replace("Z", "+00:00")
        parsed = datetime.fromisoformat(raw)
        if parsed.tzinfo is None:
            return parsed.replace(tzinfo=tz)
        return parsed.astimezone(tz)

    def _combine_date_with_midnight(self, value: date, tz: ZoneInfo) -> str:
        return datetime.combine(value, time.min, tzinfo=tz).isoformat()

    def _combine_date_with_trigger_time(self, value: date, trigger_time: str, tz: ZoneInfo) -> str:
        hours, minutes = (trigger_time or "09:00").split(":")
        trigger = time(hour=int(hours), minute=int(minutes))
        return datetime.combine(value, trigger, tzinfo=tz).isoformat()
