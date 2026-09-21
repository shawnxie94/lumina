"""Drop the legacy topic chain (llm_wiki / Topic Bridge) tables and settings columns.

The tables and columns were created by 20260729_0029/0030.  This migration is
guarded: every drop is skipped when the target is already absent, so databases
that never synced topics and fresh databases replaying the full chain are both
safe.  Applied migrations 0029/0030 stay in history untouched.
"""

from alembic import op
import sqlalchemy as sa

revision = "20260921_0033"
down_revision = "20260915_0032"
branch_labels = None
depends_on = None


TOPIC_TABLES = ("article_topics", "topic_claims", "topics")

SETTINGS_COLUMNS = (
    "topics_enabled",
    "topics_bridge_base_url",
    "topics_bridge_token",
    "topics_auto_sync_on_enable",
    "topics_knowledge_type",
    "topics_project_path",
    "topics_last_sync_at",
    "topics_last_sync_status",
    "topics_last_sync_error",
    "topics_last_health_json",
    "topics_last_sync_result_json",
)


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    # Children first: article_topics/topic_claims reference topics.
    for table in TOPIC_TABLES:
        if inspector.has_table(table):
            op.drop_table(table)

    if inspector.has_table("admin_settings"):
        existing = {column["name"] for column in inspector.get_columns("admin_settings")}
        with op.batch_alter_table("admin_settings") as batch_op:
            for column in SETTINGS_COLUMNS:
                if column in existing:
                    batch_op.drop_column(column)


def downgrade() -> None:
    # Restore of synced topic data is not supported; the legacy chain was
    # removed by product decision.  Recreate only the settings columns so a
    # downgrade keeps the schema shape reproducible from the history chain.
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if inspector.has_table("admin_settings"):
        existing = {column["name"] for column in inspector.get_columns("admin_settings")}
        with op.batch_alter_table("admin_settings") as batch_op:
            if "topics_enabled" not in existing:
                batch_op.add_column(sa.Column("topics_enabled", sa.Boolean(), nullable=True))
