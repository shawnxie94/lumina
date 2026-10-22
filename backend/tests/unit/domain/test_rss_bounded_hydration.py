from types import SimpleNamespace

from sqlalchemy import event
from sqlalchemy.orm import Session

from app.domain.article_query_service import ArticleQueryService, _article_created_desc_sort_key
from models import AIAnalysis, Article


def test_rss_streams_legacy_dates_and_only_hydrates_top_50(db_session):
    dates = [None, "", "invalid", "2026/1/2", "2026-01-02T00:00:00Z", "2026-01-02T08:00:00+08:00", "2025-12-31 12:00:00", "2026-1-3"]
    candidates = []
    for i in range(120):
        identity = f"rss-{i:03}"
        created = dates[i % len(dates)]
        db_session.add(Article(id=identity, title=identity, title_trans=f"Translated {i}", slug=identity, is_visible=True))
        db_session.flush()
        db_session.query(Article).filter_by(id=identity).update({"created_at": created})
        db_session.add(AIAnalysis(article_id=identity, summary="Summary", quotes="Quote"))
        candidates.append(SimpleNamespace(id=identity, created_at=created))
    db_session.add(Article(id="hidden", title="Hidden", slug="rss-hidden", is_visible=False, created_at="2099-01-01"))
    db_session.commit()
    expected = sorted(candidates, key=_article_created_desc_sort_key, reverse=True)[:50]
    statements = []
    def observe(_conn, _cursor, statement, *_args):
        if statement.lstrip().upper().startswith("SELECT"):
            statements.append(statement)
    engine = db_session.get_bind()
    event.listen(engine, "before_cursor_execute", observe)
    try:
        with Session(engine) as fresh:
            service = ArticleQueryService()
            articles = service.get_articles_for_rss(fresh)
            assert [article.id for article in articles] == [item.id for item in expected]
            assert len([obj for obj in fresh.identity_map.values() if isinstance(obj, Article)]) == 50
            xml = service.render_articles_rss(articles=articles, site_name="Unit", site_description="Test", public_base_url="https://unit")
            assert xml.count("<item>") == 50
            assert len(statements) == 2, statements
            assert "summary" not in statements[0].lower()
            assert "JOIN" not in statements[0].upper()
    finally:
        event.remove(engine, "before_cursor_execute", observe)
