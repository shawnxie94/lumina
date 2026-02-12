from __future__ import annotations

from collections.abc import Callable, Iterator

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from models import AITask, AITaskEvent, Base, now_str


@pytest.fixture()
def db_session(tmp_path) -> Iterator[Session]:
    db_path = tmp_path / "unit-tests.db"
    engine = create_engine(
        f"sqlite:///{db_path}",
        connect_args={"check_same_thread": False},
    )
    testing_session = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    Base.metadata.create_all(bind=engine)
    session = testing_session()
    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(bind=engine)
        engine.dispose()


@pytest.fixture()
def make_task(db_session: Session) -> Callable[..., AITask]:
    def _make_task(**overrides) -> AITask:
        payload = {
            "article_id": None,
            "task_type": "process_ai_content",
            "content_type": "summary",
            "status": "pending",
            "payload": "{}",
            "attempts": 0,
            "max_attempts": 1,
            "run_at": now_str(),
            "updated_at": now_str(),
        }
        payload.update(overrides)
        task = AITask(**payload)
        db_session.add(task)
        db_session.commit()
        db_session.refresh(task)
        return task

    return _make_task


@pytest.fixture()
def make_task_event(
    db_session: Session, make_task: Callable[..., AITask]
) -> Callable[..., AITaskEvent]:
    def _make_task_event(**overrides) -> AITaskEvent:
        task_id = overrides.pop("task_id", None)
        if task_id is None:
            task_id = make_task().id
        payload = {
            "task_id": task_id,
            "event_type": "manual",
            "from_status": None,
            "to_status": None,
            "created_at": now_str(),
        }
        payload.update(overrides)
        event = AITaskEvent(**payload)
        db_session.add(event)
        db_session.commit()
        db_session.refresh(event)
        return event

    return _make_task_event
