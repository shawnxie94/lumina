from __future__ import annotations

import os
from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect

from app.core.settings import get_settings


AI_ANALYSIS_VERSION_POINTER_COLUMNS = (
    "current_summary_version_id",
    "current_key_points_version_id",
    "current_outline_version_id",
    "current_quotes_version_id",
    "current_infographic_version_id",
)


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
    ensure_ai_analysis_versioning_schema(resolved_database_url)


def ensure_ai_analysis_versioning_schema(database_url: str) -> None:
    connect_args = {"check_same_thread": False} if database_url.startswith("sqlite") else {}
    engine = create_engine(database_url, connect_args=connect_args)

    try:
        with engine.begin() as connection:
            inspector = inspect(connection)
            table_names = set(inspector.get_table_names())
            if "ai_analyses" not in table_names:
                return

            existing_columns = {
                column["name"] for column in inspector.get_columns("ai_analyses")
            }
            for column_name in AI_ANALYSIS_VERSION_POINTER_COLUMNS:
                if column_name not in existing_columns:
                    connection.exec_driver_sql(
                        f"ALTER TABLE ai_analyses ADD COLUMN {column_name} VARCHAR"
                    )

            if "articles" not in table_names:
                return

            if "ai_analysis_versions" not in table_names:
                connection.exec_driver_sql(
                    """
                    CREATE TABLE ai_analysis_versions (
                        id VARCHAR NOT NULL PRIMARY KEY,
                        article_id VARCHAR NOT NULL,
                        content_type VARCHAR NOT NULL,
                        version_number INTEGER NOT NULL,
                        status VARCHAR NOT NULL,
                        content_text TEXT,
                        content_html TEXT,
                        content_image_url VARCHAR,
                        source_task_id VARCHAR,
                        source_model_config_id VARCHAR,
                        source_prompt_config_id VARCHAR,
                        created_by_mode VARCHAR NOT NULL,
                        rollback_from_version_id VARCHAR,
                        created_at VARCHAR,
                        CONSTRAINT uq_ai_analysis_versions_article_content_version
                            UNIQUE (article_id, content_type, version_number),
                        FOREIGN KEY(article_id) REFERENCES articles (id) ON DELETE CASCADE,
                        FOREIGN KEY(rollback_from_version_id)
                            REFERENCES ai_analysis_versions (id) ON DELETE SET NULL
                    )
                    """
                )

            connection.exec_driver_sql(
                """
                CREATE INDEX IF NOT EXISTS ix_ai_analysis_versions_article_id
                ON ai_analysis_versions (article_id)
                """
            )
            connection.exec_driver_sql(
                """
                CREATE INDEX IF NOT EXISTS ix_ai_analysis_versions_content_type
                ON ai_analysis_versions (content_type)
                """
            )
    finally:
        engine.dispose()
