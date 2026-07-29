"""article topics bridge + drop legacy article tags

Revision ID: 20260729_0029
Revises: 20260721_0028
Create Date: 2026-07-29 16:00:00

Unreleased local steps merged into one revision:
- topics / article_topics / topic_claims
- article compile_* columns
- admin topics_* settings (incl. knowledge_type / project_path)
- topics.content_md + tags_json (no persisted summary)
- drop tags / article_tags / tagging_* / auto_ai_tagging_enabled / tagging prompts
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect, text


revision = "20260729_0029"
down_revision = "20260721_0028"
branch_labels = None
depends_on = None


def _has_table(inspector, name: str) -> bool:
    return name in inspector.get_table_names()


def _has_column(inspector, table: str, column: str) -> bool:
    if not _has_table(inspector, table):
        return False
    return any(col["name"] == column for col in inspector.get_columns(table))


def _has_index(inspector, table: str, index_name: str) -> bool:
    if not _has_table(inspector, table):
        return False
    return any(item.get("name") == index_name for item in inspector.get_indexes(table))


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)

    # --- topics schema (final shape, no summary column) ---
    if not _has_table(inspector, "topics"):
        op.create_table(
            "topics",
            sa.Column("id", sa.String(), primary_key=True),
            sa.Column("key", sa.String(), nullable=False),
            sa.Column("title", sa.String(), nullable=False),
            sa.Column("content_md", sa.Text(), nullable=True),
            sa.Column("tags_json", sa.Text(), nullable=True),
            sa.Column("status", sa.String(), nullable=False, server_default="active"),
            sa.Column("topic_type", sa.String(), nullable=True),
            sa.Column("article_count", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("compiler", sa.String(), nullable=True),
            sa.Column("compiler_ref", sa.String(), nullable=True),
            sa.Column("compiled_at", sa.String(), nullable=True),
            sa.Column("related_topic_keys", sa.Text(), nullable=True),
            sa.Column("created_at", sa.String(), nullable=True),
            sa.Column("updated_at", sa.String(), nullable=True),
        )
        op.create_index("ix_topics_key", "topics", ["key"], unique=True)
        inspector = inspect(bind)
    else:
        # Idempotent upgrades for any partial local experiments.
        if _has_column(inspector, "topics", "summary"):
            with op.batch_alter_table("topics") as batch_op:
                batch_op.drop_column("summary")
            inspector = inspect(bind)
        if not _has_column(inspector, "topics", "content_md"):
            with op.batch_alter_table("topics") as batch_op:
                batch_op.add_column(sa.Column("content_md", sa.Text(), nullable=True))
            inspector = inspect(bind)
        if not _has_column(inspector, "topics", "tags_json"):
            with op.batch_alter_table("topics") as batch_op:
                batch_op.add_column(sa.Column("tags_json", sa.Text(), nullable=True))
            inspector = inspect(bind)

    if not _has_table(inspector, "article_topics"):
        op.create_table(
            "article_topics",
            sa.Column("id", sa.String(), primary_key=True),
            sa.Column(
                "article_id",
                sa.String(),
                sa.ForeignKey("articles.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column(
                "topic_id",
                sa.String(),
                sa.ForeignKey("topics.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("relation_reason", sa.Text(), nullable=True),
            sa.Column("confidence", sa.Float(), nullable=True),
            sa.Column(
                "source",
                sa.String(),
                nullable=False,
                server_default="bridge_writeback",
            ),
            sa.Column("created_at", sa.String(), nullable=True),
            sa.Column("updated_at", sa.String(), nullable=True),
            sa.UniqueConstraint(
                "article_id", "topic_id", name="uq_article_topics_article_topic"
            ),
        )
        op.create_index("ix_article_topics_article_id", "article_topics", ["article_id"])
        op.create_index("ix_article_topics_topic_id", "article_topics", ["topic_id"])
        inspector = inspect(bind)

    if not _has_table(inspector, "topic_claims"):
        op.create_table(
            "topic_claims",
            sa.Column("id", sa.String(), primary_key=True),
            sa.Column(
                "topic_id",
                sa.String(),
                sa.ForeignKey("topics.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("text", sa.Text(), nullable=False),
            sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("article_ids_json", sa.Text(), nullable=True),
            sa.Column("created_at", sa.String(), nullable=True),
            sa.Column("updated_at", sa.String(), nullable=True),
        )
        op.create_index("ix_topic_claims_topic_id", "topic_claims", ["topic_id"])
        inspector = inspect(bind)

    article_cols = [
        (
            "compile_status",
            sa.Column(
                "compile_status", sa.String(), nullable=False, server_default="none"
            ),
        ),
        ("compiled_at", sa.Column("compiled_at", sa.String(), nullable=True)),
        ("compile_error", sa.Column("compile_error", sa.Text(), nullable=True)),
        (
            "compile_export_hash",
            sa.Column("compile_export_hash", sa.String(), nullable=True),
        ),
    ]
    if _has_table(inspector, "articles"):
        missing_article_cols = [
            col for name, col in article_cols if not _has_column(inspector, "articles", name)
        ]
        if missing_article_cols:
            with op.batch_alter_table("articles") as batch:
                for col in missing_article_cols:
                    batch.add_column(col)
            inspector = inspect(bind)

    admin_cols = [
        (
            "topics_enabled",
            sa.Column(
                "topics_enabled", sa.Boolean(), nullable=False, server_default=sa.false()
            ),
        ),
        (
            "topics_bridge_base_url",
            sa.Column(
                "topics_bridge_base_url",
                sa.String(),
                nullable=True,
                server_default="http://127.0.0.1:8787",
            ),
        ),
        ("topics_bridge_token", sa.Column("topics_bridge_token", sa.String(), nullable=True)),
        (
            "topics_auto_sync_on_enable",
            sa.Column(
                "topics_auto_sync_on_enable",
                sa.Boolean(),
                nullable=False,
                server_default=sa.true(),
            ),
        ),
        (
            "topics_knowledge_type",
            sa.Column(
                "topics_knowledge_type",
                sa.String(),
                nullable=False,
                server_default="llm_wiki",
            ),
        ),
        ("topics_project_path", sa.Column("topics_project_path", sa.String(), nullable=True)),
        ("topics_last_sync_at", sa.Column("topics_last_sync_at", sa.String(), nullable=True)),
        (
            "topics_last_sync_status",
            sa.Column(
                "topics_last_sync_status",
                sa.String(),
                nullable=True,
                server_default="idle",
            ),
        ),
        (
            "topics_last_sync_error",
            sa.Column("topics_last_sync_error", sa.Text(), nullable=True),
        ),
        (
            "topics_last_health_json",
            sa.Column("topics_last_health_json", sa.Text(), nullable=True),
        ),
    ]
    if _has_table(inspector, "admin_settings"):
        missing_admin_cols = [
            col for name, col in admin_cols if not _has_column(inspector, "admin_settings", name)
        ]
        if missing_admin_cols:
            with op.batch_alter_table("admin_settings") as batch:
                for col in missing_admin_cols:
                    batch.add_column(col)
            inspector = inspect(bind)

    # --- drop legacy article tags feature ---
    if _has_table(inspector, "article_tags"):
        op.drop_table("article_tags")
        inspector = inspect(bind)

    if _has_table(inspector, "tags"):
        if _has_index(inspector, "tags", "ix_tags_normalized_name"):
            op.drop_index("ix_tags_normalized_name", table_name="tags")
        op.drop_table("tags")
        inspector = inspect(bind)

    for column in (
        "tagging_status",
        "tagging_source_hash",
        "tagging_manual_override",
    ):
        if _has_column(inspector, "ai_analyses", column):
            with op.batch_alter_table("ai_analyses") as batch_op:
                batch_op.drop_column(column)
            inspector = inspect(bind)

    if _has_column(inspector, "admin_settings", "auto_ai_tagging_enabled"):
        with op.batch_alter_table("admin_settings") as batch_op:
            batch_op.drop_column("auto_ai_tagging_enabled")
        inspector = inspect(bind)

    if _has_table(inspector, "prompt_configs"):
        bind.execute(text("DELETE FROM prompt_configs WHERE type = 'tagging'"))


def downgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)

    # Recreate minimal tags schema for downgrade compatibility only.
    if not _has_table(inspector, "tags"):
        op.create_table(
            "tags",
            sa.Column("id", sa.String(), primary_key=True),
            sa.Column("name", sa.String(), nullable=False),
            sa.Column("normalized_name", sa.String(), nullable=False),
            sa.Column("created_at", sa.String(), nullable=True),
            sa.Column("updated_at", sa.String(), nullable=True),
        )
        op.create_index(
            "ix_tags_normalized_name", "tags", ["normalized_name"], unique=True
        )
        inspector = inspect(bind)

    if not _has_table(inspector, "article_tags"):
        op.create_table(
            "article_tags",
            sa.Column(
                "article_id",
                sa.String(),
                sa.ForeignKey("articles.id", ondelete="CASCADE"),
                primary_key=True,
            ),
            sa.Column(
                "tag_id",
                sa.String(),
                sa.ForeignKey("tags.id", ondelete="CASCADE"),
                primary_key=True,
            ),
        )
        inspector = inspect(bind)

    if _has_table(inspector, "ai_analyses"):
        with op.batch_alter_table("ai_analyses") as batch_op:
            if not _has_column(inspector, "ai_analyses", "tagging_status"):
                batch_op.add_column(sa.Column("tagging_status", sa.String(), nullable=True))
            if not _has_column(inspector, "ai_analyses", "tagging_source_hash"):
                batch_op.add_column(
                    sa.Column("tagging_source_hash", sa.String(), nullable=True)
                )
            if not _has_column(inspector, "ai_analyses", "tagging_manual_override"):
                batch_op.add_column(
                    sa.Column(
                        "tagging_manual_override",
                        sa.Boolean(),
                        nullable=False,
                        server_default=sa.false(),
                    )
                )
        inspector = inspect(bind)

    if _has_table(inspector, "admin_settings") and not _has_column(
        inspector, "admin_settings", "auto_ai_tagging_enabled"
    ):
        with op.batch_alter_table("admin_settings") as batch_op:
            batch_op.add_column(
                sa.Column(
                    "auto_ai_tagging_enabled",
                    sa.Boolean(),
                    nullable=True,
                    server_default=sa.true(),
                )
            )
        inspector = inspect(bind)

    for name in [
        "topics_last_health_json",
        "topics_last_sync_error",
        "topics_last_sync_status",
        "topics_last_sync_at",
        "topics_project_path",
        "topics_knowledge_type",
        "topics_auto_sync_on_enable",
        "topics_bridge_token",
        "topics_bridge_base_url",
        "topics_enabled",
    ]:
        if _has_column(inspector, "admin_settings", name):
            with op.batch_alter_table("admin_settings") as batch:
                batch.drop_column(name)
            inspector = inspect(bind)

    for name in ["compile_export_hash", "compile_error", "compiled_at", "compile_status"]:
        if _has_column(inspector, "articles", name):
            with op.batch_alter_table("articles") as batch:
                batch.drop_column(name)
            inspector = inspect(bind)

    if _has_table(inspector, "topic_claims"):
        op.drop_table("topic_claims")
    if _has_table(inspector, "article_topics"):
        op.drop_table("article_topics")
    if _has_table(inspector, "topics"):
        if _has_index(inspector, "topics", "ix_topics_key"):
            op.drop_index("ix_topics_key", table_name="topics")
        op.drop_table("topics")
