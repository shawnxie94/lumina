"""schema baseline

Revision ID: 20260210_0000
Revises:
Create Date: 2026-02-11 00:10:00

"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa

from models import Base

# revision identifiers, used by Alembic.
revision = "20260210_0000"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    Base.metadata.create_all(bind=bind, checkfirst=True)
    inspector = sa.inspect(bind)
    prompt_config_columns = {
        column["name"] for column in inspector.get_columns("prompt_configs")
    }
    if "response_format" not in prompt_config_columns:
        with op.batch_alter_table("prompt_configs") as batch_op:
            batch_op.add_column(sa.Column("response_format", sa.String(), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    Base.metadata.drop_all(bind=bind, checkfirst=True)
