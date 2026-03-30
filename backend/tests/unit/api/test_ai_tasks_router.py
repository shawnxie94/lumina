from __future__ import annotations

import pytest

from app.api.routers import ai_tasks_router
from models import AITask, Article


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.mark.anyio
async def test_list_ai_tasks_prefers_translated_article_title(db_session):
    article = Article(
        title="Original Task Article Title",
        title_trans="任务文章译文标题",
        slug="task-article",
        content_md="content",
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
    db_session.add(article)
    db_session.commit()

    task = AITask(
        article_id=article.id,
        task_type="process_ai_content",
        content_type="summary",
        status="failed",
        payload="{}",
        attempts=1,
        max_attempts=3,
        run_at="2026-03-27T10:00:00",
        created_at="2026-03-27T10:01:00",
        updated_at="2026-03-27T10:02:00",
        finished_at="2026-03-27T10:03:00",
    )
    db_session.add(task)
    db_session.commit()

    response = await ai_tasks_router.list_ai_tasks(
        page=1,
        size=20,
        status=None,
        task_type=None,
        content_type=None,
        article_id=None,
        article_title=None,
        db=db_session,
        _=True,
    )

    assert response["data"][0]["article_title"] == "任务文章译文标题"
    assert response["data"][0]["article_slug"] == "task-article"


@pytest.mark.anyio
async def test_list_ai_tasks_article_title_filter_matches_translated_title(db_session):
    article = Article(
        title="Original Filter Title",
        title_trans="筛选译文标题",
        slug="task-filter-article",
        content_md="content",
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
    db_session.add(article)
    db_session.commit()

    task = AITask(
        article_id=article.id,
        task_type="process_ai_content",
        content_type="summary",
        status="failed",
        payload="{}",
        attempts=1,
        max_attempts=3,
        run_at="2026-03-27T10:00:00",
        created_at="2026-03-27T10:01:00",
        updated_at="2026-03-27T10:02:00",
        finished_at="2026-03-27T10:03:00",
    )
    db_session.add(task)
    db_session.commit()

    response = await ai_tasks_router.list_ai_tasks(
        page=1,
        size=20,
        status=None,
        task_type=None,
        content_type=None,
        article_id=None,
        article_title="筛选译文",
        db=db_session,
        _=True,
    )

    assert len(response["data"]) == 1
    assert response["data"][0]["id"] == task.id


@pytest.mark.anyio
async def test_get_ai_task_timeline_prefers_translated_article_title(db_session):
    article = Article(
        title="Original Timeline Title",
        title_trans="时间线译文标题",
        slug="timeline-article",
        content_md="content",
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
    db_session.add(article)
    db_session.commit()

    task = AITask(
        article_id=article.id,
        task_type="process_ai_content",
        content_type="summary",
        status="failed",
        payload="{}",
        attempts=1,
        max_attempts=3,
        run_at="2026-03-27T10:00:00",
        created_at="2026-03-27T10:01:00",
        updated_at="2026-03-27T10:02:00",
        finished_at="2026-03-27T10:03:00",
    )
    db_session.add(task)
    db_session.commit()

    response = await ai_tasks_router.get_ai_task_timeline(
        task_id=task.id,
        db=db_session,
        _=True,
    )

    assert response["task"]["article_title"] == "时间线译文标题"
    assert response["task"]["article_slug"] == "timeline-article"


@pytest.mark.anyio
async def test_get_ai_task_prefers_translated_article_title_and_falls_back(db_session):
    translated_article = Article(
        title="Original Task Title",
        title_trans="任务详情译文标题",
        slug="task-detail-article",
        content_md="content",
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
    fallback_article = Article(
        title="Fallback Original Title",
        title_trans="   ",
        slug="fallback-task-detail-article",
        content_md="content",
        content_trans="",
        top_image="",
        author="Tester",
        published_at="2026-03-27T11:00:00",
        source_domain="example.com",
        status="completed",
        is_visible=True,
        created_at="2026-03-27T11:00:00",
        updated_at="2026-03-27T11:00:00",
    )
    db_session.add_all([translated_article, fallback_article])
    db_session.commit()

    translated_task = AITask(
        article_id=translated_article.id,
        task_type="process_ai_content",
        content_type="summary",
        status="failed",
        payload="{}",
        attempts=1,
        max_attempts=3,
        run_at="2026-03-27T10:00:00",
        created_at="2026-03-27T10:01:00",
        updated_at="2026-03-27T10:02:00",
        finished_at="2026-03-27T10:03:00",
    )
    fallback_task = AITask(
        article_id=fallback_article.id,
        task_type="process_ai_content",
        content_type="summary",
        status="failed",
        payload="{}",
        attempts=1,
        max_attempts=3,
        run_at="2026-03-27T11:00:00",
        created_at="2026-03-27T11:01:00",
        updated_at="2026-03-27T11:02:00",
        finished_at="2026-03-27T11:03:00",
    )
    db_session.add_all([translated_task, fallback_task])
    db_session.commit()

    translated_response = await ai_tasks_router.get_ai_task(
        task_id=translated_task.id,
        db=db_session,
        _=True,
    )
    fallback_response = await ai_tasks_router.get_ai_task(
        task_id=fallback_task.id,
        db=db_session,
        _=True,
    )

    assert translated_response["article_title"] == "任务详情译文标题"
    assert fallback_response["article_title"] == "Fallback Original Title"
