import asyncio
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
TASK_TIMEOUT_SECONDS = int(os.getenv("AI_TASK_TIMEOUT", "900"))
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


def finish_task(
    db,
    task: AITask,
    success: bool,
    error: str | None = None,
    error_type: str | None = None,
) -> None:
    now_iso = get_now_iso()
    if success:
        task.status = "completed"
        task.finished_at = now_iso
        task.last_error = None
        task.last_error_type = None
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
        task.last_error_type = error_type

    task.locked_at = None
    task.locked_by = None
    task.updated_at = now_iso
    db.commit()


def classify_error(exc: Exception) -> str:
    message = str(exc).lower()
    if (
        isinstance(exc, asyncio.TimeoutError)
        or "timeout" in message
        or "超时" in message
    ):
        return "timeout"
    if "未配置ai服务" in message or "ai服务" in message or "config" in message:
        return "config"
    if "文章不存在" in message or "缺少" in message:
        return "data"
    return "unknown"


async def run_task_async(task: AITask) -> None:
    payload = json.loads(task.payload or "{}")
    article_id = task.article_id
    category_id = payload.get("category_id")
    service = ArticleService()

    if task.task_type == "process_article_ai":
        if not article_id:
            raise ValueError("缺少文章ID")
        await service.process_article_ai(article_id, category_id)
        return

    if task.task_type == "process_article_cleaning":
        if not article_id:
            raise ValueError("缺少文章ID")
        await service.process_article_cleaning(article_id, category_id)
        return

    if task.task_type == "process_article_validation":
        if not article_id:
            raise ValueError("缺少文章ID")
        cleaned_md = payload.get("cleaned_md") or ""
        await service.process_article_validation(article_id, category_id, cleaned_md)
        return

    if task.task_type == "process_article_classification":
        if not article_id:
            raise ValueError("缺少文章ID")
        await service.process_article_classification(article_id, category_id)
        return

    if task.task_type == "process_article_translation":
        if not article_id:
            raise ValueError("缺少文章ID")
        await service.process_article_translation(article_id, category_id)
        return

    if task.task_type == "process_ai_content":
        if not article_id:
            raise ValueError("缺少文章ID")
        content_type = task.content_type or payload.get("content_type")
        if not content_type:
            raise ValueError("缺少内容类型")
        await service.process_ai_content(
            article_id,
            category_id,
            content_type,
            model_config_id=payload.get("model_config_id"),
            prompt_config_id=payload.get("prompt_config_id"),
        )
        return

    raise ValueError(f"未知任务类型: {task.task_type}")


def cleanup_stale_tasks(db) -> int:
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
        task.locked_at = None
        task.locked_by = None
        if task.attempts >= (task.max_attempts or 3):
            task.status = "failed"
            task.finished_at = now_iso
        else:
            task.status = "pending"
            task.run_at = now_iso
        task.last_error = "任务超时或锁过期已重置"
        task.last_error_type = "timeout"
        task.updated_at = now_iso
        cleaned += 1
    if cleaned:
        db.commit()
    return cleaned


def main() -> None:
    while True:
        db = SessionLocal()
        try:
            cleanup_stale_tasks(db)
            task = claim_task(db)
            if not task:
                time.sleep(POLL_INTERVAL)
                continue
            try:
                asyncio.run(
                    asyncio.wait_for(run_task_async(task), timeout=TASK_TIMEOUT_SECONDS)
                )
                finish_task(db, task, success=True)
            except Exception as exc:
                error_type = classify_error(exc)
                finish_task(
                    db, task, success=False, error=str(exc), error_type=error_type
                )
        finally:
            db.close()


if __name__ == "__main__":
    main()
