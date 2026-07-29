"""add topics last sync result json

Revision ID: 20260729_0030
Revises: 20260729_0029
Create Date: 2026-07-29
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260729_0030"
down_revision = "20260729_0029"
branch_labels = None
depends_on = None


def _column_names(inspector, table: str) -> set[str]:
    try:
        return {col["name"] for col in inspector.get_columns(table)}
    except Exception:
        return set()


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "admin_settings" not in inspector.get_table_names():
        return
    cols = _column_names(inspector, "admin_settings")
    if "topics_last_sync_result_json" not in cols:
        op.add_column(
            "admin_settings",
            sa.Column("topics_last_sync_result_json", sa.Text(), nullable=True),
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "admin_settings" not in inspector.get_table_names():
        return
    cols = _column_names(inspector, "admin_settings")
    if "topics_last_sync_result_json" in cols:
        op.drop_column("admin_settings", "topics_last_sync_result_json")
