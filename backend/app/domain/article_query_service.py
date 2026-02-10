from sqlalchemy import func
from sqlalchemy.orm import Session

from models import Article


class ArticleQueryService:
    def get_article_neighbors(
        self,
        db: Session,
        article: Article,
        is_admin: bool = False,
    ):
        query = db.query(Article)
        if not is_admin:
            query = query.filter(Article.is_visible == True)

        prev_article = (
            query.filter(Article.created_at > article.created_at)
            .order_by(Article.created_at.asc())
            .first()
        )
        next_article = (
            query.filter(Article.created_at < article.created_at)
            .order_by(Article.created_at.desc())
            .first()
        )
        return prev_article, next_article

    def get_article_by_slug(self, db: Session, slug: str) -> Article | None:
        return db.query(Article).filter(Article.slug == slug).first()

    def get_articles(
        self,
        db: Session,
        page: int = 1,
        size: int = 20,
        category_id: str | None = None,
        search: str | None = None,
        source_domain: str | None = None,
        author: str | None = None,
        is_visible: bool | None = None,
        published_at_start: str | None = None,
        published_at_end: str | None = None,
        created_at_start: str | None = None,
        created_at_end: str | None = None,
        sort_by: str | None = "created_at_desc",
        is_admin: bool = False,
    ):
        query = db.query(Article)

        if not is_admin:
            query = query.filter(Article.is_visible == True)
        elif is_visible is not None:
            query = query.filter(Article.is_visible == is_visible)

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

        if sort_by == "created_at_desc":
            query = query.order_by(Article.created_at.desc())
        else:
            query = query.order_by(
                Article.published_at.desc().nullslast(),
                Article.created_at.desc(),
            )

        articles = query.offset((page - 1) * size).limit(size).all()
        return articles, total

    def export_articles(self, db: Session, article_slugs: list[str]) -> str:
        articles = db.query(Article).filter(Article.slug.in_(article_slugs)).all()

        categories_dict: dict[str, list[Article]] = {}
        uncategorized: list[Article] = []

        for article in articles:
            if article.category:
                category_name = article.category.name
                if category_name not in categories_dict:
                    categories_dict[category_name] = []
                categories_dict[category_name].append(article)
            else:
                uncategorized.append(article)

        markdown_content = ""

        for category_name, category_articles in categories_dict.items():
            markdown_content += f"## {category_name}\n\n"
            for article in category_articles:
                markdown_content += f"### [{article.title}]({article.source_url or ''})\n\n"
                if article.top_image:
                    markdown_content += f"![]({article.top_image})\n\n"
                if article.ai_analysis:
                    if article.ai_analysis.key_points:
                        markdown_content += f"{article.ai_analysis.key_points}\n\n"
                    elif article.ai_analysis.summary:
                        markdown_content += f"{article.ai_analysis.summary}\n\n"

        if uncategorized:
            markdown_content += "## 未分类\n\n"
            for article in uncategorized:
                markdown_content += f"### [{article.title}]({article.source_url or ''})\n\n"
                if article.top_image:
                    markdown_content += f"![]({article.top_image})\n\n"
                if article.ai_analysis:
                    if article.ai_analysis.key_points:
                        markdown_content += f"{article.ai_analysis.key_points}\n\n"
                    elif article.ai_analysis.summary:
                        markdown_content += f"{article.ai_analysis.summary}\n\n"

        return markdown_content
