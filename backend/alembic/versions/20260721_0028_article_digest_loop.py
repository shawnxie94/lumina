"""article digest loop: outline default, prompts, digest prefill

Revision ID: 20260721_0028
Revises: 20260721_0027
Create Date: 2026-07-21 16:40:00

Consolidated (was 0028-0034 iteration slices before production):
- default auto_ai_outline_enabled on
- default summary / outline / digest_prefill prompt texts
- outline default max_tokens floor 3000
- digest_prefill type as 默认-批注 (full six-line draft; wire format in code)
"""

from __future__ import annotations

import uuid
from datetime import date

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect, text


revision = "20260721_0028"
down_revision = "20260721_0027"
branch_labels = None
depends_on = None


SUMMARY_PROMPT = """创作一份“快读摘要”，旨在让读者在30秒内掌握核心情报。

要求：
1) 输出必须为中文、客观、单段长句，可用逗号和句号，禁止分段或换行。
2) 禁止任何列表符号（-、*、1. 等），禁止出现“这篇文章讲了”“摘要如下”等前置废话。
3) 极简主义：剔除背景铺垫、案例细节、营销话术及修饰性词汇，直奔主题。
4) 内容密度：必须覆盖（a）文章主题，技术文语境下优先写清“解决了什么问题”；（b）核心结论/结果或最终影响。
5) 聚焦主题与结论，不要展开完整论证链或细节步骤。
6) 篇幅：严格控制在50-150字之间。"""

SUMMARY_SYSTEM = "你是一名资深内容分析师，擅长用最极简的语言精准捕捉文章主题/问题与核心结论。"

OUTLINE_PROMPT = """提取适合思维导图展示的文章大纲，帮助读者客观吃透结构。

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
7) 控制体量：全树建议不超过约 25 个节点；叶子建议不超过 30 字；不要使用“观点A/概念1”等前缀。"""

OUTLINE_SYSTEM = "你是一名结构化内容整理助手，擅长把长文压缩为「主题 → 固定三分区（核心观点/关键概念/结论与启示）」的知识结构，便于扫读与吃透。"

DIGEST_PROMPT = """根据下方提供的文章客观材料，生成完整的六句批注草稿，供用户再编辑。

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
6) 禁止编造材料中不存在的关键数据/案例；信息不足时用审慎表述。"""

DIGEST_SYSTEM = "你是阅读批注助手，负责根据给定材料生成完整且克制的六句批注草稿；每句短而可改，帮助用户快速形成笔记。"

OUTLINE_MAX_TOKENS = 3000


def _table_names(inspector: sa.Inspector) -> set[str]:
    return set(inspector.get_table_names())


def _column_names(inspector: sa.Inspector, table_name: str) -> set[str]:
    return {column["name"] for column in inspector.get_columns(table_name)}


def _update_default_prompt(
    bind,
    *,
    name: str,
    prompt_type: str,
    prompt: str,
    system_prompt: str,
    max_tokens: int | None = None,
) -> None:
    if max_tokens is None:
        bind.execute(
            text(
                """
                UPDATE prompt_configs
                SET prompt = :prompt,
                    system_prompt = :system_prompt,
                    updated_at = :updated_at
                WHERE category_id IS NULL
                  AND is_default = 1
                  AND type = :type
                  AND name = :name
                """
            ),
            {
                "prompt": prompt,
                "system_prompt": system_prompt,
                "updated_at": date.today().isoformat(),
                "type": prompt_type,
                "name": name,
            },
        )
        return

    bind.execute(
        text(
            """
            UPDATE prompt_configs
            SET prompt = :prompt,
                system_prompt = :system_prompt,
                max_tokens = CASE
                    WHEN max_tokens IS NULL OR max_tokens < :max_tokens THEN :max_tokens
                    ELSE max_tokens
                END,
                updated_at = :updated_at
            WHERE category_id IS NULL
              AND is_default = 1
              AND type = :type
              AND name = :name
            """
        ),
        {
            "prompt": prompt,
            "system_prompt": system_prompt,
            "max_tokens": max_tokens,
            "updated_at": date.today().isoformat(),
            "type": prompt_type,
            "name": name,
        },
    )


def _upsert_digest_prompt(bind, inspector: sa.Inspector) -> None:
    columns = _column_names(inspector, "prompt_configs")
    today = date.today().isoformat()

    bind.execute(
        text(
            """
            UPDATE prompt_configs
            SET name = :new_name,
                prompt = :prompt,
                system_prompt = :system_prompt,
                temperature = COALESCE(temperature, 0.3),
                max_tokens = CASE
                    WHEN max_tokens IS NULL OR max_tokens < 1000 THEN 1000
                    ELSE max_tokens
                END,
                is_enabled = 1,
                is_default = 1,
                updated_at = :updated_at
            WHERE category_id IS NULL
              AND type = 'digest_prefill'
              AND is_default = 1
            """
        ),
        {
            "new_name": "默认-批注",
            "prompt": DIGEST_PROMPT,
            "system_prompt": DIGEST_SYSTEM,
            "updated_at": today,
        },
    )

    exists = bind.execute(
        text(
            """
            SELECT id FROM prompt_configs
            WHERE category_id IS NULL AND type = 'digest_prefill'
            LIMIT 1
            """
        )
    ).fetchone()
    if exists:
        return

    values = {
        "id": str(uuid.uuid4()),
        "name": "默认-批注",
        "category_id": None,
        "type": "digest_prefill",
        "prompt": DIGEST_PROMPT,
        "system_prompt": DIGEST_SYSTEM,
        "temperature": 0.3,
        "max_tokens": 1000,
        "is_enabled": 1,
        "is_default": 1,
        "created_at": today,
        "updated_at": today,
    }
    if "response_format" in columns:
        values["response_format"] = "json_object"
    if "top_p" in columns:
        values["top_p"] = 1.0

    field_sql = ", ".join(values.keys())
    placeholders = ", ".join(f":{key}" for key in values.keys())
    bind.execute(
        text(f"INSERT INTO prompt_configs ({field_sql}) VALUES ({placeholders})"),
        values,
    )


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    tables = _table_names(inspector)

    if "admin_settings" in tables:
        columns = _column_names(inspector, "admin_settings")
        if "auto_ai_outline_enabled" in columns:
            op.execute(
                "UPDATE admin_settings SET auto_ai_outline_enabled = 1"
            )

    if "prompt_configs" not in tables:
        return

    _update_default_prompt(
        bind,
        name="默认-快读摘要",
        prompt_type="summary",
        prompt=SUMMARY_PROMPT,
        system_prompt=SUMMARY_SYSTEM,
    )
    _update_default_prompt(
        bind,
        name="默认-大纲",
        prompt_type="outline",
        prompt=OUTLINE_PROMPT,
        system_prompt=OUTLINE_SYSTEM,
        max_tokens=OUTLINE_MAX_TOKENS,
    )
    _upsert_digest_prompt(bind, inspector)


def downgrade() -> None:
    # Intentional no-op: prompt text / outline default are product content.
    return
