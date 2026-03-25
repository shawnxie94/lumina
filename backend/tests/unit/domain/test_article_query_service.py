from __future__ import annotations

import uuid
from xml.sax.saxutils import escape

from app.domain.article_query_service import ArticleQueryService
from models import AIAnalysis, Article, Category, Tag, now_str


def make_article(
    db_session,
    *,
    title: str,
    published_at: str | None,
    created_at: str,
    title_trans: str | None = None,
    category_id: str | None = None,
    tags: list[Tag] | None = None,
    source_domain: str | None = None,
    author: str | None = None,
    is_visible: bool = True,
) -> Article:
    article = Article(
        id=str(uuid.uuid4()),
        title=title,
        title_trans=title_trans,
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
    if tags:
        article.tags = list(tags)
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


def make_tag(db_session, name: str) -> Tag:
    tag = Tag(
        id=str(uuid.uuid4()),
        name=name,
        normalized_name=name.casefold(),
        created_at=now_str(),
        updated_at=now_str(),
    )
    db_session.add(tag)
    db_session.commit()
    db_session.refresh(tag)
    return tag


def make_analysis(
    db_session,
    article: Article,
    *,
    summary: str,
) -> AIAnalysis:
    analysis = AIAnalysis(
        id=str(uuid.uuid4()),
        article_id=article.id,
        summary=summary,
        summary_status="completed",
    )
    db_session.add(analysis)
    db_session.commit()
    db_session.refresh(analysis)
    return analysis


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


def test_get_articles_filters_by_any_selected_tag(db_session):
    service = ArticleQueryService()
    ai_tag = make_tag(db_session, "AI")
    product_tag = make_tag(db_session, "产品")
    growth_tag = make_tag(db_session, "增长")

    make_article(
        db_session,
        title="matched-by-ai",
        published_at="2026-01-10",
        created_at="2026-01-11T00:00:00+00:00",
        tags=[ai_tag],
    )
    make_article(
        db_session,
        title="matched-by-growth",
        published_at="2026-01-12",
        created_at="2026-01-13T00:00:00+00:00",
        tags=[growth_tag],
    )
    make_article(
        db_session,
        title="matched-by-product",
        published_at="2026-01-14",
        created_at="2026-01-15T00:00:00+00:00",
        tags=[product_tag],
    )
    make_article(
        db_session,
        title="unmatched",
        published_at="2026-01-16",
        created_at="2026-01-17T00:00:00+00:00",
    )

    articles, total = service.get_articles(
        db=db_session,
        page=1,
        size=10,
        tag_ids=[ai_tag.id, product_tag.id],
        is_admin=True,
    )

    assert total == 2
    assert {article.title for article in articles} == {
        "matched-by-ai",
        "matched-by-product",
    }


def test_get_articles_for_rss_respects_visibility_category_and_tag_filters(db_session):
    service = ArticleQueryService()
    category_a = make_category(db_session, name="分类A", sort_order=1)
    category_b = make_category(db_session, name="分类B", sort_order=2)
    tag_ai = make_tag(db_session, "AI")
    tag_ops = make_tag(db_session, "Ops")
    tag_other = make_tag(db_session, "Other")

    visible_match = make_article(
        db_session,
        title="visible-match",
        published_at="2026-02-10",
        created_at="2026-02-11T00:00:00+00:00",
        category_id=category_a.id,
        tags=[tag_ai],
        is_visible=True,
    )
    make_analysis(db_session, visible_match, summary="matched summary")
    visible_second_match = make_article(
        db_session,
        title="visible-second-match",
        published_at="2026-02-09",
        created_at="2026-02-10T00:00:00+00:00",
        category_id=category_a.id,
        tags=[tag_ops],
        is_visible=True,
    )
    make_analysis(db_session, visible_second_match, summary="second summary")
    make_article(
        db_session,
        title="hidden-match",
        published_at="2026-02-08",
        created_at="2026-02-09T00:00:00+00:00",
        category_id=category_a.id,
        tags=[tag_ai],
        is_visible=False,
    )
    make_article(
        db_session,
        title="wrong-category",
        published_at="2026-02-07",
        created_at="2026-02-08T00:00:00+00:00",
        category_id=category_b.id,
        tags=[tag_ai],
        is_visible=True,
    )
    make_article(
        db_session,
        title="wrong-tag",
        published_at="2026-02-06",
        created_at="2026-02-07T00:00:00+00:00",
        category_id=category_a.id,
        tags=[tag_other],
        is_visible=True,
    )

    articles = service.get_articles_for_rss(
        db_session,
        category_id=category_a.id,
        tag_ids=[tag_ops.id, tag_ai.id],
    )

    assert [item.title for item in articles] == [
        "visible-match",
        "visible-second-match",
    ]


def test_get_articles_for_rss_sorts_by_created_at_desc(db_session):
    service = ArticleQueryService()
    newer_created = make_article(
        db_session,
        title="newer-created",
        published_at="2026-02-01",
        created_at="2026-02-12T00:00:00+00:00",
        is_visible=True,
    )
    make_analysis(db_session, newer_created, summary="newer summary")
    older_created = make_article(
        db_session,
        title="older-created",
        published_at="2026-02-20",
        created_at="2026-02-10T00:00:00+00:00",
        is_visible=True,
    )
    make_analysis(db_session, older_created, summary="older summary")

    articles = service.get_articles_for_rss(db_session)

    assert [item.title for item in articles] == [
        "newer-created",
        "older-created",
    ]


def test_get_articles_for_rss_normalizes_tag_id_order(db_session):
    service = ArticleQueryService()
    tag_alpha = make_tag(db_session, "Alpha")
    tag_beta = make_tag(db_session, "Beta")
    article = make_article(
        db_session,
        title="normalized-order",
        published_at="2026-02-10",
        created_at="2026-02-10T00:00:00+00:00",
        tags=[tag_alpha],
        is_visible=True,
    )
    make_analysis(db_session, article, summary="normalized summary")

    left = service.get_articles_for_rss(
        db_session,
        tag_ids=[tag_beta.id, tag_alpha.id, tag_alpha.id],
    )
    right = service.get_articles_for_rss(
        db_session,
        tag_ids=[tag_alpha.id, tag_beta.id],
    )

    assert [item.title for item in left] == [item.title for item in right] == [
        "normalized-order"
    ]


def test_render_articles_rss_uses_filtered_links_and_escapes_xml(db_session):
    service = ArticleQueryService()
    tag = make_tag(db_session, "AI")
    article = make_article(
        db_session,
        title='AI & "Search" <Guide>',
        published_at="2026-02-10T08:30:00+00:00",
        created_at="2026-02-11T00:00:00+00:00",
        tags=[tag],
        is_visible=True,
    )
    make_analysis(db_session, article, summary="Summary & details <xml>")

    rss = service.render_articles_rss(
        articles=[article],
        public_base_url="https://lumina.example.com",
        site_name="Lumina & Co",
        site_description="公开订阅 <feed>",
        category_id="cat-1",
        tag_ids=[tag.id],
    )

    assert "<title>Lumina &amp; Co</title>" in rss
    assert "<description>公开订阅 &lt;feed&gt;</description>" in rss
    assert "https://lumina.example.com/list?category_id=cat-1&amp;tag_ids=" in rss
    assert (
        f"https://lumina.example.com/backend/api/articles/rss.xml?category_id=cat-1&amp;tag_ids={tag.id}"
        in rss
    )
    assert "<title>AI &amp; \"Search\" &lt;Guide&gt;</title>" in rss
    assert "<description>Summary &amp; details &lt;xml&gt;</description>" in rss
    assert (
        f"<link>https://lumina.example.com/article/{escape(article.slug)}</link>"
        in rss
    )
    assert "<pubDate>Wed, 11 Feb 2026 00:00:00 GMT</pubDate>" in rss


def test_render_articles_rss_prefers_translated_title(db_session):
    service = ArticleQueryService()
    article = make_article(
        db_session,
        title="Original Title",
        title_trans="  译文标题  ",
        published_at="2026-02-10T08:30:00+00:00",
        created_at="2026-02-11T00:00:00+00:00",
        is_visible=True,
    )

    rss = service.render_articles_rss(
        articles=[article],
        public_base_url="https://lumina.example.com",
        site_name="Lumina",
        site_description="公开订阅",
    )

    assert "<title>译文标题</title>" in rss
    assert "<title>Original Title</title>" not in rss
