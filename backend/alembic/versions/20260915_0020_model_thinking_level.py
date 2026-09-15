"""add model thinking level

Revision ID: 20260915_0032
Revises: 20260813_0031
"""
from alembic import op
import sqlalchemy as sa

revision = "20260915_0032"
down_revision = "20260813_0031"
branch_labels = None
depends_on = None


def upgrade():
    inspector = sa.inspect(op.get_bind())
    if "model_api_configs" not in inspector.get_table_names():
        return
    if "thinking_level" not in {c["name"] for c in inspector.get_columns("model_api_configs")}:
        op.add_column(
            "model_api_configs",
            sa.Column("thinking_level", sa.String(), nullable=True, server_default="disabled"),
        )


def downgrade():
    inspector = sa.inspect(op.get_bind())
    if "model_api_configs" in inspector.get_table_names() and "thinking_level" in {
        c["name"] for c in inspector.get_columns("model_api_configs")
    }:
        op.drop_column("model_api_configs", "thinking_level")
