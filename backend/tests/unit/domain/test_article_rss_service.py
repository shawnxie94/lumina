from __future__ import annotations

from types import SimpleNamespace

from starlette.requests import Request

from app.domain.article_rss_service import ArticleRssService
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
