import asyncio
import time

from app.core.settings import get_settings, validate_startup_settings
from task_errors import normalize_task_error


def main() -> None:
    settings = get_settings()
    validate_startup_settings(settings)

    from app.domain.ai_task_service import AITaskService
    from models import SessionLocal

    task_service = AITaskService(worker_id=settings.ai_worker_id)
    poll_interval = settings.ai_worker_poll_interval
    task_timeout_seconds = settings.ai_task_timeout

    while True:
        db = SessionLocal()
        try:
            task_service.cleanup_stale_tasks(db)
            task = task_service.claim_task(db)
            if not task:
                time.sleep(poll_interval)
                continue
            try:
                asyncio.run(
                    asyncio.wait_for(
                        task_service.run_task_async(task), timeout=task_timeout_seconds
                    )
                )
                task_service.finish_task(db, task, success=True)
            except Exception as exc:
                task_error = normalize_task_error(exc)
                task_service.finish_task(
                    db,
                    task,
                    success=False,
                    error=task_error.message,
                    error_type=task_error.error_type,
                    retryable=task_error.retryable,
                )
        finally:
            db.close()


if __name__ == "__main__":
    main()
