"""merge jina enabled switch into prefer mode

Revision ID: 20260413_0022
Revises: 20260413_0021
Create Date: 2026-04-13 11:30:00
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "20260413_0022"
down_revision = "20260413_0021"
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
    if not {"jina_reader_enabled", "jina_reader_prefer_mode"}.issubset(columns):
        return

    op.execute(
        "UPDATE admin_settings SET jina_reader_prefer_mode = 'local_only' "
        "WHERE jina_reader_enabled = 0 OR jina_reader_enabled IS NULL"
    )
    op.execute(
        "UPDATE admin_settings SET jina_reader_enabled = "
        "CASE WHEN jina_reader_prefer_mode = 'local_only' THEN 0 ELSE 1 END"
    )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    if "admin_settings" not in set(inspector.get_table_names()):
        return

    columns = _column_names(inspector, "admin_settings")
    if "jina_reader_enabled" not in columns:
        return

    op.execute("UPDATE admin_settings SET jina_reader_enabled = 0")
