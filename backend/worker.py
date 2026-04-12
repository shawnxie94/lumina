import asyncio
import time
from collections.abc import Callable

from sqlalchemy import inspect

from app.core.backup_lock import restore_lock_active
from app.core.settings import get_settings, validate_startup_settings
from task_errors import normalize_task_error

REQUIRED_TASK_TABLES = (
    "ai_tasks",
    "review_templates",
    "review_template_categories",
    "review_issues",
    "review_issue_articles",
)


def get_database_table_names() -> set[str]:
    from models import engine

    inspector = inspect(engine)
    return set(inspector.get_table_names())


def wait_for_required_tables(
    *,
    get_table_names: Callable[[], set[str]] = get_database_table_names,
    required_tables: tuple[str, ...] = REQUIRED_TASK_TABLES,
    poll_interval: float = 1.0,
    sleep: Callable[[float], None] = time.sleep,
) -> None:
    required = set(required_tables)

    while True:
        try:
            existing_tables = get_table_names()
        except Exception as exc:
            print(f"Worker waiting for database readiness: {exc}")
            sleep(poll_interval)
            continue

        missing_tables = sorted(required - existing_tables)
        if not missing_tables:
            return

        print(
            "Worker waiting for database migrations to finish; "
            f"missing tables: {', '.join(missing_tables)}"
        )
        sleep(poll_interval)


def main() -> None:
    settings = get_settings()
    validate_startup_settings(settings)

    from app.domain.ai_task_service import AITaskService
    from models import SessionLocal

    ai_worker = settings.ai_worker
    task_service = AITaskService(worker_id=ai_worker.worker_id)
    poll_interval = ai_worker.poll_interval
    task_timeout_seconds = ai_worker.task_timeout
    wait_for_required_tables(poll_interval=max(float(poll_interval), 1.0))

    while True:
        if restore_lock_active(settings.database_url):
            time.sleep(poll_interval)
            continue
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
