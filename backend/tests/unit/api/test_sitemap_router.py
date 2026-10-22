import httpx
import pytest
from fastapi import FastAPI
from sqlalchemy import event
from sqlalchemy.orm import Session

from app.api.routers.sitemap_router import router
from app.core.dependencies import get_db
from models import Article, Category, ReviewIssue, ReviewTemplate


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.mark.anyio
async def test_public_projection_paginates_stably_and_ignores_admin_cookie(db_session):
    db_session.add_all([Article(id=str(i), title="Visible", slug=f"visible-{i}", is_visible=True) for i in range(5)])
    db_session.add(Article(id="hidden", title="Private", slug="hidden", is_visible=False))
    db_session.add(Category(id="cat", name="Public category"))
    db_session.add(ReviewTemplate(id="template", name="Template", slug="template"))
    db_session.flush()
    db_session.add_all([ReviewIssue(id=status, template_id="template", slug=status, title=status, status=status, markdown_content="Private large body") for status in ("draft", "published")])
    db_session.commit()
    app = FastAPI()
    app.include_router(router)
    def database():
        with Session(db_session.get_bind()) as fresh:
            yield fresh
    app.dependency_overrides[get_db] = database
    statements = []
    def observe(_conn, _cursor, statement, *_args):
        statements.append(statement)
    event.listen(db_session.get_bind(), "before_cursor_execute", observe)
    try:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://unit", cookies={"lumina_admin_token": "not-a-real-token"}) as client:
            ids = []
            cursor = None
            while True:
                response = await client.get("/api/sitemap/articles", params={"size": 2, **({"cursor": cursor} if cursor else {})})
                assert response.status_code == 200
                assert "public" in response.headers["cache-control"]
                data = response.json()
                ids.extend(item["id"] for item in data["items"])
                assert all(set(item) == {"id", "slug", "lastmod"} for item in data["items"])
                cursor = data["next_cursor"]
                if not cursor:
                    break
            assert ids == [str(i) for i in range(5)]
            assert [item["slug"] for item in (await client.get("/api/sitemap/columns")).json()["items"]] == ["published"]
            assert [item["id"] for item in (await client.get("/api/sitemap/categories")).json()["items"]] == ["cat"]
            assert (await client.get("/api/sitemap/articles?size=501")).status_code == 422
            assert (await client.get("/api/sitemap/invalid")).status_code == 422
        assert not any("JOIN" in sql.upper() or "ai_analyses" in sql or "markdown_content" in sql or "article_comments" in sql for sql in statements)
    finally:
        event.remove(db_session.get_bind(), "before_cursor_execute", observe)
