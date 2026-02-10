from app.domain.article_embedding_service import (
    EMBEDDING_TEXT_LIMIT,
    LOCAL_EMBEDDING_MODEL_NAME,
    ArticleEmbeddingService,
    get_local_embedding_model,
)
from app.domain.article_query_service import ArticleQueryService
from app.legacy.legacy_article_service import (
    ArticleService as LegacyArticleService,
    build_parameters,
)
from sqlalchemy.orm import Session


class ArticleService:
    """兼容门面：对外保留原 ArticleService 接口，已迁移能力优先走新领域服务。"""

    def __init__(self, current_task_id: str | None = None):
        self._legacy = LegacyArticleService(current_task_id=current_task_id)
        self._query_service = ArticleQueryService()
        self._embedding_service = ArticleEmbeddingService()
        self._task_service = None
        self._command_service = None

    def _get_task_service(self):
        if self._task_service is None:
            from app.domain.ai_task_service import AITaskService

            self._task_service = AITaskService()
        return self._task_service

    def _get_command_service(self):
        if self._command_service is None:
            from app.domain.article_command_service import ArticleCommandService

            self._command_service = ArticleCommandService(
                ai_task_service=self._get_task_service()
            )
        return self._command_service

    def get_articles(self, db: Session, **kwargs):
        return self._query_service.get_articles(db=db, **kwargs)

    def get_article_by_slug(self, db: Session, slug: str):
        return self._query_service.get_article_by_slug(db, slug)

    def get_article_neighbors(self, db: Session, article, is_admin: bool = False):
        return self._query_service.get_article_neighbors(db, article, is_admin=is_admin)

    def export_articles(self, db: Session, article_slugs: list[str]):
        return self._query_service.export_articles(db, article_slugs)

    def enqueue_task(
        self,
        db: Session,
        task_type: str,
        article_id: str | None = None,
        content_type: str | None = None,
        payload: dict | None = None,
    ) -> str:
        return self._get_task_service().enqueue_task(
            db,
            task_type=task_type,
            article_id=article_id,
            content_type=content_type,
            payload=payload,
        )

    async def create_article(self, article_data: dict, db: Session) -> str:
        return await self._get_command_service().create_article(article_data, db)

    async def retry_article_ai(self, db: Session, article_id: str) -> str:
        return await self._get_command_service().retry_article_ai(db, article_id)

    async def retry_article_translation(self, db: Session, article_id: str) -> str:
        return await self._get_command_service().retry_article_translation(db, article_id)

    async def generate_ai_content(
        self,
        db: Session,
        article_id: str,
        content_type: str,
        model_config_id: str | None = None,
        prompt_config_id: str | None = None,
    ) -> None:
        await self._get_command_service().generate_ai_content(
            db,
            article_id,
            content_type,
            model_config_id=model_config_id,
            prompt_config_id=prompt_config_id,
        )

    async def ensure_article_embedding(self, db: Session, article):
        return await self._embedding_service.ensure_article_embedding(db, article)

    async def process_article_embedding(self, article_id: str):
        return await self._embedding_service.process_article_embedding(article_id)

    def cosine_similarity(self, vector_a: list[float], vector_b: list[float]) -> float:
        return self._embedding_service.cosine_similarity(vector_a, vector_b)

    def __getattr__(self, item):
        return getattr(self._legacy, item)


__all__ = [
    "ArticleService",
    "EMBEDDING_TEXT_LIMIT",
    "LOCAL_EMBEDDING_MODEL_NAME",
    "build_parameters",
    "get_local_embedding_model",
]
