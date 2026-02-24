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
    URLFetchResult,
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
            created_at=now_str(),
            updated_at=now_str(),
        )
        db.add(article)
        db.commit()
        db.refresh(article)
        return article.id


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
    service = ArticleUrlIngestService(article_command_service=command)
    monkeypatch.setattr(service, "_hostname_resolves_to_private", lambda hostname: False)

    async def fake_fetch(_url: str) -> URLFetchResult:
        return URLFetchResult(
            final_url="https://example.com/final-path",
            html="""
            <html>
              <head>
                <title>Test Title</title>
                <meta property="og:image" content="/cover.jpg" />
                <meta name="author" content="Lumina Bot" />
                <meta property="article:published_time" content="2026-02-24T00:00:00Z" />
              </head>
              <body>
                <article><h1>Article</h1><p>Hello world content.</p></article>
              </body>
            </html>
            """,
        )

    monkeypatch.setattr(service, "_fetch_html_from_url", fake_fetch)

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


def test_report_by_url_returns_duplicate_when_source_url_exists(db_session, monkeypatch):
    existing = make_existing_article(db_session, "https://example.com/existing")
    service = ArticleUrlIngestService(article_command_service=StubArticleCommandService())
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
    service = ArticleUrlIngestService(article_command_service=StubArticleCommandService())
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
    service = ArticleUrlIngestService(article_command_service=StubArticleCommandService())
    monkeypatch.setattr(service, "_hostname_resolves_to_private", lambda hostname: False)

    async def fake_fetch(_url: str) -> URLFetchResult:
        raise ArticleUrlIngestContentTypeError("目标URL不是HTML页面")

    monkeypatch.setattr(service, "_fetch_html_from_url", fake_fetch)

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
        ArticleUrlIngestGatewayTimeoutError("抓取超时，请稍后重试"),
        ArticleUrlIngestBadGatewayError("抓取失败: network"),
    ],
)
def test_report_by_url_propagates_timeout_and_network_errors(db_session, monkeypatch, error):
    service = ArticleUrlIngestService(article_command_service=StubArticleCommandService())
    monkeypatch.setattr(service, "_hostname_resolves_to_private", lambda hostname: False)

    async def fake_fetch(_url: str) -> URLFetchResult:
        raise error

    monkeypatch.setattr(service, "_fetch_html_from_url", fake_fetch)

    with pytest.raises(type(error)):
        asyncio.run(
            service.report_by_url(
                db_session,
                url="https://example.com/network",
            )
        )


def test_report_by_url_rejects_empty_content(db_session, monkeypatch):
    service = ArticleUrlIngestService(article_command_service=StubArticleCommandService())
    monkeypatch.setattr(service, "_hostname_resolves_to_private", lambda hostname: False)

    async def fake_fetch(_url: str) -> URLFetchResult:
        return URLFetchResult(
            final_url="https://example.com/empty",
            html="<html><body><script>1</script><style>p{}</style></body></html>",
        )

    monkeypatch.setattr(service, "_fetch_html_from_url", fake_fetch)

    with pytest.raises(ArticleUrlIngestBadRequestError) as exc_info:
        asyncio.run(
            service.report_by_url(
                db_session,
                url="https://example.com/empty",
            )
        )

    assert "文章内容为空" in exc_info.value.detail
