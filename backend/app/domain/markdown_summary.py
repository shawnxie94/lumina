from __future__ import annotations

import re


def derive_summary_from_markdown(content_md: str | None, *, limit: int = 180) -> str | None:
    """Derive a short plain-text summary from markdown body.

    Shared by topic API serialization. Intentionally conservative: skip headings,
    tables and code fences, strip simple markdown markers/links.
    """
    chunks = [
        part.strip()
        for part in re.split(r"\n\s*\n", content_md or "")
        if part.strip()
    ]
    for chunk in chunks:
        if chunk.startswith("#"):
            continue
        if chunk.startswith("|"):
            continue
        if chunk.startswith("```"):
            continue
        text = re.sub(r"!\[[^\]]*\]\([^)]+\)", " ", chunk)
        text = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", text)
        text = re.sub(r"[`*_>#]+", " ", text)
        text = re.sub(r"\s+", " ", text).strip(" -\n\t")
        if text:
            return text[:limit]
    return None
