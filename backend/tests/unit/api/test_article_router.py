from __future__ import annotations

from io import BytesIO
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from fastapi import Response
from fastapi import UploadFile

from app.api.routers import article_router
from app.core.public_cache import CACHE_KEY_AUTHORS_PUBLIC, CACHE_KEY_SOURCES_PUBLIC
from models import Article, ArticleEmbedding, now_str


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.mark.anyio
async def test_get_similar_articles_returns_disabled_when_remote_config_unavailable(
    db_session,
):
    response = await article_router.get_similar_articles(
        article_slug="missing-article",
        db=db_session,
        is_admin=False,
    )

    assert response == {"status": "disabled", "items": []}


@pytest.mark.anyio
async def test_get_similar_articles_includes_translated_title(db_session, monkeypatch):
    current_article = Article(
        title="Current Article",
        slug="current-article",
        content_md="current content",
        content_trans="",
        top_image="",
        author="Tester",
        published_at="2026-03-27T10:00:00",
        source_domain="example.com",
        status="completed",
        is_visible=True,
        created_at="2026-03-27T10:00:00",
        updated_at="2026-03-27T10:00:00",
    )
    similar_article = Article(
        title="Similar Original Title",
        title_trans="相似文章译文标题",
        slug="similar-article",
        content_md="similar content",
        content_trans="",
        top_image="",
        author="Tester",
        published_at="2026-03-26T10:00:00",
        source_domain="example.com",
        status="completed",
        is_visible=True,
        created_at="2026-03-26T10:00:00",
        updated_at="2026-03-26T10:00:00",
    )
    db_session.add_all([current_article, similar_article])
    db_session.commit()

    db_session.add_all(
        [
            ArticleEmbedding(
                article_id=current_article.id,
                model="test-model",
                embedding="[1, 0]",
                source_hash="expected-hash",
                created_at=now_str(),
                updated_at=now_str(),
            ),
            ArticleEmbedding(
                article_id=similar_article.id,
                model="test-model",
                embedding="[1, 0]",
                source_hash="candidate-hash",
                created_at=now_str(),
                updated_at=now_str(),
            ),
        ]
    )
    db_session.commit()

    monkeypatch.setattr(
        article_router,
        "get_admin_settings",
        lambda db: SimpleNamespace(recommendations_enabled=True),
    )
    monkeypatch.setattr(
        article_router.article_embedding_service,
        "has_available_remote_config",
        lambda db: True,
    )
    monkeypatch.setattr(
        article_router.article_embedding_service,
        "has_summary_source",
        lambda article: True,
    )
    monkeypatch.setattr(
        article_router.article_embedding_service,
        "get_embedding_source_hash",
        lambda article: "expected-hash",
    )
    monkeypatch.setattr(
        article_router.article_embedding_service,
        "cosine_similarity",
        lambda left, right: 0.95,
    )

    response = await article_router.get_similar_articles(
        article_slug="current-article",
        limit=5,
        db=db_session,
        is_admin=True,
    )

    assert response["status"] == "ready"
    assert response["items"] == [
        {
            "id": similar_article.id,
            "slug": "similar-article",
            "title": "Similar Original Title",
            "title_trans": "相似文章译文标题",
            "published_at": "2026-03-26T10:00:00",
            "created_at": "2026-03-26T10:00:00",
            "category_id": None,
            "category_name": None,
            "category_color": None,
        }
    ]


@pytest.mark.anyio
async def test_generate_ai_content_accepts_infographic(monkeypatch, db_session):
    article = SimpleNamespace(id="article-1")
    captured: dict[str, str | None] = {}

    async def fake_generate(
        db,
        article_id: str,
        content_type: str,
        model_config_id: str | None = None,
        prompt_config_id: str | None = None,
    ) -> None:
        captured["article_id"] = article_id
        captured["content_type"] = content_type
        captured["model_config_id"] = model_config_id
        captured["prompt_config_id"] = prompt_config_id

    monkeypatch.setattr(
        article_router.article_query_service,
        "get_article_by_slug",
        lambda db, slug: article,
    )
    monkeypatch.setattr(
        article_router.article_command_service,
        "generate_ai_content",
        fake_generate,
    )

    response = await article_router.generate_ai_content(
        article_slug="demo-article",
        content_type="infographic",
        model_config_id="model-1",
        prompt_config_id="prompt-1",
        db=db_session,
        _=True,
    )

    assert response == {
        "id": "article-1",
        "content_type": "infographic",
        "status": "processing",
    }
    assert captured == {
        "article_id": "article-1",
        "content_type": "infographic",
        "model_config_id": "model-1",
        "prompt_config_id": "prompt-1",
    }


@pytest.mark.anyio
async def test_delete_ai_content_accepts_non_summary_types(monkeypatch, db_session):
    article = SimpleNamespace(id="article-1")
    captured: dict[str, str] = {}

    def fake_delete(db, article_id: str, content_type: str) -> None:
        captured["article_id"] = article_id
        captured["content_type"] = content_type

    monkeypatch.setattr(
        article_router.article_query_service,
        "get_article_by_slug",
        lambda db, slug: article,
    )
    monkeypatch.setattr(
        article_router.article_command_service,
        "delete_ai_content",
        fake_delete,
    )
    monkeypatch.setattr(
        article_router,
        "invalidate_public_article_derived_cache",
        lambda: captured.__setitem__("cache_invalidated", "1"),
    )

    response = await article_router.delete_ai_content(
        article_slug="demo-article",
        content_type="quotes",
        db=db_session,
        _=True,
    )

    assert response == {
        "id": "article-1",
        "content_type": "quotes",
        "status": "deleted",
    }
    assert captured == {
        "article_id": "article-1",
        "content_type": "quotes",
        "cache_invalidated": "1",
    }


@pytest.mark.anyio
async def test_delete_ai_content_rejects_summary(db_session):
    with pytest.raises(HTTPException) as exc_info:
        await article_router.delete_ai_content(
            article_slug="demo-article",
            content_type="summary",
            db=db_session,
            _=True,
        )

    assert exc_info.value.status_code == 400
    assert exc_info.value.detail == "无效的内容类型，支持: key_points, outline, quotes, infographic"


@pytest.mark.anyio
async def test_search_articles_matches_translated_title(db_session):
    article = Article(
        title="Original Search API Title",
        title_trans="接口译文标题",
        slug="search-api-title",
        content_md="content",
        content_trans="",
        top_image="",
        author="Tester",
        published_at=now_str(),
        source_domain="example.com",
        status="completed",
        is_visible=True,
        created_at=now_str(),
        updated_at=now_str(),
    )
    db_session.add(article)
    db_session.commit()

    response = await article_router.search_articles(
        query="接口译文",
        limit=20,
        db=db_session,
        _=True,
    )

    assert len(response) == 1
    assert response[0]["slug"] == "search-api-title"
    assert response[0]["title"] == "Original Search API Title"
    assert response[0]["title_trans"] == "接口译文标题"
    assert response[0]["display_title"] == "接口译文标题"


@pytest.mark.anyio
async def test_get_article_includes_translated_titles_for_neighbors(db_session):
    previous_article = Article(
        title="Previous Original Title",
        title_trans="上一篇译文标题",
        slug="previous-article",
        content_md="previous content",
        content_trans="",
        top_image="",
        author="Tester",
        published_at="2026-03-28T10:00:00",
        source_domain="example.com",
        status="completed",
        is_visible=True,
        created_at="2026-03-28T10:00:00",
        updated_at="2026-03-28T10:00:00",
    )
    current_article = Article(
        title="Current Original Title",
        title_trans="当前译文标题",
        slug="current-article",
        content_md="current content",
        content_trans="",
        top_image="",
        author="Tester",
        published_at="2026-03-27T10:00:00",
        source_domain="example.com",
        status="completed",
        is_visible=True,
        created_at="2026-03-27T10:00:00",
        updated_at="2026-03-27T10:00:00",
    )
    next_article = Article(
        title="Next Original Title",
        title_trans="下一篇译文标题",
        slug="next-article",
        content_md="next content",
        content_trans="",
        top_image="",
        author="Tester",
        published_at="2026-03-26T10:00:00",
        source_domain="example.com",
        status="completed",
        is_visible=True,
        created_at="2026-03-26T10:00:00",
        updated_at="2026-03-26T10:00:00",
    )
    db_session.add_all([previous_article, current_article, next_article])
    db_session.commit()

    response = await article_router.get_article(
        article_slug="current-article",
        response=Response(),
        db=db_session,
        is_admin=True,
    )

    assert response["title_trans"] == "当前译文标题"
    assert response["prev_article"] == {
        "id": previous_article.id,
        "slug": "previous-article",
        "title": "Previous Original Title",
        "title_trans": "上一篇译文标题",
    }
    assert response["next_article"] == {
        "id": next_article.id,
        "slug": "next-article",
        "title": "Next Original Title",
        "title_trans": "下一篇译文标题",
    }


@pytest.mark.anyio
async def test_repair_infographic_html_accepts_manual_error(monkeypatch, db_session):
    article = SimpleNamespace(id="article-1")
    captured: dict[str, str | None] = {}

    async def fake_repair(
        db,
        article_id: str,
        error_message: str,
        model_config_id: str | None = None,
    ) -> None:
        captured["article_id"] = article_id
        captured["error_message"] = error_message
        captured["model_config_id"] = model_config_id

    monkeypatch.setattr(
        article_router.article_query_service,
        "get_article_by_slug",
        lambda db, slug: article,
    )
    monkeypatch.setattr(
        article_router.article_command_service,
        "repair_infographic_html",
        fake_repair,
    )

    response = await article_router.repair_infographic_html(
        article_slug="demo-article",
        payload=article_router.ArticleInfographicRepairRequest(
            error_message="请压缩底部留白并避免正文超高",
            model_config_id="model-9",
        ),
        db=db_session,
        _=True,
    )

    assert response == {
        "id": "article-1",
        "content_type": "infographic",
        "status": "processing",
    }
    assert captured == {
        "article_id": "article-1",
        "error_message": "请压缩底部留白并避免正文超高",
        "model_config_id": "model-9",
    }


@pytest.mark.anyio
async def test_get_articles_rss_rejects_when_disabled(monkeypatch, db_session):
    request = SimpleNamespace(
        headers={},
        base_url="http://localhost:8000/",
    )

    monkeypatch.setattr(
        article_router.article_rss_service,
        "assert_rss_enabled",
        lambda db: (_ for _ in ()).throw(
            HTTPException(status_code=404, detail="RSS未开启")
        ),
    )

    with pytest.raises(HTTPException) as exc_info:
        await article_router.get_articles_rss(
            request=request,
            category_id=None,
            tag_ids=None,
            db=db_session,
        )

    assert exc_info.value.status_code == 404
    assert exc_info.value.detail == "RSS未开启"


@pytest.mark.anyio
@pytest.mark.parametrize(
    ("endpoint", "cache_key", "payload"),
    [
        ("get_authors", CACHE_KEY_AUTHORS_PUBLIC, ["Alice", "Bob"]),
        ("get_sources", CACHE_KEY_SOURCES_PUBLIC, ["example.com", "news.test"]),
    ],
)
async def test_public_metadata_endpoints_use_expected_cache_keys(
    monkeypatch,
    db_session,
    endpoint,
    cache_key,
    payload,
):
    captured: dict[str, object] = {}

    def fake_get_public_cached(key, loader):
        captured["key"] = key
        return payload

    def fake_apply_public_cache_headers(response):
        response.headers["X-Cache-Checked"] = "1"

    monkeypatch.setattr(article_router, "get_public_cached", fake_get_public_cached)
    monkeypatch.setattr(
        article_router,
        "apply_public_cache_headers",
        fake_apply_public_cache_headers,
    )

    response = Response()
    result = await getattr(article_router, endpoint)(response=response, db=db_session)

    assert result == payload
    assert captured["key"] == cache_key
    assert response.headers["X-Cache-Checked"] == "1"


@pytest.mark.anyio
async def test_upload_infographic_image_replaces_existing_asset(monkeypatch):
    analysis = SimpleNamespace(
        infographic_html="<section>infographic</section>",
        infographic_image_url="/media/old-infographic.png",
        updated_at=None,
    )
    article = SimpleNamespace(id="article-1", ai_analysis=analysis)
    captured: dict[str, object] = {"deleted_urls": []}

    monkeypatch.setattr(
        article_router.article_query_service,
        "get_article_by_slug",
        lambda db, slug: article,
    )

    async def fake_save_upload_image(db, article_id, file, kind="image"):
        captured["article_id"] = article_id
        captured["kind"] = kind
        captured["filename"] = file.filename
        return (
            SimpleNamespace(
                id="asset-1",
                storage_path="articles/article-1/infographic.png",
                size=2048,
                content_type="image/png",
            ),
            "/media/articles/article-1/infographic.png",
        )

    def fake_delete_media_asset_by_url(db, url):
        deleted = captured["deleted_urls"]
        assert isinstance(deleted, list)
        deleted.append(url)

    monkeypatch.setattr(article_router, "save_upload_image", fake_save_upload_image)
    monkeypatch.setattr(
        article_router,
        "delete_media_asset_by_url",
        fake_delete_media_asset_by_url,
    )
    monkeypatch.setattr(
        article_router,
        "invalidate_public_article_derived_cache",
        lambda: captured.__setitem__("cache_invalidated", True),
    )

    db = SimpleNamespace(commit=lambda: None, refresh=lambda obj: None)
    upload = UploadFile(filename="infographic.png", file=BytesIO(b"png"))
    response = await article_router.upload_infographic_image(
        article_slug="demo-article",
        file=upload,
        db=db,
        _=True,
    )

    assert response == {
        "asset_id": "asset-1",
        "url": "/media/articles/article-1/infographic.png",
        "filename": "infographic.png",
        "size": 2048,
        "content_type": "image/png",
    }
    assert analysis.infographic_image_url == "/media/articles/article-1/infographic.png"
    assert captured["article_id"] == "article-1"
    assert captured["kind"] == "image"
    assert captured["filename"] == "infographic.png"
    assert captured["deleted_urls"] == ["/media/old-infographic.png"]
    assert captured["cache_invalidated"] is True
