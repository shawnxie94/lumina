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
            status="processing",
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

        try:
            ai_config = self.get_ai_config(db, article_data.get("category_id"))
            if not ai_config:
                raise ValueError("未配置AI服务，请先在配置页面设置AI参数")

            ai_client = self.create_ai_client(ai_config)
            parameters = ai_config.get("parameters", {})
            prompt = ai_config.get("prompt_template")

            summary = await ai_client.generate_summary(
                article.content_md, prompt=prompt, parameters=parameters
            )

            ai_analysis = AIAnalysis(article_id=article.id, summary=summary)
            db.add(ai_analysis)

            article.status = "completed"
            db.commit()
        except Exception as e:
            print(f"AI生成失败: {e}")
            error_message = str(e)
            article.status = "failed"

            if article.ai_analysis:
                article.ai_analysis.error_message = error_message
                db.commit()
            else:
                ai_analysis = AIAnalysis(
                    article_id=article.id, error_message=error_message
                )
                db.add(ai_analysis)
                article.ai_analysis = ai_analysis
                db.commit()

        return article.id

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
        query = query.order_by(Article.created_at.desc())
        query = query.offset((page - 1) * size).limit(size)

        articles = query.all()
        return articles, total

    def get_article(self, db: Session, article_id: str):
        return db.query(Article).filter(Article.id == article_id).first()

    def export_articles(self, db: Session, article_ids: list):
        articles = db.query(Article).filter(Article.id.in_(article_ids)).all()

        markdown_content = ""
        for article in articles:
            markdown_content += f"# {article.title}\n\n"
            if article.author:
                markdown_content += f"**作者**: {article.author}\n\n"
            if article.source_url:
                markdown_content += f"**来源**: {article.source_url}\n\n"
            if article.ai_analysis:
                markdown_content += f"**摘要**: {article.ai_analysis.summary}\n\n"
            if article.content_md:
                markdown_content += article.content_md + "\n\n"
            markdown_content += "---\n\n"

        return markdown_content

    async def retry_article_ai(self, db: Session, article_id: str) -> str:
        article = db.query(Article).filter(Article.id == article_id).first()

        if not article:
            raise ValueError("Article not found")

        article.status = "processing"
        db.commit()

        try:
            ai_config = self.get_ai_config(db, article.category_id)
            if not ai_config:
                raise ValueError("未配置AI服务，请先在配置页面设置AI参数")

            ai_client = self.create_ai_client(ai_config)
            parameters = ai_config.get("parameters", {})
            prompt = ai_config.get("prompt_template")

            summary = await ai_client.generate_summary(
                article.content_md, prompt=prompt, parameters=parameters
            )
            parameters = ai_config.get("parameters", {})
            prompt = ai_config.get("prompt_template")

            summary = await ai_client.generate_summary(
                article.content_md, prompt=prompt, parameters=parameters
            )

            if article.ai_analysis:
                article.ai_analysis.summary = summary
            else:
                ai_analysis = AIAnalysis(article_id=article.id, summary=summary)
                db.add(ai_analysis)

            article.status = "completed"
            db.commit()
        except Exception as e:
            print(f"AI生成失败: {e}")
            error_message = str(e)
            article.status = "failed"

            if article.ai_analysis:
                article.ai_analysis.error_message = error_message
                db.commit()
            else:
                ai_analysis = AIAnalysis(
                    article_id=article.id, error_message=error_message
                )
                db.add(ai_analysis)
                article.ai_analysis = ai_analysis
                db.commit()

        return article.id
