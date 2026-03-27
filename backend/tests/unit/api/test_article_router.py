from __future__ import annotations

from io import BytesIO
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from fastapi import UploadFile

from app.api.routers import article_router


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
