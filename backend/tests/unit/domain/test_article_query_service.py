from __future__ import annotations

import uuid

from app.domain.article_query_service import ArticleQueryService
from models import Article, now_str


def make_article(
    db_session,
    *,
    title: str,
    published_at: str | None,
    created_at: str,
) -> Article:
    article = Article(
        id=str(uuid.uuid4()),
        title=title,
        slug=f"{title.lower()}-{uuid.uuid4().hex[:8]}",
        content_md=f"{title}-content",
        published_at=published_at,
        created_at=created_at,
        updated_at=now_str(),
        status="completed",
        is_visible=True,
    )
    db_session.add(article)
    db_session.commit()
    db_session.refresh(article)
    return article


def test_get_articles_sort_by_published_desc_handles_mixed_date_formats(db_session):
    service = ArticleQueryService()
    make_article(
        db_session,
        title="older-published",
        published_at="2025/5/14",
        created_at="2026-02-24T12:00:00+00:00",
    )
    make_article(
        db_session,
        title="newer-published",
        published_at="2026-02-24",
        created_at="2026-02-24T10:00:00+00:00",
    )

    articles, total = service.get_articles(
        db=db_session,
        page=1,
        size=10,
        sort_by="published_at_desc",
        is_admin=True,
    )

    assert total == 2
    assert [item.title for item in articles] == [
        "newer-published",
        "older-published",
    ]


def test_get_articles_sort_by_published_desc_falls_back_to_created_at(db_session):
    service = ArticleQueryService()
    make_article(
        db_session,
        title="invalid-published-date",
        published_at="not-a-date",
        created_at="2026-02-24T12:00:00+00:00",
    )
    make_article(
        db_session,
        title="valid-published-date",
        published_at="2026-02-20",
        created_at="2026-02-24T08:00:00+00:00",
    )

    articles, _ = service.get_articles(
        db=db_session,
        page=1,
        size=10,
        sort_by="published_at_desc",
        is_admin=True,
    )

    assert [item.title for item in articles] == [
        "invalid-published-date",
        "valid-published-date",
    ]
