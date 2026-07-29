from __future__ import annotations

from typing import Any

from .export_body import article_topic_set_fingerprint, topic_fingerprint
from .state import BridgeState


def filter_changed_topics(
    topics: list[dict[str, Any]],
    state: BridgeState,
    *,
    force: bool = False,
) -> tuple[list[dict[str, Any]], dict[str, str], dict[str, Any]]:
    """Return topics that need writeback plus next topic hash map and counters."""
    changed: list[dict[str, Any]] = []
    next_hashes: dict[str, str] = {}
    unchanged = 0
    for topic in topics:
        if not isinstance(topic, dict):
            continue
        key = str(topic.get("key") or "").strip()
        if not key:
            continue
        digest = topic_fingerprint(topic)
        next_hashes[key] = digest
        if not force and state.topic_hashes.get(key) == digest:
            unchanged += 1
            continue
        changed.append(topic)
    stats = {
        "scanned_topics": len(next_hashes),
        "changed_topics": len(changed),
        "unchanged_topics": unchanged,
    }
    return changed, next_hashes, stats


def build_article_writeback_payload(
    *,
    topics: list[dict[str, Any]],
    articles: list[dict[str, Any]] | None,
    state: BridgeState,
    compiled_at: str,
    force: bool = False,
    include_unmapped_exported: bool = True,
) -> tuple[list[dict[str, Any]], dict[str, str], dict[str, Any]]:
    """Build article compile-status payload with topic-set fingerprint dedupe.

    - Always rewrite article topic sets when wiki mapping changed.
    - For unmapped exported articles, only touch rows whose previous writeback
      fingerprint is missing/outdated.
    """
    topic_keys_by_article: dict[str, list[str]] = {}
    for topic in topics:
        if not isinstance(topic, dict):
            continue
        key = str(topic.get("key") or "").strip()
        if not key:
            continue
        for mapped_article_id in topic.get("article_ids") or []:
            article_id = str(mapped_article_id or "").strip()
            if not article_id:
                continue
            topic_keys_by_article.setdefault(article_id, []).append(key)

    payload: list[dict[str, Any]] = []
    next_article_topic_hashes: dict[str, str] = dict(state.article_topic_hashes)
    changed_articles = 0
    unchanged_articles = 0

    for article_id, keys in sorted(topic_keys_by_article.items()):
        unique_keys = sorted({str(item).strip() for item in keys if str(item).strip()})
        digest = article_topic_set_fingerprint(unique_keys)
        previous = state.article_topic_hashes.get(article_id)
        if not force and previous == digest:
            unchanged_articles += 1
            next_article_topic_hashes[article_id] = digest
            continue
        payload.append(
            {
                "article_id": article_id,
                "compile_status": "compiled",
                "compiled_at": compiled_at,
                "topic_keys": unique_keys,
                "replace_topics": True,
            }
        )
        next_article_topic_hashes[article_id] = digest
        changed_articles += 1

    if include_unmapped_exported and articles:
        for item in articles:
            if not isinstance(item, dict):
                continue
            article_id = str(item.get("id") or "").strip()
            if not article_id or article_id in topic_keys_by_article:
                continue
            digest = article_topic_set_fingerprint([])
            previous = state.article_topic_hashes.get(article_id)
            # Keep existing links untouched; only refresh status once.
            if not force and previous == digest:
                unchanged_articles += 1
                continue
            payload.append(
                {
                    "article_id": article_id,
                    "compile_status": "synced",
                    "compiled_at": compiled_at,
                    "topic_keys": [],
                    "replace_topics": False,
                }
            )
            next_article_topic_hashes[article_id] = digest
            changed_articles += 1

    # Drop fingerprints for articles no longer present in local export map when force full.
    if force:
        known_ids = set(state.article_paths.keys())
        if articles:
            known_ids.update(
                str(item.get("id") or "").strip()
                for item in articles
                if isinstance(item, dict) and str(item.get("id") or "").strip()
            )
        known_ids.update(topic_keys_by_article.keys())
        next_article_topic_hashes = {
            key: value
            for key, value in next_article_topic_hashes.items()
            if key in known_ids or key in topic_keys_by_article
        }

    stats = {
        "changed_articles": changed_articles,
        "unchanged_articles": unchanged_articles,
        "mapped_articles": len(topic_keys_by_article),
    }
    return payload, next_article_topic_hashes, stats


def apply_writeback_hashes(
    state: BridgeState,
    *,
    topic_hashes: dict[str, str],
    article_topic_hashes: dict[str, str],
) -> None:
    state.topic_hashes = dict(topic_hashes)
    state.article_topic_hashes = dict(article_topic_hashes)
