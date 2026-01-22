from ai_client import ConfigurableAIClient
from models import Article, AIAnalysis, Category, SessionLocal, AIConfig
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
import json


class ArticleService:
    def __init__(self):
        pass

    def get_ai_config(self, db: Session, category_id: str = None) -> AIConfig:
        query = db.query(AIConfig).filter(AIConfig.is_enabled == True)

        if category_id:
            category_config = query.filter(AIConfig.category_id == category_id).first()
            if category_config:
                return category_config

        default_config = query.filter(AIConfig.is_default == True).first()
        if default_config:
            return default_config

        fallback_config = query.filter(AIConfig.category_id.is_(None)).first()
        if fallback_config:
            return fallback_config

        return None

    def create_ai_client(self, config: AIConfig) -> ConfigurableAIClient:
        parameters = json.loads(config.parameters) if config.parameters else {}
        return ConfigurableAIClient(
            base_url=config.base_url,
            api_key=config.api_key,
            model_name=config.model_name,
        )

    def create_article(self, article_data: dict, db: Session) -> str:
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
            if "source_url" in str(e):
                raise ValueError("该文章已存在，请勿重复提交")
            raise ValueError(f"数据完整性错误: {str(e)}")

        try:
            ai_config = self.get_ai_config(db, article_data.get("category_id"))
            if not ai_config:
                raise ValueError("未配置AI服务，请先在配置页面设置AI参数")

            ai_client = self.create_ai_client(ai_config)
            parameters = (
                json.loads(ai_config.parameters) if ai_config.parameters else {}
            )
            prompt = ai_config.prompt_template if ai_config.prompt_template else None

            summary = ai_client.generate_summary(
                article.content_md, prompt=prompt, parameters=parameters
            )

            ai_analysis = AIAnalysis(article_id=article.id, summary=summary)
            db.add(ai_analysis)

            article.status = "completed"
            db.commit()
        except Exception as e:
            print(f"AI生成失败: {e}")
            article.status = "failed"
            db.commit()

        return article.id

    def get_articles(
        self,
        db: Session,
        page: int = 1,
        size: int = 20,
        category_id: str = None,
        search: str = None,
    ):
        query = db.query(Article)

        if category_id:
            query = query.filter(Article.category_id == category_id)
        if search:
            query = query.filter(Article.title.contains(search))

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

    def retry_article_ai(self, db: Session, article_id: str) -> str:
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
            parameters = (
                json.loads(ai_config.parameters) if ai_config.parameters else {}
            )
            prompt = ai_config.prompt_template if ai_config.prompt_template else None

            summary = ai_client.generate_summary(
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
            article.status = "failed"
            db.commit()

        return article.id
