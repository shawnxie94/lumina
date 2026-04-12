from __future__ import annotations

import pytest

from app.api.routers import ai_usage_router
from app.schemas import AIUsageContinuationRequest
from models import AICallSession, AIUsageLog, AIAnalysis, Article


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.mark.anyio
async def test_continue_ai_usage_accepts_process_ai_content_usage(
    db_session,
    monkeypatch,
):
    article = Article(
        title="Continuation Article",
        slug="continuation-article",
        content_md="content",
        created_at="2026-04-12T10:00:00",
        updated_at="2026-04-12T10:00:00",
    )
    db_session.add(article)
    db_session.commit()
    db_session.add(
        AIAnalysis(
            article_id=article.id,
            summary_status="completed",
            updated_at="2026-04-12T10:00:00",
        )
    )
    usage = AIUsageLog(
        task_id="task-1",
        article_id=article.id,
        task_type="process_ai_content",
        content_type="summary",
        status="completed",
        request_payload="{}",
        response_payload="{}",
        created_at="2026-04-12T10:00:00",
    )
    db_session.add(usage)
    db_session.flush()
    db_session.add(
        AICallSession(
            usage_log_id=usage.id,
            task_id="task-1",
            article_id=article.id,
            task_type="process_ai_content",
            content_type="summary",
            api_type="chat_completions",
            continuation_mode="snapshot",
            input_snapshot="{}",
            output_snapshot="{}",
            created_at="2026-04-12T10:00:00",
            updated_at="2026-04-12T10:00:00",
        )
    )
    db_session.commit()

    monkeypatch.setattr(
        ai_usage_router.article_command_service,
        "enqueue_ai_continuation",
        lambda **kwargs: "task-continuation-1",
    )

    response = await ai_usage_router.continue_ai_usage(
        usage_id=usage.id,
        payload=AIUsageContinuationRequest(feedback="请更短"),
        db=db_session,
        _=True,
    )

    assert response == {
        "usage_id": usage.id,
        "task_id": "task-continuation-1",
        "status": "pending",
    }
