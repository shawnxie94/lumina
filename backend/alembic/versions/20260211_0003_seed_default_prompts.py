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
        "prompt": """创作一份“快读摘要”，旨在让读者在30秒内掌握核心情报。

要求：
1) 输出必须为中文、客观、单段长句，可用逗号和句号，禁止分段或换行。
2) 禁止任何列表符号（-、*、1. 等），禁止出现“这篇文章讲了”“摘要如下”等前置废话。
3) 极简主义：剔除背景铺垫、案例细节、营销话术及修饰性词汇，直奔主题。
4) 内容密度：必须覆盖（a）文章主题，技术文语境下优先写清“解决了什么问题”；（b）核心结论/结果或最终影响。
5) 聚焦主题与结论，不要展开完整论证链或细节步骤。
6) 篇幅：严格控制在50-150字之间。""",
        "system_prompt": "你是一名资深内容分析师，擅长用最极简的语言精准捕捉文章主题/问题与核心结论。",
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

6) 输出必须为中文、客观、无主观评价，禁止任何开场白/结束语或解释性文字。
7) 严禁使用任何列表符号，段落数量严格控制在2-3段。

字数：300–500 字。""",
        "system_prompt": "你是一名资深内容分析师，擅长从复杂信息中剥离噪音，提取核心价值并进行专业重构。",
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
4) 必须仅输出中文译文，禁止任何额外话语、解释或前后缀。""",
        "system_prompt": "你是一位精通中英文互译的专业翻译官，擅长科技、文化及商业领域的信达雅翻译。",
        "response_format": "text",
        "temperature": 0.2,
        "max_tokens": 14000,
        "top_p": 1.0,
    },
    {
        "name": "默认-大纲",
        "type": "outline",
        "prompt": """提取适合思维导图展示的文章大纲，帮助读者客观吃透结构。

要求：
1) 根节点 title 简洁概括主题，可附领域/对象（如“增长策略｜SaaS”）。
2) 根下第一层（L1）必须且仅使用以下三个固定分区标题，title 原文一致、顺序固定：
   - 核心观点
   - 关键概念
   - 结论与启示
3) 「核心观点」：用 2-3 个子节点写主要立论；每个立论下最多再嵌一层，补充作者如何展开/证明（数据、案例、步骤、对比等，按文取材）。信息不足写“证明链不清晰”，禁止编造。
4) 「关键概念」：列出读懂本文必需的术语或机制，叶子用“概念：极简释义”；无则 children 为空数组，不要硬凑。
5) 「结论与启示」：写结论与启示；有明确行动建议时可加“行动：...”叶子。
6) 禁止把正文小标题/模块名提升为 L1；L1 只能是上述三分区，内容放在分区之下。
7) 控制体量：全树建议不超过约 25 个节点；叶子建议不超过 30 字；不要使用“观点A/概念1”等前缀。""",
        "system_prompt": "你是一名结构化内容整理助手，擅长把长文压缩为「主题 → 固定三分区（核心观点/关键概念/结论与启示）」的知识结构，便于扫读与吃透。",
        "response_format": "json_object",
        "temperature": 0.3,
        "max_tokens": 3000,
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
5) 输出必须为中文、客观、无主观评价，禁止任何开场白/结束语或解释性文字。
6) 严禁使用任何列表符号，段落数量严格控制在2-3段。

字数：300–500字。""",
        "system_prompt": "你是一名资深内容分析师，擅长从复杂信息中剥离噪音，提取核心价值并进行专业重构。",
        "response_format": "text",
        "temperature": 0.4,
        "max_tokens": 1000,
        "top_p": 0.9,
    },
    {
        "name": "默认-金句",
        "type": "quotes",
        "prompt": """筛选并提炼出最具有传播力、深度或启发性的金句。

要求：
1) 标准：深刻性、共鸣感、精炼性。
2) 拒绝平庸：不要事实陈述句，选择观点句/结论句/修辞优美的句子。
3) 允许润色：可在不改变原意下微调，使其更像独立名言。
4) 多样化：覆盖不同维度（趋势判断/价值坚守/行动号召等）。
5) 数量 3-5 条。
6) 输出必须为中文，不要任何解释或前后缀。""",
        "system_prompt": "你是一名资深文案金句捕手，擅长从长篇内容中提炼传播力强的金句。",
        "response_format": "text",
        "temperature": 0.7,
        "max_tokens": 700,
        "top_p": 1.0,
    },
    {
        "name": "默认-分类",
        "type": "classification",
        "prompt": """根据文章内容与分类列表选择最匹配的分类。

硬性要求：
1) 只能在提供的分类列表中做选择。
2) 若无合适分类，明确判定为空分类。
3) 优先依据文章主题、主体对象、核心意图和主要讨论范围判断。""",
        "system_prompt": "你是内容分类助手，擅长依据主题边界和讨论重点做最匹配的分类判断。",
        "response_format": "text",
        "temperature": 0.1,
        "max_tokens": 200,
        "top_p": 0.9,
    },
    {
        "name": "默认-内容校验",
        "type": "content_validation",
        "prompt": """你是内容质检员，请判断内容是否合规。

硬性要求：
1) 若内容合规，错误信息应为空。
2) 若不合规，错误原因使用“错误类型：说明”格式，错误类型仅限以下之一：空内容、广告/导航、结构混乱、格式异常、语言混杂、其他。
3) 合规标准：必须包含正文内容；标题/段落格式合理；无明显广告/导航；无空输出。""",
        "system_prompt": "你是内容质检员，擅长根据正文完整性、结构质量和噪音程度做严格判断。",
        "response_format": "json_object",
        "temperature": 0.0,
        "max_tokens": 800,
        "top_p": 1.0,
    },
    {
        "name": "默认-内容清洗",
        "type": "content_cleaning",
        "prompt": """将运行时提供的 HTML 或 Markdown 内容清洗为结构化的 GFM Markdown。

硬性要求：
1) 仅输出 Markdown 正文，禁止任何解释/前后缀。
2) 必须保留：标题层级、列表、引用、表格、链接、图片、代码块、段落换行。
3) 必须去除：导航、广告、版权声明、推荐阅读、分享按钮、评论区、相关链接、页脚。
4) 不要改写内容，只做结构化与去噪。
5) 链接使用标准 Markdown 形式，图片使用 ![]()。
6) 若内容中包含视频/音频，必须保留其链接；视频使用 [▶ 标题](URL)，音频使用 [🎧 标题](URL)。
7) 若内容中包含数学公式，必须完整保留，不得改写；行内公式使用 $...$，独立公式使用 $$...$$。""",
        "system_prompt": "你是严谨的内容清洗专家，专注输出稳定、结构化的 GFM Markdown。",
        "response_format": "text",
        "temperature": 0.1,
        "max_tokens": 12000,
        "top_p": 1.0,
    },
    {
        "name": "默认-批注",
        "type": "digest_prefill",
        "prompt": """根据下方提供的文章客观材料，生成完整的六句批注草稿，供用户再编辑。

固定六句模板（每句都必须生成完整内容，不要只填 ____）：
这篇文章讲的是 ____
作者最核心的观点是 ____
作者用了 ____ 来证明
我认为最有价值的是 ____
我不完全认同的是 ____
我准备采取的一个行动是 ____

硬性要求：
1) 仅依据下方已给出的客观材料作答；材料中带有大纲/摘要标签时，优先依据这些结构化内容，正文摘录仅在细节不足时参考。
2) line1-line3 填写客观理解：主题/问题、核心观点、证明或展开方式。
3) line4-line6 给出克制、可改写的个人化草稿：最有价值点、保留意见、可执行行动。
4) 六句都必须以对应固定中文前缀开头，且前缀后内容非空，禁止只输出 ____。
5) 每句一句话为主，prefix 后建议 20–60 字，单句尽量不超过 80 字；禁止长段落堆砌与列表。
6) 禁止编造材料中不存在的关键数据/案例；信息不足时用审慎表述。""",
        "system_prompt": "你是阅读批注助手，负责根据给定材料生成完整且克制的六句批注草稿；每句短而可改，帮助用户快速形成笔记。",
        "response_format": "json_object",
        "temperature": 0.3,
        "max_tokens": 1000,
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
