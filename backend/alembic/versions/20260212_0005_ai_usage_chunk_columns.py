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


def upgrade() -> None:
    with op.batch_alter_table("ai_usage_logs") as batch_op:
        batch_op.add_column(sa.Column("finish_reason", sa.String(), nullable=True))
        batch_op.add_column(sa.Column("truncated", sa.Boolean(), nullable=True))
        batch_op.add_column(sa.Column("chunk_index", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("continue_round", sa.Integer(), nullable=True))
        batch_op.add_column(
            sa.Column("estimated_input_tokens", sa.Integer(), nullable=True)
        )


def downgrade() -> None:
    with op.batch_alter_table("ai_usage_logs") as batch_op:
        batch_op.drop_column("estimated_input_tokens")
        batch_op.drop_column("continue_round")
        batch_op.drop_column("chunk_index")
        batch_op.drop_column("truncated")
        batch_op.drop_column("finish_reason")
