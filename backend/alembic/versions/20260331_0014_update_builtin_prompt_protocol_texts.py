"""update builtin prompt protocol texts

Revision ID: 20260331_0014
Revises: 20260331_0013
Create Date: 2026-03-31 23:20:00
"""

from __future__ import annotations

from alembic import op
from sqlalchemy import text


# revision identifiers, used by Alembic.
revision = "20260331_0014"
down_revision = "20260331_0013"
branch_labels = None
depends_on = None


PROMPT_UPDATES = [
    {
        "name": "默认-大纲",
        "type": "outline",
        "old_prompt": """请阅读提供的文本，并按指定 JSON 结构提取文章大纲（思维导图友好版）。

要求：
1) 根节点 title 简洁概括主题，可附领域/对象（如“增长策略｜SaaS”）。
2) 核心观点：2-3 个主要立论。
3) 关键概念：用“概念：极简释义”格式。
4) 结论与启示：输出结论与启示；如有明确行动建议，可额外增加“行动：...”节点。
5) 叶子节点不要使用“观点A/概念1”等前缀，直接给内容。
6) 叶子节点建议不超过 30 字，便于缩略图展示。

输出结构（只替换内容）：
{
  "title": "文章标题",
  "children": [
    {
      "title": "核心观点",
      "children": [
        { "title": "核心观点内容" },
        { "title": "核心观点内容" }
      ]
    },
    {
      "title": "关键概念",
      "children": [
        { "title": "概念：极简释义" },
        { "title": "概念：极简释义" }
      ]
    },
    {
      "title": "结论与启示",
      "children": [
        { "title": "结论：..." },
        { "title": "启示：..." },
        { "title": "行动：..." }
      ]
    }
  ]
}

待解析内容：
{content}
""",
        "old_system_prompt": "你是一名结构化数据转换专家，擅长将长篇文章解析为思维导图专用的 JSON 格式。输出必须为合法 JSON，禁止任何解释性文字、开场白、Markdown 代码块。",
        "prompt": """请阅读提供的文本，并提取适合思维导图展示的文章大纲。

要求：
1) 根节点 title 简洁概括主题，可附领域/对象（如“增长策略｜SaaS”）。
2) 核心观点：2-3 个主要立论。
3) 关键概念：用“概念：极简释义”格式。
4) 结论与启示：输出结论与启示；如有明确行动建议，可额外增加“行动：...”节点。
5) 叶子节点不要使用“观点A/概念1”等前缀，直接给内容。
6) 叶子节点建议不超过 30 字，便于缩略图展示。

待解析内容：
{content}
""",
        "system_prompt": "你是一名结构化内容整理助手，擅长将长篇文章压缩为层级清晰、便于思维导图展示的知识结构。",
    },
    {
        "name": "默认-分类",
        "type": "classification",
        "old_prompt": """请根据以下文章内容与分类列表选择最匹配的分类。

硬性要求：
1) 仅输出分类 ID（UUID），不要输出任何解释或多余字符。
2) 若无合适分类输出空字符串。
3) 只允许输出分类列表中出现的 ID。

分类列表：
{categories}

文章内容：
{content}""",
        "old_system_prompt": "你是内容分类助手，只输出分类 ID。",
        "prompt": """请根据以下文章内容与分类列表选择最匹配的分类。

硬性要求：
1) 只能在提供的分类列表中做选择。
2) 若无合适分类，明确判定为空分类。
3) 优先依据文章主题、主体对象、核心意图和主要讨论范围判断。

分类列表：
{categories}

文章内容：
{content}""",
        "system_prompt": "你是内容分类助手，擅长依据主题边界和讨论重点做最匹配的分类判断。",
    },
    {
        "name": "默认-内容校验",
        "type": "content_validation",
        "old_prompt": """你是内容质检员，只输出 JSON。

硬性要求：
1) 仅输出 JSON，不要解释/Markdown 代码块。
2) JSON 结构：{"is_valid": true/false, "error": "错误原因"}。
3) 若合规：is_valid=true，error 为空字符串。
4) 若不合规：is_valid=false，error 使用“错误类型：说明”格式，错误类型仅限以下之一：空内容、广告/导航、结构混乱、格式异常、语言混杂、其他。
5) 合规标准：必须包含正文内容；标题/段落格式合理；无明显广告/导航；无空输出。

待校验内容：
{content}""",
        "old_system_prompt": "你是内容质检员，只输出 JSON。",
        "prompt": """你是内容质检员，请判断内容是否合规。

硬性要求：
1) 若内容合规，错误信息应为空。
2) 若不合规，错误原因使用“错误类型：说明”格式，错误类型仅限以下之一：空内容、广告/导航、结构混乱、格式异常、语言混杂、其他。
3) 合规标准：必须包含正文内容；标题/段落格式合理；无明显广告/导航；无空输出。

待校验内容：
{content}""",
        "system_prompt": "你是内容质检员，擅长根据正文完整性、结构质量和噪音程度做严格判断。",
    },
    {
        "name": "默认-标签",
        "type": "tagging",
        "old_prompt": """请根据以下文章内容生成 3-5 个中文标签。

硬性要求：
1) 仅输出 JSON 数组，例如 [\"AI 产品\", \"浏览器插件\", \"知识管理\"]。
2) 不能输出解释、Markdown 代码块或额外文字。
3) 标签要具体、可检索、信息密度高，避免“文章/内容/思考”等空泛词。
4) 尽量避免与参考分类完全重复，除非它本身就是最关键标签。
5) 每个标签不超过 5 个字。

参考分类：{category_name}

文章内容：
{content}""",
        "old_system_prompt": "你是内容标签助手，只输出 JSON 数组。",
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
    },
]


def upgrade() -> None:
    conn = op.get_bind()
    for item in PROMPT_UPDATES:
        conn.execute(
            text(
                """
                UPDATE prompt_configs
                SET prompt = :prompt,
                    system_prompt = :system_prompt
                WHERE type = :type
                  AND name = :name
                  AND category_id IS NULL
                  AND model_api_config_id IS NULL
                  AND prompt = :old_prompt
                  AND COALESCE(system_prompt, '') = COALESCE(:old_system_prompt, '')
                """
            ),
            item,
        )


def downgrade() -> None:
    # 文案型数据迁移不回滚，避免覆盖用户可能已手动调整的提示词内容。
    return None
