from datetime import datetime, timedelta

from sqlalchemy import func, literal
from sqlalchemy.orm import Session, joinedload, load_only

from models import AIAnalysis, Article, Category


def _normalize_start_date_bound(value: str | None) -> str | None:
    if not value:
        return None
    return value.strip() or None


def _normalize_end_date_bound(value: str | None) -> str | None:
    if not value:
        return None
    raw = value.strip()
    if not raw:
        return None
    try:
        day = datetime.strptime(raw, "%Y-%m-%d")
    except ValueError:
        return raw
    next_day = day + timedelta(days=1)
    return next_day.strftime("%Y-%m-%d")


class ArticleQueryService:
    def get_article_neighbors(
        self,
        db: Session,
        article: Article,
        is_admin: bool = False,
    ):
        query = db.query(Article).options(
            load_only(
                Article.id,
                Article.slug,
                Article.title,
                Article.created_at,
                Article.is_visible,
            )
        )
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

    def get_article_by_slug(
        self,
        db: Session,
        slug: str,
        include_relations: bool = False,
    ) -> Article | None:
        query = db.query(Article)
        if include_relations:
            query = query.options(
                joinedload(Article.category).load_only(Category.id, Category.name, Category.color),
                joinedload(Article.ai_analysis).load_only(
                    AIAnalysis.summary,
                    AIAnalysis.summary_status,
                    AIAnalysis.key_points,
                    AIAnalysis.key_points_status,
                    AIAnalysis.outline,
                    AIAnalysis.outline_status,
                    AIAnalysis.quotes,
                    AIAnalysis.quotes_status,
                    AIAnalysis.classification_status,
                    AIAnalysis.error_message,
                    AIAnalysis.updated_at,
                ),
            )
        return query.filter(Article.slug == slug).first()

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
            normalized_author = author.strip().replace(" ", "")
            if normalized_author:
                normalized_article_authors = func.replace(
                    func.replace(func.coalesce(Article.author, ""), "，", ","),
                    " ",
                    "",
                )
                wrapped_article_authors = (
                    literal(",") + normalized_article_authors + literal(",")
                )
                query = query.filter(
                    wrapped_article_authors.like(f"%,{normalized_author},%")
                )
        published_start_bound = _normalize_start_date_bound(published_at_start)
        if published_start_bound:
            query = query.filter(Article.published_at >= published_start_bound)
        published_end_bound = _normalize_end_date_bound(published_at_end)
        if published_end_bound:
            query = query.filter(Article.published_at < published_end_bound)
        created_start_bound = _normalize_start_date_bound(created_at_start)
        if created_start_bound:
            query = query.filter(Article.created_at >= created_start_bound)
        created_end_bound = _normalize_end_date_bound(created_at_end)
        if created_end_bound:
            query = query.filter(Article.created_at < created_end_bound)

        total = query.count()

        query = query.options(
            load_only(
                Article.id,
                Article.slug,
                Article.title,
                Article.top_image,
                Article.author,
                Article.status,
                Article.source_domain,
                Article.published_at,
                Article.created_at,
                Article.is_visible,
                Article.original_language,
                Article.category_id,
            ),
            joinedload(Article.category).load_only(Category.id, Category.name, Category.color),
            joinedload(Article.ai_analysis).load_only(AIAnalysis.summary),
        )

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
                if article.ai_analysis and article.ai_analysis.summary:
                    markdown_content += f"{article.ai_analysis.summary}\n\n"

        if uncategorized:
            markdown_content += "## 未分类\n\n"
            for article in uncategorized:
                markdown_content += f"### [{article.title}]({article.source_url or ''})\n\n"
                if article.top_image:
                    markdown_content += f"![]({article.top_image})\n\n"
                if article.ai_analysis and article.ai_analysis.summary:
                    markdown_content += f"{article.ai_analysis.summary}\n\n"

        return markdown_content
