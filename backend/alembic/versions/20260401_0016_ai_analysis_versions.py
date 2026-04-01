"""add ai analysis version history

Revision ID: 20260401_0016
Revises: 20260331_0015
Create Date: 2026-04-01 14:30:00
"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "20260401_0016"
down_revision = "20260331_0015"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if not inspector.has_table("ai_analysis_versions"):
        op.create_table(
            "ai_analysis_versions",
            sa.Column("id", sa.String(), nullable=False),
            sa.Column("article_id", sa.String(), nullable=False),
            sa.Column("content_type", sa.String(), nullable=False),
            sa.Column("version_number", sa.Integer(), nullable=False),
            sa.Column("status", sa.String(), nullable=False),
            sa.Column("content_text", sa.Text(), nullable=True),
            sa.Column("content_html", sa.Text(), nullable=True),
            sa.Column("content_image_url", sa.String(), nullable=True),
            sa.Column("source_task_id", sa.String(), nullable=True),
            sa.Column("source_model_config_id", sa.String(), nullable=True),
            sa.Column("source_prompt_config_id", sa.String(), nullable=True),
            sa.Column("created_by_mode", sa.String(), nullable=False),
            sa.Column("rollback_from_version_id", sa.String(), nullable=True),
            sa.Column("created_at", sa.String(), nullable=True),
            sa.ForeignKeyConstraint(["article_id"], ["articles.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(
                ["rollback_from_version_id"], ["ai_analysis_versions.id"], ondelete="SET NULL"
            ),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint(
                "article_id",
                "content_type",
                "version_number",
                name="uq_ai_analysis_versions_article_content_version",
            ),
        )
        op.create_index(
            "ix_ai_analysis_versions_article_id", "ai_analysis_versions", ["article_id"]
        )
        op.create_index(
            "ix_ai_analysis_versions_content_type",
            "ai_analysis_versions",
            ["content_type"],
        )

    columns = {column["name"] for column in inspector.get_columns("ai_analyses")}
    with op.batch_alter_table("ai_analyses") as batch_op:
        if "current_summary_version_id" not in columns:
            batch_op.add_column(
                sa.Column("current_summary_version_id", sa.String(), nullable=True)
            )
        if "current_key_points_version_id" not in columns:
            batch_op.add_column(
                sa.Column("current_key_points_version_id", sa.String(), nullable=True)
            )
        if "current_outline_version_id" not in columns:
            batch_op.add_column(
                sa.Column("current_outline_version_id", sa.String(), nullable=True)
            )
        if "current_quotes_version_id" not in columns:
            batch_op.add_column(
                sa.Column("current_quotes_version_id", sa.String(), nullable=True)
            )
        if "current_infographic_version_id" not in columns:
            batch_op.add_column(
                sa.Column("current_infographic_version_id", sa.String(), nullable=True)
            )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    columns = {column["name"] for column in inspector.get_columns("ai_analyses")}
    with op.batch_alter_table("ai_analyses") as batch_op:
        if "current_infographic_version_id" in columns:
            batch_op.drop_column("current_infographic_version_id")
        if "current_quotes_version_id" in columns:
            batch_op.drop_column("current_quotes_version_id")
        if "current_outline_version_id" in columns:
            batch_op.drop_column("current_outline_version_id")
        if "current_key_points_version_id" in columns:
            batch_op.drop_column("current_key_points_version_id")
        if "current_summary_version_id" in columns:
            batch_op.drop_column("current_summary_version_id")

    if inspector.has_table("ai_analysis_versions"):
        op.drop_index(
            "ix_ai_analysis_versions_content_type", table_name="ai_analysis_versions"
        )
        op.drop_index(
            "ix_ai_analysis_versions_article_id", table_name="ai_analysis_versions"
        )
        op.drop_table("ai_analysis_versions")
