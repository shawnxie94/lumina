from __future__ import annotations

import pytest
import uuid

from app.api.routers import ai_tasks_router
from models import (
    AICallSession,
    AIUsageLog,
    AITask,
    AITaskEvent,
    Article,
    ReviewIssue,
    ReviewTemplate,
)


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
async def test_list_ai_tasks_collapses_same_chain_to_root_row(db_session):
    article = Article(
        title="Chain Aggregation Article",
        title_trans="链路聚合文章",
        slug="chain-aggregation-article",
        content_md="content",
        content_trans="",
        top_image="",
        author="Tester",
        published_at="2026-04-13T10:00:00",
        source_domain="example.com",
        status="completed",
        is_visible=True,
        created_at="2026-04-13T10:00:00",
        updated_at="2026-04-13T10:00:00",
    )
    db_session.add(article)
    db_session.commit()

    root_task = AITask(
        id="task-root",
        article_id=article.id,
        root_task_id="task-root",
        task_type="process_ai_content",
        content_type="summary",
        status="completed",
        payload="{}",
        attempts=1,
        max_attempts=1,
        run_at="2026-04-13T10:00:00",
        created_at="2026-04-13T10:00:00",
        updated_at="2026-04-13T10:00:00",
        finished_at="2026-04-13T10:00:00",
    )
    continuation_task = AITask(
        id="task-cont-1",
        article_id=article.id,
        parent_task_id="task-root",
        root_task_id="task-root",
        task_type="process_ai_content",
        content_type="summary",
        status="failed",
        payload='{"continuation_feedback":"请更短"}',
        attempts=1,
        max_attempts=1,
        run_at="2026-04-13T10:05:00",
        created_at="2026-04-13T10:05:00",
        updated_at="2026-04-13T10:06:00",
        finished_at="2026-04-13T10:06:00",
        last_error="too long",
    )
    db_session.add_all([root_task, continuation_task])
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

    assert len(response["data"]) == 1
    assert response["data"][0]["id"] == "task-root"
    assert response["data"][0]["latest_task_id"] == "task-cont-1"
    assert response["data"][0]["status"] == "failed"
    assert response["data"][0]["chain_length"] == 2
    assert response["data"][0]["has_continuations"] is True


@pytest.mark.anyio
async def test_list_ai_tasks_paginates_by_root_task_chain(db_session):
    article = Article(
        title="Chain Pagination Article",
        title_trans="链路分页文章",
        slug="chain-pagination-article",
        content_md="content",
        content_trans="",
        top_image="",
        author="Tester",
        published_at="2026-04-13T10:00:00",
        source_domain="example.com",
        status="completed",
        is_visible=True,
        created_at="2026-04-13T10:00:00",
        updated_at="2026-04-13T10:00:00",
    )
    db_session.add(article)
    db_session.commit()

    db_session.add_all(
        [
            AITask(
                id="task-root-1",
                article_id=article.id,
                root_task_id="task-root-1",
                task_type="process_ai_content",
                content_type="summary",
                status="completed",
                payload="{}",
                attempts=1,
                max_attempts=1,
                run_at="2026-04-13T10:00:00",
                created_at="2026-04-13T10:00:00",
                updated_at="2026-04-13T10:00:00",
                finished_at="2026-04-13T10:00:00",
            ),
            AITask(
                id="task-root-1-cont",
                article_id=article.id,
                parent_task_id="task-root-1",
                root_task_id="task-root-1",
                task_type="process_ai_content",
                content_type="summary",
                status="completed",
                payload='{"continuation_feedback":"请更短"}',
                attempts=1,
                max_attempts=1,
                run_at="2026-04-13T10:05:00",
                created_at="2026-04-13T10:05:00",
                updated_at="2026-04-13T10:06:00",
                finished_at="2026-04-13T10:06:00",
            ),
            AITask(
                id="task-root-2",
                article_id=article.id,
                root_task_id="task-root-2",
                task_type="process_ai_content",
                content_type="summary",
                status="completed",
                payload="{}",
                attempts=1,
                max_attempts=1,
                run_at="2026-04-13T11:00:00",
                created_at="2026-04-13T11:00:00",
                updated_at="2026-04-13T11:00:00",
                finished_at="2026-04-13T11:00:00",
            ),
        ]
    )
    db_session.commit()

    response = await ai_tasks_router.list_ai_tasks(
        page=1,
        size=1,
        status=None,
        task_type=None,
        content_type=None,
        article_id=None,
        article_title=None,
        db=db_session,
        _=True,
    )

    assert response["pagination"]["total"] == 2
    assert response["pagination"]["total_pages"] == 2
    assert [item["id"] for item in response["data"]] == ["task-root-2"]


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
async def test_get_ai_task_timeline_merges_chain_tasks(db_session):
    article = Article(
        title="Timeline Chain Article",
        title_trans="时间线链路文章",
        slug="timeline-chain-article",
        content_md="content",
        content_trans="",
        top_image="",
        author="Tester",
        published_at="2026-04-13T10:00:00",
        source_domain="example.com",
        status="completed",
        is_visible=True,
        created_at="2026-04-13T10:00:00",
        updated_at="2026-04-13T10:00:00",
    )
    db_session.add(article)
    db_session.commit()

    root_task = AITask(
        id="task-root",
        article_id=article.id,
        root_task_id="task-root",
        task_type="process_ai_content",
        content_type="summary",
        status="completed",
        payload="{}",
        attempts=1,
        max_attempts=1,
        run_at="2026-04-13T10:00:00",
        created_at="2026-04-13T10:00:00",
        updated_at="2026-04-13T10:01:00",
        finished_at="2026-04-13T10:01:00",
    )
    continuation_task = AITask(
        id="task-cont-1",
        article_id=article.id,
        parent_task_id="task-root",
        root_task_id="task-root",
        task_type="process_ai_content",
        content_type="summary",
        status="failed",
        payload='{"continuation_feedback":"请更短"}',
        attempts=1,
        max_attempts=1,
        run_at="2026-04-13T10:05:00",
        created_at="2026-04-13T10:05:00",
        updated_at="2026-04-13T10:06:00",
        finished_at="2026-04-13T10:06:00",
    )
    root_event = AITaskEvent(
        task_id="task-root",
        event_type="completed",
        created_at="2026-04-13T10:01:00",
    )
    continuation_event = AITaskEvent(
        task_id="task-cont-1",
        event_type="failed",
        created_at="2026-04-13T10:06:00",
    )
    root_usage = AIUsageLog(
        id="usage-root",
        task_id="task-root",
        article_id=article.id,
        task_type="process_ai_content",
        content_type="summary",
        status="completed",
        created_at="2026-04-13T10:00:30",
    )
    continuation_usage = AIUsageLog(
        id="usage-cont",
        task_id="task-cont-1",
        article_id=article.id,
        task_type="process_ai_content",
        content_type="summary",
        status="completed",
        created_at="2026-04-13T10:05:30",
    )
    db_session.add_all(
        [
            root_task,
            continuation_task,
            root_event,
            continuation_event,
            root_usage,
            continuation_usage,
        ]
    )
    db_session.commit()

    response = await ai_tasks_router.get_ai_task_timeline(
        task_id="task-cont-1",
        db=db_session,
        _=True,
    )

    assert response["task"]["id"] == "task-root"
    assert [item["task_id"] for item in response["events"]] == [
        "task-root",
        "task-cont-1",
    ]
    assert [item["task_id"] for item in response["usage"]] == [
        "task-root",
        "task-cont-1",
    ]


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


@pytest.mark.anyio
async def test_list_ai_tasks_returns_review_issue_target_for_review_generation_task(db_session):
    template = ReviewTemplate(
        id=str(uuid.uuid4()),
        name="周期回顾模板",
        slug="periodic-review",
        description="",
        color="#3B82F6",
        sort_order=0,
        created_at="2026-04-04T10:00:00",
        updated_at="2026-04-04T10:00:00",
    )
    db_session.add(template)
    db_session.flush()

    issue = ReviewIssue(
        template_id=template.id,
        slug="reviews-2026-03-30-v2",
        title="2026-03-30 ~ 2026-04-05 周期回顾（草稿 2）",
        status="draft",
        markdown_content="# 回顾\n\n{{review_article_sections}}",
        created_at="2026-04-04T10:01:00",
        updated_at="2026-04-04T10:01:00",
    )
    db_session.add(issue)
    db_session.flush()

    task = AITask(
        article_id=None,
        task_type="generate_review_issue",
        content_type=None,
        status="completed",
        payload=f'{{"issue_id":"{issue.id}","template_id":"{template.id}"}}',
        attempts=1,
        max_attempts=1,
        run_at="2026-04-04T10:01:00",
        created_at="2026-04-04T10:02:00",
        updated_at="2026-04-04T10:03:00",
        finished_at="2026-04-04T10:04:00",
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

    assert response["data"][0]["article_title"] == issue.title
    assert response["data"][0]["article_slug"] == issue.slug
    assert response["data"][0]["article_kind"] == "review"


@pytest.mark.anyio
async def test_get_ai_task_timeline_returns_review_issue_target_for_review_generation_task(db_session):
    template = ReviewTemplate(
        id=str(uuid.uuid4()),
        name="周期回顾模板",
        slug="periodic-review",
        description="",
        color="#3B82F6",
        sort_order=0,
        created_at="2026-04-04T10:00:00",
        updated_at="2026-04-04T10:00:00",
    )
    db_session.add(template)
    db_session.flush()

    issue = ReviewIssue(
        template_id=template.id,
        slug="reviews-2026-03-30-v3",
        title="2026-03-30 ~ 2026-04-05 周期回顾（草稿 3）",
        status="draft",
        markdown_content="# 回顾\n\n{{review_article_sections}}",
        created_at="2026-04-04T10:01:00",
        updated_at="2026-04-04T10:01:00",
    )
    db_session.add(issue)
    db_session.flush()

    task = AITask(
        article_id=None,
        task_type="generate_review_issue",
        content_type=None,
        status="completed",
        payload=f'{{"issue_id":"{issue.id}","template_id":"{template.id}"}}',
        attempts=1,
        max_attempts=1,
        run_at="2026-04-04T10:01:00",
        created_at="2026-04-04T10:02:00",
        updated_at="2026-04-04T10:03:00",
        finished_at="2026-04-04T10:04:00",
    )
    db_session.add(task)
    db_session.commit()

    response = await ai_tasks_router.get_ai_task_timeline(
        task_id=task.id,
        db=db_session,
        _=True,
    )

    assert response["task"]["article_title"] == issue.title
    assert response["task"]["article_slug"] == issue.slug
    assert response["task"]["article_kind"] == "review"


@pytest.mark.anyio
async def test_get_ai_task_timeline_exposes_session_info_for_usage(db_session):
    article = Article(
        title="Timeline Article",
        title_trans="时间线文章",
        slug="timeline-usage-article",
        content_md="content",
        content_trans="",
        top_image="",
        author="Tester",
        published_at="2026-04-12T10:00:00",
        source_domain="example.com",
        status="completed",
        is_visible=True,
        created_at="2026-04-12T10:00:00",
        updated_at="2026-04-12T10:00:00",
    )
    db_session.add(article)
    db_session.commit()

    task = AITask(
        article_id=article.id,
        task_type="process_ai_content",
        content_type="summary",
        status="completed",
        payload="{}",
        attempts=1,
        max_attempts=1,
        run_at="2026-04-12T10:00:00",
        created_at="2026-04-12T10:00:00",
        updated_at="2026-04-12T10:00:00",
        finished_at="2026-04-12T10:01:00",
    )
    db_session.add(task)
    db_session.flush()

    usage = AIUsageLog(
        task_id=task.id,
        article_id=article.id,
        task_type="process_ai_content",
        content_type="summary",
        status="completed",
        request_payload="{}",
        response_payload='{"content":"时间线输出"}',
        created_at="2026-04-12T10:00:30",
    )
    db_session.add(usage)
    db_session.flush()

    db_session.add(
        AICallSession(
            usage_log_id=usage.id,
            task_id=task.id,
            article_id=article.id,
            task_type="process_ai_content",
            content_type="summary",
            api_type="chat_completions",
            continuation_mode="snapshot",
            input_snapshot='{"user_prompt":"原始提示词"}',
            output_snapshot='{"content":"时间线输出"}',
            created_at="2026-04-12T10:00:30",
            updated_at="2026-04-12T10:00:30",
        )
    )
    db_session.commit()

    response = await ai_tasks_router.get_ai_task_timeline(
        task_id=task.id,
        db=db_session,
        _=True,
    )

    assert response["usage"][0]["session_info"]["api_type"] == "chat_completions"
    assert response["usage"][0]["session_info"]["output_snapshot"]["content"] == "时间线输出"
