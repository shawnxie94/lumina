import json
import logging

from ai_client import is_english_content
from media_service import maybe_ingest_top_image
from models import AIAnalysis, Article, Category, generate_uuid, now_str
from slug_utils import generate_article_slug
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.domain.ai_task_service import AITaskService

logger = logging.getLogger("article_service")


class ArticleCommandService:
    def __init__(self, ai_task_service: AITaskService | None = None):
        self.ai_task_service = ai_task_service or AITaskService()

    async def create_article(self, article_data: dict, db: Session) -> str:
        if not article_data.get("content_html") and not article_data.get("content_md"):
            raise ValueError("文章内容不能为空")

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

        article_id = generate_uuid()
        article = Article(
            id=article_id,
            title=article_data.get("title"),
            slug=generate_article_slug(article_data.get("title"), article_id),
            content_html=article_data.get("content_html"),
            content_structured=content_structured,
            content_md=article_data.get("content_md"),
            source_url=source_url,
            top_image=article_data.get("top_image"),
            author=article_data.get("author"),
            published_at=article_data.get("published_at"),
            source_domain=article_data.get("source_domain"),
            category_id=article_data.get("category_id"),
            status="pending",
            original_language=original_language,
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

        self.ai_task_service.enqueue_task(
            db,
            task_type="process_article_cleaning",
            article_id=article.id,
            content_type="content_cleaning",
            payload={"category_id": article_data.get("category_id")},
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
