from __future__ import annotations

from types import SimpleNamespace

import pytest

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
