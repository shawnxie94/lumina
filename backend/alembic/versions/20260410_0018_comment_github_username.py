"""add github username columns to comments

Revision ID: 20260410_0018
Revises: 20260403_0017
Create Date: 2026-04-10 15:20:00
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "20260410_0018"
down_revision = "20260403_0017"
branch_labels = None
depends_on = None


def _column_names(inspector: sa.Inspector, table_name: str) -> set[str]:
    return {column["name"] for column in inspector.get_columns(table_name)}


def _table_exists(inspector: sa.Inspector, table_name: str) -> bool:
    return table_name in set(inspector.get_table_names())


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)

    if _table_exists(inspector, "article_comments") and "github_username" not in _column_names(
        inspector, "article_comments"
    ):
        with op.batch_alter_table("article_comments") as batch_op:
            batch_op.add_column(sa.Column("github_username", sa.String(), nullable=True))

    if _table_exists(inspector, "review_comments") and "github_username" not in _column_names(
        inspector, "review_comments"
    ):
        with op.batch_alter_table("review_comments") as batch_op:
            batch_op.add_column(sa.Column("github_username", sa.String(), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)

    if _table_exists(inspector, "article_comments") and "github_username" in _column_names(
        inspector, "article_comments"
    ):
        with op.batch_alter_table("article_comments") as batch_op:
            batch_op.drop_column("github_username")

    if _table_exists(inspector, "review_comments") and "github_username" in _column_names(
        inspector, "review_comments"
    ):
        with op.batch_alter_table("review_comments") as batch_op:
            batch_op.drop_column("github_username")
