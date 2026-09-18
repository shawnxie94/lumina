from ai_client import is_english_content
from media_service import maybe_ingest_article_images_with_stats
from models import AIAnalysis, Article, now_str

from . import common


class _EnqueueMixin:
    def _enqueue_task(self, db, **kwargs):
        if self.enqueue_task_func:
            return self.enqueue_task_func(db, **kwargs)
        from app.domain.ai_task_service import AITaskService

        return AITaskService().enqueue_task(db, **kwargs)

    def _normalize_post_process_options(self, options: dict | None) -> dict:
        if not isinstance(options, dict):
            return {
                "classification": True,
                "summary": True,
                "outline": True,
                "quotes": False,
                "translation": True,
            }
        return {
            "classification": bool(options.get("classification")),
            "summary": bool(options.get("summary")),
            "outline": bool(options.get("outline")),
            "quotes": bool(options.get("quotes")),
            "translation": bool(options.get("translation")),
        }

    def _enqueue_post_validation_tasks(
        self,
        db,
        article: Article,
        category_id: str | None,
        post_process_options: dict | None,
    ) -> None:
        options = self._normalize_post_process_options(post_process_options)
        article.status = "completed"
        article.updated_at = now_str()
        db.commit()

        interpretation_fields = (
            "classification",
            "summary",
            "outline",
            "quotes",
        )
        if any(options.get(field) for field in interpretation_fields):
            analysis = common._ensure_analysis(db, article)
            analysis.interpretation_status = "pending"
            analysis.interpretation_error = None
            analysis.updated_at = now_str()
            db.commit()
            self._enqueue_task(
                db,
                task_type="process_article_interpretation",
                article_id=article.id,
                content_type="interpretation",
                payload={
                    "category_id": category_id,
                    "post_process_options": options,
                },
            )
            return

        if options.get("classification"):
            self._enqueue_task(
                db,
                task_type="process_article_classification",
                article_id=article.id,
                content_type="classification",
                payload={
                    "category_id": category_id,
                    "post_process_options": options,
                },
            )
            return

        if options.get("summary"):
            self._enqueue_task(
                db,
                task_type="process_ai_content",
                article_id=article.id,
                content_type="summary",
                payload={"category_id": category_id},
            )
        for content_type in ("outline", "quotes"):
            if options.get(content_type):
                self._enqueue_task(
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
            article.updated_at = now_str()
            db.commit()
            self._enqueue_task(
                db,
                task_type="process_article_translation",
                article_id=article.id,
                content_type="translation",
                payload={"category_id": category_id},
            )
        else:
            article.translation_status = "skipped"
            article.translation_error = None
            article.updated_at = now_str()
            db.commit()

    async def _accept_cleaned_article_content(
        self,
        db,
        article: Article,
        ai_analysis: AIAnalysis,
        cleaned_md: str,
        category_id: str | None,
        post_process_options: dict | None,
    ) -> None:
        article.content_md = cleaned_md
        article.updated_at = now_str()
        ai_analysis.error_message = None
        ai_analysis.cleaned_md_draft = None
        ai_analysis.updated_at = now_str()
        db.commit()
        try:
            ingest_stats = await maybe_ingest_article_images_with_stats(db, article)
            self._append_media_ingest_event(
                db, ingest_stats, stage="cleaning_completed"
            )
        except Exception as exc:
            common.logger.warning("article_images_ingest_failed: %s", str(exc))
            self._append_media_ingest_event(
                db,
                {"total": 0, "success": 0, "failed": 0, "updated": False},
                stage="cleaning_completed_error",
            )

        self._enqueue_post_validation_tasks(
            db,
            article,
            category_id,
            post_process_options,
        )
