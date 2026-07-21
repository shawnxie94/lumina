"""Helpers for article note (批注) six-line draft parse and material assembly."""

from __future__ import annotations

import json
import re
from typing import Any

DIGEST_LINE_PREFIXES = (
    "这篇文章讲的是",
    "作者最核心的观点是",
    "作者用了",
    "我认为最有价值的是",
    "我不完全认同的是",
    "我准备采取的一个行动是",
)

DIGEST_LINE_KEYS = ("line1", "line2", "line3", "line4", "line5", "line6")

EMPTY_SLOT = "____"


def empty_digest_lines() -> dict[str, str]:
    return {
        "line1": f"{DIGEST_LINE_PREFIXES[0]} {EMPTY_SLOT}",
        "line2": f"{DIGEST_LINE_PREFIXES[1]} {EMPTY_SLOT}",
        "line3": f"{DIGEST_LINE_PREFIXES[2]} {EMPTY_SLOT} 来证明",
        "line4": f"{DIGEST_LINE_PREFIXES[3]} {EMPTY_SLOT}",
        "line5": f"{DIGEST_LINE_PREFIXES[4]} {EMPTY_SLOT}",
        "line6": f"{DIGEST_LINE_PREFIXES[5]} {EMPTY_SLOT}",
    }


def join_digest_lines(lines: dict[str, str]) -> str:
    # Separate paragraphs so Markdown renderers keep six digest lines distinct.
    ordered = [str(lines.get(key) or "").strip() for key in DIGEST_LINE_KEYS]
    return "\n\n".join(item for item in ordered if item)


def _normalize_line_text(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "").strip())


def _strip_prefix(line: str, prefix: str) -> str:
    text = _normalize_line_text(line)
    if text.startswith(prefix):
        return text[len(prefix) :].strip()
    return text


def ensure_line_with_prefix(value: str, prefix: str, *, proof_suffix: bool = False) -> str:
    text = _normalize_line_text(value)
    if not text.startswith(prefix):
        text = f"{prefix} {text}".strip()
    if proof_suffix and not text.endswith("来证明"):
        if text == prefix or text == f"{prefix} {EMPTY_SLOT}":
            text = f"{prefix} {EMPTY_SLOT} 来证明"
    return text


def parse_digest_prefill_result(raw_output: Any) -> dict[str, str]:
    if isinstance(raw_output, dict):
        parsed = raw_output
    else:
        raw_text = str(raw_output or "").strip()
        if not raw_text:
            raise ValueError("digest_prefill 输出为空")
        # tolerate fenced json
        if raw_text.startswith("```"):
            raw_text = re.sub(r"^```(?:json)?\s*", "", raw_text)
            raw_text = re.sub(r"\s*```$", "", raw_text)
        try:
            parsed = json.loads(raw_text)
        except json.JSONDecodeError as exc:
            raise ValueError("digest_prefill 输出不是合法 JSON") from exc

    if not isinstance(parsed, dict):
        raise ValueError("digest_prefill 输出必须是 JSON 对象")

    lines = empty_digest_lines()
    for index, key in enumerate(DIGEST_LINE_KEYS):
        prefix = DIGEST_LINE_PREFIXES[index]
        raw_value = parsed.get(key)
        if raw_value is None:
            raise ValueError(f"digest_prefill 缺少字段 {key}")
        if not isinstance(raw_value, str):
            raise ValueError(f"digest_prefill.{key} 必须是字符串")
        value = _normalize_line_text(raw_value)
        if not value:
            raise ValueError(f"digest_prefill.{key} 不能为空")

        value = ensure_line_with_prefix(
            value,
            prefix,
            proof_suffix=(index == 2),
        )
        body = _strip_prefix(value, prefix)
        if index == 2:
            body = re.sub(r"来证明\s*$", "", body).strip()
        if not body or body == EMPTY_SLOT:
            raise ValueError(f"digest_prefill.{key} 不能为空槽，请生成完整批注句")

        lines[key] = value

    if not lines["line3"].endswith("来证明"):
        body = _strip_prefix(lines["line3"], DIGEST_LINE_PREFIXES[2])
        body = re.sub(r"来证明\s*$", "", body).strip()
        lines["line3"] = f"{DIGEST_LINE_PREFIXES[2]} {body} 来证明"

    return lines


def build_prefill_material(
    *,
    summary: str | None,
    outline: str | None,
    content_md: str | None,
    content_limit: int = 6000,
) -> tuple[str, dict[str, bool]]:
    has_outline = bool(str(outline or "").strip())
    has_summary = bool(str(summary or "").strip())
    content = str(content_md or "").strip()
    has_content = bool(content)

    blocks: list[str] = []
    if has_outline:
        blocks.append(f"【大纲 JSON】\n{str(outline).strip()}")
    if has_summary:
        blocks.append(f"【摘要】\n{str(summary).strip()}")
    if not has_outline and not has_summary and has_content:
        blocks.append(f"【正文摘录】\n{content[:content_limit]}")

    material = "\n\n".join(blocks).strip()
    flags = {
        "has_outline": has_outline,
        "has_summary": has_summary,
        "content_fallback": has_content and not has_outline and not has_summary,
        "has_content": has_content,
    }
    return material, flags
