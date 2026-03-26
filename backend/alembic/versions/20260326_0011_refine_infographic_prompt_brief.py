"""refine infographic default prompt copy

Revision ID: 20260326_0011
Revises: 20260325_0010
Create Date: 2026-03-26 17:10:00

"""

from __future__ import annotations

from alembic import op
from sqlalchemy import text

# revision identifiers, used by Alembic.
revision = "20260326_0011"
down_revision = "20260325_0010"
branch_labels = None
depends_on = None


FINAL_PROMPT = """请将文章提炼成一张单页中文信息图，突出内容结构、信息层级、布局组织与视觉风格。

建议采用以下组织方式：
1) 顶部标题区：一句主题结论 + 一句背景或适用范围。
2) 主体区优先 2 个核心信息卡；如确有必要可扩展到 3 个，但不要更多。
3) 结尾保留一个行动建议 / 启示 / 适用场景区。
4) 优先提炼“读者最该记住的观点、步骤、对比或清单”，避免铺陈原文细节。
5) 如果文章更适合其他信息结构，可明确改成双列对比、时间线、步骤流、矩阵卡片等版式。

视觉风格建议：
1) 配色统一克制，优先围绕单一主色体系展开，不要让每个区块各用一套颜色。
2) 建议采用浅暖或浅中性色背景，标题区/标题文字使用深墨色，主体卡片保持高对比、易读。
3) 强调色控制为 1 种低饱和点缀色，用于数字、关键词、分隔线或局部高亮，避免高饱和撞色和彩虹式渐变。
4) 如需区分层级，优先通过留白、字号、字重和浅深层次解决，不要主要依赖大面积重色块。
5) 整体观感要稳定、专业、偏编辑化，适合中文阅读，不追求花哨插画感。

文章内容：
{content}"""

PREVIOUS_FINAL_PROMPT = """请将文章提炼成一张单页中文信息图，突出内容结构、信息层级、布局组织与视觉风格。

建议采用以下组织方式：
1) 顶部标题区：一句主题结论 + 一句背景或适用范围。
2) 主体区优先 3 个核心信息卡；如确有必要可扩展到 4 个，但不要更多。
3) 结尾保留一个行动建议 / 启示 / 适用场景区。
4) 优先提炼“读者最该记住的观点、步骤、对比或清单”，避免铺陈原文细节。
5) 如果文章更适合其他信息结构，可明确改成双列对比、时间线、步骤流、矩阵卡片等版式。

视觉风格建议：
1) 配色统一克制，优先围绕单一主色体系展开，不要让每个区块各用一套颜色。
2) 建议采用浅暖或浅中性色背景，标题区/标题文字使用深墨色，主体卡片保持高对比、易读。
3) 强调色控制为 1 种低饱和点缀色，用于数字、关键词、分隔线或局部高亮，避免高饱和撞色和彩虹式渐变。
4) 如需区分层级，优先通过留白、字号、字重和浅深层次解决，不要主要依赖大面积重色块。
5) 整体观感要稳定、专业、偏编辑化，适合中文阅读，不追求花哨插画感。

文章内容：
{content}"""

FINAL_SYSTEM_PROMPT = (
    "结论先行，强调对比，尽量使用短句表达；版面保持少而精、单页可读，画面克制统一，适合中文阅读，可采用浅暖底色配深墨标题，并只保留一种低饱和强调色。"
)
PREVIOUS_FINAL_SYSTEM_PROMPT = (
    "结论先行，强调对比，尽量使用短句表达；画面保持克制统一，适合中文阅读，可采用浅暖底色配深墨标题，并只保留一种低饱和强调色。"
)


def upgrade() -> None:
    conn = op.get_bind()
    conn.execute(
        text(
            """
            UPDATE prompt_configs
            SET prompt = :new_prompt,
                system_prompt = :new_system_prompt,
                updated_at = CURRENT_TIMESTAMP
            WHERE type = 'infographic'
              AND name = '默认-信息图'
              AND prompt = :old_prompt
              AND system_prompt = :old_system_prompt
            """
        ),
        {
            "new_prompt": FINAL_PROMPT,
            "new_system_prompt": FINAL_SYSTEM_PROMPT,
            "old_prompt": PREVIOUS_FINAL_PROMPT,
            "old_system_prompt": PREVIOUS_FINAL_SYSTEM_PROMPT,
        },
    )


def downgrade() -> None:
    return None
