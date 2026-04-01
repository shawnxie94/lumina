from __future__ import annotations

import json
import os
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterator

from app.core.settings import get_settings

BACKUP_RESTORE_LOCK_FILENAME = ".backup_restore.lock"


def _resolve_database_path(database_url: str) -> Path:
    if not database_url.startswith("sqlite:///"):
        raise ValueError("仅支持 SQLite 镜像备份")
    database_path = database_url.removeprefix("sqlite:///")
    path = Path(database_path)
    return path if path.is_absolute() else (Path.cwd() / path).resolve()


def get_restore_lock_path(database_url: str | None = None) -> Path:
    settings = get_settings()
    resolved_database_url = database_url or settings.database_url
    database_path = _resolve_database_path(resolved_database_url)
    return database_path.parent / BACKUP_RESTORE_LOCK_FILENAME


def restore_lock_active(database_url: str | None = None) -> bool:
    return get_restore_lock_path(database_url).exists()


@contextmanager
def acquire_restore_lock(database_url: str | None = None) -> Iterator[Path]:
    lock_path = get_restore_lock_path(database_url)
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(
        {
            "pid": os.getpid(),
            "created_at": datetime.now(timezone.utc).isoformat(),
        },
        ensure_ascii=False,
    )
    try:
        with lock_path.open("x", encoding="utf-8") as lock_file:
            lock_file.write(payload)
    except FileExistsError as exc:
        raise ValueError("导入失败：已有镜像恢复任务正在进行") from exc

    try:
        yield lock_path
    finally:
        try:
            lock_path.unlink()
        except FileNotFoundError:
            pass
