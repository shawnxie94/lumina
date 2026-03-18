"""add note recommendation level for articles

Revision ID: 20260318_0007
Revises: 20260212_0006
Create Date: 2026-03-18 11:10:00

"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "20260318_0007"
down_revision = "20260212_0006"
branch_labels = None
depends_on = None


def _has_column(table_name: str, column_name: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    columns = inspector.get_columns(table_name)
    return any(column.get("name") == column_name for column in columns)


def upgrade() -> None:
    if _has_column("articles", "note_recommendation_level"):
        return
    with op.batch_alter_table("articles") as batch_op:
        batch_op.add_column(
            sa.Column(
                "note_recommendation_level",
                sa.String(),
                nullable=False,
                server_default="neutral",
            )
        )


def downgrade() -> None:
    if not _has_column("articles", "note_recommendation_level"):
        return
    with op.batch_alter_table("articles") as batch_op:
        batch_op.drop_column("note_recommendation_level")
