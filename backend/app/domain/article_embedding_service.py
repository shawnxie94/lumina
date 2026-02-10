from sqlalchemy.orm import Session

from article_service import ArticleService


class ArticleEmbeddingService:
    def __init__(self, facade: ArticleService | None = None):
        self.facade = facade or ArticleService()

    async def ensure_article_embedding(self, db: Session, article):
        return await self.facade.ensure_article_embedding(db, article)

    async def process_article_embedding(self, article_id: str):
        return await self.facade.process_article_embedding(article_id)

    def cosine_similarity(self, vector_a: list[float], vector_b: list[float]) -> float:
        return self.facade.cosine_similarity(vector_a, vector_b)
