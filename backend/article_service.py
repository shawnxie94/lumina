from ai_client import SimpleAIClient
from models import Article, AIAnalysis, Category, SessionLocal
from sqlalchemy.orm import Session


class ArticleService:
    def __init__(self):
        self.ai_client = SimpleAIClient()

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

        db.add(article)
        db.commit()
        db.refresh(article)

        try:
            summary = self.ai_client.generate_summary(article.content_md)

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
            summary = self.ai_client.generate_summary(article.content_md)

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
