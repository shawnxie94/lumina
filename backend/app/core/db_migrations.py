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


def run_db_migrations(
    database_url: str | None = None,
    *,
    stamp_revision: str | None = None,
) -> None:
    backend_dir = Path(__file__).resolve().parents[2]
    config = Config(str(backend_dir / "alembic.ini"))
    resolved_database_url = resolve_database_url(override_url=database_url)
    config.set_main_option("sqlalchemy.url", resolved_database_url)
    config.attributes["database_url_override"] = resolved_database_url
    if stamp_revision is None:
        unknown_revision = find_unknown_alembic_revision(
            resolved_database_url, base_dir=backend_dir
        )
        if unknown_revision is not None:
            raise RuntimeError(
                f"数据库 alembic_version 指向当前迁移链中不存在的版本 '{unknown_revision}'，"
                "通常是历史迁移文件被重写或删除所致（本次启动已被阻止，避免对库结构做错误推演）。"
                "请先核对库内实际 schema 与哪个已知版本匹配，再执行类似："
                "uv run python scripts/migrate_db.py --stamp <已知版本号> ，"
                "脚本会将版本对齐到该基线并继续升级到 head。"
            )
    with migration_lock(resolved_database_url, base_dir=backend_dir):
        if stamp_revision is not None:
            # 悬空版本会让 stamp 的版本解析直接失败，先 purge 清掉版本行再写入基线。
            purge = (
                find_unknown_alembic_revision(
                    resolved_database_url, base_dir=backend_dir
                )
                is not None
            )
            command.stamp(config, stamp_revision, purge=purge)
        command.upgrade(config, "head")


def find_unknown_alembic_revision(database_url: str, *, base_dir: Path) -> str | None:
    """返回 alembic_version 里当前迁移链无法识别的版本号。

    alembic_version 表不存在、没有行、或全部版本都在链上时返回 None。
    """
    from alembic.script import ScriptDirectory
    from sqlalchemy import create_engine, inspect, text

    script_config = Config(str(base_dir / "alembic.ini"))
    known_revisions = {
        revision.revision
        for revision in ScriptDirectory.from_config(script_config).walk_revisions()
    }

    engine_url = database_url
    database_path = sqlite_database_path(database_url, base_dir=base_dir)
    if database_path is not None:
        engine_url = f"sqlite:///{database_path}"

    engine = create_engine(engine_url)
    try:
        inspector = inspect(engine)
        if not inspector.has_table("alembic_version"):
            return None
        with engine.connect() as connection:
            rows = connection.execute(
                text("SELECT version_num FROM alembic_version")
            ).fetchall()
    finally:
        engine.dispose()

    for (stored_revision,) in rows:
        if stored_revision and stored_revision not in known_revisions:
            return stored_revision
    return None


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
