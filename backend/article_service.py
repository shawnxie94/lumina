from app.domain.article_query_service import ArticleQueryService
from app.legacy.legacy_article_service import (
    EMBEDDING_TEXT_LIMIT,
    LOCAL_EMBEDDING_MODEL_NAME,
    ArticleService as LegacyArticleService,
    build_parameters,
    get_local_embedding_model,
)
from sqlalchemy.orm import Session


class ArticleService:
    """兼容门面：对外保留原 ArticleService 接口，已迁移能力优先走新领域服务。"""

    def __init__(self, current_task_id: str | None = None):
        self._legacy = LegacyArticleService(current_task_id=current_task_id)
        self._query_service = ArticleQueryService()

    def get_articles(self, db: Session, **kwargs):
        return self._query_service.get_articles(db=db, **kwargs)

    def get_article_by_slug(self, db: Session, slug: str):
        return self._query_service.get_article_by_slug(db, slug)

    def get_article_neighbors(self, db: Session, article, is_admin: bool = False):
        return self._query_service.get_article_neighbors(db, article, is_admin=is_admin)

    def export_articles(self, db: Session, article_slugs: list[str]):
        return self._query_service.export_articles(db, article_slugs)

    def __getattr__(self, item):
        return getattr(self._legacy, item)


__all__ = [
    "ArticleService",
    "EMBEDDING_TEXT_LIMIT",
    "LOCAL_EMBEDDING_MODEL_NAME",
    "build_parameters",
    "get_local_embedding_model",
]
