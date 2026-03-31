"""add article tags and tagging prompt

Revision ID: 20260319_0008
Revises: 20260318_0007
Create Date: 2026-03-19 10:30:00

"""

from __future__ import annotations

from datetime import date, datetime, timezone
import uuid

from alembic import op
import sqlalchemy as sa
from sqlalchemy import text

# revision identifiers, used by Alembic.
revision = "20260319_0008"
down_revision = "20260318_0007"
branch_labels = None
depends_on = None


def _has_table(table_name: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return table_name in inspector.get_table_names()


def _has_column(table_name: str, column_name: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    columns = inspector.get_columns(table_name)
    return any(column.get("name") == column_name for column in columns)


def _seed_default_tagging_prompt() -> None:
    conn = op.get_bind()
    existing = conn.execute(
        text("SELECT id FROM prompt_configs WHERE type = 'tagging' LIMIT 1")
    ).first()
    if existing:
        return

    today = date.today().isoformat()
    now_iso = datetime.now(timezone.utc).isoformat()
    conn.execute(
        text(
            """
            INSERT INTO prompt_configs (
                id,
                name,
                category_id,
                type,
                prompt,
                system_prompt,
                response_format,
                temperature,
                max_tokens,
                top_p,
                chunk_size_tokens,
                chunk_overlap_tokens,
                max_continue_rounds,
                model_api_config_id,
                is_enabled,
                is_default,
                created_at,
                updated_at
            ) VALUES (
                :id,
                :name,
                NULL,
                :type,
                :prompt,
                :system_prompt,
                :response_format,
                :temperature,
                :max_tokens,
                :top_p,
                NULL,
                NULL,
                NULL,
                NULL,
                1,
                1,
                :created_at,
                :updated_at
            )
            """
        ),
        {
            "id": str(uuid.uuid4()),
            "name": "默认-标签",
            "type": "tagging",
            "prompt": """请根据以下文章内容生成 3-5 个中文标签。

硬性要求：
1) 标签要具体、可检索、信息密度高，避免“文章/内容/思考”等空泛词。
2) 尽量避免与参考分类完全重复，除非它本身就是最关键标签。
3) 优先提炼主题、对象、方法、场景、领域等高区分度信息。
4) 每个标签不超过 5 个字。

参考分类：{category_name}

文章内容：
{content}""",
            "system_prompt": "你是内容标签助手，擅长提炼具体、稳定、可复用的高价值标签。",
            "response_format": "text",
            "temperature": 0.2,
            "max_tokens": 300,
            "top_p": 0.9,
            "created_at": today,
            "updated_at": now_iso,
        },
    )


def upgrade() -> None:
    if not _has_table("tags"):
        op.create_table(
            "tags",
            sa.Column("id", sa.String(), nullable=False),
            sa.Column("name", sa.String(), nullable=False),
            sa.Column("normalized_name", sa.String(), nullable=False),
            sa.Column("created_at", sa.String(), nullable=True),
            sa.Column("updated_at", sa.String(), nullable=True),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("normalized_name"),
        )
        op.create_index(
            "ix_tags_normalized_name",
            "tags",
            ["normalized_name"],
            unique=True,
        )

    if not _has_table("article_tags"):
        op.create_table(
            "article_tags",
            sa.Column("article_id", sa.String(), nullable=False),
            sa.Column("tag_id", sa.String(), nullable=False),
            sa.Column("created_at", sa.String(), nullable=False),
            sa.ForeignKeyConstraint(["article_id"], ["articles.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["tag_id"], ["tags.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("article_id", "tag_id"),
        )

    if not _has_column("ai_analyses", "tagging_status"):
        with op.batch_alter_table("ai_analyses") as batch_op:
            batch_op.add_column(sa.Column("tagging_status", sa.String(), nullable=True))
    if not _has_column("ai_analyses", "tagging_source_hash"):
        with op.batch_alter_table("ai_analyses") as batch_op:
            batch_op.add_column(
                sa.Column("tagging_source_hash", sa.String(), nullable=True)
            )
    if not _has_column("ai_analyses", "tagging_manual_override"):
        with op.batch_alter_table("ai_analyses") as batch_op:
            batch_op.add_column(
                sa.Column(
                    "tagging_manual_override",
                    sa.Boolean(),
                    nullable=False,
                    server_default=sa.false(),
                )
            )

    _seed_default_tagging_prompt()


def downgrade() -> None:
    conn = op.get_bind()
    conn.execute(text("DELETE FROM prompt_configs WHERE type = 'tagging'"))

    if _has_column("ai_analyses", "tagging_manual_override"):
        with op.batch_alter_table("ai_analyses") as batch_op:
            batch_op.drop_column("tagging_manual_override")
    if _has_column("ai_analyses", "tagging_source_hash"):
        with op.batch_alter_table("ai_analyses") as batch_op:
            batch_op.drop_column("tagging_source_hash")
    if _has_column("ai_analyses", "tagging_status"):
        with op.batch_alter_table("ai_analyses") as batch_op:
            batch_op.drop_column("tagging_status")

    if _has_table("article_tags"):
        op.drop_table("article_tags")
    if _has_table("tags"):
        indexes = {
            item.get("name") for item in sa.inspect(op.get_bind()).get_indexes("tags")
        }
        if "ix_tags_normalized_name" in indexes:
            op.drop_index("ix_tags_normalized_name", table_name="tags")
        op.drop_table("tags")
