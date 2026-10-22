"""Count SQL through the actual list endpoint and full JSON serialization."""
import json

import pytest
from fastapi import Response
from fastapi.encoders import jsonable_encoder
from sqlalchemy import event, inspect
from sqlalchemy.orm import Session

from app.api.routers import article_router
from app.domain.article_query_service import ArticleQueryService
from models import AIAnalysis, Article, Category


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.mark.anyio
@pytest.mark.parametrize("size", [1, 20, 100])
async def test_list_serialization_has_constant_select_budget(db_session, size):
    category = Category(name="Budget", color="#123456")
    db_session.add(category)
    db_session.flush()
    for index in range(100):
        article = Article(
            title=f"Article {index}", slug=f"budget-{index}",
            category_id=category.id, is_visible=True, view_count=index,
        )
        db_session.add(article)
        db_session.flush()
        db_session.add(AIAnalysis(article_id=article.id, summary=f"Summary {index}"))
    db_session.commit()
    engine = db_session.get_bind()
    selects = []

    def count_select(_conn, _cursor, statement, _parameters, _context, _many):
        if statement.lstrip().upper().startswith("SELECT"):
            selects.append(statement)

    event.listen(engine, "before_cursor_execute", count_select)
    try:
        # No seeded ORM objects in this identity map: deferred loads cannot hide.
        with Session(engine) as fresh:
            result = article_router.get_articles(
                response=Response(), size=size, db=fresh, is_admin=False,
            )
            payload = json.loads(json.dumps(jsonable_encoder(result)))
        assert len(payload["data"]) == size
        assert all(item["summary"] and item["category"] for item in payload["data"])
        assert all(isinstance(item["view_count"], int) for item in payload["data"])
        assert len(selects) == 3, selects
    finally:
        event.remove(engine, "before_cursor_execute", count_select)


def test_detail_preloads_serialized_interpretation_fields(db_session):
    article = Article(title="Detail audit", slug="detail-audit", is_visible=True)
    db_session.add(article)
    db_session.flush()
    db_session.add(AIAnalysis(
        article_id=article.id, interpretation_status="failed",
        interpretation_error="Example error",
    ))
    db_session.commit()
    with Session(db_session.get_bind()) as fresh:
        detail = ArticleQueryService().get_article_by_slug(
            fresh, "detail-audit", include_relations=True,
        )
        assert detail is not None and detail.ai_analysis is not None
        assert not {"interpretation_status", "interpretation_error"} & inspect(
            detail.ai_analysis
        ).unloaded
        assert detail.ai_analysis.interpretation_status == "failed"
        assert detail.ai_analysis.interpretation_error == "Example error"
