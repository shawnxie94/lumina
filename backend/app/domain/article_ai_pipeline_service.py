from article_service import ArticleService


class ArticleAIPipelineService:
    def __init__(self, current_task_id: str | None = None):
        self.facade = ArticleService(current_task_id=current_task_id)

    async def process_article_ai(self, article_id: str, category_id: str | None):
        return await self.facade.process_article_ai(article_id, category_id)

    async def process_article_cleaning(self, article_id: str, category_id: str | None):
        return await self.facade.process_article_cleaning(article_id, category_id)

    async def process_article_validation(
        self,
        article_id: str,
        category_id: str | None,
        cleaned_md: str | None,
    ):
        return await self.facade.process_article_validation(
            article_id, category_id, cleaned_md
        )

    async def process_article_classification(
        self, article_id: str, category_id: str | None
    ):
        return await self.facade.process_article_classification(article_id, category_id)

    async def process_article_translation(self, article_id: str, category_id: str | None):
        return await self.facade.process_article_translation(article_id, category_id)

    async def process_ai_content(
        self,
        article_id: str,
        category_id: str | None,
        content_type: str,
        model_config_id: str | None = None,
        prompt_config_id: str | None = None,
    ):
        return await self.facade.process_ai_content(
            article_id,
            category_id,
            content_type,
            model_config_id=model_config_id,
            prompt_config_id=prompt_config_id,
        )
