from ai_client import ConfigurableAIClient
from models import (
    Article,
    AIAnalysis,
    Category,
    SessionLocal,
    ModelAPIConfig,
    PromptConfig,
)
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
import json


class ArticleService:
    def __init__(self):
        pass

    def get_ai_config(self, db: Session, category_id: str = None):
        query = db.query(ModelAPIConfig).filter(ModelAPIConfig.is_enabled == True)
        prompt_query = db.query(PromptConfig).filter(PromptConfig.is_enabled == True)

        if category_id:
            category_prompt = prompt_query.filter(
                PromptConfig.category_id == category_id
            ).first()
            if category_prompt:
                result = {
                    "prompt_template": category_prompt.prompt,
                    "parameters": None,
                }
                if category_prompt.model_api_config_id:
                    model_config = query.filter(
                        ModelAPIConfig.id == category_prompt.model_api_config_id
                    ).first()
                    if model_config:
                        result.update(
                            {
                                "base_url": model_config.base_url,
                                "api_key": model_config.api_key,
                                "model_name": model_config.model_name,
                            }
                        )
                else:
                    default_model = query.filter(
                        ModelAPIConfig.is_default == True
                    ).first()
                    if default_model:
                        result.update(
                            {
                                "base_url": default_model.base_url,
                                "api_key": default_model.api_key,
                                "model_name": default_model.model_name,
                            }
                        )
                return result

        generic_prompt = prompt_query.filter(PromptConfig.category_id.is_(None)).first()
        if generic_prompt:
            result = {
                "prompt_template": generic_prompt.prompt,
                "parameters": None,
            }
            if generic_prompt.model_api_config_id:
                model_config = query.filter(
                    ModelAPIConfig.id == generic_prompt.model_api_config_id
                ).first()
                if model_config:
                    result.update(
                        {
                            "base_url": model_config.base_url,
                            "api_key": model_config.api_key,
                            "model_name": model_config.model_name,
                        }
                    )
            else:
                default_model = query.filter(ModelAPIConfig.is_default == True).first()
                if default_model:
                    result.update(
                        {
                            "base_url": default_model.base_url,
                            "api_key": default_model.api_key,
                            "model_name": default_model.model_name,
                        }
                    )
            return result

        default_model = query.filter(ModelAPIConfig.is_default == True).first()
        if default_model:
            return {
                "base_url": default_model.base_url,
                "api_key": default_model.api_key,
                "model_name": default_model.model_name,
                "prompt_template": None,
                "parameters": None,
            }

        return None

    def create_ai_client(self, config: dict) -> ConfigurableAIClient:
        return ConfigurableAIClient(
            base_url=config["base_url"],
            api_key=config["api_key"],
            model_name=config["model_name"],
        )

    async def create_article(self, article_data: dict, db: Session) -> str:
        category = (
            db.query(Category)
            .filter(Category.id == article_data.get("category_id"))
            .first()
        )

        article = Article(
            title=article_data.get("title"),
            content_html=article_data.get("content_html"),
            content_md=article_data.get("content_md"),
            source_url=article_data.get("source_url"),
            top_image=article_data.get("top_image"),
            author=article_data.get("author"),
            published_at=article_data.get("published_at"),
            source_domain=article_data.get("source_domain"),
            category_id=article_data.get("category_id"),
            status="pending",
        )

        try:
            db.add(article)
            db.commit()
            db.refresh(article)
        except IntegrityError as e:
            db.rollback()
            error_str = str(e).lower()
            if "source_url" in error_str or "unique constraint" in error_str:
                existing = (
                    db.query(Article)
                    .filter(Article.source_url == article_data.get("source_url"))
                    .first()
                )
                if existing:
                    raise ValueError("该文章已存在，请勿重复提交")
            raise ValueError(f"数据完整性错误: {str(e)}")

        import asyncio

        asyncio.create_task(
            self.process_article_ai(article.id, article_data.get("category_id"))
        )

        return article.id

    async def process_article_ai(self, article_id: str, category_id: str):
        from models import SessionLocal
        import asyncio

        db = SessionLocal()
        try:
            article = db.query(Article).filter(Article.id == article_id).first()
            if not article:
                return

            article.status = "processing"
            db.commit()

            ai_config = self.get_ai_config(db, category_id)
            if not ai_config:
                article.status = "failed"
                existing_analysis = (
                    db.query(AIAnalysis)
                    .filter(AIAnalysis.article_id == article_id)
                    .first()
                )
                if existing_analysis:
                    existing_analysis.error_message = (
                        "未配置AI服务，请先在配置页面设置AI参数"
                    )
                else:
                    ai_analysis = AIAnalysis(
                        article_id=article.id,
                        error_message="未配置AI服务，请先在配置页面设置AI参数",
                    )
                    db.add(ai_analysis)
                db.commit()
                return

            ai_client = self.create_ai_client(ai_config)
            parameters = ai_config.get("parameters", {})
            prompt = ai_config.get("prompt_template")

            try:
                summary = await asyncio.wait_for(
                    ai_client.generate_summary(
                        article.content_md, prompt=prompt, parameters=parameters
                    ),
                    timeout=60.0,
                )
            except asyncio.TimeoutError:
                raise Exception("AI生成超时，请稍后重试")

            existing_analysis = (
                db.query(AIAnalysis).filter(AIAnalysis.article_id == article_id).first()
            )
            if existing_analysis:
                existing_analysis.summary = summary
                existing_analysis.error_message = None
            else:
                ai_analysis = AIAnalysis(article_id=article.id, summary=summary)
                db.add(ai_analysis)

            article.status = "completed"
            db.commit()
        except Exception as e:
            print(f"AI生成失败: {e}")
            error_message = str(e)
            article = db.query(Article).filter(Article.id == article_id).first()
            if article:
                article.status = "failed"
                existing_analysis = (
                    db.query(AIAnalysis)
                    .filter(AIAnalysis.article_id == article_id)
                    .first()
                )
                if existing_analysis:
                    existing_analysis.error_message = error_message
                else:
                    ai_analysis = AIAnalysis(
                        article_id=article.id, error_message=error_message
                    )
                    db.add(ai_analysis)
                db.commit()
        finally:
            db.close()

    def get_articles(
        self,
        db: Session,
        page: int = 1,
        size: int = 20,
        category_id: str = None,
        search: str = None,
        source_domain: str = None,
        author: str = None,
        published_at_start: str = None,
        published_at_end: str = None,
        created_at_start: str = None,
        created_at_end: str = None,
        sort_by: str = "published_at_desc",
    ):
        from sqlalchemy import func

        query = db.query(Article)

        if category_id:
            query = query.filter(Article.category_id == category_id)
        if search:
            query = query.filter(Article.title.contains(search))
        if source_domain:
            query = query.filter(Article.source_domain == source_domain)
        if author:
            query = query.filter(Article.author == author)
        if published_at_start:
            query = query.filter(
                func.substr(Article.published_at, 1, 10) >= published_at_start
            )
        if published_at_end:
            query = query.filter(
                func.substr(Article.published_at, 1, 10) <= published_at_end
            )
        if created_at_start:
            query = query.filter(
                func.substr(Article.created_at, 1, 10) >= created_at_start
            )
        if created_at_end:
            query = query.filter(
                func.substr(Article.created_at, 1, 10) <= created_at_end
            )

        total = query.count()

        # Apply sorting based on sort_by parameter
        if sort_by == "created_at_desc":
            query = query.order_by(Article.created_at.desc())
        else:  # Default: published_at_desc
            query = query.order_by(
                Article.published_at.desc().nullslast(), Article.created_at.desc()
            )

        query = query.offset((page - 1) * size).limit(size)

        articles = query.all()
        return articles, total

    def get_article(self, db: Session, article_id: str):
        return db.query(Article).filter(Article.id == article_id).first()

    def export_articles(self, db: Session, article_ids: list):
        articles = db.query(Article).filter(Article.id.in_(article_ids)).all()

        categories_dict = {}
        uncategorized = []

        for article in articles:
            if article.category:
                cat_name = article.category.name
                if cat_name not in categories_dict:
                    categories_dict[cat_name] = []
                categories_dict[cat_name].append(article)
            else:
                uncategorized.append(article)

        markdown_content = ""

        for cat_name, cat_articles in categories_dict.items():
            markdown_content += f"## {cat_name}\n\n"
            for article in cat_articles:
                markdown_content += (
                    f"### [{article.title}]({article.source_url or ''})\n\n"
                )
                if article.top_image:
                    markdown_content += f"![]({article.top_image})\n\n"
                if article.ai_analysis and article.ai_analysis.summary:
                    markdown_content += f"{article.ai_analysis.summary}\n\n"

        if uncategorized:
            markdown_content += "## 未分类\n\n"
            for article in uncategorized:
                markdown_content += (
                    f"### [{article.title}]({article.source_url or ''})\n\n"
                )
                if article.top_image:
                    markdown_content += f"![]({article.top_image})\n\n"
                if article.ai_analysis and article.ai_analysis.summary:
                    markdown_content += f"{article.ai_analysis.summary}\n\n"

        return markdown_content

    async def retry_article_ai(self, db: Session, article_id: str) -> str:
        article = db.query(Article).filter(Article.id == article_id).first()

        if not article:
            raise ValueError("Article not found")

        article.status = "pending"
        if article.ai_analysis:
            article.ai_analysis.error_message = None
        db.commit()

        import asyncio

        asyncio.create_task(self.process_article_ai(article_id, article.category_id))

        return article_id
