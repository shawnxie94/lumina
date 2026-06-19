"""add extraction settings and article extraction metadata

Revision ID: 20260413_0020
Revises: 20260412_0019
Create Date: 2026-04-13 10:00:00
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "20260413_0020"
down_revision = "20260412_0019"
branch_labels = None
depends_on = None


def _column_names(inspector: sa.Inspector, table_name: str) -> set[str]:
    return {column["name"] for column in inspector.get_columns(table_name)}


def _table_exists(inspector: sa.Inspector, table_name: str) -> bool:
    return table_name in set(inspector.get_table_names())


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)

    if _table_exists(inspector, "articles"):
        article_columns = _column_names(inspector, "articles")
        with op.batch_alter_table("articles") as batch_op:
            if "extraction_provider" not in article_columns:
                batch_op.add_column(sa.Column("extraction_provider", sa.String(), nullable=True))
            if "extraction_status" not in article_columns:
                batch_op.add_column(sa.Column("extraction_status", sa.String(), nullable=True))
            if "extraction_error" not in article_columns:
                batch_op.add_column(sa.Column("extraction_error", sa.Text(), nullable=True))
            if "extraction_metadata" not in article_columns:
                batch_op.add_column(sa.Column("extraction_metadata", sa.Text(), nullable=True))

        op.execute(
            "UPDATE articles SET extraction_provider = 'legacy' "
            "WHERE extraction_provider IS NULL"
        )
        op.execute(
            "UPDATE articles SET extraction_status = 'completed' "
            "WHERE extraction_status IS NULL"
        )
        inspector = inspect(bind)

    if _table_exists(inspector, "admin_settings"):
        admin_columns = _column_names(inspector, "admin_settings")
        with op.batch_alter_table("admin_settings") as batch_op:
            if "jina_reader_enabled" not in admin_columns:
                batch_op.add_column(
                    sa.Column("jina_reader_enabled", sa.Boolean(), nullable=True)
                )
            if "jina_reader_base_url" not in admin_columns:
                batch_op.add_column(
                    sa.Column("jina_reader_base_url", sa.String(), nullable=True)
                )
            if "jina_reader_api_key" not in admin_columns:
                batch_op.add_column(
                    sa.Column("jina_reader_api_key", sa.String(), nullable=True)
                )
            if "jina_reader_timeout_seconds" not in admin_columns:
                batch_op.add_column(
                    sa.Column("jina_reader_timeout_seconds", sa.Integer(), nullable=True)
                )
            if "jina_reader_token_budget" not in admin_columns:
                batch_op.add_column(
                    sa.Column("jina_reader_token_budget", sa.Integer(), nullable=True)
                )
            if "jina_reader_prefer_mode" not in admin_columns:
                batch_op.add_column(
                    sa.Column("jina_reader_prefer_mode", sa.String(), nullable=True)
                )
            if "auto_ai_cleaning_enabled" not in admin_columns:
                batch_op.add_column(
                    sa.Column("auto_ai_cleaning_enabled", sa.Boolean(), nullable=True)
                )
            if "auto_ai_classification_enabled" not in admin_columns:
                batch_op.add_column(
                    sa.Column("auto_ai_classification_enabled", sa.Boolean(), nullable=True)
                )
            if "auto_ai_summary_enabled" not in admin_columns:
                batch_op.add_column(
                    sa.Column("auto_ai_summary_enabled", sa.Boolean(), nullable=True)
                )
            if "auto_ai_tagging_enabled" not in admin_columns:
                batch_op.add_column(
                    sa.Column("auto_ai_tagging_enabled", sa.Boolean(), nullable=True)
                )
            if "auto_translation_enabled" not in admin_columns:
                batch_op.add_column(
                    sa.Column("auto_translation_enabled", sa.Boolean(), nullable=True)
                )

        op.execute(
            "UPDATE admin_settings SET jina_reader_enabled = 0 "
            "WHERE jina_reader_enabled IS NULL"
        )
        op.execute(
            "UPDATE admin_settings SET jina_reader_base_url = 'https://r.jina.ai' "
            "WHERE jina_reader_base_url IS NULL OR jina_reader_base_url = ''"
        )
        op.execute(
            "UPDATE admin_settings SET jina_reader_timeout_seconds = 15 "
            "WHERE jina_reader_timeout_seconds IS NULL"
        )
        op.execute(
            "UPDATE admin_settings SET jina_reader_prefer_mode = 'jina_first' "
            "WHERE jina_reader_prefer_mode IS NULL OR jina_reader_prefer_mode = ''"
        )
        op.execute(
            "UPDATE admin_settings SET auto_ai_cleaning_enabled = 0 "
            "WHERE auto_ai_cleaning_enabled IS NULL"
        )
        op.execute(
            "UPDATE admin_settings SET auto_ai_classification_enabled = 1 "
            "WHERE auto_ai_classification_enabled IS NULL"
        )
        op.execute(
            "UPDATE admin_settings SET auto_ai_summary_enabled = 1 "
            "WHERE auto_ai_summary_enabled IS NULL"
        )
        op.execute(
            "UPDATE admin_settings SET auto_ai_tagging_enabled = 1 "
            "WHERE auto_ai_tagging_enabled IS NULL"
        )
        op.execute(
            "UPDATE admin_settings SET auto_translation_enabled = 1 "
            "WHERE auto_translation_enabled IS NULL"
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)

    if _table_exists(inspector, "admin_settings"):
        admin_columns = _column_names(inspector, "admin_settings")
        with op.batch_alter_table("admin_settings") as batch_op:
            for column_name in (
                "auto_translation_enabled",
                "auto_ai_tagging_enabled",
                "auto_ai_summary_enabled",
                "auto_ai_classification_enabled",
                "auto_ai_cleaning_enabled",
                "jina_reader_prefer_mode",
                "jina_reader_token_budget",
                "jina_reader_timeout_seconds",
                "jina_reader_api_key",
                "jina_reader_base_url",
                "jina_reader_enabled",
            ):
                if column_name in admin_columns:
                    batch_op.drop_column(column_name)

    if _table_exists(inspector, "articles"):
        article_columns = _column_names(inspector, "articles")
        with op.batch_alter_table("articles") as batch_op:
            for column_name in (
                "extraction_metadata",
                "extraction_error",
                "extraction_status",
                "extraction_provider",
            ):
                if column_name in article_columns:
                    batch_op.drop_column(column_name)
