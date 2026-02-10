from sqlalchemy.orm import Session

from article_service import ArticleService


class ArticleCommandService:
    def __init__(self, facade: ArticleService | None = None):
        self.facade = facade or ArticleService()

    async def create_article(self, article_data: dict, db: Session) -> str:
        return await self.facade.create_article(article_data, db)

    async def retry_article_ai(self, db: Session, article_id: str) -> str:
        return await self.facade.retry_article_ai(db, article_id)

    async def retry_article_translation(self, db: Session, article_id: str) -> str:
        return await self.facade.retry_article_translation(db, article_id)

    async def generate_ai_content(
        self,
        db: Session,
        article_id: str,
        content_type: str,
        model_config_id: str | None = None,
        prompt_config_id: str | None = None,
    ) -> None:
        await self.facade.generate_ai_content(
            db,
            article_id,
            content_type,
            model_config_id=model_config_id,
            prompt_config_id=prompt_config_id,
        )
