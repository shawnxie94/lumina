from __future__ import annotations

import uuid

from app.domain.article_query_service import ArticleQueryService
from models import Article, Category, now_str


def make_article(
    db_session,
    *,
    title: str,
    published_at: str | None,
    created_at: str,
    category_id: str | None = None,
    source_domain: str | None = None,
    author: str | None = None,
    is_visible: bool = True,
) -> Article:
    article = Article(
        id=str(uuid.uuid4()),
        title=title,
        slug=f"{title.lower()}-{uuid.uuid4().hex[:8]}",
        content_md=f"{title}-content",
        published_at=published_at,
        category_id=category_id,
        source_domain=source_domain,
        author=author,
        created_at=created_at,
        updated_at=now_str(),
        status="completed",
        is_visible=is_visible,
    )
    db_session.add(article)
    db_session.commit()
    db_session.refresh(article)
    return article


def make_category(db_session, name: str, sort_order: int = 0) -> Category:
    category = Category(
        id=str(uuid.uuid4()),
        name=name,
        sort_order=sort_order,
        created_at=now_str(),
    )
    db_session.add(category)
    db_session.commit()
    db_session.refresh(category)
    return category


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


def test_export_articles_by_filters_matches_list_conditions(db_session):
    service = ArticleQueryService()
    target_category = make_category(db_session, name="目标分类", sort_order=1)
    other_category = make_category(db_session, name="其他分类", sort_order=2)

    matched = make_article(
        db_session,
        title="matched-article",
        published_at="2026-01-10",
        created_at="2026-01-11T00:00:00+00:00",
        category_id=target_category.id,
        source_domain="example.com",
        author="Alice，Bob",
        is_visible=False,
    )
    make_article(
        db_session,
        title="wrong-category",
        published_at="2026-01-10",
        created_at="2026-01-11T00:00:00+00:00",
        category_id=other_category.id,
        source_domain="example.com",
        author="Alice，Bob",
        is_visible=False,
    )
    make_article(
        db_session,
        title="wrong-source-domain",
        published_at="2026-01-10",
        created_at="2026-01-11T00:00:00+00:00",
        category_id=target_category.id,
        source_domain="other.com",
        author="Alice，Bob",
        is_visible=False,
    )
    make_article(
        db_session,
        title="wrong-author",
        published_at="2026-01-10",
        created_at="2026-01-11T00:00:00+00:00",
        category_id=target_category.id,
        source_domain="example.com",
        author="Carol",
        is_visible=False,
    )
    make_article(
        db_session,
        title="outside-date-range",
        published_at="2025-12-31",
        created_at="2026-01-11T00:00:00+00:00",
        category_id=target_category.id,
        source_domain="example.com",
        author="Alice，Bob",
        is_visible=False,
    )

    markdown = service.export_articles_by_filters(
        db=db_session,
        category_id=target_category.id,
        source_domain="example.com",
        author="Bob",
        is_visible=False,
        published_at_start="2026-01-01",
        published_at_end="2026-01-31",
        is_admin=True,
        public_base_url="http://localhost:8000",
    )

    assert matched.title in markdown
    assert matched.slug in markdown
    assert "wrong-category" not in markdown
    assert "wrong-source-domain" not in markdown
    assert "wrong-author" not in markdown
    assert "outside-date-range" not in markdown


def test_export_articles_by_filters_respects_visibility_for_non_admin(db_session):
    service = ArticleQueryService()
    category = make_category(db_session, name="分类A", sort_order=1)
    visible = make_article(
        db_session,
        title="visible-article",
        published_at="2026-01-10",
        created_at="2026-01-11T00:00:00+00:00",
        category_id=category.id,
        source_domain="example.com",
        is_visible=True,
    )
    hidden = make_article(
        db_session,
        title="hidden-article",
        published_at="2026-01-10",
        created_at="2026-01-11T00:00:00+00:00",
        category_id=category.id,
        source_domain="example.com",
        is_visible=False,
    )

    markdown = service.export_articles_by_filters(
        db=db_session,
        source_domain="example.com",
        is_admin=False,
    )

    assert visible.title in markdown
    assert hidden.title not in markdown
