import json
from datetime import datetime, timedelta, timezone

from sqlalchemy import or_
from sqlalchemy.exc import IntegrityError

from app.core.settings import get_settings
from app.domain.article_ai_pipeline_service import ArticleAIPipelineService
from app.domain.article_embedding_service import ArticleEmbeddingService
from models import AITask, now_str
from task_errors import TaskDataError
from task_state import append_task_event, ensure_task_status_transition

settings = get_settings()
ai_worker = settings.ai_worker
POLL_INTERVAL = ai_worker.poll_interval
LOCK_TIMEOUT_SECONDS = ai_worker.lock_timeout
TASK_TIMEOUT_SECONDS = ai_worker.task_timeout
WORKER_ID = ai_worker.worker_id


def get_now_iso() -> str:
    return now_str()


def get_future_iso(seconds: int) -> str:
    return (datetime.now(timezone.utc) + timedelta(seconds=seconds)).isoformat()


def get_stale_lock_iso() -> str:
    return (datetime.now(timezone.utc) - timedelta(seconds=LOCK_TIMEOUT_SECONDS)).isoformat()


class AITaskService:
    def __init__(self, worker_id: str = WORKER_ID):
        self.worker_id = worker_id
        self.embedding_service = ArticleEmbeddingService()

    def enqueue_task(
        self,
        db,
        task_type: str,
        article_id: str | None = None,
        content_type: str | None = None,
        payload: dict | None = None,
    ) -> str:
        payload_json = json.dumps(
            payload or {}, ensure_ascii=False, sort_keys=True, separators=(",", ":")
        )

        def find_existing_task() -> AITask | None:
            existing_query = db.query(AITask).filter(
                AITask.task_type == task_type,
                AITask.status.in_(["pending", "processing"]),
                AITask.payload == payload_json,
            )

            if article_id is None:
                existing_query = existing_query.filter(AITask.article_id.is_(None))
            else:
                existing_query = existing_query.filter(AITask.article_id == article_id)

            if content_type is None:
                existing_query = existing_query.filter(AITask.content_type.is_(None))
            else:
                existing_query = existing_query.filter(AITask.content_type == content_type)

            return existing_query.order_by(AITask.created_at.desc(), AITask.id.desc()).first()

        existing_task = find_existing_task()
        if existing_task:
            return existing_task.id

        now_iso = get_now_iso()
        task = AITask(
            article_id=article_id,
            task_type=task_type,
            content_type=content_type,
            payload=payload_json,
            status="pending",
            attempts=0,
            run_at=now_iso,
            updated_at=now_iso,
        )
        db.add(task)

        try:
            db.flush()
            append_task_event(
                db,
                task_id=task.id,
                event_type="enqueued",
                from_status=None,
                to_status="pending",
                message="任务已加入队列",
                details={
                    "task_type": task_type,
                    "content_type": content_type,
                },
            )
            db.commit()
        except IntegrityError:
            db.rollback()
            existing_task = find_existing_task()
            if existing_task:
                return existing_task.id
            raise

        db.refresh(task)
        return task.id

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

    def _require_article_id(self, article_id: str | None) -> str:
        if not article_id:
            raise TaskDataError("缺少文章ID")
        return article_id

    async def _handle_process_article_cleaning(self, pipeline, article_id: str, category_id):
        await pipeline.process_article_cleaning(article_id, category_id)

    async def _handle_process_article_validation(
        self,
        pipeline,
        article_id: str,
        category_id,
        payload: dict,
    ):
        cleaned_md = payload.get("cleaned_md")
        await pipeline.process_article_validation(article_id, category_id, cleaned_md)

    async def _handle_process_article_classification(
        self,
        pipeline,
        article_id: str,
        category_id,
    ):
        await pipeline.process_article_classification(article_id, category_id)

    async def _handle_process_article_translation(self, pipeline, article_id: str, category_id):
        await pipeline.process_article_translation(article_id, category_id)

    async def _handle_process_ai_content(
        self,
        pipeline,
        task: AITask,
        article_id: str,
        category_id,
        payload: dict,
    ):
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

    async def _handle_process_article_embedding(self, article_id: str):
        await self.embedding_service.process_article_embedding(article_id)

    async def run_task_async(self, task: AITask) -> None:
        payload = json.loads(task.payload or "{}")
        article_id = task.article_id
        category_id = payload.get("category_id")
        pipeline = ArticleAIPipelineService(
            current_task_id=task.id,
            enqueue_task_func=self.enqueue_task,
        )

        handlers = {
            "process_article_cleaning": lambda: self._handle_process_article_cleaning(
                pipeline,
                self._require_article_id(article_id),
                category_id,
            ),
            "process_article_validation": lambda: self._handle_process_article_validation(
                pipeline,
                self._require_article_id(article_id),
                category_id,
                payload,
            ),
            "process_article_classification": lambda: self._handle_process_article_classification(
                pipeline,
                self._require_article_id(article_id),
                category_id,
            ),
            "process_article_translation": lambda: self._handle_process_article_translation(
                pipeline,
                self._require_article_id(article_id),
                category_id,
            ),
            "process_ai_content": lambda: self._handle_process_ai_content(
                pipeline,
                task,
                self._require_article_id(article_id),
                category_id,
                payload,
            ),
            "process_article_embedding": lambda: self._handle_process_article_embedding(
                self._require_article_id(article_id)
            ),
        }

        handler = handlers.get(task.task_type)
        if handler is None:
            raise TaskDataError(f"未知任务类型: {task.task_type}")

        await handler()

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
