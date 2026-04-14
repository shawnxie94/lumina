"""add ai task chain fields

Revision ID: 20260413_0020
Revises: 20260412_0019
Create Date: 2026-04-13 00:00:00
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "20260413_0020"
down_revision = "20260412_0019"
branch_labels = None
depends_on = None


def _table_exists(inspector: sa.Inspector, table_name: str) -> bool:
    return table_name in set(inspector.get_table_names())


def _column_names(inspector: sa.Inspector, table_name: str) -> set[str]:
    return {column["name"] for column in inspector.get_columns(table_name)}


def _index_names(inspector: sa.Inspector, table_name: str) -> set[str]:
    return {index["name"] for index in inspector.get_indexes(table_name)}


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)

    if not _table_exists(inspector, "ai_tasks"):
        return

    column_names = _column_names(inspector, "ai_tasks")
    index_names = _index_names(inspector, "ai_tasks")

    with op.batch_alter_table("ai_tasks") as batch_op:
        if "parent_task_id" not in column_names:
            batch_op.add_column(sa.Column("parent_task_id", sa.String(), nullable=True))
        if "root_task_id" not in column_names:
            batch_op.add_column(sa.Column("root_task_id", sa.String(), nullable=True))
        if "ix_ai_tasks_root_task_id" not in index_names:
            batch_op.create_index(
                "ix_ai_tasks_root_task_id",
                ["root_task_id"],
                unique=False,
            )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)

    if not _table_exists(inspector, "ai_tasks"):
        return

    column_names = _column_names(inspector, "ai_tasks")
    index_names = _index_names(inspector, "ai_tasks")

    with op.batch_alter_table("ai_tasks") as batch_op:
        if "ix_ai_tasks_root_task_id" in index_names:
            batch_op.drop_index("ix_ai_tasks_root_task_id")
        if "root_task_id" in column_names:
            batch_op.drop_column("root_task_id")
        if "parent_task_id" in column_names:
            batch_op.drop_column("parent_task_id")
