from __future__ import annotations

import os
from pathlib import Path

from alembic import command
from alembic.config import Config

DEFAULT_DATABASE_URL = "sqlite:///./data/articles.db"


def run_db_migrations(database_url: str | None = None) -> None:
    backend_dir = Path(__file__).resolve().parents[2]
    config = Config(str(backend_dir / "alembic.ini"))
    config.set_main_option(
        "sqlalchemy.url",
        database_url or os.getenv("DATABASE_URL", DEFAULT_DATABASE_URL),
    )
    command.upgrade(config, "head")
