import asyncio
import uuid

import pytest

from app.domain.article_url_ingest_service import (
    ArticleUrlIngestBadGatewayError,
    ArticleUrlIngestBadRequestError,
    ArticleUrlIngestContentTypeError,
    ArticleUrlIngestDuplicateError,
    ArticleUrlIngestGatewayTimeoutError,
    ArticleUrlIngestService,
)
from app.domain.article_extraction_service import (
    ArticleExtractionBadGatewayError,
    ArticleExtractionBadRequestError,
    ArticleExtractionContentTypeError,
    ArticleExtractionGatewayTimeoutError,
    ExtractedArticle,
)
from models import Article, now_str


class StubArticleCommandService:
    def __init__(self):
        self.last_payload: dict | None = None
        self.slug_counter = 0

    async def create_article(self, article_data: dict, db) -> str:
        self.last_payload = article_data
        self.slug_counter += 1
        article_id = str(uuid.uuid4())
        article = Article(
            id=article_id,
            title=article_data.get("title") or "untitled",
            slug=f"slug-{self.slug_counter}",
            content_html=article_data.get("content_html"),
            content_md=article_data.get("content_md") or "",
            source_url=article_data.get("source_url"),
            top_image=article_data.get("top_image"),
            author=article_data.get("author"),
            published_at=article_data.get("published_at"),
            source_domain=article_data.get("source_domain"),
            status="pending",
            is_visible=False,
            category_id=article_data.get("category_id"),
            extraction_provider=article_data.get("extraction_provider"),
            extraction_status=article_data.get("extraction_status"),
            extraction_error=article_data.get("extraction_error"),
            extraction_metadata=article_data.get("extraction_metadata"),
            created_at=now_str(),
            updated_at=now_str(),
        )
        db.add(article)
        db.commit()
        db.refresh(article)
        return article.id


class StubExtractionService:
    def __init__(self, result: ExtractedArticle | None = None, error: Exception | None = None):
        self.result = result
        self.error = error
        self.last_url = None

    async def extract_url(self, _db, url: str, *, ensure_public_url):
        self.last_url = url
        ensure_public_url(url)
        if self.error:
            raise self.error
        return self.result or ExtractedArticle(
            title="Test Title",
            content_html="<article><p>Hello world content.</p></article>",
            content_md="Hello world content.",
            source_url="https://example.com/final-path",
            top_image="https://example.com/cover.jpg",
            author="Lumina Bot",
            published_at="2026-02-24T00:00:00Z",
            source_domain="example.com",
            provider="jina",
            metadata={"content_length": 20},
        )

    def metadata_to_json(self, metadata):
        return "{}" if metadata else None


def make_existing_article(db_session, source_url: str) -> Article:
    article = Article(
        id=str(uuid.uuid4()),
        title="existing",
        slug=f"existing-{uuid.uuid4().hex[:8]}",
        content_html="<p>existing</p>",
        content_md="existing",
        source_url=source_url,
        status="completed",
        is_visible=True,
        created_at=now_str(),
        updated_at=now_str(),
    )
    db_session.add(article)
    db_session.commit()
    db_session.refresh(article)
    return article


def test_report_by_url_creates_article_and_uses_redirect_url(db_session, monkeypatch):
    command = StubArticleCommandService()
    service = ArticleUrlIngestService(
        article_command_service=command,
        article_extraction_service=StubExtractionService(),
    )
    monkeypatch.setattr(service, "_hostname_resolves_to_private", lambda hostname: False)

    result = asyncio.run(
        service.report_by_url(
            db_session,
            url="https://example.com/start",
            is_visible=True,
            skip_ai_processing=True,
        )
    )
    article = db_session.query(Article).filter(Article.id == result["id"]).first()

    assert result["source_url"] == "https://example.com/final-path"
    assert article is not None
    assert article.source_url == "https://example.com/final-path"
    assert article.is_visible is True
    assert command.last_payload is not None
    assert command.last_payload["source_domain"] == "example.com"
    assert command.last_payload["skip_ai_processing"] is True
    assert command.last_payload["extraction_provider"] == "jina"


def test_report_by_url_uses_first_image_in_primary_content_when_meta_missing(
    db_session,
    monkeypatch,
):
    command = StubArticleCommandService()
    service = ArticleUrlIngestService(
        article_command_service=command,
        article_extraction_service=StubExtractionService(
            ExtractedArticle(
                title="Test Title",
                content_html="<article><p>Hello world content.</p><img src=\"https://example.com/content-cover.jpg\" /></article>",
                content_md="Hello world content.",
                source_url="https://example.com/body-first-image",
                top_image="https://example.com/content-cover.jpg",
                author=None,
                published_at=None,
                source_domain="example.com",
                provider="local_html",
            )
        ),
    )
    monkeypatch.setattr(service, "_hostname_resolves_to_private", lambda hostname: False)

    asyncio.run(
        service.report_by_url(
            db_session,
            url="https://example.com/start",
            skip_ai_processing=True,
        )
    )

    assert command.last_payload is not None
    assert command.last_payload["top_image"] == "https://example.com/content-cover.jpg"


def test_report_by_url_returns_duplicate_when_source_url_exists(db_session, monkeypatch):
    existing = make_existing_article(db_session, "https://example.com/existing")
    service = ArticleUrlIngestService(
        article_command_service=StubArticleCommandService(),
        article_extraction_service=StubExtractionService(),
    )
    monkeypatch.setattr(service, "_hostname_resolves_to_private", lambda hostname: False)

    with pytest.raises(ArticleUrlIngestDuplicateError) as exc_info:
        asyncio.run(
            service.report_by_url(
                db_session,
                url="https://example.com/existing",
            )
        )

    assert exc_info.value.existing["id"] == existing.id
    assert exc_info.value.existing["slug"] == existing.slug


@pytest.mark.parametrize(
    ("url", "expected_detail"),
    [
        ("ftp://example.com/article", "URL仅支持 http 或 https"),
        ("http://localhost/article", "不允许访问内网或本机地址"),
        ("http://127.0.0.1/article", "不允许访问内网或本机地址"),
        ("http://192.168.1.2/article", "不允许访问内网或本机地址"),
    ],
)
def test_report_by_url_rejects_invalid_and_private_urls(
    db_session,
    monkeypatch,
    url,
    expected_detail,
):
    service = ArticleUrlIngestService(
        article_command_service=StubArticleCommandService(),
        article_extraction_service=StubExtractionService(),
    )
    monkeypatch.setattr(service, "_hostname_resolves_to_private", lambda hostname: False)

    with pytest.raises(ArticleUrlIngestBadRequestError) as exc_info:
        asyncio.run(
            service.report_by_url(
                db_session,
                url=url,
            )
        )

    assert expected_detail in exc_info.value.detail


def test_report_by_url_rejects_non_html_content(db_session, monkeypatch):
    service = ArticleUrlIngestService(
        article_command_service=StubArticleCommandService(),
        article_extraction_service=StubExtractionService(
            error=ArticleExtractionContentTypeError("目标URL不是HTML页面")
        ),
    )
    monkeypatch.setattr(service, "_hostname_resolves_to_private", lambda hostname: False)

    with pytest.raises(ArticleUrlIngestContentTypeError):
        asyncio.run(
            service.report_by_url(
                db_session,
                url="https://example.com/not-html",
            )
        )


@pytest.mark.parametrize(
    "error",
    [
        ArticleExtractionGatewayTimeoutError("抓取超时，请稍后重试"),
        ArticleExtractionBadGatewayError("抓取失败: network"),
    ],
)
def test_report_by_url_propagates_timeout_and_network_errors(db_session, monkeypatch, error):
    service = ArticleUrlIngestService(
        article_command_service=StubArticleCommandService(),
        article_extraction_service=StubExtractionService(error=error),
    )
    monkeypatch.setattr(service, "_hostname_resolves_to_private", lambda hostname: False)

    expected_type = (
        ArticleUrlIngestGatewayTimeoutError
        if isinstance(error, ArticleExtractionGatewayTimeoutError)
        else ArticleUrlIngestBadGatewayError
    )
    with pytest.raises(expected_type):
        asyncio.run(
            service.report_by_url(
                db_session,
                url="https://example.com/network",
            )
        )


def test_report_by_url_rejects_empty_content(db_session, monkeypatch):
    service = ArticleUrlIngestService(
        article_command_service=StubArticleCommandService(),
        article_extraction_service=StubExtractionService(
            error=ArticleExtractionBadRequestError("文章内容为空")
        ),
    )
    monkeypatch.setattr(service, "_hostname_resolves_to_private", lambda hostname: False)

    with pytest.raises(ArticleUrlIngestBadRequestError) as exc_info:
        asyncio.run(
            service.report_by_url(
                db_session,
                url="https://example.com/empty",
            )
        )

    assert "文章内容为空" in exc_info.value.detail
