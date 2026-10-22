from sqlalchemy import func
from sqlalchemy.orm import Session

from app.schemas.sitemap import SitemapKind
from models import Article, Category, ReviewIssue


def get_sitemap_page(db: Session, kind: SitemapKind, cursor: str | None, size: int) -> dict:
    """Public-only scalar projection. Authenticated callers cannot widen it."""
    if kind == "articles":
        query = db.query(
            Article.id,
            Article.slug,
            func.coalesce(
                func.nullif(Article.published_at, ""), Article.created_at
            ).label("lastmod"),
        ).filter(Article.is_visible.is_(True))
        model = Article
    elif kind == "columns":
        query = db.query(
            ReviewIssue.id,
            ReviewIssue.slug,
            func.coalesce(
                func.nullif(ReviewIssue.updated_at, ""),
                func.nullif(ReviewIssue.published_at, ""),
                ReviewIssue.created_at,
            ).label("lastmod"),
        ).filter(ReviewIssue.status == "published")
        model = ReviewIssue
    else:
        query = db.query(Category.id)
        model = Category
    if cursor:
        query = query.filter(model.id > cursor)
    rows = query.order_by(model.id.asc()).limit(size + 1).all()
    return {
        "items": [
            {
                "id": row.id,
                "slug": getattr(row, "slug", None),
                "lastmod": getattr(row, "lastmod", None),
            }
            for row in rows[:size]
        ],
        "next_cursor": rows[size - 1].id if len(rows) > size else None,
    }
