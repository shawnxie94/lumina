"""add rss toggle and infographic image url

Revision ID: 20260326_0012
Revises: 20260326_0011
Create Date: 2026-03-26 23:40:00

"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "20260326_0012"
down_revision = "20260326_0011"
branch_labels = None
depends_on = None


def _has_column(table_name: str, column_name: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    columns = inspector.get_columns(table_name)
    return any(column.get("name") == column_name for column in columns)


def upgrade() -> None:
    with op.batch_alter_table("admin_settings") as batch_op:
        if not _has_column("admin_settings", "rss_enabled"):
            batch_op.add_column(
                sa.Column(
                    "rss_enabled",
                    sa.Boolean(),
                    nullable=False,
                    server_default=sa.false(),
                )
            )

    with op.batch_alter_table("ai_analyses") as batch_op:
        if not _has_column("ai_analyses", "infographic_image_url"):
            batch_op.add_column(
                sa.Column("infographic_image_url", sa.String(), nullable=True)
            )


def downgrade() -> None:
    with op.batch_alter_table("ai_analyses") as batch_op:
        if _has_column("ai_analyses", "infographic_image_url"):
            batch_op.drop_column("infographic_image_url")

    with op.batch_alter_table("admin_settings") as batch_op:
        if _has_column("admin_settings", "rss_enabled"):
            batch_op.drop_column("rss_enabled")
