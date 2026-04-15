"""add ai continuation and task chain support

Revision ID: 20260412_0019
Revises: 20260410_0018
Create Date: 2026-04-12 22:30:00
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "20260412_0019"
down_revision = "20260410_0018"
branch_labels = None
depends_on = None


def _column_names(inspector: sa.Inspector, table_name: str) -> set[str]:
    return {column["name"] for column in inspector.get_columns(table_name)}


def _table_exists(inspector: sa.Inspector, table_name: str) -> bool:
    return table_name in set(inspector.get_table_names())


def _index_names(inspector: sa.Inspector, table_name: str) -> set[str]:
    return {index["name"] for index in inspector.get_indexes(table_name)}


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)

    if _table_exists(inspector, "model_api_configs") and "api_type" not in _column_names(
        inspector, "model_api_configs"
    ):
        with op.batch_alter_table("model_api_configs") as batch_op:
            batch_op.add_column(sa.Column("api_type", sa.String(), nullable=True))

        op.execute(
            "UPDATE model_api_configs SET api_type = 'chat_completions' WHERE api_type IS NULL"
        )

        with op.batch_alter_table("model_api_configs") as batch_op:
            batch_op.alter_column(
                "api_type",
                existing_type=sa.String(),
                nullable=False,
                server_default="chat_completions",
            )

        inspector = inspect(bind)

    if _table_exists(inspector, "ai_tasks"):
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

        op.execute("UPDATE ai_tasks SET root_task_id = id WHERE root_task_id IS NULL")
        inspector = inspect(bind)

    if not _table_exists(inspector, "ai_call_sessions"):
        op.create_table(
            "ai_call_sessions",
            sa.Column("id", sa.String(), primary_key=True),
            sa.Column(
                "usage_log_id",
                sa.String(),
                sa.ForeignKey("ai_usage_logs.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("task_id", sa.String(), nullable=True),
            sa.Column(
                "article_id",
                sa.String(),
                sa.ForeignKey("articles.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column("task_type", sa.String(), nullable=True),
            sa.Column("content_type", sa.String(), nullable=True),
            sa.Column("api_type", sa.String(), nullable=False),
            sa.Column("continuation_mode", sa.String(), nullable=False),
            sa.Column("provider_response_id", sa.String(), nullable=True),
            sa.Column("provider_request_id", sa.String(), nullable=True),
            sa.Column("provider_conversation_id", sa.String(), nullable=True),
            sa.Column("input_snapshot", sa.Text(), nullable=True),
            sa.Column("output_snapshot", sa.Text(), nullable=True),
            sa.Column(
                "source_usage_log_id",
                sa.String(),
                sa.ForeignKey("ai_usage_logs.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column("created_at", sa.String(), nullable=False),
            sa.Column("updated_at", sa.String(), nullable=False),
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)

    if _table_exists(inspector, "ai_call_sessions"):
        op.drop_table("ai_call_sessions")

    if _table_exists(inspector, "ai_tasks"):
        column_names = _column_names(inspector, "ai_tasks")
        index_names = _index_names(inspector, "ai_tasks")
        with op.batch_alter_table("ai_tasks") as batch_op:
            if "ix_ai_tasks_root_task_id" in index_names:
                batch_op.drop_index("ix_ai_tasks_root_task_id")
            if "root_task_id" in column_names:
                batch_op.drop_column("root_task_id")
            if "parent_task_id" in column_names:
                batch_op.drop_column("parent_task_id")

    if _table_exists(inspector, "model_api_configs") and "api_type" in _column_names(
        inspector, "model_api_configs"
    ):
        with op.batch_alter_table("model_api_configs") as batch_op:
            batch_op.drop_column("api_type")
