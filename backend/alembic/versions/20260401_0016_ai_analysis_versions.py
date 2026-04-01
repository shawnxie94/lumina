"""add ai analysis version history

Revision ID: 20260401_0016
Revises: 20260331_0015
Create Date: 2026-04-01 14:30:00
"""

import uuid

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "20260401_0016"
down_revision = "20260331_0015"
branch_labels = None
depends_on = None


CONTENT_TYPE_SPECS = {
    "summary": {
        "content_text_field": "summary",
        "content_html_field": None,
        "content_image_url_field": None,
        "pointer_field": "current_summary_version_id",
    },
    "key_points": {
        "content_text_field": "key_points",
        "content_html_field": None,
        "content_image_url_field": None,
        "pointer_field": "current_key_points_version_id",
    },
    "outline": {
        "content_text_field": "outline",
        "content_html_field": None,
        "content_image_url_field": None,
        "pointer_field": "current_outline_version_id",
    },
    "quotes": {
        "content_text_field": "quotes",
        "content_html_field": None,
        "content_image_url_field": None,
        "pointer_field": "current_quotes_version_id",
    },
    "infographic": {
        "content_text_field": None,
        "content_html_field": "infographic_html",
        "content_image_url_field": "infographic_image_url",
        "pointer_field": "current_infographic_version_id",
    },
}


def _has_renderable_value(value: object | None) -> bool:
    return isinstance(value, str) and bool(value.strip())


def _backfill_existing_ai_content_versions(bind) -> None:
    rows = bind.execute(
        sa.text(
            """
            SELECT
                id,
                article_id,
                summary,
                key_points,
                outline,
                quotes,
                infographic_html,
                infographic_image_url,
                current_summary_version_id,
                current_key_points_version_id,
                current_outline_version_id,
                current_quotes_version_id,
                current_infographic_version_id,
                updated_at
            FROM ai_analyses
            """
        )
    ).mappings()

    for row in rows:
        article_id = row.get("article_id")
        if not article_id:
            continue

        for content_type, spec in CONTENT_TYPE_SPECS.items():
            pointer_field = spec["pointer_field"]
            current_version_id = row.get(pointer_field)
            content_text = (
                row.get(spec["content_text_field"])
                if spec["content_text_field"]
                else None
            )
            content_html = (
                row.get(spec["content_html_field"])
                if spec["content_html_field"]
                else None
            )
            content_image_url = (
                row.get(spec["content_image_url_field"])
                if spec["content_image_url_field"]
                else None
            )
            has_content = any(
                _has_renderable_value(value)
                for value in (content_text, content_html, content_image_url)
            )
            if not has_content:
                continue

            existing_version = bind.execute(
                sa.text(
                    """
                    SELECT id
                    FROM ai_analysis_versions
                    WHERE article_id = :article_id
                      AND content_type = :content_type
                    ORDER BY version_number DESC
                    LIMIT 1
                    """
                ),
                {
                    "article_id": article_id,
                    "content_type": content_type,
                },
            ).mappings().first()

            if existing_version:
                if not current_version_id:
                    bind.execute(
                        sa.text(
                            f"""
                            UPDATE ai_analyses
                            SET {pointer_field} = :version_id
                            WHERE id = :analysis_id
                            """
                        ),
                        {
                            "version_id": existing_version["id"],
                            "analysis_id": row["id"],
                        },
                    )
                continue

            new_version_id = str(uuid.uuid4())
            bind.execute(
                sa.text(
                    """
                    INSERT INTO ai_analysis_versions (
                        id,
                        article_id,
                        content_type,
                        version_number,
                        status,
                        content_text,
                        content_html,
                        content_image_url,
                        source_task_id,
                        source_model_config_id,
                        source_prompt_config_id,
                        created_by_mode,
                        rollback_from_version_id,
                        created_at
                    )
                    VALUES (
                        :id,
                        :article_id,
                        :content_type,
                        1,
                        'completed',
                        :content_text,
                        :content_html,
                        :content_image_url,
                        NULL,
                        NULL,
                        NULL,
                        'generation',
                        NULL,
                        :created_at
                    )
                    """
                ),
                {
                    "id": new_version_id,
                    "article_id": article_id,
                    "content_type": content_type,
                    "content_text": content_text,
                    "content_html": content_html,
                    "content_image_url": content_image_url,
                    "created_at": row.get("updated_at"),
                },
            )
            bind.execute(
                sa.text(
                    f"""
                    UPDATE ai_analyses
                    SET {pointer_field} = :version_id
                    WHERE id = :analysis_id
                    """
                ),
                {
                    "version_id": new_version_id,
                    "analysis_id": row["id"],
                },
            )


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

    _backfill_existing_ai_content_versions(bind)


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
