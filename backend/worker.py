import asyncio
import time

from app.domain.ai_task_service import (
    AITaskService,
    POLL_INTERVAL,
    TASK_TIMEOUT_SECONDS,
)
from models import SessionLocal
from task_errors import normalize_task_error


def main() -> None:
    task_service = AITaskService()

    while True:
        db = SessionLocal()
        try:
            task_service.cleanup_stale_tasks(db)
            task = task_service.claim_task(db)
            if not task:
                time.sleep(POLL_INTERVAL)
                continue
            try:
                asyncio.run(
                    asyncio.wait_for(
                        task_service.run_task_async(task), timeout=TASK_TIMEOUT_SECONDS
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
