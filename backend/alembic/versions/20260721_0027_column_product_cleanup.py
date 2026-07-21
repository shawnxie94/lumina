"""column product cleanup: slug lock, drop windows, slim templates

Revision ID: 20260721_0027
Revises: 20260413_0025
Create Date: 2026-07-21 00:00:00

Merges the previously unreleased local-only steps:
- 0027 add review_issues.slug_locked
- 0028 drop review_issues window_start/window_end
- 0029 review_templates color/sort_order
- 0030 drop review_template_categories + unused template schedule/AI columns
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect, text


revision = "20260721_0027"
down_revision = "20260413_0025"
branch_labels = None
depends_on = None


DROP_TEMPLATE_COLUMNS = {
    "is_enabled",
    "schedule_type",
    "custom_interval_days",
    "anchor_date",
    "timezone",
    "trigger_time",
    "include_all_categories",
    "model_api_config_id",
    "review_input_mode",
    "system_prompt",
    "prompt_template",
    "temperature",
    "max_tokens",
    "top_p",
    "title_template",
    "next_run_at",
    "last_run_at",
}


def _table_exists(inspector, table_name: str) -> bool:
    return table_name in set(inspector.get_table_names())


def _columns(inspector, table_name: str) -> set[str]:
    if not _table_exists(inspector, table_name):
        return set()
    return {column["name"] for column in inspector.get_columns(table_name)}


def _indexes(inspector, table_name: str) -> list[dict]:
    if not _table_exists(inspector, table_name):
        return []
    return list(inspector.get_indexes(table_name))


def _upgrade_review_issues(bind, inspector) -> None:
    if not _table_exists(inspector, "review_issues"):
        return

    columns = _columns(inspector, "review_issues")
    if "slug_locked" not in columns:
        op.add_column(
            "review_issues",
            sa.Column("slug_locked", sa.Boolean(), nullable=True),
        )
        columns.add("slug_locked")

    op.execute(
        text(
            "UPDATE review_issues SET slug_locked = 1 "
            "WHERE status = 'published' AND (slug_locked IS NULL OR slug_locked = 0)"
        )
    )
    op.execute(text("UPDATE review_issues SET slug_locked = 0 WHERE slug_locked IS NULL"))

    # SQLite cannot drop indexed columns cleanly without first dropping indexes.
    for index in _indexes(inspector, "review_issues"):
        cols = set(index.get("column_names") or [])
        if "window_start" in cols or "window_end" in cols:
            name = index.get("name")
            if name:
                op.drop_index(name, table_name="review_issues")

    inspector = inspect(bind)
    columns = _columns(inspector, "review_issues")
    needs_window_drop = "window_start" in columns or "window_end" in columns

    if bind.dialect.name == "sqlite" and needs_window_drop:
        op.execute(text("PRAGMA foreign_keys=OFF"))
        op.execute(
            text(
                """
                CREATE TABLE review_issues_new (
                    id VARCHAR NOT NULL,
                    template_id VARCHAR NOT NULL,
                    slug VARCHAR NOT NULL,
                    slug_locked BOOLEAN NOT NULL DEFAULT 0,
                    title VARCHAR NOT NULL,
                    status VARCHAR NOT NULL,
                    top_image VARCHAR,
                    markdown_content TEXT NOT NULL,
                    view_count INTEGER NOT NULL DEFAULT 0,
                    generated_at VARCHAR,
                    published_at VARCHAR,
                    created_at VARCHAR,
                    updated_at VARCHAR,
                    PRIMARY KEY (id),
                    FOREIGN KEY(template_id) REFERENCES review_templates (id) ON DELETE CASCADE
                )
                """
            )
        )
        select_cols = [
            "id",
            "template_id",
            "slug",
            "COALESCE(slug_locked, 0) AS slug_locked" if "slug_locked" in columns else "0 AS slug_locked",
            "title",
            "status",
            "top_image",
            "markdown_content",
            "COALESCE(view_count, 0) AS view_count",
            "generated_at",
            "published_at",
            "created_at",
            "updated_at",
        ]
        op.execute(
            text(
                f"""
                INSERT INTO review_issues_new (
                    id, template_id, slug, slug_locked, title, status, top_image,
                    markdown_content, view_count, generated_at, published_at,
                    created_at, updated_at
                )
                SELECT {', '.join(select_cols)}
                FROM review_issues
                """
            )
        )
        op.execute(text("DROP TABLE review_issues"))
        op.execute(text("ALTER TABLE review_issues_new RENAME TO review_issues"))
        op.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS ix_review_issues_slug ON review_issues (slug)"))
        op.execute(
            text("CREATE INDEX IF NOT EXISTS ix_review_issues_template_id ON review_issues (template_id)")
        )
        op.execute(text("PRAGMA foreign_keys=ON"))
        return

    if "window_start" in columns:
        op.drop_column("review_issues", "window_start")
    if "window_end" in columns:
        op.drop_column("review_issues", "window_end")


def _upgrade_review_templates(bind, inspector) -> None:
    if _table_exists(inspector, "review_template_categories"):
        op.drop_table("review_template_categories")
        inspector = inspect(bind)

    if not _table_exists(inspector, "review_templates"):
        return

    columns = _columns(inspector, "review_templates")

    # Ensure color/sort exist before optional SQLite rebuild, and seed sort_order once.
    added_sort = False
    if "color" not in columns:
        op.add_column(
            "review_templates",
            sa.Column("color", sa.String(), nullable=False, server_default="#3B82F6"),
        )
        columns.add("color")
    if "sort_order" not in columns:
        op.add_column(
            "review_templates",
            sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        )
        columns.add("sort_order")
        added_sort = True

    if added_sort:
        op.execute(
            text(
                """
                UPDATE review_templates
                SET sort_order = (
                    SELECT COUNT(*)
                    FROM review_templates AS rt2
                    WHERE COALESCE(rt2.created_at, '') < COALESCE(review_templates.created_at, '')
                       OR (
                            COALESCE(rt2.created_at, '') = COALESCE(review_templates.created_at, '')
                            AND rt2.id < review_templates.id
                       )
                )
                """
            )
        )

    inspector = inspect(bind)
    columns = _columns(inspector, "review_templates")
    to_drop = sorted(DROP_TEMPLATE_COLUMNS & columns)
    if not to_drop:
        return

    if bind.dialect.name == "sqlite":
        op.execute(text("PRAGMA foreign_keys=OFF"))
        op.execute(
            text(
                """
                CREATE TABLE review_templates_new (
                    id VARCHAR NOT NULL,
                    name VARCHAR NOT NULL,
                    slug VARCHAR NOT NULL,
                    description TEXT,
                    color VARCHAR NOT NULL DEFAULT '#3B82F6',
                    sort_order INTEGER NOT NULL DEFAULT 0,
                    created_at VARCHAR,
                    updated_at VARCHAR,
                    PRIMARY KEY (id)
                )
                """
            )
        )
        op.execute(
            text(
                """
                INSERT INTO review_templates_new (
                    id, name, slug, description, color, sort_order, created_at, updated_at
                )
                SELECT
                    id,
                    name,
                    slug,
                    description,
                    COALESCE(color, '#3B82F6'),
                    COALESCE(sort_order, 0),
                    created_at,
                    updated_at
                FROM review_templates
                """
            )
        )
        op.execute(text("DROP TABLE review_templates"))
        op.execute(text("ALTER TABLE review_templates_new RENAME TO review_templates"))
        op.create_index("ix_review_templates_slug", "review_templates", ["slug"], unique=True)
        op.execute(text("PRAGMA foreign_keys=ON"))
        return

    with op.batch_alter_table("review_templates") as batch_op:
        for column_name in to_drop:
            batch_op.drop_column(column_name)


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    _upgrade_review_issues(bind, inspector)
    inspector = inspect(bind)
    _upgrade_review_templates(bind, inspector)


def downgrade() -> None:
    # Product cleanup is intentionally not fully reversible on SQLite.
    bind = op.get_bind()
    inspector = inspect(bind)
    if _table_exists(inspector, "review_issues"):
        columns = _columns(inspector, "review_issues")
        if "slug_locked" in columns:
            op.drop_column("review_issues", "slug_locked")
        if "window_start" not in columns:
            op.add_column("review_issues", sa.Column("window_start", sa.String(), nullable=True))
            op.create_index("ix_review_issues_window_start", "review_issues", ["window_start"])
        if "window_end" not in columns:
            op.add_column("review_issues", sa.Column("window_end", sa.String(), nullable=True))
            op.create_index("ix_review_issues_window_end", "review_issues", ["window_end"])
    if _table_exists(inspector, "review_templates"):
        columns = _columns(inspector, "review_templates")
        if "sort_order" in columns:
            op.drop_column("review_templates", "sort_order")
        if "color" in columns:
            op.drop_column("review_templates", "color")
