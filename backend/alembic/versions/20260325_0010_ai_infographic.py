"""add infographic ai analysis fields and seed infographic prompt

Revision ID: 20260325_0010
Revises: 20260322_0009
Create Date: 2026-03-25 22:10:00

"""

from __future__ import annotations

from datetime import date, datetime, timezone
import uuid

from alembic import op
import sqlalchemy as sa
from sqlalchemy import text

# revision identifiers, used by Alembic.
revision = "20260325_0010"
down_revision = "20260322_0009"
branch_labels = None
depends_on = None


def _has_column(table_name: str, column_name: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    columns = inspector.get_columns(table_name)
    return any(column.get("name") == column_name for column in columns)


def _seed_default_infographic_prompt() -> None:
    conn = op.get_bind()
    existing = conn.execute(
        text("SELECT id FROM prompt_configs WHERE type = 'infographic' LIMIT 1")
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
            "name": "默认-信息图",
            "type": "infographic",
            "prompt": """请将文章提炼成一张单页中文信息图，突出内容结构、信息层级、布局组织与视觉风格。

建议采用以下组织方式：
1) 顶部标题区：一句主题结论 + 一句背景或适用范围。
2) 主体区优先 2 个核心信息卡；如确有必要可扩展到 3 个，但不要更多。
3) 结尾保留一个行动建议 / 启示 / 适用场景区。
4) 优先提炼“读者最该记住的观点、步骤、对比或清单”，避免铺陈原文细节。
5) 如果文章更适合其他信息结构，可明确改成双列对比、时间线、步骤流、矩阵卡片等版式。
6）内容不需要添加“结论：”、“核心卡：”、“使用范围：”、“行动建议：”等前缀说明。

视觉风格建议：
1) 配色统一克制，优先围绕单一主色体系展开，不要让每个区块各用一套颜色。
2) 建议采用浅暖或浅中性色背景，标题区/标题文字使用深墨色，主体卡片保持高对比、易读。
3) 强调色控制为 1 种低饱和点缀色，用于数字、关键词、分隔线或局部高亮，避免高饱和撞色和彩虹式渐变。
4) 如需区分层级，优先通过留白、字号、字重和浅深层次解决，不要主要依赖大面积重色块。
5) 整体观感要稳定、专业、偏编辑化，适合中文阅读，不追求花哨插画感。

文章内容：
{content}""",
            "system_prompt": "结论先行，强调对比，尽量使用短句表达；版面保持少而精、单页可读，画面克制统一，适合中文阅读，可采用浅暖底色配深墨标题，并只保留一种低饱和强调色。",
            "response_format": "text",
            "temperature": 0.3,
            "max_tokens": 2200,
            "top_p": 0.9,
            "created_at": today,
            "updated_at": now_iso,
        },
    )


def upgrade() -> None:
    with op.batch_alter_table("ai_analyses") as batch_op:
        if not _has_column("ai_analyses", "infographic_html"):
            batch_op.add_column(sa.Column("infographic_html", sa.Text(), nullable=True))
        if not _has_column("ai_analyses", "infographic_status"):
            batch_op.add_column(
                sa.Column("infographic_status", sa.String(), nullable=True)
            )

    _seed_default_infographic_prompt()


def downgrade() -> None:
    with op.batch_alter_table("ai_analyses") as batch_op:
        if _has_column("ai_analyses", "infographic_status"):
            batch_op.drop_column("infographic_status")
        if _has_column("ai_analyses", "infographic_html"):
            batch_op.drop_column("infographic_html")
