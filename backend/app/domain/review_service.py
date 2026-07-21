from __future__ import annotations

from datetime import datetime
from email.utils import format_datetime as format_rfc2822_datetime
from html import escape, unescape
from pathlib import Path
import re
from typing import Any
from urllib.parse import urlencode, urlparse

from fastapi import HTTPException
from sqlalchemy import and_, case, func, or_
from sqlalchemy.orm import Session, joinedload

from app.core.settings import get_settings
from app.domain.comment_utils import build_user_github_url
from slug_utils import generate_slug
from models import (
    generate_uuid,
    Article,
    Category,
    ReviewComment,
    ReviewIssue,
    ReviewIssueArticle,
    ReviewTemplate,
    now_str,
)

REVIEW_ARTICLE_SECTIONS_PLACEHOLDER = "{{review_article_sections}}"
SINGLE_BRACE_REVIEW_ARTICLE_SECTIONS_PATTERN = re.compile(
    r"(?<!\{)\{review_article_sections\}(?!\})"
)
ARTICLE_PLACEHOLDER_PATTERN = re.compile(r"\{\{([a-z0-9][a-z0-9-]*)\}\}")
SINGLE_BRACE_TEMPLATE_TOKEN_PATTERN = re.compile(
    r"(?<!\{)\{([a-zA-Z_][a-zA-Z0-9_]*)\}(?!\})"
)
MARKDOWN_HEADING_PATTERN = re.compile(r"^(#{1,6})\s+.+$")
MARKDOWN_BLOCKQUOTE_PATTERN = re.compile(r"^\s{0,3}>")
MARKDOWN_REFERENCE_ATTRIBUTION_PATTERN = re.compile(
    r"^(?:\u2014{1,2}|--)\s*\[[^\]]+\]\([^)]+\)\s*$"
)

DEFAULT_NEW_ISSUE_TITLE = "新建文章"
MEDIA_ROOT = Path(get_settings().media.root)



class ReviewService:
    RSS_ITEM_LIMIT = 50


    def enqueue_manual_issue_task(
        self,
        db: Session,
        template: ReviewTemplate,
        *,
        title: str | None = None,
    ) -> tuple[ReviewIssue, str | None]:

        issue_title = (title or "").strip() or DEFAULT_NEW_ISSUE_TITLE
        issue_id = generate_uuid()
        issue = ReviewIssue(
            id=issue_id,
            template_id=template.id,
            slug=self._build_draft_issue_slug(db, template, issue_id),
            slug_locked=False,
            title=issue_title,
            status="draft",
            markdown_content=self.build_default_markdown(issue_title),
            created_at=now_str(),
            updated_at=now_str(),
        )
        db.add(issue)
        db.commit()
        db.refresh(issue)
        return issue, None

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
        total = base_query.count()
        issues = (
            base_query
            .options(joinedload(ReviewIssue.template))
            .order_by(*self._issue_list_order_by())
            .offset(max(0, (page - 1) * size))
            .limit(size)
            .all()
        )
        return [self.serialize_issue_card(db, issue) for issue in issues], total

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
        rows = (
            base_query
            .with_entities(
                ReviewIssue.template_id.label("template_id"),
                func.count(ReviewIssue.id).label("count"),
            )
            .group_by(ReviewIssue.template_id)
            .all()
        )
        counts_by_template = {
            row.template_id: int(row.count or 0)
            for row in rows
            if row.template_id
        }
        template_ids = list(counts_by_template.keys())
        template_meta: dict[str, dict[str, str]] = {}
        if template_ids:
            template_meta_rows = (
                db.query(
                    ReviewTemplate.id,
                    ReviewTemplate.name,
                    ReviewTemplate.slug,
                    ReviewTemplate.color,
                    ReviewTemplate.sort_order,
                )
                .filter(ReviewTemplate.id.in_(template_ids))
                .all()
            )
            template_meta = {
                row.id: {
                    "name": row.name,
                    "slug": row.slug,
                    "color": row.color or "#3B82F6",
                    "sort_order": int(row.sort_order or 0),
                }
                for row in template_meta_rows
            }
        total_count = sum(counts_by_template.values())
        items = [
            {
                "id": "",
                "name": "全部",
                "slug": "",
                "color": None,
                "count": total_count,
            }
        ]
        ordered = sorted(
            [
                template_id
                for template_id in template_ids
                if template_id in template_meta
            ],
            key=lambda tid: (
                template_meta[tid]["sort_order"],
                template_meta[tid]["name"],
                tid,
            ),
        )
        items.extend(
            {
                "id": template_id_value,
                "name": template_meta[template_id_value]["name"],
                "slug": template_meta[template_id_value]["slug"],
                "color": template_meta[template_id_value]["color"],
                "count": counts_by_template[template_id_value],
            }
            for template_id_value in ordered
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
            raise HTTPException(status_code=404, detail="专栏文章不存在")
        return issue

    def get_issue_by_id(self, db: Session, issue_id: str) -> ReviewIssue:
        issue = (
            db.query(ReviewIssue)
            .options(joinedload(ReviewIssue.template))
            .filter(ReviewIssue.id == issue_id)
            .first()
        )
        if not issue:
            raise HTTPException(status_code=404, detail="专栏文章不存在")
        return issue

    def validate_review_markdown(self, markdown_content: str) -> None:
        count = markdown_content.count(REVIEW_ARTICLE_SECTIONS_PLACEHOLDER)
        if count > 1:
            raise HTTPException(status_code=400, detail="旧版文章段落占位符只能保留一次")

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



    def build_default_markdown(
        self,
        title: str,
        *,
        article_outline_markdown: str | None = None,
    ) -> str:
        article_outline = (article_outline_markdown or "").strip() or REVIEW_ARTICLE_SECTIONS_PLACEHOLDER
        return (
            f"# {title}\n\n"
            "> 专栏草稿，可在发布前继续编辑。\n\n"
            "## 正文\n\n"
            "请在这里补充专栏正文。\n\n"
            f"{article_outline}\n"
        )

    def serialize_issue_card(self, db: Session, issue: ReviewIssue) -> dict[str, Any]:
        (
            category_names_map,
            comment_count_map,
            top_image_map,
        ) = self._load_issue_card_resolution_maps(
            db,
            [issue],
            include_hidden=False,
        )
        return self._serialize_issue_card_from_resolved(
            issue,
            categories=category_names_map.get(issue.id, []),
            top_image=top_image_map.get(issue.id, ""),
            comment_count=comment_count_map.get(issue.id, 0),
        )

    def _serialize_issue_card_from_resolved(
        self,
        issue: ReviewIssue,
        *,
        categories: list[str],
        top_image: str,
        comment_count: int,
    ) -> dict[str, Any]:
        return {
            "id": issue.id,
            "slug": issue.slug,
            "title": issue.title,
            "status": issue.status,
            "top_image": top_image,
            "generated_at": issue.generated_at,
            "published_at": issue.published_at,
            "created_at": issue.created_at,
            "updated_at": issue.updated_at,
            "template": self._serialize_template_summary(issue.template),
            "category_names": categories,
            "summary": self._build_issue_excerpt(issue.markdown_content),
            "view_count": int(issue.view_count or 0),
            "comment_count": int(comment_count or 0),
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
            "user_github_url": build_user_github_url(
                comment.provider,
                comment.user_id,
                comment.github_username,
                comment.user_name,
            ),
            "provider": comment.provider,
            "content": comment.content,
            "reply_to_id": comment.reply_to_id,
            "is_hidden": bool(comment.is_hidden),
            "created_at": comment.created_at,
            "updated_at": comment.updated_at,
        }







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
        referenced_slugs = self._extract_article_placeholders(issue.markdown_content)
        missing_slugs = [slug for slug in referenced_slugs if slug not in blocks]
        if missing_slugs:
            extra_articles = (
                db.query(Article)
                .options(joinedload(Article.ai_analysis))
                .filter(Article.slug.in_(missing_slugs))
                .filter(Article.is_visible == True)
                .all()
            )
            for article in extra_articles:
                slug = (article.slug or "").strip()
                if not slug or slug in blocks:
                    continue
                item = {
                    "title": (article.title_trans or "").strip() or article.title,
                    "slug": slug,
                    "summary": (article.ai_analysis.summary if article.ai_analysis else "")
                    or "（暂无摘要）",
                    "top_image": article.top_image or "",
                    "hidden": False,
                }
                block_lines = [self._build_article_heading_link(item)]
                if item["top_image"]:
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
        rendered = "\n".join(rendered_lines).strip()
        return self._prune_empty_markdown_headings(rendered)

    def _issue_list_order_by(self) -> tuple[Any, ...]:
        return (
            case((ReviewIssue.published_at.is_(None), 0), else_=1).asc(),
            ReviewIssue.published_at.desc(),
            ReviewIssue.created_at.desc(),
            ReviewIssue.id.desc(),
        )






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
        query = db.query(ReviewIssue)
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


    def _load_issue_category_names_map(
        self,
        db: Session,
        issue_ids: list[str],
    ) -> dict[str, list[str]]:
        if not issue_ids:
            return {}
        rows = (
            db.query(ReviewIssueArticle.issue_id, Category.name)
            .join(Category, ReviewIssueArticle.category_id == Category.id)
            .filter(ReviewIssueArticle.issue_id.in_(issue_ids))
            .order_by(
                ReviewIssueArticle.issue_id.asc(),
                ReviewIssueArticle.category_sort_order.asc(),
                Category.name.asc(),
            )
            .all()
        )
        category_names_map: dict[str, list[str]] = {issue_id: [] for issue_id in issue_ids}
        seen_names_map: dict[str, set[str]] = {issue_id: set() for issue_id in issue_ids}
        for issue_id, category_name in rows:
            if not issue_id or not category_name or category_name in seen_names_map[issue_id]:
                continue
            category_names_map[issue_id].append(category_name)
            seen_names_map[issue_id].add(category_name)
        return category_names_map

    def _load_issue_comment_count_map(
        self,
        db: Session,
        issue_ids: list[str],
        *,
        include_hidden: bool,
    ) -> dict[str, int]:
        if not issue_ids:
            return {}
        query = (
            db.query(ReviewComment.issue_id, func.count(ReviewComment.id))
            .filter(ReviewComment.issue_id.in_(issue_ids))
        )
        if not include_hidden:
            query = query.filter(
                (ReviewComment.is_hidden == False) | (ReviewComment.is_hidden.is_(None))
            )
        rows = query.group_by(ReviewComment.issue_id).all()
        count_map = {issue_id: 0 for issue_id in issue_ids}
        count_map.update({issue_id: int(count or 0) for issue_id, count in rows if issue_id})
        return count_map

    def _load_issue_card_resolution_maps(
        self,
        db: Session,
        issues: list[ReviewIssue],
        *,
        include_hidden: bool,
    ) -> tuple[dict[str, list[str]], dict[str, int], dict[str, str]]:
        issue_ids = [issue.id for issue in issues]
        return (
            self._load_issue_category_names_map(db, issue_ids),
            self._load_issue_comment_count_map(
                db,
                issue_ids,
                include_hidden=include_hidden,
            ),
            self._load_issue_top_images_for_output(db, issues),
        )

    def _build_issue_excerpt(self, markdown_content: str | None) -> str:
        raw = (markdown_content or "").replace(REVIEW_ARTICLE_SECTIONS_PLACEHOLDER, "").strip()
        for paragraph in re.split(r"\n\s*\n+", raw):
            lines = [line.strip() for line in paragraph.splitlines() if line.strip()]
            if not lines:
                continue
            if all(MARKDOWN_HEADING_PATTERN.match(line) for line in lines):
                continue
            if all(MARKDOWN_BLOCKQUOTE_PATTERN.match(line) for line in lines):
                continue
            if all(MARKDOWN_REFERENCE_ATTRIBUTION_PATTERN.match(line) for line in lines):
                continue
            return " ".join(lines)
        return ""


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
            "color": getattr(template, "color", None) or "#3B82F6",
            "sort_order": int(getattr(template, "sort_order", 0) or 0),
        }

    def _serialize_template_detail(
        self,
        db: Session,
        template: ReviewTemplate | None,
    ) -> dict[str, Any] | None:
        if not template:
            return None
        del db
        return {
            **self._serialize_template_summary(template),
            "description": template.description,
            "category_names": [],
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
            "/columns",
            template_id=template_id,
        )
        feed_self_link = self._build_review_feed_url(
            base_url,
            "/backend/api/columns/rss.xml",
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
                f"/columns/{review.slug}",
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



    def _build_fallback_issue_title(
        self,
        db: Session,
        template: ReviewTemplate,
        issue: ReviewIssue,
    ) -> str:
        del db, template, issue
        return DEFAULT_NEW_ISSUE_TITLE



    def _resolve_issue_top_image(self, articles: list[Article]) -> str | None:
        for article in articles:
            top_image = (article.top_image or "").strip()
            if top_image:
                return top_image
        return None

    def _load_issue_top_images_for_output(
        self,
        db: Session,
        issues: list[ReviewIssue],
    ) -> dict[str, str]:
        if not issues:
            return {}
        availability_cache: dict[str, bool] = {}

        def is_available(url: str | None) -> bool:
            normalized_url = (url or "").strip()
            if normalized_url not in availability_cache:
                availability_cache[normalized_url] = self._is_public_asset_url_available(
                    normalized_url
                )
            return availability_cache[normalized_url]

        top_image_map: dict[str, str] = {}
        unresolved_ids: list[str] = []
        for issue in issues:
            current_top_image = (issue.top_image or "").strip()
            if is_available(current_top_image):
                top_image_map[issue.id] = current_top_image
                continue
            unresolved_ids.append(issue.id)

        if unresolved_ids:
            rows = (
                db.query(ReviewIssueArticle.issue_id, Article.top_image)
                .join(Article, ReviewIssueArticle.article_id == Article.id)
                .filter(ReviewIssueArticle.issue_id.in_(unresolved_ids))
                .order_by(
                    ReviewIssueArticle.issue_id.asc(),
                    ReviewIssueArticle.category_sort_order.asc(),
                    ReviewIssueArticle.article_sort_order.asc(),
                    ReviewIssueArticle.id.asc(),
                )
                .all()
            )
            for issue_id, candidate_top_image in rows:
                if issue_id in top_image_map:
                    continue
                normalized_candidate = (candidate_top_image or "").strip()
                if is_available(normalized_candidate):
                    top_image_map[issue_id] = normalized_candidate

        for issue in issues:
            top_image_map.setdefault(issue.id, "")
        return top_image_map

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

    def _prune_empty_markdown_headings(self, markdown_content: str) -> str:
        lines = (markdown_content or "").splitlines()
        if not lines:
            return ""
        changed = True
        while changed:
            changed = False
            next_lines: list[str] = []
            index = 0
            while index < len(lines):
                line = lines[index]
                heading_match = MARKDOWN_HEADING_PATTERN.match(line.strip())
                if not heading_match or len(heading_match.group(1)) == 1:
                    next_lines.append(line)
                    index += 1
                    continue

                heading_level = len(heading_match.group(1))
                probe_index = index + 1
                while probe_index < len(lines) and not lines[probe_index].strip():
                    probe_index += 1
                if probe_index >= len(lines):
                    changed = True
                    index = probe_index
                    continue
                next_heading_match = MARKDOWN_HEADING_PATTERN.match(
                    lines[probe_index].strip()
                )
                if next_heading_match and len(next_heading_match.group(1)) <= heading_level:
                    changed = True
                    index = probe_index
                    continue
                next_lines.append(line)
                index += 1
            lines = next_lines
        return "\n".join(lines).strip()

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

    def _column_slug_token(self, template: ReviewTemplate | None) -> str:
        raw = ((template.slug if template else "") or "").strip().lower()
        token = generate_slug(raw or "column", max_length=40)
        return token or "column"

    def _build_draft_issue_slug(
        self,
        db: Session,
        template: ReviewTemplate,
        issue_id: str,
    ) -> str:
        column = self._column_slug_token(template)
        short_id = (issue_id or "").replace("-", "")[:8] or generate_uuid().replace("-", "")[:8]
        base_slug = f"draft-{column}-{short_id}".lower()
        slug = base_slug
        suffix = 2
        while db.query(ReviewIssue.id).filter(ReviewIssue.slug == slug).first():
            slug = f"{base_slug}-{suffix}"
            suffix += 1
        return slug

    def _build_published_issue_slug(
        self,
        db: Session,
        issue: ReviewIssue,
        *,
        ignore_issue_id: str | None = None,
    ) -> str:
        template = issue.template
        if template is None and issue.template_id:
            template = (
                db.query(ReviewTemplate)
                .filter(ReviewTemplate.id == issue.template_id)
                .first()
            )
        column = self._column_slug_token(template)
        title_slug = generate_slug((issue.title or "").strip() or "untitled", max_length=50)
        base_slug = f"{column}-{title_slug}".lower().strip("-")
        if not base_slug:
            base_slug = f"{column}-untitled"
        # Avoid colliding with draft placeholder namespace for clarity.
        if base_slug.startswith("draft-"):
            base_slug = f"col-{base_slug}"

        slug = base_slug
        suffix = 2
        while True:
            query = db.query(ReviewIssue.id).filter(ReviewIssue.slug == slug)
            if ignore_issue_id:
                query = query.filter(ReviewIssue.id != ignore_issue_id)
            if not query.first():
                return slug
            slug = f"{base_slug}-{suffix}"
            suffix += 1

    def _is_draft_placeholder_slug(self, slug: str | None) -> bool:
        normalized = (slug or "").strip().lower()
        return normalized.startswith("draft-")

    def _promote_issue_slug_on_publish(self, db: Session, issue: ReviewIssue) -> None:
        # Once locked (usually after first publish), never rewrite public URL.
        if bool(getattr(issue, "slug_locked", False)):
            return

        title = (issue.title or "").strip()
        if not title:
            raise HTTPException(status_code=400, detail="发布前请先填写专栏文章标题")

        # Existing non-draft public-looking slugs (legacy data) stay as-is and lock.
        if issue.slug and not self._is_draft_placeholder_slug(issue.slug):
            issue.slug_locked = True
            return

        issue.slug = self._build_published_issue_slug(
            db,
            issue,
            ignore_issue_id=issue.id,
        )
        issue.slug_locked = True

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




