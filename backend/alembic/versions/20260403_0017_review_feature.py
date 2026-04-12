"""add final review feature schema

Revision ID: 20260403_0017
Revises: 20260401_0016
Create Date: 2026-04-03 17:30:00
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "20260403_0017"
down_revision = "20260401_0016"
branch_labels = None
depends_on = None


def _table_names(inspector: sa.Inspector) -> set[str]:
    return set(inspector.get_table_names())


def _column_names(inspector: sa.Inspector, table_name: str) -> set[str]:
    return {column["name"] for column in inspector.get_columns(table_name)}


def _index_names(inspector: sa.Inspector, table_name: str) -> set[str]:
    return {index["name"] for index in inspector.get_indexes(table_name)}


def _foreign_key_names(inspector: sa.Inspector, table_name: str) -> set[str]:
    return {
        foreign_key["name"]
        for foreign_key in inspector.get_foreign_keys(table_name)
        if foreign_key.get("name")
    }


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    tables = _table_names(inspector)

    if "review_templates" not in tables:
        op.create_table(
            "review_templates",
            sa.Column("id", sa.String(), nullable=False),
            sa.Column("name", sa.String(), nullable=False),
            sa.Column("slug", sa.String(), nullable=False),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("is_enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("schedule_type", sa.String(), nullable=False),
            sa.Column("custom_interval_days", sa.Integer(), nullable=True),
            sa.Column("anchor_date", sa.String(), nullable=False),
            sa.Column("timezone", sa.String(), nullable=False, server_default="Asia/Shanghai"),
            sa.Column("trigger_time", sa.String(), nullable=False, server_default="09:00"),
            sa.Column("include_all_categories", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("prompt_template", sa.Text(), nullable=False),
            sa.Column("system_prompt", sa.Text(), nullable=True),
            sa.Column("title_template", sa.Text(), nullable=False),
            sa.Column(
                "model_api_config_id",
                sa.String(),
                sa.ForeignKey("model_api_configs.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column("review_input_mode", sa.String(), nullable=False, server_default="abstract"),
            sa.Column("temperature", sa.Float(), nullable=True),
            sa.Column("max_tokens", sa.Integer(), nullable=True),
            sa.Column("top_p", sa.Float(), nullable=True),
            sa.Column("next_run_at", sa.String(), nullable=True),
            sa.Column("last_run_at", sa.String(), nullable=True),
            sa.Column("created_at", sa.String(), nullable=True),
            sa.Column("updated_at", sa.String(), nullable=True),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index("ix_review_templates_slug", "review_templates", ["slug"], unique=True)
    else:
        review_template_columns = _column_names(inspector, "review_templates")
        review_template_foreign_keys = _foreign_key_names(inspector, "review_templates")
        review_template_indexes = _index_names(inspector, "review_templates")
        with op.batch_alter_table("review_templates") as batch_op:
            if "system_prompt" not in review_template_columns:
                batch_op.add_column(sa.Column("system_prompt", sa.Text(), nullable=True))
            if "model_api_config_id" not in review_template_columns:
                batch_op.add_column(sa.Column("model_api_config_id", sa.String(), nullable=True))
            if (
                "model_api_config_id" in review_template_columns
                or "model_api_config_id" not in review_template_columns
            ) and "fk_review_templates_model_api_config_id" not in review_template_foreign_keys:
                batch_op.create_foreign_key(
                    "fk_review_templates_model_api_config_id",
                    "model_api_configs",
                    ["model_api_config_id"],
                    ["id"],
                    ondelete="SET NULL",
                )
            if "review_input_mode" not in review_template_columns:
                batch_op.add_column(
                    sa.Column(
                        "review_input_mode",
                        sa.String(),
                        nullable=False,
                        server_default="abstract",
                    )
                )
            if "temperature" not in review_template_columns:
                batch_op.add_column(sa.Column("temperature", sa.Float(), nullable=True))
            if "max_tokens" not in review_template_columns:
                batch_op.add_column(sa.Column("max_tokens", sa.Integer(), nullable=True))
            if "top_p" not in review_template_columns:
                batch_op.add_column(sa.Column("top_p", sa.Float(), nullable=True))
        if "ix_review_templates_slug" not in review_template_indexes:
            op.create_index("ix_review_templates_slug", "review_templates", ["slug"], unique=True)

    if "review_template_categories" not in tables:
        op.create_table(
            "review_template_categories",
            sa.Column("template_id", sa.String(), nullable=False),
            sa.Column("category_id", sa.String(), nullable=False),
            sa.Column("created_at", sa.String(), nullable=False),
            sa.ForeignKeyConstraint(["category_id"], ["categories.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["template_id"], ["review_templates.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("template_id", "category_id"),
        )

    if "review_issues" not in tables:
        op.create_table(
            "review_issues",
            sa.Column("id", sa.String(), nullable=False),
            sa.Column("template_id", sa.String(), nullable=False),
            sa.Column("slug", sa.String(), nullable=False),
            sa.Column("title", sa.String(), nullable=False),
            sa.Column("status", sa.String(), nullable=False, server_default="draft"),
            sa.Column("window_start", sa.String(), nullable=False),
            sa.Column("window_end", sa.String(), nullable=False),
            sa.Column("top_image", sa.String(), nullable=True),
            sa.Column("markdown_content", sa.Text(), nullable=False),
            sa.Column("view_count", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("generated_at", sa.String(), nullable=True),
            sa.Column("published_at", sa.String(), nullable=True),
            sa.Column("created_at", sa.String(), nullable=True),
            sa.Column("updated_at", sa.String(), nullable=True),
            sa.ForeignKeyConstraint(["template_id"], ["review_templates.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index("ix_review_issues_slug", "review_issues", ["slug"], unique=True)
        op.create_index("ix_review_issues_template_id", "review_issues", ["template_id"])
        op.create_index("ix_review_issues_window_start", "review_issues", ["window_start"])
        op.create_index("ix_review_issues_window_end", "review_issues", ["window_end"])
    else:
        review_issue_columns = _column_names(inspector, "review_issues")
        review_issue_indexes = _index_names(inspector, "review_issues")
        with op.batch_alter_table("review_issues") as batch_op:
            if "top_image" not in review_issue_columns:
                batch_op.add_column(sa.Column("top_image", sa.String(), nullable=True))
            if "view_count" not in review_issue_columns:
                batch_op.add_column(
                    sa.Column(
                        "view_count",
                        sa.Integer(),
                        nullable=False,
                        server_default="0",
                    )
                )
        if "ix_review_issues_slug" not in review_issue_indexes:
            op.create_index("ix_review_issues_slug", "review_issues", ["slug"], unique=True)
        if "ix_review_issues_template_id" not in review_issue_indexes:
            op.create_index("ix_review_issues_template_id", "review_issues", ["template_id"])
        if "ix_review_issues_window_start" not in review_issue_indexes:
            op.create_index("ix_review_issues_window_start", "review_issues", ["window_start"])
        if "ix_review_issues_window_end" not in review_issue_indexes:
            op.create_index("ix_review_issues_window_end", "review_issues", ["window_end"])

    if "review_issue_articles" not in tables:
        op.create_table(
            "review_issue_articles",
            sa.Column("id", sa.String(), nullable=False),
            sa.Column("issue_id", sa.String(), nullable=False),
            sa.Column("article_id", sa.String(), nullable=False),
            sa.Column("category_id", sa.String(), nullable=True),
            sa.Column("category_sort_order", sa.Integer(), nullable=False, server_default="999999"),
            sa.Column("article_sort_order", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("created_at", sa.String(), nullable=True),
            sa.Column("updated_at", sa.String(), nullable=True),
            sa.ForeignKeyConstraint(["article_id"], ["articles.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["category_id"], ["categories.id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(["issue_id"], ["review_issues.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index("ix_review_issue_articles_issue_id", "review_issue_articles", ["issue_id"])
        op.create_index("ix_review_issue_articles_article_id", "review_issue_articles", ["article_id"])
        op.create_index("ix_review_issue_articles_category_id", "review_issue_articles", ["category_id"])
    else:
        review_issue_article_indexes = _index_names(inspector, "review_issue_articles")
        if "ix_review_issue_articles_issue_id" not in review_issue_article_indexes:
            op.create_index("ix_review_issue_articles_issue_id", "review_issue_articles", ["issue_id"])
        if "ix_review_issue_articles_article_id" not in review_issue_article_indexes:
            op.create_index("ix_review_issue_articles_article_id", "review_issue_articles", ["article_id"])
        if "ix_review_issue_articles_category_id" not in review_issue_article_indexes:
            op.create_index("ix_review_issue_articles_category_id", "review_issue_articles", ["category_id"])

    if "review_comments" not in tables:
        op.create_table(
            "review_comments",
            sa.Column("id", sa.String(), nullable=False),
            sa.Column("issue_id", sa.String(), nullable=False),
            sa.Column("user_id", sa.String(), nullable=False),
            sa.Column("user_name", sa.String(), nullable=False),
            sa.Column("user_avatar", sa.String(), nullable=True),
            sa.Column("provider", sa.String(), nullable=True),
            sa.Column("content", sa.Text(), nullable=False),
            sa.Column("reply_to_id", sa.String(), nullable=True),
            sa.Column("is_hidden", sa.Boolean(), nullable=True, server_default=sa.false()),
            sa.Column("created_at", sa.String(), nullable=True),
            sa.Column("updated_at", sa.String(), nullable=True),
            sa.ForeignKeyConstraint(["issue_id"], ["review_issues.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index(
            "ix_review_comments_issue_id",
            "review_comments",
            ["issue_id"],
            unique=False,
        )
    else:
        review_comment_indexes = _index_names(inspector, "review_comments")
        if "ix_review_comments_issue_id" not in review_comment_indexes:
            op.create_index(
                "ix_review_comments_issue_id",
                "review_comments",
                ["issue_id"],
                unique=False,
            )

    if "media_assets" in tables:
        media_columns = {
            column["name"]: column for column in inspector.get_columns("media_assets")
        }
        media_foreign_keys = _foreign_key_names(inspector, "media_assets")
        needs_batch_update = (
            "review_issue_id" not in media_columns
            or not media_columns.get("article_id", {}).get("nullable", False)
            or "fk_media_assets_review_issue_id_review_issues" not in media_foreign_keys
        )
        if needs_batch_update:
            with op.batch_alter_table("media_assets", recreate="always") as batch_op:
                if "review_issue_id" not in media_columns:
                    batch_op.add_column(
                        sa.Column("review_issue_id", sa.String(), nullable=True)
                    )
                if "article_id" in media_columns and not media_columns["article_id"].get("nullable", False):
                    batch_op.alter_column(
                        "article_id",
                        existing_type=sa.String(),
                        nullable=True,
                    )
                if "fk_media_assets_review_issue_id_review_issues" not in media_foreign_keys:
                    batch_op.create_foreign_key(
                        "fk_media_assets_review_issue_id_review_issues",
                        "review_issues",
                        ["review_issue_id"],
                        ["id"],
                        ondelete="CASCADE",
                    )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    tables = _table_names(inspector)

    if "media_assets" in tables:
        media_columns = {
            column["name"]: column for column in inspector.get_columns("media_assets")
        }
        if "review_issue_id" in media_columns or media_columns.get("article_id", {}).get("nullable", False):
            with op.batch_alter_table("media_assets", recreate="always") as batch_op:
                if "review_issue_id" in media_columns:
                    batch_op.drop_column("review_issue_id")
                if "article_id" in media_columns and media_columns["article_id"].get("nullable", False):
                    batch_op.alter_column(
                        "article_id",
                        existing_type=sa.String(),
                        nullable=False,
                    )

    if "review_comments" in tables:
        review_comment_indexes = _index_names(inspector, "review_comments")
        if "ix_review_comments_issue_id" in review_comment_indexes:
            op.drop_index("ix_review_comments_issue_id", table_name="review_comments")
        op.drop_table("review_comments")

    if "review_issue_articles" in tables:
        op.drop_index("ix_review_issue_articles_category_id", table_name="review_issue_articles")
        op.drop_index("ix_review_issue_articles_article_id", table_name="review_issue_articles")
        op.drop_index("ix_review_issue_articles_issue_id", table_name="review_issue_articles")
        op.drop_table("review_issue_articles")

    if "review_issues" in tables:
        op.drop_index("ix_review_issues_window_end", table_name="review_issues")
        op.drop_index("ix_review_issues_window_start", table_name="review_issues")
        op.drop_index("ix_review_issues_template_id", table_name="review_issues")
        op.drop_index("ix_review_issues_slug", table_name="review_issues")
        op.drop_table("review_issues")

    if "review_template_categories" in tables:
        op.drop_table("review_template_categories")

    if "review_templates" in tables:
        op.drop_index("ix_review_templates_slug", table_name="review_templates")
        op.drop_table("review_templates")
