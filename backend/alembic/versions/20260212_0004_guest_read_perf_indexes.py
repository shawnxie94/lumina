"""guest read performance indexes

Revision ID: 20260212_0004
Revises: 20260211_0003
Create Date: 2026-02-12 12:40:00

"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "20260212_0004"
down_revision = "20260211_0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        sa.text(
            "CREATE INDEX IF NOT EXISTS idx_articles_visibility_published_created_at "
            "ON articles (is_visible, published_at DESC, created_at DESC)"
        )
    )


def downgrade() -> None:
    op.execute(
        sa.text("DROP INDEX IF EXISTS idx_articles_visibility_published_created_at")
    )
