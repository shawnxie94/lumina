import json

from models import AITaskEvent, now_str


TASK_STATUS_PENDING = "pending"
TASK_STATUS_PROCESSING = "processing"
TASK_STATUS_COMPLETED = "completed"
TASK_STATUS_FAILED = "failed"
TASK_STATUS_CANCELLED = "cancelled"


ALLOWED_TASK_STATUS_TRANSITIONS = {
    TASK_STATUS_PENDING: {TASK_STATUS_PROCESSING, TASK_STATUS_CANCELLED},
    TASK_STATUS_PROCESSING: {
        TASK_STATUS_PENDING,
        TASK_STATUS_COMPLETED,
        TASK_STATUS_FAILED,
    },
    TASK_STATUS_FAILED: {TASK_STATUS_PENDING},
    TASK_STATUS_CANCELLED: {TASK_STATUS_PENDING},
    TASK_STATUS_COMPLETED: set(),
}


def can_transition_task_status(current_status: str, target_status: str) -> bool:
    if current_status == target_status:
        return False
    allowed = ALLOWED_TASK_STATUS_TRANSITIONS.get(current_status, set())
    return target_status in allowed


def ensure_task_status_transition(current_status: str, target_status: str) -> None:
    if can_transition_task_status(current_status, target_status):
        return
    raise ValueError(f"非法任务状态流转: {current_status} -> {target_status}")


def append_task_event(
    db,
    task_id: str,
    event_type: str,
    from_status: str | None,
    to_status: str | None,
    message: str | None = None,
    error_type: str | None = None,
    details: dict | None = None,
) -> None:
    db.add(
        AITaskEvent(
            task_id=task_id,
            event_type=event_type,
            from_status=from_status,
            to_status=to_status,
            message=message,
            error_type=error_type,
            details=json.dumps(details, ensure_ascii=False) if details else None,
            created_at=now_str(),
        )
    )
