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
