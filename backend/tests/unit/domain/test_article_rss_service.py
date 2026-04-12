from __future__ import annotations

from types import SimpleNamespace

from starlette.requests import Request

from app.domain.article_rss_service import ArticleRssService
from app.domain.article_query_service import ArticleQueryService
from app.domain import article_rss_service


def make_request(headers: list[tuple[bytes, bytes]] | None = None) -> Request:
    scope = {
        "type": "http",
        "http_version": "1.1",
        "method": "GET",
        "scheme": "http",
        "path": "/backend/api/articles/rss.xml",
        "raw_path": b"/backend/api/articles/rss.xml",
        "query_string": b"",
        "headers": headers or [],
        "server": ("localhost", 8000),
        "client": ("127.0.0.1", 50000),
    }
    return Request(scope)


def test_normalize_tag_ids_sorts_and_deduplicates():
    service = ArticleRssService()

    assert service.normalize_tag_ids(" beta,alpha,beta ,,alpha ") == ["alpha", "beta"]


def test_resolve_public_base_url_prefers_forwarded_headers_when_origin_missing():
    service = ArticleRssService()
    request = make_request(
        headers=[
            (b"x-forwarded-proto", b"https"),
            (b"x-forwarded-host", b"lumina.example.com"),
        ]
    )

    assert service.resolve_public_base_url(request) == "https://lumina.example.com"


def test_resolve_public_base_url_uses_configured_public_base_url(monkeypatch):
    service = ArticleRssService()
    request = make_request()
    monkeypatch.setattr(
        article_rss_service,
        "get_settings",
        lambda: SimpleNamespace(app_public_base_url="http://localhost:3000"),
    )

    assert service.resolve_public_base_url(request) == "http://localhost:3000"


def test_build_cache_key_uses_normalized_dimensions():
    service = ArticleRssService()

    cache_key = service.build_cache_key(
        "https://lumina.example.com",
        category_id="cat-1",
        tag_ids=["alpha", "beta"],
    )

    assert cache_key.startswith("articles:rss:public:")
    assert "category:cat-1" in cache_key
    assert "tags:alpha%2Cbeta" in cache_key


def test_render_articles_rss_includes_item_author_category_and_tags():
    service = ArticleQueryService()
    article = SimpleNamespace(
        slug="hello-rss",
        title="Hello RSS",
        title_trans=None,
        author="Shawn",
        top_image="https://cdn.example.com/cover.png",
        published_at="2026-04-10T10:00:00+08:00",
        created_at="2026-04-09T10:00:00+08:00",
        category=SimpleNamespace(name="产品"),
        tags=[
            SimpleNamespace(name="RSS"),
            SimpleNamespace(name="信息流"),
        ],
        ai_analysis=SimpleNamespace(
            summary="摘要内容",
            quotes="第一条金句\n第二条金句",
            infographic_image_url=None,
        ),
    )

    content = service.render_articles_rss(
        articles=[article],
        public_base_url="https://lumina.example.com",
        site_name="Lumina",
        site_description="信息灯塔",
    )

    assert 'xmlns:dc="http://purl.org/dc/elements/1.1/"' in content
    assert "<dc:creator><![CDATA[Shawn]]></dc:creator>" in content
    assert "<category><![CDATA[产品]]></category>" in content
    assert "<category><![CDATA[RSS]]></category>" in content
    assert "<category><![CDATA[信息流]]></category>" in content
