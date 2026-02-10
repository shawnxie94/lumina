from sqlalchemy.orm import Session

from article_service import ArticleService


class ArticleCommandService:
    def __init__(self, facade: ArticleService | None = None):
        self.facade = facade or ArticleService()

    async def create_article(self, article_data: dict, db: Session) -> str:
        return await self.facade.create_article(article_data, db)

    async def retry_article_ai(self, article_id: str) -> bool:
        return await self.facade.retry_article_ai(article_id)

    async def retry_article_translation(self, article_id: str) -> bool:
        return await self.facade.retry_article_translation(article_id)

    async def generate_ai_content(self, article_id: str, content_type: str) -> bool:
        return await self.facade.generate_ai_content(article_id, content_type)
