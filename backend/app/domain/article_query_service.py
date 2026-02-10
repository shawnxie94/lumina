from sqlalchemy.orm import Session

from article_service import ArticleService


class ArticleQueryService:
    def __init__(self, facade: ArticleService | None = None):
        self.facade = facade or ArticleService()

    def get_articles(self, db: Session, **kwargs):
        return self.facade.get_articles(db, **kwargs)

    def get_article_by_slug(self, db: Session, slug: str):
        return self.facade.get_article_by_slug(db, slug)

    def get_article_neighbors(self, db: Session, article, is_admin: bool = False):
        return self.facade.get_article_neighbors(db, article, is_admin=is_admin)

    def export_articles(self, db: Session, article_slugs: list[str]):
        return self.facade.export_articles(db, article_slugs)
