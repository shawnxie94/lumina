import inspect
import threading

import httpx
import pytest
from fastapi import FastAPI
from sqlalchemy.orm import Session

from app.api.routers import article_router
from app.core.dependencies import check_is_admin_or_internal, get_db
from models import Article


@pytest.fixture
def anyio_backend():
    return "asyncio"


def test_only_selected_sync_reads_changed():
    for name in ("get_articles", "get_article", "search_articles", "get_articles_rss", "export_article_markdown", "get_similar_articles"):
        assert not inspect.iscoroutinefunction(getattr(article_router, name))
    assert inspect.iscoroutinefunction(article_router.create_article)
    assert inspect.iscoroutinefunction(article_router.report_article_by_url)


@pytest.mark.anyio
async def test_http_list_runs_query_off_event_loop_and_preserves_public_contract(db_session, monkeypatch):
    db_session.add_all([
        Article(title="Public", slug="public-read", is_visible=True, view_count=9),
        Article(title="Private", slug="private-read", is_visible=False),
    ])
    db_session.commit()
    app = FastAPI()
    app.include_router(article_router.router)
    def database():
        with Session(db_session.get_bind()) as fresh:
            yield fresh
    app.dependency_overrides[get_db] = database
    app.dependency_overrides[check_is_admin_or_internal] = lambda: False
    loop_thread = threading.get_ident()
    query_threads = []
    original = article_router.article_query_service.get_articles
    def observed(*args, **kwargs):
        query_threads.append(threading.get_ident())
        return original(*args, **kwargs)
    monkeypatch.setattr(article_router.article_query_service, "get_articles", observed)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://unit") as client:
        response = await client.get("/api/articles?size=20")
        assert response.status_code == 200
        assert [item["slug"] for item in response.json()["data"]] == ["public-read"]
        assert response.json()["data"][0]["view_count"] == 9
        assert "public" in response.headers["cache-control"]
        assert (await client.get("/api/articles/private-read")).status_code == 404
        assert (await client.get("/api/articles/public-read")).status_code == 200
        assert (await client.get("/api/articles/search?query=Public")).status_code == 401
    assert query_threads and all(thread != loop_thread for thread in query_threads)
