import json

import pytest

from models import AITaskEvent
from task_state import (
    append_task_event,
    can_transition_task_status,
    ensure_task_status_transition,
)


@pytest.mark.parametrize(
    ("current_status", "target_status", "allowed"),
    [
        ("pending", "processing", True),
        ("processing", "completed", True),
        ("failed", "pending", True),
        ("completed", "failed", False),
        ("pending", "completed", False),
        ("pending", "pending", False),
    ],
)
def test_can_transition_task_status(current_status: str, target_status: str, allowed: bool):
    assert can_transition_task_status(current_status, target_status) is allowed


def test_ensure_task_status_transition_raises_for_invalid_transition():
    with pytest.raises(ValueError, match="非法任务状态流转"):
        ensure_task_status_transition("pending", "completed")


def test_append_task_event_persists_event_with_json_details(db_session, make_task):
    task = make_task(task_type="process_ai_content")
    append_task_event(
        db_session,
        task_id=task.id,
        event_type="claimed",
        from_status="pending",
        to_status="processing",
        message="任务已领取",
        error_type=None,
        details={"attempts": 1, "worker_id": "worker-test"},
    )
    db_session.commit()

    event = db_session.query(AITaskEvent).filter(AITaskEvent.task_id == task.id).one()
    assert event.event_type == "claimed"
    assert event.from_status == "pending"
    assert event.to_status == "processing"
    assert event.message == "任务已领取"
    assert json.loads(event.details) == {"attempts": 1, "worker_id": "worker-test"}
