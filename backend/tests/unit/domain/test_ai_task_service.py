import asyncio
import json
from unittest.mock import AsyncMock

import pytest

import app.domain.ai_task_service as ai_task_module
from app.domain.ai_task_service import AITaskService
from models import AITask, AITaskEvent
from task_errors import TaskDataError


class DummyPipeline:
    def __init__(self, current_task_id=None, enqueue_task_func=None):
        self.current_task_id = current_task_id
        self.enqueue_task_func = enqueue_task_func


def test_enqueue_task_deduplicates_by_normalized_payload(db_session):
    service = AITaskService(worker_id="worker-test")
    first_id = service.enqueue_task(
        db_session,
        task_type="process_ai_content",
        article_id="article-1",
        content_type="summary",
        payload={"b": 2, "a": 1},
    )
    second_id = service.enqueue_task(
        db_session,
        task_type="process_ai_content",
        article_id="article-1",
        content_type="summary",
        payload={"a": 1, "b": 2},
    )

    assert first_id == second_id

    task = db_session.query(AITask).one()
    assert task.payload == '{"a":1,"b":2}'

    event = (
        db_session.query(AITaskEvent)
        .filter(AITaskEvent.task_id == first_id, AITaskEvent.event_type == "enqueued")
        .one()
    )
    assert json.loads(event.details) == {
        "task_type": "process_ai_content",
        "content_type": "summary",
    }


def test_claim_task_updates_status_lock_and_attempts(db_session, make_task, monkeypatch):
    service = AITaskService(worker_id="worker-test")
    task = make_task(
        status="pending",
        run_at="2026-01-01T00:00:00+00:00",
        locked_at=None,
        locked_by=None,
        attempts=0,
    )
    monkeypatch.setattr(ai_task_module, "get_now_iso", lambda: "2026-01-02T00:00:00+00:00")
    monkeypatch.setattr(ai_task_module, "get_stale_lock_iso", lambda: "2025-12-31T00:00:00+00:00")

    claimed = service.claim_task(db_session)

    assert claimed is not None
    assert claimed.id == task.id
    db_session.refresh(task)
    assert task.status == "processing"
    assert task.attempts == 1
    assert task.locked_by == "worker-test"
    assert task.locked_at == "2026-01-02T00:00:00+00:00"

    event_count = (
        db_session.query(AITaskEvent)
        .filter(AITaskEvent.task_id == task.id, AITaskEvent.event_type == "claimed")
        .count()
    )
    assert event_count == 1


def test_claim_task_returns_none_when_no_pending_task_ready(db_session, make_task, monkeypatch):
    service = AITaskService(worker_id="worker-test")
    make_task(
        status="pending",
        run_at="2030-01-01T00:00:00+00:00",
    )
    monkeypatch.setattr(ai_task_module, "get_now_iso", lambda: "2026-01-01T00:00:00+00:00")
    monkeypatch.setattr(ai_task_module, "get_stale_lock_iso", lambda: "2025-12-31T00:00:00+00:00")

    claimed = service.claim_task(db_session)

    assert claimed is None


def test_finish_task_marks_completed_and_writes_event(db_session, make_task, monkeypatch):
    service = AITaskService(worker_id="worker-test")
    task = make_task(
        status="processing",
        locked_by="worker-test",
        locked_at="2026-01-01T00:00:00+00:00",
    )
    monkeypatch.setattr(ai_task_module, "get_now_iso", lambda: "2026-01-03T00:00:00+00:00")

    service.finish_task(db_session, task, success=True)

    db_session.refresh(task)
    assert task.status == "completed"
    assert task.finished_at == "2026-01-03T00:00:00+00:00"
    assert task.locked_at is None
    assert task.locked_by is None
    assert task.last_error is None
    assert task.last_error_type is None

    event_count = (
        db_session.query(AITaskEvent)
        .filter(AITaskEvent.task_id == task.id, AITaskEvent.event_type == "completed")
        .count()
    )
    assert event_count == 1


def test_finish_task_marks_failed_and_preserves_error_metadata(db_session, make_task, monkeypatch):
    service = AITaskService(worker_id="worker-test")
    task = make_task(
        status="processing",
        locked_by="worker-test",
        locked_at="2026-01-01T00:00:00+00:00",
    )
    monkeypatch.setattr(ai_task_module, "get_now_iso", lambda: "2026-01-03T00:00:00+00:00")

    service.finish_task(
        db_session,
        task,
        success=False,
        error="network timeout",
        error_type="timeout",
        retryable=False,
    )

    db_session.refresh(task)
    assert task.status == "failed"
    assert task.finished_at == "2026-01-03T00:00:00+00:00"
    assert task.last_error == "network timeout"
    assert task.last_error_type == "timeout"

    event = (
        db_session.query(AITaskEvent)
        .filter(AITaskEvent.task_id == task.id, AITaskEvent.event_type == "failed")
        .one()
    )
    assert event.error_type == "timeout"
    assert event.message == "network timeout"
    assert json.loads(event.details)["retryable"] is False


def test_finish_task_ignores_processing_task_owned_by_other_worker(db_session, make_task):
    service = AITaskService(worker_id="worker-test")
    task = make_task(
        status="processing",
        locked_by="worker-other",
        locked_at="2026-01-01T00:00:00+00:00",
    )

    service.finish_task(db_session, task, success=True)

    db_session.refresh(task)
    assert task.status == "processing"
    assert task.locked_by == "worker-other"
    assert db_session.query(AITaskEvent).filter(AITaskEvent.task_id == task.id).count() == 0


def test_cleanup_stale_tasks_marks_timeout_failures(db_session, make_task, monkeypatch):
    service = AITaskService(worker_id="worker-test")
    task = make_task(
        status="processing",
        locked_by="worker-test",
        locked_at="2026-01-01T00:00:00+00:00",
    )
    monkeypatch.setattr(ai_task_module, "get_now_iso", lambda: "2026-01-04T00:00:00+00:00")
    monkeypatch.setattr(ai_task_module, "get_stale_lock_iso", lambda: "2026-01-02T00:00:00+00:00")

    cleaned = service.cleanup_stale_tasks(db_session)

    assert cleaned == 1
    db_session.refresh(task)
    assert task.status == "failed"
    assert task.locked_at is None
    assert task.locked_by is None
    assert task.last_error_type == "timeout"
    assert task.finished_at == "2026-01-04T00:00:00+00:00"

    event_count = (
        db_session.query(AITaskEvent)
        .filter(AITaskEvent.task_id == task.id, AITaskEvent.event_type == "stale_lock_failed")
        .count()
    )
    assert event_count == 1


def test_require_article_id_raises_when_missing():
    service = AITaskService(worker_id="worker-test")
    with pytest.raises(TaskDataError, match="缺少文章ID"):
        service._require_article_id("")
    assert service._require_article_id("article-1") == "article-1"


def test_run_task_async_rejects_unknown_task_type(monkeypatch):
    service = AITaskService(worker_id="worker-test")
    monkeypatch.setattr(ai_task_module, "ArticleAIPipelineService", DummyPipeline)
    task = AITask(task_type="unknown_task", article_id="article-1", payload="{}")

    with pytest.raises(TaskDataError, match="未知任务类型"):
        asyncio.run(service.run_task_async(task))


def test_run_task_async_rejects_ai_content_without_content_type(monkeypatch):
    service = AITaskService(worker_id="worker-test")
    monkeypatch.setattr(ai_task_module, "ArticleAIPipelineService", DummyPipeline)
    task = AITask(
        task_type="process_ai_content",
        article_id="article-1",
        content_type=None,
        payload="{}",
    )

    with pytest.raises(TaskDataError, match="缺少内容类型"):
        asyncio.run(service.run_task_async(task))


def test_run_task_async_rejects_missing_article_id(monkeypatch):
    service = AITaskService(worker_id="worker-test")
    monkeypatch.setattr(ai_task_module, "ArticleAIPipelineService", DummyPipeline)
    task = AITask(task_type="process_article_embedding", article_id=None, payload="{}")

    with pytest.raises(TaskDataError, match="缺少文章ID"):
        asyncio.run(service.run_task_async(task))


def test_run_task_async_routes_embedding_task_to_handler(monkeypatch):
    service = AITaskService(worker_id="worker-test")
    monkeypatch.setattr(ai_task_module, "ArticleAIPipelineService", DummyPipeline)
    handler = AsyncMock(return_value=None)
    monkeypatch.setattr(service, "_handle_process_article_embedding", handler)
    task = AITask(task_type="process_article_embedding", article_id="article-1", payload="{}")

    asyncio.run(service.run_task_async(task))

    handler.assert_awaited_once_with("article-1")
