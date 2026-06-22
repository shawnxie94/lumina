import ipaddress
import json
import logging
import re
import socket
from datetime import datetime, timezone
from urllib.parse import urlparse

from ai_client import is_english_content
from media_service import maybe_ingest_article_images_with_stats, maybe_ingest_top_image
from models import AIAnalysis, AITask, Article, Category, generate_uuid, now_str
from slug_utils import generate_article_slug
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.domain.ai_task_service import AITaskService
from app.domain.article_ai_version_service import ArticleAIVersionService
from app.domain.article_extraction_service import (
    ArticleExtractionError,
    ArticleExtractionService,
)
from app.domain.article_top_image_service import resolve_top_image
from auth import get_admin_settings

logger = logging.getLogger("article_service")

DELETABLE_AI_CONTENT_FIELDS: dict[str, tuple[str, ...]] = {
    "outline": ("outline", "outline_status"),
    "quotes": ("quotes", "quotes_status"),
}


def _complete_published_at_time(published_at: str | None) -> str | None:
    """
    如果 published_at 只有日期部分（YYYY-MM-DD），自动补全当前时分秒。
    如果已有时间部分或为空，则原样返回。
    """
    if not published_at:
        return None
    raw = published_at.strip()
    # 只补全纯日期格式（YYYY-MM-DD 或 YYYY/MM/DD）
    if re.match(r"^\d{4}[-/]\d{2}[-/]\d{2}$", raw):
        current_time = datetime.now(timezone.utc).isoformat()
        # current_time 格式: 2026-04-06T09:30:45.123456+00:00
        # 提取时分秒部分
        time_part = current_time[11:19]  # 取 "09:30:45"
        # 将 YYYY-MM-DD 转换为标准格式并拼接时间
        normalized_date = raw.replace("/", "-")
        return f"{normalized_date}T{time_part}"
    return raw


class ArticleCommandService:
    def __init__(
        self,
        ai_task_service: AITaskService | None = None,
        article_extraction_service: ArticleExtractionService | None = None,
    ):
        self.ai_task_service = ai_task_service or AITaskService()
        self.article_extraction_service = (
            article_extraction_service or ArticleExtractionService()
        )
        self.article_ai_version_service = ArticleAIVersionService()

    def _resolve_post_process_options(self, article_data: dict, db: Session) -> dict:
        if bool(article_data.get("skip_ai_processing")):
            return {
                "cleaning": False,
                "classification": False,
                "summary": False,
                "outline": False,
                "quotes": False,
                "tagging": False,
                "translation": False,
        }
        requested = article_data.get("post_process_options")
        if isinstance(requested, dict):
            return {
                "cleaning": False,
                "classification": bool(requested.get("classification")),
                "summary": bool(requested.get("summary")),
                "outline": bool(requested.get("outline")),
                "quotes": bool(requested.get("quotes")),
                "tagging": bool(requested.get("tagging")),
                "translation": bool(requested.get("translation")),
            }
        admin = get_admin_settings(db)

        def enabled_by_default(name: str) -> bool:
            return getattr(admin, name, True) is not False

        return {
            "cleaning": False,
            "classification": enabled_by_default("auto_ai_classification_enabled"),
            "summary": enabled_by_default("auto_ai_summary_enabled"),
            "outline": bool(getattr(admin, "auto_ai_outline_enabled", False)),
            "quotes": bool(getattr(admin, "auto_ai_quotes_enabled", False)),
            "tagging": enabled_by_default("auto_ai_tagging_enabled"),
            "translation": enabled_by_default("auto_translation_enabled"),
        }

    def _has_post_process_work(self, options: dict) -> bool:
        return any(bool(value) for value in options.values())

    def _ensure_public_source_url(self, url: str) -> None:
        parsed = urlparse((url or "").strip())
        if parsed.scheme not in {"http", "https"}:
            raise ValueError("重新抓取HTML仅支持 http 或 https URL")
        hostname = (parsed.hostname or "").strip().lower()
        if not hostname:
            raise ValueError("重新抓取HTML的来源URL缺少主机名")
        if hostname == "localhost":
            raise ValueError("不允许访问内网或本机地址")

        try:
            host_ip = ipaddress.ip_address(hostname)
        except ValueError:
            host_ip = None

        if host_ip is not None:
            if self._is_disallowed_ip(host_ip):
                raise ValueError("不允许访问内网或本机地址")
            return

        try:
            records = socket.getaddrinfo(hostname, None, type=socket.SOCK_STREAM)
        except OSError:
            return

        for record in records:
            try:
                ip_obj = ipaddress.ip_address(record[4][0])
            except ValueError:
                continue
            if self._is_disallowed_ip(ip_obj):
                raise ValueError("不允许访问内网或本机地址")

    def _is_disallowed_ip(
        self,
        ip_obj: ipaddress.IPv4Address | ipaddress.IPv6Address,
    ) -> bool:
        return bool(
            ip_obj.is_private
            or ip_obj.is_loopback
            or ip_obj.is_link_local
            or ip_obj.is_reserved
            or ip_obj.is_multicast
            or ip_obj.is_unspecified
        )

    async def _apply_jina_html_cleaning_if_enabled(
        self,
        article_data: dict,
        db: Session,
    ) -> dict:
        if article_data.get("extraction_provider"):
            return article_data
        content_html = (article_data.get("content_html") or "").strip()
        if not content_html:
            return article_data
        extraction_settings = self.article_extraction_service.resolve_settings(db)
        if (
            not extraction_settings.jina_reader_enabled
            or extraction_settings.jina_reader_prefer_mode == "local_only"
        ):
            return article_data

        try:
            extracted = await self.article_extraction_service.extract_html(
                db,
                html=content_html,
                source_url=article_data.get("source_url"),
                title=article_data.get("title"),
                top_image=article_data.get("top_image"),
                author=article_data.get("author"),
                published_at=article_data.get("published_at"),
                source_domain=article_data.get("source_domain"),
            )
        except ArticleExtractionError as exc:
            metadata = {
                "attempts": [{"provider": "jina_html", "error": exc.detail}]
            }
            return {
                **article_data,
                "extraction_provider": "direct",
                "extraction_status": "fallback_used",
                "extraction_error": exc.detail,
                "extraction_metadata": json.dumps(metadata, ensure_ascii=False),
            }

        return {
            **article_data,
            "title": extracted.title or article_data.get("title"),
            "content_html": extracted.content_html,
            "content_md": extracted.content_md,
            "content_structured": None,
            "source_url": extracted.source_url or article_data.get("source_url"),
            "top_image": extracted.top_image or article_data.get("top_image"),
            "author": extracted.author or article_data.get("author"),
            "published_at": extracted.published_at or article_data.get("published_at"),
            "source_domain": extracted.source_domain or article_data.get("source_domain"),
            "extraction_provider": extracted.provider,
            "extraction_status": extracted.status,
            "extraction_error": extracted.error,
            "extraction_metadata": self.article_extraction_service.metadata_to_json(
                extracted.metadata
            ),
        }

    def _enqueue_configured_post_process(
        self,
        db: Session,
        article: Article,
        category_id: str | None,
        source_format: str,
        options: dict,
    ) -> None:
        payload = {
            "category_id": category_id,
            "post_process_options": options,
        }
        if options.get("cleaning"):
            self.ai_task_service.enqueue_task(
                db,
                task_type="process_article_cleaning",
                article_id=article.id,
                content_type="content_cleaning",
                payload={
                    **payload,
                    "source_format": source_format,
                    "strategy": "auto",
                    "chunk_cursor": 0,
                },
            )
            return

        interpretation_fields = (
            "classification",
            "tagging",
            "summary",
            "outline",
            "quotes",
        )
        if any(options.get(field) for field in interpretation_fields):
            self.ai_task_service.enqueue_task(
                db,
                task_type="process_article_interpretation",
                article_id=article.id,
                content_type="interpretation",
                payload=payload,
            )
            return

        if options.get("classification"):
            self.ai_task_service.enqueue_task(
                db,
                task_type="process_article_classification",
                article_id=article.id,
                content_type="classification",
                payload=payload,
            )
            return

        if options.get("tagging"):
            self.ai_task_service.enqueue_task(
                db,
                task_type="process_article_tagging",
                article_id=article.id,
                content_type="tagging",
                payload={"category_id": category_id},
            )
        if options.get("summary"):
            self.ai_task_service.enqueue_task(
                db,
                task_type="process_ai_content",
                article_id=article.id,
                content_type="summary",
                payload={"category_id": category_id},
            )
        for content_type in ("outline", "quotes"):
            if options.get(content_type):
                self.ai_task_service.enqueue_task(
                    db,
                    task_type="process_ai_content",
                    article_id=article.id,
                    content_type=content_type,
                    payload={"category_id": category_id},
                )
        if options.get("translation") and article.content_md and is_english_content(
            article.content_md
        ):
            article.translation_status = "pending"
            article.translation_error = None
            db.commit()
            self.ai_task_service.enqueue_task(
                db,
                task_type="process_article_translation",
                article_id=article.id,
                content_type="translation",
                payload={"category_id": category_id},
            )
        elif options.get("translation"):
            article.translation_status = "skipped"
            article.translation_error = None
            db.commit()

    async def _ensure_article_html_for_cleaning(
        self,
        db: Session,
        article: Article,
    ) -> None:
        if (article.content_html or "").strip():
            return
        source_url = (article.source_url or "").strip()
        if not source_url:
            raise ValueError("文章缺少HTML正文和来源URL，无法重新抓取后清洗")

        self._ensure_public_source_url(source_url)
        try:
            extracted = await self.article_extraction_service.extract_url(
                db,
                source_url,
                ensure_public_url=self._ensure_public_source_url,
            )
        except ArticleExtractionError as exc:
            raise ValueError(f"重新抓取HTML失败: {exc.detail}") from exc

        if not (extracted.content_html or "").strip():
            raise ValueError("重新抓取后仍未获得HTML正文，无法清洗")

        article.content_html = extracted.content_html
        article.content_md = extracted.content_md or article.content_md
        article.source_url = extracted.source_url or article.source_url
        article.top_image = extracted.top_image or article.top_image
        article.author = extracted.author or article.author
        article.published_at = extracted.published_at or article.published_at
        article.source_domain = extracted.source_domain or article.source_domain
        article.extraction_provider = extracted.provider
        article.extraction_status = extracted.status
        article.extraction_error = extracted.error
        article.extraction_metadata = self.article_extraction_service.metadata_to_json(
            extracted.metadata
        )
        db.commit()
        db.refresh(article)

    async def create_article(self, article_data: dict, db: Session) -> str:
        article_data = await self._apply_jina_html_cleaning_if_enabled(article_data, db)
        if not article_data.get("content_html") and not article_data.get("content_md"):
            raise ValueError("文章内容不能为空")
        skip_ai_processing = bool(article_data.get("skip_ai_processing"))
        post_process_options = self._resolve_post_process_options(article_data, db)

        _category = (
            db.query(Category)
            .filter(Category.id == article_data.get("category_id"))
            .first()
        )

        content_structured = article_data.get("content_structured")
        if isinstance(content_structured, (dict, list)):
            content_structured = json.dumps(content_structured, ensure_ascii=False)

        content_for_lang = article_data.get("content_html") or article_data.get("content_md") or ""
        original_language = "en" if is_english_content(content_for_lang) else "zh"

        source_url = article_data.get("source_url")
        if source_url == "":
            source_url = None

        top_image = resolve_top_image(
            article_data.get("top_image"),
            content_html=article_data.get("content_html"),
            content_md=article_data.get("content_md"),
            base_url=source_url,
        )

        article_id = generate_uuid()
        article = Article(
            id=article_id,
            title=article_data.get("title"),
            slug=generate_article_slug(article_data.get("title"), article_id),
            content_html=article_data.get("content_html"),
            content_structured=content_structured,
            content_md=article_data.get("content_md"),
            source_url=source_url,
            top_image=top_image,
            author=article_data.get("author"),
            published_at=_complete_published_at_time(article_data.get("published_at")),
            source_domain=article_data.get("source_domain"),
            category_id=article_data.get("category_id"),
            status="completed",
            translation_status="skipped"
            if skip_ai_processing or not post_process_options.get("translation")
            else None,
            original_language=original_language,
            extraction_provider=article_data.get("extraction_provider") or "direct",
            extraction_status=article_data.get("extraction_status") or "completed",
            extraction_error=article_data.get("extraction_error"),
            extraction_metadata=article_data.get("extraction_metadata"),
        )

        try:
            db.add(article)
            db.commit()
            db.refresh(article)
        except IntegrityError as exc:
            db.rollback()
            error_str = str(exc).lower()
            if "source_url" in error_str or "unique constraint" in error_str:
                existing = (
                    db.query(Article)
                    .filter(Article.source_url == article_data.get("source_url"))
                    .first()
                )
                if existing:
                    raise ValueError("该文章已存在，请勿重复提交")
            raise ValueError(f"数据完整性错误: {str(exc)}")

        try:
            await maybe_ingest_top_image(db, article)
        except Exception as exc:
            logger.warning("top_image_ingest_error: %s", str(exc))

        try:
            await maybe_ingest_article_images_with_stats(db, article)
        except Exception as exc:
            logger.warning("article_images_ingest_error: %s", str(exc))

        if self._has_post_process_work(post_process_options):
            self._enqueue_configured_post_process(
                db,
                article,
                article_data.get("category_id"),
                "html" if article_data.get("content_html") else "markdown",
                post_process_options,
            )

        return article.id

    async def retry_article_ai(
        self,
        db: Session,
        article_id: str,
        model_config_id: str | None = None,
        prompt_config_id: str | None = None,
    ) -> str:
        article = db.query(Article).filter(Article.id == article_id).first()
        if not article:
            raise ValueError("Article not found")

        await self._ensure_article_html_for_cleaning(db, article)

        article.status = "pending"
        if article.ai_analysis:
            article.ai_analysis.error_message = None
        db.commit()

        self.ai_task_service.enqueue_task(
            db,
            task_type="process_article_cleaning",
            article_id=article_id,
            content_type="content_cleaning",
            payload={
                "category_id": article.category_id,
                "model_config_id": model_config_id,
                "prompt_config_id": prompt_config_id,
                "source_format": "html",
                "strategy": "auto",
                "chunk_cursor": 0,
            },
        )

        return article_id

    async def retry_article_translation(
        self,
        db: Session,
        article_id: str,
        model_config_id: str | None = None,
        prompt_config_id: str | None = None,
    ) -> str:
        article = db.query(Article).filter(Article.id == article_id).first()
        if not article:
            raise ValueError("文章不存在")

        if not article.content_md:
            raise ValueError("文章内容为空，无法翻译")

        if not is_english_content(article.content_md):
            raise ValueError("文章不是英文内容，无需翻译")

        article.translation_status = "pending"
        article.translation_error = None
        db.commit()

        self.ai_task_service.enqueue_task(
            db,
            task_type="process_article_translation",
            article_id=article_id,
            payload={
                "category_id": article.category_id,
                "model_config_id": model_config_id,
                "prompt_config_id": prompt_config_id,
            },
        )

        return article_id

    async def generate_ai_content(
        self,
        db: Session,
        article_id: str,
        content_type: str,
        model_config_id: str | None = None,
        prompt_config_id: str | None = None,
    ) -> None:
        if content_type not in ("summary", "outline", "quotes"):
            raise ValueError("不支持生成该类型的 AI 解读")

        article = db.query(Article).filter(Article.id == article_id).first()
        if not article:
            raise ValueError("文章不存在")

        if not article.content_md:
            raise ValueError("文章内容为空")

        if not article.ai_analysis:
            ai_analysis = AIAnalysis(article_id=article.id)
            db.add(ai_analysis)
            db.commit()
            db.refresh(article)

        setattr(article.ai_analysis, f"{content_type}_status", "pending")
        article.ai_analysis.updated_at = now_str()
        db.commit()

        self.ai_task_service.enqueue_task(
            db,
            task_type="process_ai_content",
            article_id=article_id,
            content_type=content_type,
            payload={
                "category_id": article.category_id,
                "model_config_id": model_config_id,
                "prompt_config_id": prompt_config_id,
            },
        )

    def delete_ai_content(self, db: Session, article_id: str, content_type: str) -> None:
        article = db.query(Article).filter(Article.id == article_id).first()
        if not article:
            raise ValueError("文章不存在")
        if content_type not in DELETABLE_AI_CONTENT_FIELDS:
            raise ValueError("不支持删除该类型的 AI 解读")
        if not article.ai_analysis:
            raise ValueError("AI解读不存在")
        active_task = (
            db.query(AITask.id)
            .filter(
                AITask.article_id == article_id,
                AITask.task_type == "process_ai_content",
                AITask.content_type == content_type,
                AITask.status.in_(["pending", "processing"]),
            )
            .first()
        )
        if active_task:
            raise ValueError("当前类型的 AI 解读正在生成中，请稍后再试")

        self.article_ai_version_service.clear_current_content(db, article_id, content_type)
        db.commit()

    def update_ai_content(self, db: Session, article_id: str, content_type: str, content: str) -> None:
        article = db.query(Article).filter(Article.id == article_id).first()
        if not article:
            raise ValueError("文章不存在")
        if content_type not in ("summary", "outline", "quotes"):
            raise ValueError("不支持更新该类型的 AI 解读")
        if not article.ai_analysis:
            raise ValueError("AI解读不存在")
        active_task = (
            db.query(AITask.id)
            .filter(
                AITask.article_id == article_id,
                AITask.task_type == "process_ai_content",
                AITask.content_type == content_type,
                AITask.status.in_(["pending", "processing"]),
            )
            .first()
        )
        if active_task:
            raise ValueError("当前类型的 AI 解读正在生成中，请稍后再试")

        setattr(article.ai_analysis, content_type, content)
        db.commit()
