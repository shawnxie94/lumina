"""index governance baseline

Revision ID: 20260210_0001
Revises:
Create Date: 2026-02-10 21:20:00

"""

from __future__ import annotations

from collections.abc import Iterable

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "20260210_0001"
down_revision = None
branch_labels = None
depends_on = None


def _table_names() -> set[str]:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return set(inspector.get_table_names())


def _execute_many(statements: Iterable[str]) -> None:
    for statement in statements:
        op.execute(sa.text(statement))


def upgrade() -> None:
    tables = _table_names()
    dialect = op.get_bind().dialect.name

    if "articles" in tables:
        _execute_many(
            [
                "CREATE UNIQUE INDEX IF NOT EXISTS idx_articles_slug_unique ON articles (slug)",
                "CREATE INDEX IF NOT EXISTS idx_articles_category ON articles(category_id)",
                "CREATE INDEX IF NOT EXISTS idx_articles_status ON articles(status)",
                "CREATE INDEX IF NOT EXISTS idx_articles_created_at ON articles(created_at DESC)",
                "CREATE INDEX IF NOT EXISTS idx_articles_source_url ON articles(source_url)",
                "CREATE INDEX IF NOT EXISTS idx_articles_visibility_created_at ON articles(is_visible, created_at DESC)",
                "CREATE INDEX IF NOT EXISTS idx_articles_category_visibility_created_at ON articles(category_id, is_visible, created_at DESC)",
                "CREATE INDEX IF NOT EXISTS idx_articles_source_domain_created_at ON articles(source_domain, created_at DESC)",
                "CREATE INDEX IF NOT EXISTS idx_articles_author_created_at ON articles(author, created_at DESC)",
                "CREATE INDEX IF NOT EXISTS idx_articles_published_at ON articles(published_at DESC)",
            ]
        )

    if "ai_tasks" in tables:
        _execute_many(
            [
                "CREATE INDEX IF NOT EXISTS idx_ai_tasks_status_run_at ON ai_tasks (status, run_at)",
                "CREATE INDEX IF NOT EXISTS idx_ai_tasks_article_id ON ai_tasks (article_id)",
                "CREATE INDEX IF NOT EXISTS idx_ai_tasks_locked_status ON ai_tasks (locked_at, status)",
            ]
        )
        if dialect == "sqlite":
            _execute_many(
                [
                    "CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_tasks_active_dedupe_unique ON ai_tasks (ifnull(article_id, ''), task_type, ifnull(content_type, ''), ifnull(payload, '')) WHERE status IN ('pending', 'processing')"
                ]
            )

    if "ai_task_events" in tables:
        _execute_many(
            [
                "CREATE INDEX IF NOT EXISTS idx_ai_task_events_task_created_at ON ai_task_events (task_id, created_at)"
            ]
        )

    if "ai_usage_logs" in tables:
        _execute_many(
            [
                "CREATE INDEX IF NOT EXISTS idx_ai_usage_logs_model ON ai_usage_logs (model_api_config_id)",
                "CREATE INDEX IF NOT EXISTS idx_ai_usage_logs_created_at ON ai_usage_logs (created_at)",
                "CREATE INDEX IF NOT EXISTS idx_ai_usage_logs_status ON ai_usage_logs (status)",
                "CREATE INDEX IF NOT EXISTS idx_ai_usage_logs_article_created_at ON ai_usage_logs (article_id, created_at)",
                "CREATE INDEX IF NOT EXISTS idx_ai_usage_logs_task_created_at ON ai_usage_logs (task_id, created_at)",
            ]
        )

    if "article_comments" in tables:
        _execute_many(
            [
                "CREATE INDEX IF NOT EXISTS idx_article_comments_article_created_at ON article_comments (article_id, created_at)",
                "CREATE INDEX IF NOT EXISTS idx_article_comments_hidden_created_at ON article_comments (is_hidden, created_at)",
                "CREATE INDEX IF NOT EXISTS idx_article_comments_reply_to ON article_comments (reply_to_id)",
            ]
        )

    if "ai_analyses" in tables:
        _execute_many(
            [
                "CREATE INDEX IF NOT EXISTS idx_ai_analysis_article_id ON ai_analyses(article_id)"
            ]
        )

    if "prompt_configs" in tables:
        _execute_many(
            [
                "CREATE INDEX IF NOT EXISTS idx_prompt_configs_category_type_enabled ON prompt_configs (category_id, type, is_enabled)",
                "CREATE INDEX IF NOT EXISTS idx_prompt_configs_model_enabled ON prompt_configs (model_api_config_id, is_enabled)",
            ]
        )

    if "model_api_configs" in tables:
        _execute_many(
            [
                "CREATE INDEX IF NOT EXISTS idx_model_api_configs_enabled_default ON model_api_configs (is_enabled, is_default)"
            ]
        )


def downgrade() -> None:
    statements = [
        "DROP INDEX IF EXISTS idx_model_api_configs_enabled_default",
        "DROP INDEX IF EXISTS idx_prompt_configs_model_enabled",
        "DROP INDEX IF EXISTS idx_prompt_configs_category_type_enabled",
        "DROP INDEX IF EXISTS idx_ai_analysis_article_id",
        "DROP INDEX IF EXISTS idx_article_comments_reply_to",
        "DROP INDEX IF EXISTS idx_article_comments_hidden_created_at",
        "DROP INDEX IF EXISTS idx_article_comments_article_created_at",
        "DROP INDEX IF EXISTS idx_ai_usage_logs_task_created_at",
        "DROP INDEX IF EXISTS idx_ai_usage_logs_article_created_at",
        "DROP INDEX IF EXISTS idx_ai_usage_logs_status",
        "DROP INDEX IF EXISTS idx_ai_usage_logs_created_at",
        "DROP INDEX IF EXISTS idx_ai_usage_logs_model",
        "DROP INDEX IF EXISTS idx_ai_task_events_task_created_at",
        "DROP INDEX IF EXISTS idx_ai_tasks_locked_status",
        "DROP INDEX IF EXISTS idx_ai_tasks_active_dedupe_unique",
        "DROP INDEX IF EXISTS idx_ai_tasks_article_id",
        "DROP INDEX IF EXISTS idx_ai_tasks_status_run_at",
        "DROP INDEX IF EXISTS idx_articles_published_at",
        "DROP INDEX IF EXISTS idx_articles_author_created_at",
        "DROP INDEX IF EXISTS idx_articles_source_domain_created_at",
        "DROP INDEX IF EXISTS idx_articles_category_visibility_created_at",
        "DROP INDEX IF EXISTS idx_articles_visibility_created_at",
        "DROP INDEX IF EXISTS idx_articles_source_url",
        "DROP INDEX IF EXISTS idx_articles_created_at",
        "DROP INDEX IF EXISTS idx_articles_status",
        "DROP INDEX IF EXISTS idx_articles_category",
        "DROP INDEX IF EXISTS idx_articles_slug_unique",
    ]
    _execute_many(statements)
