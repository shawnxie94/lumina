from __future__ import annotations

from contextlib import contextmanager
import os
from pathlib import Path
from typing import Iterator

from alembic import command
from alembic.config import Config

from app.core.settings import get_settings


def resolve_database_url(
    *,
    override_url: str | None = None,
    env_url: str | None = None,
    ini_url: str | None = None,
    settings_url: str | None = None,
) -> str:
    candidates = [
        override_url,
        os.getenv("DATABASE_URL") if env_url is None else env_url,
        ini_url,
        get_settings().database_url if settings_url is None else settings_url,
    ]
    for candidate in candidates:
        normalized = (candidate or "").strip()
        if normalized:
            return normalized
    raise RuntimeError("无法解析数据库连接地址")


def run_db_migrations(database_url: str | None = None) -> None:
    backend_dir = Path(__file__).resolve().parents[2]
    config = Config(str(backend_dir / "alembic.ini"))
    resolved_database_url = resolve_database_url(override_url=database_url)
    config.set_main_option("sqlalchemy.url", resolved_database_url)
    config.attributes["database_url_override"] = resolved_database_url
    with migration_lock(resolved_database_url, base_dir=backend_dir):
        command.upgrade(config, "head")


def sqlite_database_path(database_url: str, *, base_dir: Path) -> Path | None:
    if not database_url.startswith("sqlite:///"):
        return None

    raw_path = database_url.removeprefix("sqlite:///")
    if raw_path in {"", ":memory:"}:
        return None

    database_path = Path(raw_path)
    if not database_path.is_absolute():
        database_path = base_dir / database_path
    return database_path


@contextmanager
def migration_lock(database_url: str, *, base_dir: Path) -> Iterator[None]:
    database_path = sqlite_database_path(database_url, base_dir=base_dir)
    if database_path is None:
        yield
        return

    try:
        import fcntl
    except ImportError:
        yield
        return

    lock_path = database_path.parent / f".{database_path.name}.migration.lock"
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    with lock_path.open("a+") as lock_file:
        fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(lock_file.fileno(), fcntl.LOCK_UN)
