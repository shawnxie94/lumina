from __future__ import annotations

import hashlib
import json
import re
from typing import Any

EN_LANGS = {"en", "english", "en-us", "en-gb", "en_us", "en_gb"}
TAG_RE = re.compile(r"<[^>]+>")
WS_RE = re.compile(r"\s+")


def _is_english(article: dict[str, Any]) -> bool:
    lang = str(article.get("original_language") or "").strip().lower()
    if lang in EN_LANGS:
        return True
    return False


def _html_to_text(html: str) -> str:
    text = TAG_RE.sub("\n", html or "")
    text = text.replace("&nbsp;", " ").replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">")
    return WS_RE.sub(" ", text).strip()


def select_export_body(article: dict[str, Any]) -> dict[str, str]:
    title = str(article.get("title") or "").strip()
    title_trans = str(article.get("title_trans") or "").strip()
    content_md = str(article.get("content_md") or "").strip()
    content_html = str(article.get("content_html") or "").strip()
    content_trans = str(article.get("content_trans") or "").strip()
    translation_status = str(article.get("translation_status") or "").strip().lower()

    if _is_english(article) and translation_status == "completed" and content_trans:
        return {
            "title": title_trans or title,
            "body": content_trans,
            "body_language": "zh",
            "body_source": "content_trans",
            "translation_fallback": "false",
        }

    if content_md:
        body = content_md
        body_source = "content_md"
    elif content_html:
        body = _html_to_text(content_html)
        body_source = "content_html"
    elif content_trans:
        body = content_trans
        body_source = "content_trans"
    else:
        body = ""
        body_source = "none"

    return {
        "title": title,
        "body": body,
        "body_language": str(article.get("original_language") or "unknown"),
        "body_source": body_source,
        "translation_fallback": "false",
    }


def body_hash(title: str, body: str) -> str:
    digest = hashlib.sha256()
    digest.update(title.encode("utf-8"))
    digest.update(b"\n")
    digest.update(body.encode("utf-8"))
    return digest.hexdigest()


def slugify_filename(value: str) -> str:
    text = (value or "").strip().lower()
    text = re.sub(r"[\s_]+", "-", text)
    text = re.sub(r"[^a-z0-9\u4e00-\u9fff-]+", "", text)
    text = re.sub(r"-{2,}", "-", text).strip("-")
    return (text or "article")[:80]



def topic_fingerprint(topic: dict[str, Any]) -> str:
    """Stable content fingerprint for wiki topic writeback dedupe."""
    related = topic.get("related_topic_keys") or []
    if not isinstance(related, list):
        related = []
    article_ids = topic.get("article_ids") or []
    if not isinstance(article_ids, list):
        article_ids = []
    tags = topic.get("tags") or []
    if not isinstance(tags, list):
        tags = []
    claims = topic.get("claims") or []
    claim_texts: list[str] = []
    if isinstance(claims, list):
        for claim in claims:
            if isinstance(claim, dict):
                claim_text = str(claim.get("text") or "").strip()
            else:
                claim_text = str(claim or "").strip()
            if claim_text:
                claim_texts.append(claim_text)

    payload = {
        "key": str(topic.get("key") or "").strip(),
        "title": str(topic.get("title") or "").strip(),
        "content_md": str(topic.get("content_md") or ""),
        "tags": sorted(str(item).strip() for item in tags if str(item).strip()),
        "status": str(topic.get("status") or "active").strip() or "active",
        "topic_type": str(topic.get("topic_type") or "").strip(),
        "article_ids": sorted(str(item).strip() for item in article_ids if str(item).strip()),
        "related_topic_keys": sorted(
            str(item).strip() for item in related if str(item).strip()
        ),
        "claims": claim_texts,
        "compiler_ref": str(topic.get("compiler_ref") or "").strip(),
    }
    raw = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def article_topic_set_fingerprint(topic_keys: list[str] | tuple[str, ...] | set[str]) -> str:
    keys = sorted({str(item).strip() for item in topic_keys if str(item).strip()})
    raw = json.dumps(keys, ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()
