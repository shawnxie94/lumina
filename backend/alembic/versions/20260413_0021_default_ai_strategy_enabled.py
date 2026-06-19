"""enable default ai strategy toggles

Revision ID: 20260413_0021
Revises: 20260413_0020
Create Date: 2026-04-13 11:00:00
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "20260413_0021"
down_revision = "20260413_0020"
branch_labels = None
depends_on = None


def _column_names(inspector: sa.Inspector, table_name: str) -> set[str]:
    return {column["name"] for column in inspector.get_columns(table_name)}


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    if "admin_settings" not in set(inspector.get_table_names()):
        return

    columns = _column_names(inspector, "admin_settings")
    for column_name in (
        "auto_ai_classification_enabled",
        "auto_ai_summary_enabled",
        "auto_ai_tagging_enabled",
        "auto_translation_enabled",
    ):
        if column_name in columns:
            op.execute(f"UPDATE admin_settings SET {column_name} = 1")

    if "auto_ai_cleaning_enabled" in columns:
        op.execute("UPDATE admin_settings SET auto_ai_cleaning_enabled = 0")


def downgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    if "admin_settings" not in set(inspector.get_table_names()):
        return

    columns = _column_names(inspector, "admin_settings")
    for column_name in (
        "auto_ai_classification_enabled",
        "auto_ai_summary_enabled",
        "auto_ai_tagging_enabled",
        "auto_translation_enabled",
    ):
        if column_name in columns:
            op.execute(f"UPDATE admin_settings SET {column_name} = 0")
