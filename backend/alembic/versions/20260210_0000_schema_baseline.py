"""schema baseline

Revision ID: 20260210_0000
Revises:
Create Date: 2026-02-11 00:10:00

"""

from __future__ import annotations

from alembic import op

from models import Base

# revision identifiers, used by Alembic.
revision = "20260210_0000"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    Base.metadata.create_all(bind=bind, checkfirst=True)


def downgrade() -> None:
    bind = op.get_bind()
    Base.metadata.drop_all(bind=bind, checkfirst=True)
