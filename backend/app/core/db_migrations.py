from __future__ import annotations

import os
from pathlib import Path

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
    command.upgrade(config, "head")
