"""add article view count

Revision ID: 20260331_0015
Revises: 20260331_0014
Create Date: 2026-03-31 23:55:00
"""

from __future__ import annotations

from alembic import op
from sqlalchemy import inspect, text


# revision identifiers, used by Alembic.
revision = "20260331_0015"
down_revision = "20260331_0014"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = inspect(conn)
    columns = {column["name"] for column in inspector.get_columns("articles")}
    if "view_count" in columns:
        return
    conn.execute(
        text(
            """
            ALTER TABLE articles
            ADD COLUMN view_count INTEGER NOT NULL DEFAULT 0
            """
        )
    )


def downgrade() -> None:
    # SQLite 不支持安全删除列；保持向前迁移。
    return None
