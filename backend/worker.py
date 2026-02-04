import asyncio
import json
import os
import time
import uuid
from datetime import datetime, timedelta

from sqlalchemy import or_

from article_service import ArticleService
from models import AITask, SessionLocal, now_str


POLL_INTERVAL = float(os.getenv("AI_WORKER_POLL_INTERVAL", "3"))
LOCK_TIMEOUT_SECONDS = int(os.getenv("AI_TASK_LOCK_TIMEOUT", "300"))
WORKER_ID = os.getenv("AI_WORKER_ID", str(uuid.uuid4()))


def get_now_iso() -> str:
    return now_str()


def get_stale_lock_iso() -> str:
    return (datetime.now() - timedelta(seconds=LOCK_TIMEOUT_SECONDS)).isoformat()


def claim_task(db) -> AITask | None:
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
                "locked_by": WORKER_ID,
                "updated_at": now_iso,
            },
            synchronize_session=False,
        )
    )
    if not updated:
        db.commit()
        return None

    db.commit()
    return db.query(AITask).filter(AITask.id == task.id).first()


def finish_task(db, task: AITask, success: bool, error: str | None = None) -> None:
    now_iso = get_now_iso()
    if success:
        task.status = "completed"
        task.finished_at = now_iso
        task.last_error = None
    else:
        if task.attempts >= (task.max_attempts or 3):
            task.status = "failed"
            task.finished_at = now_iso
        else:
            backoff_seconds = min(60 * task.attempts, 300)
            task.status = "pending"
            task.run_at = (
                datetime.now() + timedelta(seconds=backoff_seconds)
            ).isoformat()
        task.last_error = error

    task.locked_at = None
    task.locked_by = None
    task.updated_at = now_iso
    db.commit()


def run_task(task: AITask) -> None:
    payload = json.loads(task.payload or "{}")
    article_id = task.article_id
    category_id = payload.get("category_id")
    service = ArticleService()

    if task.task_type == "process_article_ai":
        if not article_id:
            raise ValueError("缺少文章ID")
        asyncio.run(service.process_article_ai(article_id, category_id))
        return

    if task.task_type == "process_article_translation":
        if not article_id:
            raise ValueError("缺少文章ID")
        asyncio.run(service.process_article_translation(article_id, category_id))
        return

    if task.task_type == "process_ai_content":
        if not article_id:
            raise ValueError("缺少文章ID")
        content_type = task.content_type or payload.get("content_type")
        if not content_type:
            raise ValueError("缺少内容类型")
        asyncio.run(
            service.process_ai_content(
                article_id,
                category_id,
                content_type,
                model_config_id=payload.get("model_config_id"),
                prompt_config_id=payload.get("prompt_config_id"),
            )
        )
        return

    raise ValueError(f"未知任务类型: {task.task_type}")


def main() -> None:
    while True:
        db = SessionLocal()
        try:
            task = claim_task(db)
            if not task:
                time.sleep(POLL_INTERVAL)
                continue
            try:
                run_task(task)
                finish_task(db, task, success=True)
            except Exception as exc:
                finish_task(db, task, success=False, error=str(exc))
        finally:
            db.close()


if __name__ == "__main__":
    main()
