import json
import os
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import or_

from app.domain.article_ai_pipeline_service import ArticleAIPipelineService
from models import AITask, now_str
from task_errors import TaskDataError
from task_state import append_task_event, ensure_task_status_transition

POLL_INTERVAL = float(os.getenv("AI_WORKER_POLL_INTERVAL", "3"))
LOCK_TIMEOUT_SECONDS = int(os.getenv("AI_TASK_LOCK_TIMEOUT", "300"))
TASK_TIMEOUT_SECONDS = int(os.getenv("AI_TASK_TIMEOUT", "900"))
WORKER_ID = os.getenv("AI_WORKER_ID", str(uuid.uuid4()))


def get_now_iso() -> str:
    return now_str()


def get_future_iso(seconds: int) -> str:
    return (datetime.now(timezone.utc) + timedelta(seconds=seconds)).isoformat()


def get_stale_lock_iso() -> str:
    return (datetime.now(timezone.utc) - timedelta(seconds=LOCK_TIMEOUT_SECONDS)).isoformat()


class AITaskService:
    def __init__(self, worker_id: str = WORKER_ID):
        self.worker_id = worker_id

    def claim_task(self, db) -> AITask | None:
        now_iso = get_now_iso()
        stale_lock_iso = get_stale_lock_iso()
        task = (
            db.query(AITask)
            .filter(AITask.status == "pending")
            .filter(AITask.run_at <= now_iso)
            .filter(or_(AITask.locked_at.is_(None), AITask.locked_at < stale_lock_iso))
            .order_by(AITask.run_at.asc(), AITask.created_at.asc())
            .first()
        )
        if not task:
            return None

        ensure_task_status_transition("pending", "processing")

        next_attempts = (task.attempts or 0) + 1
        updated = (
            db.query(AITask)
            .filter(AITask.id == task.id, AITask.status == "pending")
            .filter(or_(AITask.locked_at.is_(None), AITask.locked_at < stale_lock_iso))
            .update(
                {
                    "status": "processing",
                    "attempts": next_attempts,
                    "locked_at": now_iso,
                    "locked_by": self.worker_id,
                    "updated_at": now_iso,
                },
                synchronize_session=False,
            )
        )
        if not updated:
            db.commit()
            return None

        append_task_event(
            db,
            task_id=task.id,
            event_type="claimed",
            from_status="pending",
            to_status="processing",
            message="任务已被 worker 领取",
            details={
                "worker_id": self.worker_id,
                "attempts": next_attempts,
            },
        )
        db.commit()
        return db.query(AITask).filter(AITask.id == task.id).first()

    def finish_task(
        self,
        db,
        task: AITask,
        success: bool,
        error: str | None = None,
        error_type: str | None = None,
        retryable: bool = True,
    ) -> None:
        now_iso = get_now_iso()
        updates: dict[str, str | None] = {
            "updated_at": now_iso,
            "locked_at": None,
            "locked_by": None,
        }

        event_type = "completed"
        target_status = "completed"

        if success:
            updates.update(
                {
                    "status": "completed",
                    "finished_at": now_iso,
                    "last_error": None,
                    "last_error_type": None,
                }
            )
        else:
            max_attempts = task.max_attempts or 3
            if (not retryable) or task.attempts >= max_attempts:
                target_status = "failed"
                event_type = "failed"
                updates.update(
                    {
                        "status": "failed",
                        "finished_at": now_iso,
                    }
                )
            else:
                target_status = "pending"
                event_type = "retry_scheduled"
                backoff_seconds = min(60 * task.attempts, 300)
                updates.update(
                    {
                        "status": "pending",
                        "run_at": get_future_iso(backoff_seconds),
                    }
                )
            updates["last_error"] = error
            updates["last_error_type"] = error_type

        ensure_task_status_transition("processing", target_status)

        affected = (
            db.query(AITask)
            .filter(AITask.id == task.id)
            .filter(AITask.status == "processing")
            .filter(AITask.locked_by == self.worker_id)
            .update(updates, synchronize_session=False)
        )

        if affected:
            append_task_event(
                db,
                task_id=task.id,
                event_type=event_type,
                from_status="processing",
                to_status=target_status,
                message=error,
                error_type=error_type,
                details={
                    "worker_id": self.worker_id,
                    "attempts": task.attempts,
                    "max_attempts": task.max_attempts,
                    "retryable": retryable,
                    "run_at": updates.get("run_at"),
                },
            )
        db.commit()

    async def run_task_async(self, task: AITask) -> None:
        payload = json.loads(task.payload or "{}")
        article_id = task.article_id
        category_id = payload.get("category_id")
        pipeline = ArticleAIPipelineService(current_task_id=task.id)

        if task.task_type == "process_article_ai":
            if not article_id:
                raise TaskDataError("缺少文章ID")
            await pipeline.process_article_ai(article_id, category_id)
            return

        if task.task_type == "process_article_cleaning":
            if not article_id:
                raise TaskDataError("缺少文章ID")
            await pipeline.process_article_cleaning(article_id, category_id)
            return

        if task.task_type == "process_article_validation":
            if not article_id:
                raise TaskDataError("缺少文章ID")
            cleaned_md = payload.get("cleaned_md")
            await pipeline.process_article_validation(article_id, category_id, cleaned_md)
            return

        if task.task_type == "process_article_classification":
            if not article_id:
                raise TaskDataError("缺少文章ID")
            await pipeline.process_article_classification(article_id, category_id)
            return

        if task.task_type == "process_article_translation":
            if not article_id:
                raise TaskDataError("缺少文章ID")
            await pipeline.process_article_translation(article_id, category_id)
            return

        if task.task_type == "process_ai_content":
            if not article_id:
                raise TaskDataError("缺少文章ID")
            content_type = task.content_type or payload.get("content_type")
            if not content_type:
                raise TaskDataError("缺少内容类型")
            await pipeline.process_ai_content(
                article_id,
                category_id,
                content_type,
                model_config_id=payload.get("model_config_id"),
                prompt_config_id=payload.get("prompt_config_id"),
            )
            return

        if task.task_type == "process_article_embedding":
            if not article_id:
                raise TaskDataError("缺少文章ID")
            await pipeline.facade.process_article_embedding(article_id)
            return

        raise TaskDataError(f"未知任务类型: {task.task_type}")

    def cleanup_stale_tasks(self, db) -> int:
        now_iso = get_now_iso()
        stale_lock_iso = get_stale_lock_iso()
        stale_tasks = (
            db.query(AITask)
            .filter(AITask.status == "processing")
            .filter(AITask.locked_at.isnot(None))
            .filter(AITask.locked_at < stale_lock_iso)
            .all()
        )
        cleaned = 0
        for task in stale_tasks:
            from_status = task.status
            task.locked_at = None
            task.locked_by = None
            if task.attempts >= (task.max_attempts or 3):
                target_status = "failed"
                ensure_task_status_transition(from_status, target_status)
                task.status = target_status
                task.finished_at = now_iso
                event_type = "stale_lock_failed"
            else:
                target_status = "pending"
                ensure_task_status_transition(from_status, target_status)
                task.status = target_status
                task.run_at = now_iso
                event_type = "stale_lock_requeued"
            task.last_error = "任务超时或锁过期已重置"
            task.last_error_type = "timeout"
            task.updated_at = now_iso
            append_task_event(
                db,
                task_id=task.id,
                event_type=event_type,
                from_status=from_status,
                to_status=target_status,
                message="任务超时或锁过期已重置",
                error_type="timeout",
                details={"worker_id": self.worker_id},
            )
            cleaned += 1
        if cleaned:
            db.commit()
        return cleaned
