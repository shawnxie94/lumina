"""drop prompt response_format column

Revision ID: 20260331_0013
Revises: 20260326_0012
Create Date: 2026-03-31 22:30:00
"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "20260331_0013"
down_revision = "20260326_0012"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("prompt_configs") as batch_op:
        batch_op.drop_column("response_format")


def downgrade() -> None:
    with op.batch_alter_table("prompt_configs") as batch_op:
        batch_op.add_column(sa.Column("response_format", sa.String(), nullable=True))
