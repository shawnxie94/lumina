"""add automatic outline and quotes post-processing settings

Revision ID: 20260413_0023
Revises: 20260413_0022
Create Date: 2026-04-13 13:00:00
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "20260413_0023"
down_revision = "20260413_0022"
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
    with op.batch_alter_table("admin_settings") as batch_op:
        if "auto_ai_outline_enabled" not in columns:
            batch_op.add_column(
                sa.Column("auto_ai_outline_enabled", sa.Boolean(), nullable=True)
            )
        if "auto_ai_quotes_enabled" not in columns:
            batch_op.add_column(
                sa.Column("auto_ai_quotes_enabled", sa.Boolean(), nullable=True)
            )

    op.execute(
        "UPDATE admin_settings SET auto_ai_outline_enabled = 0 "
        "WHERE auto_ai_outline_enabled IS NULL"
    )
    op.execute(
        "UPDATE admin_settings SET auto_ai_quotes_enabled = 0 "
        "WHERE auto_ai_quotes_enabled IS NULL"
    )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    if "admin_settings" not in set(inspector.get_table_names()):
        return

    columns = _column_names(inspector, "admin_settings")
    with op.batch_alter_table("admin_settings") as batch_op:
        if "auto_ai_quotes_enabled" in columns:
            batch_op.drop_column("auto_ai_quotes_enabled")
        if "auto_ai_outline_enabled" in columns:
            batch_op.drop_column("auto_ai_outline_enabled")
