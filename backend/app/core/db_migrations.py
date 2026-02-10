from __future__ import annotations

from pathlib import Path

from alembic import command
from alembic.config import Config

from app.core.settings import get_settings


def run_db_migrations(database_url: str | None = None) -> None:
    backend_dir = Path(__file__).resolve().parents[2]
    config = Config(str(backend_dir / "alembic.ini"))
    config.set_main_option(
        "sqlalchemy.url",
        database_url or get_settings().database_url,
    )
    command.upgrade(config, "head")
