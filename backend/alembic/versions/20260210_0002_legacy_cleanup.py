"""legacy compatibility cleanup

Revision ID: 20260210_0002
Revises: 20260210_0001
Create Date: 2026-02-10 23:20:00

"""

from __future__ import annotations

from collections.abc import Iterable

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "20260210_0002"
down_revision = "20260210_0001"
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

    if "ai_tasks" in tables:
        _execute_many(
            [
                """
                UPDATE ai_tasks
                SET task_type = 'process_article_translation', content_type = 'translation'
                WHERE task_type = 'process_article_ai'
                  AND lower(coalesce(content_type, '')) = 'translation'
                """,
                """
                UPDATE ai_tasks
                SET task_type = 'process_article_cleaning', content_type = 'content_cleaning'
                WHERE task_type = 'process_article_ai'
                  AND lower(coalesce(content_type, '')) = 'content_cleaning'
                """,
                """
                UPDATE ai_tasks
                SET task_type = 'process_article_validation', content_type = 'content_validation'
                WHERE task_type = 'process_article_ai'
                  AND lower(coalesce(content_type, '')) = 'content_validation'
                """,
                """
                UPDATE ai_tasks
                SET task_type = 'process_article_classification', content_type = 'classification'
                WHERE task_type = 'process_article_ai'
                  AND lower(coalesce(content_type, '')) = 'classification'
                """,
                """
                UPDATE ai_tasks
                SET task_type = 'process_ai_content',
                    content_type = coalesce(nullif(content_type, ''), 'summary')
                WHERE task_type = 'process_article_ai'
                """,
            ]
        )

    if "ai_usage_logs" in tables:
        _execute_many(
            [
                """
                UPDATE ai_usage_logs
                SET task_type = 'process_article_translation', content_type = 'translation'
                WHERE task_type = 'process_article_ai'
                  AND lower(coalesce(content_type, '')) = 'translation'
                """,
                """
                UPDATE ai_usage_logs
                SET task_type = 'process_article_cleaning', content_type = 'content_cleaning'
                WHERE task_type = 'process_article_ai'
                  AND lower(coalesce(content_type, '')) = 'content_cleaning'
                """,
                """
                UPDATE ai_usage_logs
                SET task_type = 'process_article_validation', content_type = 'content_validation'
                WHERE task_type = 'process_article_ai'
                  AND lower(coalesce(content_type, '')) = 'content_validation'
                """,
                """
                UPDATE ai_usage_logs
                SET task_type = 'process_article_classification', content_type = 'classification'
                WHERE task_type = 'process_article_ai'
                  AND lower(coalesce(content_type, '')) = 'classification'
                """,
                """
                UPDATE ai_usage_logs
                SET task_type = 'process_ai_content'
                WHERE task_type = 'process_article_ai'
                """,
            ]
        )

    op.execute(sa.text("DROP TABLE IF EXISTS ai_configs"))


def downgrade() -> None:
    tables = _table_names()

    if "ai_usage_logs" in tables:
        _execute_many(
            [
                """
                UPDATE ai_usage_logs
                SET task_type = 'process_article_ai', content_type = NULL
                WHERE task_type IN (
                    'process_ai_content',
                    'process_article_translation',
                    'process_article_cleaning',
                    'process_article_validation',
                    'process_article_classification'
                )
                """,
            ]
        )

    if "ai_tasks" in tables:
        _execute_many(
            [
                """
                UPDATE ai_tasks
                SET task_type = 'process_article_ai', content_type = NULL
                WHERE task_type IN (
                    'process_ai_content',
                    'process_article_translation',
                    'process_article_cleaning',
                    'process_article_validation',
                    'process_article_classification'
                )
                """,
            ]
        )
