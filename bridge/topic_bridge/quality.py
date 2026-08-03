from __future__ import annotations

import json
import re
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

from .config import BridgeConfig
from .wiki_scan import _parse_frontmatter


_LEAK_PATTERNS = (
    re.compile(r"<think(?:\s|>)", re.I),
    re.compile(r"\bthe user wants me to\b", re.I),
    re.compile(r"\blet me analyze\b", re.I),
    re.compile(r"\bI need to (?:merge|analyze|write|draft)\b", re.I),
    re.compile(r"\bI should (?:use|write|preserve|keep)\b", re.I),
    re.compile(r"\bcaller's suggested\b", re.I),
    re.compile(r"\bwait, looking\b", re.I),
    re.compile(r"\bactually, looking\b", re.I),
)


def _sample(items: list[str], limit: int = 20) -> list[str]:
    return sorted(items)[:limit]


def _load_json_list(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []
    return [item for item in data if isinstance(item, dict)] if isinstance(data, list) else []


def _count_ingest_warnings(path: Path) -> dict[str, int]:
    return dict(Counter(item["kind"] for item in _load_ingest_warnings(path)))


def _load_ingest_warnings(path: Path) -> list[dict[str, Any]]:
    """Parse warning entries and distinguish still-active targets from stale ones."""

    if not path.exists():
        return []
    try:
        lines = path.read_text(encoding="utf-8", errors="ignore").splitlines()
    except OSError:
        return []

    records: list[dict[str, Any]] = []
    source = ""
    current: dict[str, Any] | None = None
    for line in lines:
        if line.startswith("## "):
            match = re.match(r"##\s+([^|]+)\|\s*(.*)", line)
            source = match.group(2).strip() if match else ""
            continue
        match = re.match(r"^(\d+)\.\s+(.*)", line.strip())
        if match:
            text = match.group(2).strip()
            lowered = text.lower()
            if "not closed before end of stream" in lowered or "truncated" in lowered:
                kind = "truncation"
            elif "unsafe path" in lowered:
                kind = "unsafe_path"
            elif "must be under" in lowered or "wrong directory" in lowered:
                kind = "wrong_directory"
            else:
                kind = "other"
            target_match = re.search(r'FILE block "([^"]+)"', text)
            current = {
                "source": source,
                "kind": kind,
                "text": text,
                "target": target_match.group(1) if target_match else None,
            }
            records.append(current)
            continue
        if current and line.strip():
            current["text"] = f'{current["text"]} {line.strip()}'
    return records


def _load_ingest_dispositions(path: Path) -> dict[str, dict[str, Any]]:
    """Load local, source-scoped handling states for append-only warnings."""

    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    sources = data.get("sources") if isinstance(data, dict) else None
    if not isinstance(sources, dict):
        return {}
    valid = {"equivalent", "retry", "manual", "defer", "stale"}
    result: dict[str, dict[str, Any]] = {}
    for source, entry in sources.items():
        if not isinstance(entry, dict):
            continue
        status = str(entry.get("status") or "").strip().lower()
        if status in valid:
            result[str(source)] = {**entry, "status": status}
    return result


def _audit_source_pages(
    config: BridgeConfig,
    hard: dict[str, list[str]],
    warnings: dict[str, list[str]],
) -> dict[str, Any]:
    """Audit source-layer artifacts separately from writeback topic pages."""

    source_dir = config.wiki_dir / "sources"
    raw_files = {f"lumina/{path.name}" for path in config.raw_dir.glob("*.md")}
    source_pages = 0
    source_refs: set[str] = set()
    source_ref_pages: defaultdict[str, list[str]] = defaultdict(list)
    source_leaks: list[str] = []
    legacy_pages: list[str] = []
    missing_raw_refs: list[str] = []

    if source_dir.exists():
        for path in sorted(source_dir.rglob("*.md")):
            source_pages += 1
            rel = str(path.relative_to(config.project_path))
            try:
                text = path.read_text(encoding="utf-8", errors="ignore")
            except OSError:
                continue
            meta, body = _parse_frontmatter(text)
            sources = meta.get("sources") or []
            valid_sources = (
                isinstance(sources, list)
                and [str(value).strip() for value in sources if str(value).strip()]
            )
            if str(meta.get("type") or "").strip().lower() != "source" or not valid_sources:
                legacy_pages.append(rel)
            if any(pattern.search(text) for pattern in _LEAK_PATTERNS):
                source_leaks.append(rel)
            if not body.strip():
                warnings["empty_source_page"].append(rel)
            for value in valid_sources or []:
                source_refs.add(value)
                source_ref_pages[value].append(rel)
                if value.startswith("lumina/") and value not in raw_files:
                    missing_raw_refs.append(f"{rel}: {value}")

    if source_leaks:
        hard["source_model_text_leak"].extend(source_leaks)
    if legacy_pages:
        warnings["legacy_source_artifact"].extend(legacy_pages)
    if missing_raw_refs:
        warnings["missing_source_input"].extend(missing_raw_refs)
    duplicate_refs = [
        f"{source}: {paths}"
        for source, paths in source_ref_pages.items()
        if len(paths) > 1
    ]
    if duplicate_refs:
        warnings["duplicate_source_page"].extend(duplicate_refs)

    covered = len(raw_files & source_refs)
    return {
        "pages": source_pages,
        "raw_sources": len(raw_files),
        "raw_sources_with_source_page": covered,
        "raw_source_coverage": round(covered / len(raw_files), 4) if raw_files else 1.0,
        "pages_with_model_leak": len(source_leaks),
        "legacy_pages": len(legacy_pages),
        "missing_raw_refs": len(missing_raw_refs),
        "duplicate_source_refs": len(duplicate_refs),
    }


def _review_anomalies(review_items: list[dict[str, Any]]) -> list[str]:
    anomalies: list[str] = []
    for item in review_items:
        if item.get("type") != "confirm":
            continue
        title = str(item.get("title") or "")
        pages = item.get("affectedPages") or []
        if title in {"Title", "Precise title"} or any("wiki/page" in str(page) for page in pages):
            anomalies.append(str(item.get("id") or title))
        elif "---LINT:" in str(item.get("description") or ""):
            anomalies.append(str(item.get("id") or title))
    return anomalies


def _compile_ready(compile_status: dict[str, Any] | None) -> bool:
    if not compile_status:
        return True
    return not bool(
        compile_status.get("active")
        or compile_status.get("failed")
        or compile_status.get("queue_size")
    )


def audit_local_knowledge(
    config: BridgeConfig,
    *,
    compile_status: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Audit local LLM Wiki output before it can become a writeback payload.

    The audit intentionally only reads the project. It does not repair, delete,
    or write to Lumina. Hard failures block writeback; review suggestions and
    ingest warnings remain visible as non-blocking diagnostics.
    """

    wiki_dir = config.wiki_dir
    runtime_dir = config.project_path / ".llm-wiki"
    hard: dict[str, list[str]] = defaultdict(list)
    warnings: dict[str, list[str]] = defaultdict(list)
    # Entity and concept namespaces are intentionally separate.  A product or
    # protocol can legitimately have both an entity page and a concept page;
    # only duplicate titles within the same kind should block writeback.
    titles: dict[tuple[str, str], list[str]] = defaultdict(list)
    scanned = 0
    canonical_topics = 0
    by_kind: Counter[str] = Counter()

    for kind, folder_name in (("entity", "entities"), ("concept", "concepts")):
        folder = wiki_dir / folder_name
        if not folder.exists():
            continue
        for path in sorted(folder.glob("*.md")):
            scanned += 1
            rel = str(path.relative_to(config.project_path))
            try:
                text = path.read_text(encoding="utf-8", errors="ignore")
            except OSError as exc:
                hard["unreadable"].append(f"{rel}: {exc}")
                continue
            meta, body = _parse_frontmatter(text)
            tags = meta.get("tags") or []
            is_stub = isinstance(tags, list) and "stub" in {
                str(tag).strip().lower() for tag in tags
            }
            if is_stub:
                warnings["noncanonical_stub"].append(rel)
                continue
            title = str(meta.get("title") or "").strip()
            if not meta:
                hard["missing_frontmatter"].append(rel)
                if any(pattern.search(text) for pattern in _LEAK_PATTERNS):
                    hard["model_text_leak"].append(rel)
                continue
            actual_type = str(meta.get("type") or "").strip().lower()
            if actual_type != kind:
                hard["wrong_type"].append(rel)
            if not title:
                hard["missing_title"].append(rel)
            else:
                titles[(kind, title)].append(rel)
            if not body.strip():
                hard["empty_body"].append(rel)
            if any(pattern.search(text) for pattern in _LEAK_PATTERNS):
                hard["model_text_leak"].append(rel)
            sources = meta.get("sources") or []
            if not isinstance(sources, list) or not any(str(item).strip() for item in sources):
                hard["missing_sources"].append(rel)
            if actual_type == kind and title and body.strip():
                canonical_topics += 1
            by_kind[kind] += 1

    for (_kind, _title), paths in titles.items():
        if len(paths) > 1:
            hard["duplicate_titles"].extend(paths)

    review_items = _load_json_list(runtime_dir / "review.json")
    unresolved_reviews = [item for item in review_items if not item.get("resolved")]
    review_counts = Counter(str(item.get("type") or "unknown") for item in unresolved_reviews)
    review_anomalies = _review_anomalies(review_items)
    if review_counts:
        warnings["unresolved_review"] = [
            f"{kind}:{count}" for kind, count in sorted(review_counts.items())
        ]
    if review_anomalies:
        warnings["review_data_anomaly"] = review_anomalies

    ingest_warning_records = _load_ingest_warnings(runtime_dir / "ingest-warnings.log")
    ingest_dispositions = _load_ingest_dispositions(runtime_dir / "ingest-dispositions.json")
    ingest_warnings = dict(Counter(item["kind"] for item in ingest_warning_records))
    if ingest_warnings:
        warnings["ingest_warning"] = [
            f"{kind}:{count}" for kind, count in sorted(ingest_warnings.items())
        ]
    active_ingest_warnings: list[str] = []
    stale_ingest_warnings: list[str] = []
    ingest_disposition_counts: Counter[str] = Counter()
    unclassified_ingest_warnings: list[str] = []
    actionable_ingest_warnings: list[str] = []
    for item in ingest_warning_records:
        target = item.get("target")
        is_stale = bool(target and (config.project_path / str(target)).exists())
        label = f'{item["source"]}: {target or item["text"]}'
        (stale_ingest_warnings if is_stale else active_ingest_warnings).append(label)
        disposition = ingest_dispositions.get(item["source"])
        disposition_status = str(disposition.get("status") or "") if disposition else ""
        if disposition_status:
            ingest_disposition_counts[disposition_status] += 1
        elif is_stale:
            # A warning whose target now exists is historical by definition;
            # do not require a hand-authored disposition for every old log row.
            ingest_disposition_counts["stale"] += 1
        else:
            unclassified_ingest_warnings.append(label)
        if not is_stale and disposition_status not in {"equivalent", "defer", "stale"}:
            actionable_ingest_warnings.append(label)
    if active_ingest_warnings:
        warnings["ingest_warning_active"] = active_ingest_warnings
    if stale_ingest_warnings:
        warnings["ingest_warning_stale"] = stale_ingest_warnings

    source_quality = _audit_source_pages(config, hard, warnings)

    if canonical_topics == 0:
        hard["no_topics"].append(str(wiki_dir))
    if not _compile_ready(compile_status):
        hard["compile_not_ready"].append(".llm-wiki compile queue is still active or failed")

    hard_counts = {key: len(value) for key, value in sorted(hard.items()) if value}
    warning_counts = {key: len(value) for key, value in sorted(warnings.items()) if value}
    if unresolved_reviews:
        warning_counts["unresolved_review"] = len(unresolved_reviews)
    if ingest_warnings:
        warning_counts["ingest_warning"] = sum(ingest_warnings.values())
    if active_ingest_warnings:
        warning_counts["ingest_warning_active"] = len(active_ingest_warnings)
    if stale_ingest_warnings:
        warning_counts["ingest_warning_stale"] = len(stale_ingest_warnings)
    if unclassified_ingest_warnings:
        warning_counts["ingest_warning_unclassified"] = len(unclassified_ingest_warnings)
    if actionable_ingest_warnings:
        warning_counts["ingest_warning_actionable"] = len(actionable_ingest_warnings)
    result: dict[str, Any] = {
        "ready": not hard_counts,
        "status": "ready" if not hard_counts else "blocked",
        "project_path": str(config.project_path),
        "wiki_dir": str(wiki_dir),
        "scanned_topics": scanned,
        "canonical_topics": canonical_topics,
        "ignored_noncanonical": len(warnings.get("noncanonical_stub", [])),
        "topics_by_kind": dict(by_kind),
        "hard_failure_counts": hard_counts,
        "hard_failure_samples": {key: _sample(value) for key, value in hard.items() if value},
        "warning_counts": warning_counts,
        "warning_samples": {key: _sample(value) for key, value in warnings.items() if value},
        "review": {
            "total": len(review_items),
            "unresolved": len(unresolved_reviews),
            "unresolved_by_type": dict(sorted(review_counts.items())),
            "data_anomalies": len(review_anomalies),
        },
        "ingest_warnings": ingest_warnings,
        "ingest_warning_status": {
            "total": len(ingest_warning_records),
            "active": len(active_ingest_warnings),
            "stale": len(stale_ingest_warnings),
            "actionable": len(actionable_ingest_warnings),
            "unclassified": len(unclassified_ingest_warnings),
            "dispositions": dict(sorted(ingest_disposition_counts.items())),
            "active_samples": _sample(active_ingest_warnings),
            "stale_samples": _sample(stale_ingest_warnings),
        },
        "source_quality": source_quality,
        "compile_status": compile_status or {},
        "hint": (
            "Repair hard failures locally before writeback."
            if hard_counts
            else "Local output passed the writeback quality gate."
        ),
    }
    return result
