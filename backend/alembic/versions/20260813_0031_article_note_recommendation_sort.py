"""add indexed article note recommendation sort order

Revision ID: 20260813_0031
Revises: 20260729_0030
Create Date: 2026-08-13
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260813_0031"
down_revision = "20260729_0030"
branch_labels = None
depends_on = None


def _has_column(table_name: str, column_name: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    if table_name not in inspector.get_table_names():
        return False
    return any(
        column.get("name") == column_name
        for column in inspector.get_columns(table_name)
    )


def _column_names(table_name: str) -> set[str]:
    inspector = sa.inspect(op.get_bind())
    if table_name not in inspector.get_table_names():
        return set()
    return {column.get("name") for column in inspector.get_columns(table_name)}


def _has_table(table_name: str) -> bool:
    return table_name in sa.inspect(op.get_bind()).get_table_names()


def upgrade() -> None:
    if not _has_table("articles"):
        return

    if not _has_column("articles", "note_recommendation_level"):
        with op.batch_alter_table("articles") as batch_op:
            batch_op.add_column(
                sa.Column(
                    "note_recommendation_level",
                    sa.String(),
                    nullable=False,
                    server_default="neutral",
                )
            )

    if not _has_column("articles", "note_recommendation_level_order"):
        with op.batch_alter_table("articles") as batch_op:
            batch_op.add_column(
                sa.Column(
                    "note_recommendation_level_order",
                    sa.Integer(),
                    nullable=False,
                    server_default="1",
                )
            )

    op.execute(
        sa.text(
            """
            UPDATE articles
            SET note_recommendation_level_order = CASE note_recommendation_level
                WHEN 'strongly_recommended' THEN 3
                WHEN 'recommended' THEN 2
                WHEN 'neutral' THEN 1
                WHEN 'not_recommended' THEN 0
                ELSE 1
            END
            """
        )
    )
    article_columns = _column_names("articles")
    if {"is_visible", "created_at", "id"}.issubset(article_columns):
        op.execute(
            sa.text(
                "CREATE INDEX IF NOT EXISTS "
                "idx_articles_visibility_note_recommendation_created_at "
                "ON articles (is_visible, note_recommendation_level_order DESC, created_at DESC, id DESC)"
            )
        )
    if {"created_at", "id"}.issubset(article_columns):
        op.execute(
            sa.text(
                "CREATE INDEX IF NOT EXISTS "
                "idx_articles_note_recommendation_created_at "
                "ON articles (note_recommendation_level_order DESC, created_at DESC, id DESC)"
            )
        )


def downgrade() -> None:
    op.execute(
        sa.text(
            "DROP INDEX IF EXISTS "
            "idx_articles_visibility_note_recommendation_created_at"
        )
    )
    op.execute(
        sa.text("DROP INDEX IF EXISTS idx_articles_note_recommendation_created_at")
    )
    if _has_column("articles", "note_recommendation_level_order"):
        with op.batch_alter_table("articles") as batch_op:
            batch_op.drop_column("note_recommendation_level_order")
