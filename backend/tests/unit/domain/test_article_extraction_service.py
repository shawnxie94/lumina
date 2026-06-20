import asyncio

import app.domain.article_extraction_service as article_extraction_service_module
from app.domain.article_extraction_service import (
    ArticleExtractionBadGatewayError,
    ArticleExtractionService,
    ExtractionSettings,
    ExtractedArticle,
)
from models import AdminSettings


def test_resolve_settings_treats_disabled_legacy_jina_flag_as_local_only(db_session):
    db_session.add(
        AdminSettings(
            password_hash="hash",
            jwt_secret="secret",
            jina_reader_enabled=False,
            jina_reader_prefer_mode="jina_first",
        )
    )
    db_session.commit()

    settings = ArticleExtractionService().resolve_settings(db_session)

    assert settings.jina_reader_enabled is False
    assert settings.jina_reader_prefer_mode == "local_only"


def test_extract_url_uses_local_fallback_when_jina_fails(db_session, monkeypatch):
    db_session.add(
        AdminSettings(
            password_hash="hash",
            jwt_secret="secret",
            jina_reader_enabled=True,
            jina_reader_prefer_mode="jina_first",
        )
    )
    db_session.commit()
    service = ArticleExtractionService()

    async def fake_jina(_url, _settings):
        raise ArticleExtractionBadGatewayError("Jina unavailable")

    async def fake_local(_url):
        return ExtractedArticle(
            title="Fallback Title",
            content_html="<article><p>Fallback content has enough length.</p></article>",
            content_md="Fallback content has enough length.",
            source_url="https://example.com/fallback",
            top_image=None,
            author=None,
            published_at=None,
            source_domain="example.com",
            provider="local_html",
            metadata={"content_length": 35},
        )

    monkeypatch.setattr(service, "_extract_with_jina", fake_jina)
    monkeypatch.setattr(service, "_extract_with_local_html", fake_local)

    result = asyncio.run(
        service.extract_url(
            db_session,
            "https://example.com/start",
            ensure_public_url=lambda _url: None,
        )
    )

    assert result.provider == "local_html"
    assert result.status == "fallback_used"
    assert result.error == "Jina unavailable"
    assert result.metadata["attempts"][0]["provider"] == "jina"


def test_extract_with_jina_html_posts_html_and_reference_url(monkeypatch):
    captured = {}

    class FakeResponse:
        status_code = 200
        headers = {"content-type": "application/json"}
        url = "https://r.jina.ai/"

        def json(self):
            return {
                "data": {
                    "title": "Reader Title",
                    "content": "Reader cleaned content with enough words to be valid.",
                    "url": "https://example.com/article",
                    "image": "https://example.com/image.png",
                }
            }

    class FakeAsyncClient:
        def __init__(self, **kwargs):
            captured["client_kwargs"] = kwargs

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return None

        async def post(self, url, *, headers, json):
            captured["url"] = url
            captured["headers"] = headers
            captured["json"] = json
            return FakeResponse()

    monkeypatch.setattr(
        article_extraction_service_module.httpx,
        "AsyncClient",
        FakeAsyncClient,
    )

    service = ArticleExtractionService()
    result = asyncio.run(
        service._extract_with_jina_html(
            html="<article><p>Selected HTML content.</p></article>",
            source_url="https://example.com/article",
            title="Selected Title",
            top_image=None,
            author=None,
            published_at=None,
            source_domain="example.com",
            settings=ExtractionSettings(
                jina_reader_enabled=True,
                jina_reader_base_url="https://r.jina.ai",
                jina_reader_api_key="secret",
                jina_reader_timeout_seconds=12,
                jina_reader_token_budget=2048,
                jina_reader_prefer_mode="jina_first",
            ),
        )
    )

    assert captured["url"] == "https://r.jina.ai/"
    assert captured["headers"]["Authorization"] == "Bearer secret"
    assert captured["headers"]["X-Token-Budget"] == "2048"
    assert captured["json"] == {
        "html": "<article><p>Selected HTML content.</p></article>",
        "url": "https://example.com/article",
    }
    assert result.provider == "jina_html"
    assert result.title == "Selected Title"
    assert result.content_md == "Reader cleaned content with enough words to be valid."


def test_extract_with_jina_html_fills_metadata_from_source_html(monkeypatch):
    class FakeResponse:
        status_code = 200
        headers = {"content-type": "application/json"}
        url = "https://r.jina.ai/"

        def json(self):
            return {
                "data": {
                    "title": "Reader Title",
                    "content": "Reader cleaned content with enough words to be valid.",
                    "url": "https://example.com/article",
                }
            }

    class FakeAsyncClient:
        def __init__(self, **_kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return None

        async def post(self, _url, *, headers, json):
            return FakeResponse()

    monkeypatch.setattr(
        article_extraction_service_module.httpx,
        "AsyncClient",
        FakeAsyncClient,
    )

    html = """
    <html>
      <head>
        <script type="application/ld+json">
          {
            "@type": "NewsArticle",
            "headline": "Original Title",
            "author": {"name": "Source Author"},
            "datePublished": "2026-06-20T10:30:00+08:00"
          }
        </script>
      </head>
      <body>
        <article><p>Original selected HTML content.</p></article>
      </body>
    </html>
    """

    service = ArticleExtractionService()
    result = asyncio.run(
        service._extract_with_jina_html(
            html=html,
            source_url="https://example.com/article",
            title=None,
            top_image=None,
            author=None,
            published_at=None,
            source_domain="example.com",
            settings=ExtractionSettings(
                jina_reader_enabled=True,
                jina_reader_base_url="https://r.jina.ai",
                jina_reader_api_key="",
                jina_reader_timeout_seconds=12,
                jina_reader_token_budget=None,
                jina_reader_prefer_mode="jina_first",
            ),
        )
    )

    assert result.provider == "jina_html"
    assert result.author == "Source Author"
    assert result.published_at == "2026-06-20T10:30:00+08:00"


def test_extract_source_html_metadata_supports_weixin_dom_fields():
    html = """
    <html>
      <body>
        <span id="js_name">Lumina Research</span>
        <span id="publish_time">2026-06-20</span>
        <article><p>Original selected HTML content.</p></article>
      </body>
    </html>
    """

    service = ArticleExtractionService()

    assert service._extract_author(html) == "Lumina Research"
    assert service._extract_published_at(html) == "2026-06-20"


def test_parse_jina_response_repairs_utf8_mojibake_from_html_cleaning():
    expected_content = "欢迎来到人类溢价时代。王焕超腾讯研究院高级研究员。"
    expected_author = "王焕超"

    class FakeResponse:
        headers = {"content-type": "application/json; charset=utf-8"}

        def json(self):
            return {
                "data": {
                    "title": "Reader Title",
                    "content": expected_content.encode("utf-8").decode("latin-1"),
                    "author": expected_author.encode("utf-8").decode("cp1252"),
                    "url": "https://example.com/article",
                }
            }

    parsed = ArticleExtractionService()._parse_jina_response(FakeResponse())

    assert parsed["title"] == "Reader Title"
    assert parsed["content_md"] == expected_content
    assert parsed["author"] == expected_author


def test_parse_jina_response_keeps_normal_text_unchanged():
    expected_content = "Cafe teams use facade patterns when the context is clear enough."

    class FakeResponse:
        headers = {"content-type": "application/json"}

        def json(self):
            return {"data": {"content": expected_content, "author": "Andre"}}

    parsed = ArticleExtractionService()._parse_jina_response(FakeResponse())

    assert parsed["content_md"] == expected_content
    assert parsed["author"] == "Andre"


def test_parse_jina_response_repairs_dropped_nbsp_inside_mojibake():
    expected_content = (
        "![Image 1: 图片](https://example.com/path95Vg/640)"
        "王焕超腾讯研究院高级研究员。价格是300拉里。"
    )
    broken_content = expected_content.encode("utf-8").decode("latin-1").replace(
        "\xa0",
        "",
    )

    class FakeResponse:
        headers = {"content-type": "application/json"}

        def json(self):
            return {"data": {"content": broken_content}}

    parsed = ArticleExtractionService()._parse_jina_response(FakeResponse())

    assert parsed["content_md"] == expected_content
