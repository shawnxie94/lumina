"""add header custom links setting

Revision ID: 20260413_0025
Revises: 20260413_0024
Create Date: 2026-06-28 00:00:00
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "20260413_0025"
down_revision = "20260413_0024"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    if "admin_settings" not in set(inspector.get_table_names()):
        return
    columns = {column["name"] for column in inspector.get_columns("admin_settings")}
    if "header_custom_links" not in columns:
        op.add_column(
            "admin_settings",
            sa.Column("header_custom_links", sa.Text(), nullable=True),
        )
    op.execute("UPDATE admin_settings SET header_custom_links = '[]' WHERE header_custom_links IS NULL")


def downgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    if "admin_settings" not in set(inspector.get_table_names()):
        return
    columns = {column["name"] for column in inspector.get_columns("admin_settings")}
    if "header_custom_links" in columns:
        op.drop_column("admin_settings", "header_custom_links")
