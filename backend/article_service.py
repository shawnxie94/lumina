from app.legacy.legacy_article_service import (
    EMBEDDING_TEXT_LIMIT,
    LOCAL_EMBEDDING_MODEL_NAME,
    ArticleService as LegacyArticleService,
    build_parameters,
    get_local_embedding_model,
)


class ArticleService:
    """兼容门面：对外保留原 ArticleService 接口，内部委托 legacy 实现。"""

    def __init__(self, current_task_id: str | None = None):
        self._legacy = LegacyArticleService(current_task_id=current_task_id)

    def __getattr__(self, item):
        return getattr(self._legacy, item)


__all__ = [
    "ArticleService",
    "EMBEDDING_TEXT_LIMIT",
    "LOCAL_EMBEDDING_MODEL_NAME",
    "build_parameters",
    "get_local_embedding_model",
]
