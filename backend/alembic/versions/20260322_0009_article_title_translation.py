"""add translated article title column

Revision ID: 20260322_0009
Revises: 20260319_0008
Create Date: 2026-03-22 13:20:00

"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "20260322_0009"
down_revision = "20260319_0008"
branch_labels = None
depends_on = None


def _has_column(table_name: str, column_name: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    columns = inspector.get_columns(table_name)
    return any(column.get("name") == column_name for column in columns)


def upgrade() -> None:
    with op.batch_alter_table("articles") as batch_op:
        if not _has_column("articles", "title_trans"):
            batch_op.add_column(sa.Column("title_trans", sa.String(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("articles") as batch_op:
        if _has_column("articles", "title_trans"):
            batch_op.drop_column("title_trans")
