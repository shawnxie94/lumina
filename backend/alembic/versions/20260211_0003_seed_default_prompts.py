"""seed built-in default prompts

Revision ID: 20260211_0003
Revises: 20260210_0002
Create Date: 2026-02-11 19:30:00

"""

from __future__ import annotations

from datetime import date
import uuid

from alembic import op
from sqlalchemy import text

# revision identifiers, used by Alembic.
revision = "20260211_0003"
down_revision = "20260210_0002"
branch_labels = None
depends_on = None


DEFAULT_PROMPT_CONFIGS = [
    {
        "name": "默认-快读摘要",
        "type": "summary",
        "prompt": """为提供的文本创作一份“快读摘要”，旨在让读者在30秒内掌握核心情报。

要求：
1) 极简主义：剔除背景铺垫、案例细节、营销话术及修饰性词汇，直奔主题。
2) 内容密度：必须包含核心主体、关键动作/事件、最终影响/结论。
3) 篇幅：严格控制在50-150字之间。

待摘要内容：
{content}""",
        "system_prompt": "你是一名资深内容分析师，擅长用最极简的语言精准捕捉文章灵魂。输出必须为中文、客观、单段长句（可用逗号、句号，禁止分段/换行），禁止任何列表符号（- * 1.等），禁止出现“这篇文章讲了/摘要如下”等前置废话。",
        "response_format": "text",
        "temperature": 0.3,
        "max_tokens": 400,
        "top_p": 1.0,
    },
    {
        "name": "默认-总结",
        "type": "key_points",
        "prompt": """请阅读提供的文本内容，生成一份干练、客观的中文总结。

要求：
1) 彻底去噪：剔除营销推广、招聘信息、课程宣传、免责声明、社交媒体引导语等无关内容。
2) 聚焦核心：只保留核心观点、关键事实与重要结论。
3) 逻辑重构：不要摘抄原句，重组语言，信息密度高、行文连贯。
4) 段落衔接：段落内自然衔接（可用"此外/另一方面/综上所述"等连接词）。
5) 格式强化：善用 Markdown 格式突出关键信息，具体规则如下：
   - **加粗**：用于核心概念、关键术语、重要人名/机构名、关键数据（如"**GDP 增长 5.2%**"、"**OpenAI**"）。
   - *斜体*：用于需要特别区分或存在争议/不确定性的表述（如"*据未经证实的消息*"、"*该观点尚存分歧*"），也可用于对比场景中标注对立面。
   - **加粗 + 斜体结合**（***文字***）：仅用于全文最核心的结论或转折性判断，不超过 1–2 处。

字数：300–500 字。

待总结内容：
{content}
""",
        "system_prompt": "你是一名资深内容分析师，擅长从复杂信息中剥离噪音，提取核心价值并进行专业重构。输出必须为中文、客观、无主观评价；禁止任何开场白/结束语或解释性文字；严禁使用任何列表符号；段落数量严格控制在2-3段。",
        "response_format": "text",
        "temperature": 0.4,
        "max_tokens": 1000,
        "top_p": 0.9,
    },
    {
        "name": "默认-中英翻译",
        "type": "translation",
        "prompt": """将输入的英文文章翻译成中文。

要求：
1) 严格保留原始 Markdown 格式（标题、列表、链接、代码块、换行等）。
2) 专业术语使用业界通用中文表达，必要时可在中文后保留英文原词。
3) 语言风格地道、通顺，避免翻译腔。
4) 只输出译文，不要前后缀。

请直接开始翻译：
{content}""",
        "system_prompt": "你是一位精通中英文互译的专业翻译官，擅长科技、文化及商业领域的信达雅翻译。必须仅输出中文译文，禁止任何额外话语。",
        "response_format": "text",
        "temperature": 0.2,
        "max_tokens": 14000,
        "top_p": 1.0,
    },
    {
        "name": "默认-大纲",
        "type": "outline",
        "prompt": """请阅读提供的文本，并按指定 JSON 结构提取文章大纲（思维导图友好版）。

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
        "system_prompt": "你是一名结构化数据转换专家，擅长将长篇文章解析为思维导图专用的 JSON 格式。输出必须为合法 JSON，禁止任何解释性文字、开场白、Markdown 代码块。",
        "response_format": "json_object",
        "temperature": 0.3,
        "max_tokens": 1200,
        "top_p": 1.0,
    },
    {
        "name": "默认-干练总结",
        "type": "summary_long",
        "prompt": """请阅读提供的文本内容，生成一份干练、客观的中文总结。

要求：
1) 彻底去噪：剔除营销推广、招聘信息、课程宣传、免责声明、社交媒体引导语等无关内容。
2) 聚焦核心：只保留核心观点、关键事实与重要结论。
3) 逻辑重构：不要摘抄原句，重组语言，信息密度高、行文连贯。
4) 段落内自然衔接（可用“此外/另一方面/综上所述”等连接词）。

字数：300–500字。

待总结内容：
{content}""",
        "system_prompt": "你是一名资深内容分析师，擅长从复杂信息中剥离噪音，提取核心价值并进行专业重构。输出必须为中文、客观、无主观评价；禁止任何开场白/结束语或解释性文字；严禁使用任何列表符号；段落数量严格控制在2-3段。",
        "response_format": "text",
        "temperature": 0.4,
        "max_tokens": 1000,
        "top_p": 0.9,
    },
    {
        "name": "默认-金句",
        "type": "quotes",
        "prompt": """请阅读提供的文本内容，从中筛选并提炼出最具有传播力、深度或启发性的金句。

要求：
1) 标准：深刻性、共鸣感、精炼性。
2) 拒绝平庸：不要事实陈述句，选择观点句/结论句/修辞优美的句子。
3) 允许润色：可在不改变原意下微调，使其更像独立名言。
4) 多样化：覆盖不同维度（趋势判断/价值坚守/行动号召等）。

输出格式：
- 使用无序列表（-），每句单独一行
- 数量 3-5 条
- 仅输出金句列表，不要解释

待提炼内容：
{content}""",
        "system_prompt": "你是一名资深文案金句捕手，擅长从长篇内容中提炼传播力强的金句。输出必须为中文，仅输出金句列表，不要任何解释或前后缀。",
        "response_format": "text",
        "temperature": 0.7,
        "max_tokens": 700,
        "top_p": 1.0,
    },
    {
        "name": "默认-分类",
        "type": "classification",
        "prompt": """请根据以下文章内容与分类列表选择最匹配的分类。

硬性要求：
1) 仅输出分类 ID（UUID），不要输出任何解释或多余字符。
2) 若无合适分类输出空字符串。
3) 只允许输出分类列表中出现的 ID。

分类列表：
{categories}

文章内容：
{content}""",
        "system_prompt": "你是内容分类助手，只输出分类 ID。",
        "response_format": "text",
        "temperature": 0.1,
        "max_tokens": 200,
        "top_p": 0.9,
    },
    {
        "name": "默认-内容校验",
        "type": "content_validation",
        "prompt": """你是内容质检员，只输出 JSON。

硬性要求：
1) 仅输出 JSON，不要解释/Markdown 代码块。
2) JSON 结构：{"is_valid": true/false, "error": "错误原因"}。
3) 若合规：is_valid=true，error 为空字符串。
4) 若不合规：is_valid=false，error 使用“错误类型：说明”格式，错误类型仅限以下之一：空内容、广告/导航、结构混乱、格式异常、语言混杂、其他。
5) 合规标准：必须包含正文内容；标题/段落格式合理；无明显广告/导航；无空输出。

待校验内容：
{content}""",
        "system_prompt": "你是内容质检员，只输出 JSON。",
        "response_format": "json_object",
        "temperature": 0.0,
        "max_tokens": 800,
        "top_p": 1.0,
    },
    {
        "name": "默认-内容清洗",
        "type": "content_cleaning",
        "prompt": """请将以下 HTML 内容清洗为结构化的 GFM Markdown。

硬性要求：
1) 仅输出 Markdown 正文，禁止任何解释/前后缀。
2) 必须保留：标题层级、列表、引用、表格、链接、图片、代码块、段落换行。
3) 必须去除：导航、广告、版权声明、推荐阅读、分享按钮、评论区、相关链接、页脚。
4) 不要改写内容，只做结构化与去噪。
5) 链接使用标准 Markdown 形式，图片使用 ![]()。

HTML：
{content}""",
        "system_prompt": "你是严谨的内容清洗专家，专注输出稳定、结构化的 GFM Markdown。",
        "response_format": "text",
        "temperature": 0.1,
        "max_tokens": 12000,
        "top_p": 1.0,
    },
]


INSERT_SQL = text(
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
        1,
        1,
        :created_at,
        :updated_at
    )
    """
)


def upgrade() -> None:
    bind = op.get_bind()
    existing_count = bind.execute(text("SELECT COUNT(*) FROM prompt_configs")).scalar()
    if existing_count and int(existing_count) > 0:
        return

    today = date.today().isoformat()
    for item in DEFAULT_PROMPT_CONFIGS:
        bind.execute(
            INSERT_SQL,
            {
                "id": str(uuid.uuid4()),
                "name": item["name"],
                "type": item["type"],
                "prompt": item["prompt"],
                "system_prompt": item["system_prompt"],
                "response_format": item["response_format"],
                "temperature": item["temperature"],
                "max_tokens": item["max_tokens"],
                "top_p": item["top_p"],
                "created_at": today,
                "updated_at": today,
            },
        )


def downgrade() -> None:
    bind = op.get_bind()
    for item in DEFAULT_PROMPT_CONFIGS:
        bind.execute(
            text(
                """
                DELETE FROM prompt_configs
                WHERE category_id IS NULL
                  AND is_default = 1
                  AND model_api_config_id IS NULL
                  AND type = :type
                  AND name = :name
                """
            ),
            {"type": item["type"], "name": item["name"]},
        )
