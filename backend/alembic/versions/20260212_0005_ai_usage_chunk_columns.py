"""add ai usage chunk/continuation columns

Revision ID: 20260212_0005
Revises: 20260212_0004
Create Date: 2026-02-12 20:50:00

"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "20260212_0005"
down_revision = "20260212_0004"
branch_labels = None
depends_on = None


def _has_column(table_name: str, column_name: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    columns = inspector.get_columns(table_name)
    return any(column.get("name") == column_name for column in columns)


def upgrade() -> None:
    with op.batch_alter_table("ai_usage_logs") as batch_op:
        if not _has_column("ai_usage_logs", "finish_reason"):
            batch_op.add_column(sa.Column("finish_reason", sa.String(), nullable=True))
        if not _has_column("ai_usage_logs", "truncated"):
            batch_op.add_column(sa.Column("truncated", sa.Boolean(), nullable=True))
        if not _has_column("ai_usage_logs", "chunk_index"):
            batch_op.add_column(sa.Column("chunk_index", sa.Integer(), nullable=True))
        if not _has_column("ai_usage_logs", "continue_round"):
            batch_op.add_column(sa.Column("continue_round", sa.Integer(), nullable=True))
        if not _has_column("ai_usage_logs", "estimated_input_tokens"):
            batch_op.add_column(
                sa.Column("estimated_input_tokens", sa.Integer(), nullable=True)
            )


def downgrade() -> None:
    with op.batch_alter_table("ai_usage_logs") as batch_op:
        if _has_column("ai_usage_logs", "estimated_input_tokens"):
            batch_op.drop_column("estimated_input_tokens")
        if _has_column("ai_usage_logs", "continue_round"):
            batch_op.drop_column("continue_round")
        if _has_column("ai_usage_logs", "chunk_index"):
            batch_op.drop_column("chunk_index")
        if _has_column("ai_usage_logs", "truncated"):
            batch_op.drop_column("truncated")
        if _has_column("ai_usage_logs", "finish_reason"):
            batch_op.drop_column("finish_reason")
