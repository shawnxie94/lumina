"""add advanced cleaning option columns

Revision ID: 20260212_0006
Revises: 20260212_0005
Create Date: 2026-02-12 21:25:00

"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "20260212_0006"
down_revision = "20260212_0005"
branch_labels = None
depends_on = None


def _has_column(table_name: str, column_name: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    columns = inspector.get_columns(table_name)
    return any(column.get("name") == column_name for column in columns)


def upgrade() -> None:
    with op.batch_alter_table("model_api_configs") as batch_op:
        if not _has_column("model_api_configs", "context_window_tokens"):
            batch_op.add_column(
                sa.Column("context_window_tokens", sa.Integer(), nullable=True)
            )
        if not _has_column("model_api_configs", "reserve_output_tokens"):
            batch_op.add_column(
                sa.Column("reserve_output_tokens", sa.Integer(), nullable=True)
            )

    with op.batch_alter_table("prompt_configs") as batch_op:
        if not _has_column("prompt_configs", "chunk_size_tokens"):
            batch_op.add_column(
                sa.Column("chunk_size_tokens", sa.Integer(), nullable=True)
            )
        if not _has_column("prompt_configs", "chunk_overlap_tokens"):
            batch_op.add_column(
                sa.Column("chunk_overlap_tokens", sa.Integer(), nullable=True)
            )
        if not _has_column("prompt_configs", "max_continue_rounds"):
            batch_op.add_column(
                sa.Column("max_continue_rounds", sa.Integer(), nullable=True)
            )


def downgrade() -> None:
    with op.batch_alter_table("prompt_configs") as batch_op:
        if _has_column("prompt_configs", "max_continue_rounds"):
            batch_op.drop_column("max_continue_rounds")
        if _has_column("prompt_configs", "chunk_overlap_tokens"):
            batch_op.drop_column("chunk_overlap_tokens")
        if _has_column("prompt_configs", "chunk_size_tokens"):
            batch_op.drop_column("chunk_size_tokens")

    with op.batch_alter_table("model_api_configs") as batch_op:
        if _has_column("model_api_configs", "reserve_output_tokens"):
            batch_op.drop_column("reserve_output_tokens")
        if _has_column("model_api_configs", "context_window_tokens"):
            batch_op.drop_column("context_window_tokens")
