from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import tempfile
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


_FRONTMATTER_RE = re.compile(r"^---\s*\n(.*?)\n---\s*\n?", re.S)
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
_PAIRED_THINK_BLOCK_RE = re.compile(r"<think(?:\s[^>]*)?>.*?</think>", re.IGNORECASE | re.DOTALL)


def _parse_frontmatter(text: str) -> tuple[dict[str, str], str]:
    match = _FRONTMATTER_RE.match(text)
    if not match:
        return {}, text
    meta: dict[str, str] = {}
    for line in match.group(1).splitlines():
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        meta[key.strip()] = value.strip().strip('"').strip("'")
    return meta, text[match.end() :]


def _has_model_leak(text: str) -> bool:
    return any(pattern.search(text) for pattern in _LEAK_PATTERNS)


def _sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _history_records(project_path: Path) -> dict[Path, list[dict[str, Any]]]:
    records: dict[Path, list[dict[str, Any]]] = {}
    history_dir = project_path / ".llm-wiki" / "history"
    if not history_dir.exists():
        return records
    for history_path in sorted(history_dir.glob("*.json")):
        try:
            data = json.loads(history_path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        if not isinstance(data, list):
            continue
        for index, item in enumerate(data):
            if not isinstance(item, dict):
                continue
            raw_path = str(item.get("path") or "").strip()
            content = item.get("content")
            if not raw_path or not isinstance(content, str):
                continue
            path = Path(raw_path).expanduser()
            if not path.is_absolute():
                path = project_path / path
            try:
                path = path.resolve()
            except OSError:
                continue
            records.setdefault(path, []).append(
                {
                    "timestamp": int(item.get("timestamp") or 0),
                    "history_file": str(history_path),
                    "history_index": index,
                    "record_id": str(item.get("id") or ""),
                    "author": str(item.get("author") or ""),
                    "tool": str(item.get("tool") or ""),
                    "content": content,
                }
            )
    return records


def _valid_candidate(record: dict[str, Any], expected_type: str) -> bool:
    content = str(record.get("content") or "")
    if not content.startswith("---\n") or _has_model_leak(content):
        return False
    meta, body = _parse_frontmatter(content)
    return (
        meta.get("type", "").strip().lower() == expected_type
        and bool(meta.get("title", "").strip())
        and bool(body.strip())
    )


def _current_issues(text: str) -> list[str]:
    issues: list[str] = []
    if not text.startswith("---\n"):
        issues.append("missing_frontmatter")
    if _has_model_leak(text):
        issues.append("model_text_leak")
    return issues


def _write_atomic(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp_name = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp_name, path)
    finally:
        try:
            os.unlink(temp_name)
        except FileNotFoundError:
            pass


def restore_history_pages(project_path: Path, *, dry_run: bool = False) -> dict[str, Any]:
    """Restore malformed/leaking wiki pages from the latest valid local history.

    This operation is deliberately local-only. It never starts a provider, calls
    Bridge, reads Lumina credentials, or mutates review/history records. Before
    every write, the current page is copied into a timestamped backup directory.
    """

    project_path = project_path.expanduser().resolve()
    records = _history_records(project_path)
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    backup_root = project_path / ".llm-wiki" / "repair-backups" / timestamp
    targets: list[dict[str, Any]] = []
    restored: list[dict[str, Any]] = []
    unresolved: list[dict[str, Any]] = []
    errors: list[dict[str, Any]] = []

    for expected_type, folder_name in (("entity", "entities"), ("concept", "concepts")):
        folder = project_path / "wiki" / folder_name
        if not folder.exists():
            continue
        for path in sorted(folder.glob("*.md")):
            try:
                current = path.read_text(encoding="utf-8", errors="ignore")
            except OSError as exc:
                errors.append({"path": str(path), "error": str(exc)})
                continue
            issues = _current_issues(current)
            if not issues:
                continue

            candidates = [
                record
                for record in records.get(path.resolve(), [])
                if _valid_candidate(record, expected_type)
            ]
            candidates.sort(
                key=lambda record: (
                    int(record.get("timestamp") or 0),
                    str(record.get("history_file") or ""),
                    int(record.get("history_index") or 0),
                )
            )
            candidate = candidates[-1] if candidates else None
            item: dict[str, Any] = {
                "path": str(path.relative_to(project_path)),
                "issues": issues,
                "history_candidates": len(candidates),
            }
            if candidate is None:
                item["status"] = "no_valid_history"
                unresolved.append(item)
                targets.append(item)
                continue

            candidate_content = str(candidate["content"])
            item.update(
                {
                    "status": "planned" if dry_run else "restored",
                    "history_file": candidate["history_file"],
                    "history_timestamp": candidate["timestamp"],
                    "history_record_id": candidate.get("record_id") or None,
                    "current_sha256": _sha256(current),
                    "restored_sha256": _sha256(candidate_content),
                }
            )
            targets.append(item)
            if dry_run:
                continue

            try:
                backup_path = backup_root / path.relative_to(project_path)
                backup_path.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(path, backup_path)
                _write_atomic(path, candidate_content)
                item["backup_path"] = str(backup_path)
                restored.append(item)
            except OSError as exc:
                item["status"] = "error"
                item["error"] = str(exc)
                errors.append(item)

    if not dry_run and not restored and backup_root.exists():
        shutil.rmtree(backup_root)

    return {
        "ok": not errors and not unresolved,
        "status": "dry_run" if dry_run else ("restored" if restored else "no_action"),
        "project_path": str(project_path),
        "dry_run": dry_run,
        "remote_writeback": False,
        "target_count": len(targets),
        "restored_count": len(restored),
        "unresolved_count": len(unresolved),
        "error_count": len(errors),
        "backup_root": str(backup_root) if restored else None,
        "targets": targets,
        "unresolved": unresolved,
        "errors": errors,
        "hint": (
            "Review the plan, then rerun without --dry-run to restore locally."
            if dry_run and targets
            else "All targeted pages were restored locally; wait for LLM Wiki to recompile before auditing."
            if restored and not unresolved and not errors
            else "No safe history restore was available for one or more targeted pages."
            if unresolved
            else "No malformed or leaking wiki pages were found."
        ),
    }


def _missing_truncation_targets(project_path: Path) -> list[dict[str, Any]]:
    """Find current missing FILE blocks from the local ingest warning log."""

    project_path = project_path.expanduser().resolve()
    log_path = project_path / ".llm-wiki" / "ingest-warnings.log"
    if not log_path.exists():
        return []

    current_source = ""
    targets: dict[str, dict[str, Any]] = {}
    for line in log_path.read_text(encoding="utf-8", errors="ignore").splitlines():
        if line.startswith("## "):
            current_source = line.split("|", 1)[1].strip() if "|" in line else ""
            continue
        stripped = line.strip()
        if not re.match(r"^\d+\.\s", stripped):
            continue
        lowered = stripped.lower()
        if "not closed before end of stream" not in lowered and "truncated" not in lowered:
            continue
        match = re.search(r'FILE block "([^"]+)"', stripped)
        if not match:
            continue
        target = match.group(1)
        target_path = project_path / target
        if target_path.exists() or target in targets:
            continue
        raw_path = project_path / "raw/sources" / current_source
        targets[target] = {
            "target": target,
            "source": current_source,
            "raw_path": str(raw_path),
            "raw_exists": raw_path.exists(),
        }
    return [targets[key] for key in sorted(targets)]


def retry_missing_truncations(
    project_path: Path,
    *,
    api_url: str = "http://127.0.0.1:19828",
    dry_run: bool = False,
) -> dict[str, Any]:
    """Target only missing truncated outputs and ask local LLM Wiki to rescan.

    LLM Wiki's source rescan keys off content hashes. Appending one extra blank
    line is semantically inert for Markdown but creates a deterministic local
    change for exactly the affected raw sources. The command never calls Lumina.
    """

    project_path = project_path.expanduser().resolve()
    targets = _missing_truncation_targets(project_path)
    missing_raw = [item for item in targets if not item["raw_exists"]]
    queue_path = project_path / ".llm-wiki" / "ingest-queue.json"
    queue_items: list[dict[str, Any]] = []
    if queue_path.exists():
        try:
            raw_queue = json.loads(queue_path.read_text(encoding="utf-8"))
            if isinstance(raw_queue, list):
                queue_items = [item for item in raw_queue if isinstance(item, dict)]
        except (OSError, ValueError):
            queue_items = []
    queue_work = [
        item
        for item in queue_items
        if str(item.get("status") or "").lower()
        in {"pending", "processing", "queued", "running", "compiling", "ingest"}
    ]
    if dry_run or not targets or missing_raw:
        return {
            "ok": not missing_raw,
            "status": "dry_run" if dry_run else ("no_targets" if not targets else "missing_raw"),
            "project_path": str(project_path),
            "api_url": api_url.rstrip("/"),
            "remote_writeback": False,
            "target_count": len(targets),
            "targets": targets,
            "missing_raw": missing_raw,
            "queue_work": queue_work,
            "rescan": None,
            "hint": (
                "Review the 14-target plan, then rerun without --dry-run."
                if dry_run and targets
                else "Some warning targets no longer have a local raw source."
                if missing_raw
                else "No missing truncated outputs remain."
            ),
        }
    if queue_work:
        return {
            "ok": False,
            "status": "compile_in_progress",
            "project_path": str(project_path),
            "api_url": api_url.rstrip("/"),
            "remote_writeback": False,
            "target_count": len(targets),
            "targets": targets,
            "queue_work": queue_work,
            "hint": "Wait for the current local LLM Wiki queue to finish before retrying.",
        }

    touched: list[str] = []
    try:
        for item in targets:
            path = Path(item["raw_path"])
            original = path.read_bytes()
            # A second terminal newline is ignored by Markdown parsers but
            # changes the source hash used by LLM Wiki's rescan.
            path.write_bytes(original + b"\n")
            touched.append(str(path))

        url = f"{api_url.rstrip('/')}/api/v1/projects/current/sources/rescan"
        request = urllib.request.Request(
            url,
            data=b"{}",
            headers={"Content-Type": "application/json", "Accept": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(request, timeout=15) as response:
            raw = response.read().decode("utf-8", errors="replace")
            rescan = json.loads(raw) if raw else {}
        return {
            "ok": bool(rescan.get("ok", True)),
            "status": "rescan_requested",
            "project_path": str(project_path),
            "api_url": api_url.rstrip("/"),
            "remote_writeback": False,
            "target_count": len(targets),
            "targets": targets,
            "touched_raw": touched,
            "rescan": rescan,
            "hint": "Poll the local compile queue, then run `lumina knowledge audit`.",
        }
    except (OSError, urllib.error.URLError, ValueError) as exc:
        return {
            "ok": False,
            "status": "rescan_failed",
            "project_path": str(project_path),
            "api_url": api_url.rstrip("/"),
            "remote_writeback": False,
            "target_count": len(targets),
            "targets": targets,
            "touched_raw": touched,
            "error": str(exc),
            "hint": "Inspect local LLM Wiki health and queues before retrying.",
        }


def force_reingest_sources(
    project_path: Path,
    source_files: list[str],
    *,
    api_url: str = "http://127.0.0.1:19828",
    dry_run: bool = False,
) -> dict[str, Any]:
    """Invalidate selected local source bookkeeping and request a rescan.

    LLM Wiki's normal rescan can observe a changed file and update its
    ``file-snapshot.json`` before the ingest queue is created.  Removing only
    the selected source entries from the snapshot and ingest cache forces a
    fresh analysis while preserving wiki pages, history, review data, and all
    unrelated source cache entries.
    """

    project_path = project_path.expanduser().resolve()
    raw_root = (project_path / "raw" / "sources").resolve()
    runtime_dir = project_path / ".llm-wiki"
    queue_path = runtime_dir / "ingest-queue.json"
    queue_work: list[dict[str, Any]] = []
    if queue_path.exists():
        try:
            raw_queue = json.loads(queue_path.read_text(encoding="utf-8"))
            if isinstance(raw_queue, list):
                queue_work = [
                    item
                    for item in raw_queue
                    if isinstance(item, dict)
                    and str(item.get("status") or "").lower()
                    in {"pending", "processing", "queued", "running", "compiling", "ingest"}
                ]
        except (OSError, ValueError):
            queue_work = []

    targets: list[dict[str, Any]] = []
    invalid: list[dict[str, Any]] = []
    seen: set[Path] = set()
    for raw_value in source_files:
        value = str(raw_value or "").strip()
        if not value:
            continue
        candidate = Path(value).expanduser()
        if not candidate.is_absolute():
            candidate = raw_root / candidate
        try:
            resolved = candidate.resolve()
            resolved.relative_to(raw_root)
        except (OSError, ValueError):
            invalid.append({"source": value, "error": "source must be under raw/sources"})
            continue
        if resolved in seen:
            continue
        seen.add(resolved)
        if not resolved.is_file():
            invalid.append({"source": value, "error": "source file does not exist"})
            continue
        relative_raw = resolved.relative_to(raw_root).as_posix()
        targets.append(
            {
                "source": relative_raw,
                "path": str(resolved),
                "raw_path": str(resolved.relative_to(project_path)),
                "cache_key": relative_raw,
            }
        )

    snapshot_path = runtime_dir / "file-snapshot.json"
    cache_path = runtime_dir / "ingest-cache.json"
    if dry_run or invalid or queue_work or not targets:
        return {
            "ok": not invalid and not queue_work,
            "status": "dry_run" if dry_run else (
                "invalid_sources" if invalid else
                "compile_in_progress" if queue_work else
                "no_targets"
            ),
            "project_path": str(project_path),
            "api_url": api_url.rstrip("/"),
            "remote_writeback": False,
            "target_count": len(targets),
            "targets": targets,
            "invalid": invalid,
            "queue_work": queue_work,
            "hint": (
                "Review the target list, then rerun without --dry-run."
                if dry_run and targets
                else "Wait for the current local LLM Wiki queue to finish before retrying."
                if queue_work
                else "Fix invalid source paths before retrying."
                if invalid
                else "No source files were selected."
            ),
        }

    try:
        snapshot = json.loads(snapshot_path.read_text(encoding="utf-8")) if snapshot_path.exists() else {}
        cache = json.loads(cache_path.read_text(encoding="utf-8")) if cache_path.exists() else {}
    except (OSError, ValueError) as exc:
        return {
            "ok": False,
            "status": "runtime_metadata_invalid",
            "project_path": str(project_path),
            "api_url": api_url.rstrip("/"),
            "remote_writeback": False,
            "target_count": len(targets),
            "targets": targets,
            "error": str(exc),
            "hint": "Back up and repair .llm-wiki/file-snapshot.json or ingest-cache.json before retrying.",
        }

    snapshot_files = snapshot.get("files") if isinstance(snapshot, dict) else None
    if not isinstance(snapshot_files, dict):
        snapshot_files = {}
    cache_entries = cache.get("entries") if isinstance(cache, dict) else None
    if not isinstance(cache_entries, dict):
        cache_entries = {}

    snapshot_keys: list[str] = []
    cache_keys: list[str] = []
    for item in targets:
        raw_rel = item["raw_path"]
        cache_key = item["cache_key"]
        for key in list(snapshot_files):
            normalized = str(key).replace("\\", "/")
            if normalized in {raw_rel, item["source"], item["path"]}:
                snapshot_keys.append(key)
        for key in list(cache_entries):
            normalized = str(key).replace("\\", "/")
            if normalized in {cache_key, raw_rel} or normalized.endswith(f"/{cache_key}"):
                cache_keys.append(key)

    backup_root = runtime_dir / "repair-backups" / datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ") / "reingest"
    try:
        backup_root.mkdir(parents=True, exist_ok=True)
        backups: list[str] = []
        for path in (snapshot_path, cache_path):
            if path.exists():
                backup = backup_root / path.name
                shutil.copy2(path, backup)
                backups.append(str(backup))

        for key in snapshot_keys:
            snapshot_files.pop(key, None)
        for key in cache_keys:
            cache_entries.pop(key, None)
        snapshot["files"] = snapshot_files
        cache["entries"] = cache_entries
        _write_atomic(snapshot_path, json.dumps(snapshot, ensure_ascii=False, indent=2) + "\n")
        _write_atomic(cache_path, json.dumps(cache, ensure_ascii=False, indent=2) + "\n")

        url = f"{api_url.rstrip('/')}/api/v1/projects/current/sources/rescan"
        request = urllib.request.Request(
            url,
            data=b"{}",
            headers={"Content-Type": "application/json", "Accept": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(request, timeout=15) as response:
            raw = response.read().decode("utf-8", errors="replace")
            rescan = json.loads(raw) if raw else {}
        return {
            "ok": bool(rescan.get("ok", True)),
            "status": "rescan_requested",
            "project_path": str(project_path),
            "api_url": api_url.rstrip("/"),
            "remote_writeback": False,
            "target_count": len(targets),
            "targets": targets,
            "invalidated_snapshot_entries": len(snapshot_keys),
            "invalidated_cache_entries": len(cache_keys),
            "backups": backups,
            "rescan": rescan,
            "hint": "Poll the local compile queue, then run `lumina knowledge audit`.",
        }
    except (OSError, urllib.error.URLError, ValueError) as exc:
        return {
            "ok": False,
            "status": "rescan_failed",
            "project_path": str(project_path),
            "api_url": api_url.rstrip("/"),
            "remote_writeback": False,
            "target_count": len(targets),
            "targets": targets,
            "invalidated_snapshot_entries": len(snapshot_keys),
            "invalidated_cache_entries": len(cache_keys),
            "backup_root": str(backup_root),
            "error": str(exc),
            "hint": "Runtime metadata was backed up; inspect local LLM Wiki health before retrying.",
        }


def sanitize_source_model_leaks(
    project_path: Path,
    *,
    source_files: list[str] | None = None,
    dry_run: bool = False,
) -> dict[str, Any]:
    """Remove only explicitly delimited model-planning blocks from source pages.

    This is a local post-processing repair for source pages produced with a
    paired ``<think>...</think>`` block.  It never guesses at free-form prose;
    pages with unpaired leak markers are reported for manual review instead.
    """

    project_path = project_path.expanduser().resolve()
    source_dir = project_path / "wiki" / "sources"
    requested = {str(item).strip() for item in (source_files or []) if str(item).strip()}
    targets: list[Path] = []
    invalid: list[dict[str, str]] = []
    if requested:
        for value in sorted(requested):
            path = Path(value).expanduser()
            if not path.is_absolute():
                path = project_path / value
            try:
                resolved = path.resolve()
                resolved.relative_to(source_dir.resolve())
            except (OSError, ValueError):
                invalid.append({"source": value, "error": "source page must be under wiki/sources"})
                continue
            if not resolved.is_file():
                invalid.append({"source": value, "error": "source page does not exist"})
                continue
            targets.append(resolved)
    elif source_dir.exists():
        targets = sorted(source_dir.glob("*.md"))

    planned: list[dict[str, Any]] = []
    for path in targets:
        try:
            text = path.read_text(encoding="utf-8", errors="ignore")
        except OSError as exc:
            invalid.append({"source": str(path), "error": str(exc)})
            continue
        matches = list(_PAIRED_THINK_BLOCK_RE.finditer(text))
        if not matches:
            continue
        sanitized = _PAIRED_THINK_BLOCK_RE.sub("", text)
        sanitized = re.sub(r"\n{3,}", "\n\n", sanitized)
        planned.append(
            {
                "path": str(path.relative_to(project_path)),
                "blocks": len(matches),
                "bytes_before": len(text.encode("utf-8")),
                "bytes_after": len(sanitized.encode("utf-8")),
                "content": sanitized,
            }
        )

    if dry_run or invalid:
        return {
            "ok": not invalid,
            "status": "dry_run" if dry_run else "invalid_sources",
            "project_path": str(project_path),
            "remote_writeback": False,
            "target_count": len(planned),
            "sanitized_count": 0,
            "invalid": invalid,
            "targets": [{k: v for k, v in item.items() if k != "content"} for item in planned],
            "hint": "Review the plan, then rerun without --dry-run." if dry_run else "Fix invalid source pages before retrying.",
        }

    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    backup_root = project_path / ".llm-wiki" / "repair-backups" / timestamp / "source-sanitize"
    sanitized: list[dict[str, Any]] = []
    errors: list[dict[str, str]] = []
    try:
        for item in planned:
            path = project_path / item["path"]
            backup = backup_root / item["path"]
            backup.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(path, backup)
            _write_atomic(path, str(item["content"]))
            sanitized.append(
                {
                    "path": item["path"],
                    "blocks": item["blocks"],
                    "bytes_before": item["bytes_before"],
                    "bytes_after": item["bytes_after"],
                    "backup_path": str(backup),
                }
            )
    except OSError as exc:
        errors.append({"path": str(path), "error": str(exc)})

    return {
        "ok": not errors,
        "status": "sanitized" if sanitized else "no_action",
        "project_path": str(project_path),
        "remote_writeback": False,
        "target_count": len(planned),
        "sanitized_count": len(sanitized),
        "error_count": len(errors),
        "backup_root": str(backup_root) if sanitized else None,
        "targets": sanitized,
        "errors": errors,
        "hint": "Run `lumina knowledge audit` after the local source repair." if sanitized else "No paired <think> blocks were found.",
    }


def _review_anomaly_reason(item: dict[str, Any]) -> str | None:
    """Return a reason for review records that are structurally unusable."""

    if str(item.get("type") or "") != "confirm":
        return None
    title = str(item.get("title") or "")
    pages = item.get("affectedPages") or []
    if title in {"Title", "Precise title"}:
        return "placeholder_confirm_title"
    if any("wiki/page" in str(page) for page in pages):
        return "placeholder_affected_pages"
    if "---LINT:" in str(item.get("description") or ""):
        return "embedded_lint_payload"
    return None


def quarantine_review_anomalies(
    project_path: Path,
    *,
    dry_run: bool = False,
) -> dict[str, Any]:
    """Move malformed confirm records out of the active review queue.

    This is intentionally a quarantine, not an automatic resolution: the
    original records are copied to a timestamped local artifact and the
    active ``review.json`` keeps every non-anomalous record unchanged.
    """

    project_path = project_path.expanduser().resolve()
    runtime_dir = project_path / ".llm-wiki"
    review_path = runtime_dir / "review.json"
    if not review_path.exists():
        return {
            "ok": True,
            "status": "no_review_file",
            "project_path": str(project_path),
            "remote_writeback": False,
            "target_count": 0,
            "quarantined_count": 0,
            "hint": "No local review.json was found.",
        }

    try:
        data = json.loads(review_path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        return {
            "ok": False,
            "status": "review_data_invalid",
            "project_path": str(project_path),
            "remote_writeback": False,
            "target_count": 0,
            "quarantined_count": 0,
            "error": str(exc),
            "hint": "Back up review.json and repair its JSON before retrying.",
        }

    if not isinstance(data, list):
        return {
            "ok": False,
            "status": "review_data_invalid",
            "project_path": str(project_path),
            "remote_writeback": False,
            "target_count": 0,
            "quarantined_count": 0,
            "error": "review.json must contain a JSON list",
            "hint": "Back up review.json and repair its top-level shape before retrying.",
        }

    targets: list[dict[str, Any]] = []
    remaining: list[Any] = []
    for index, item in enumerate(data):
        if not isinstance(item, dict):
            remaining.append(item)
            continue
        reason = _review_anomaly_reason(item)
        if reason is None:
            remaining.append(item)
            continue
        targets.append({"index": index, "reason": reason, "record": item})

    if dry_run or not targets:
        return {
            "ok": True,
            "status": "dry_run" if dry_run else "no_targets",
            "project_path": str(project_path),
            "remote_writeback": False,
            "target_count": len(targets),
            "quarantined_count": 0,
            "review_total": len(data),
            "remaining_total": len(remaining),
            "targets": targets,
            "hint": (
                "Review the anomaly list, then rerun without --dry-run."
                if dry_run and targets
                else "No structurally anomalous confirm records were found."
            ),
        }

    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    backup_root = runtime_dir / "repair-backups" / timestamp / "review-quarantine"
    quarantine_path = backup_root / "review-anomalies.json"
    backup_path = backup_root / "review.json"
    try:
        backup_root.mkdir(parents=True, exist_ok=True)
        shutil.copy2(review_path, backup_path)
        quarantine_path.write_text(
            json.dumps(
                {
                    "quarantinedAt": datetime.now(timezone.utc).isoformat(),
                    "source": str(review_path),
                    "records": targets,
                },
                ensure_ascii=False,
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )
        _write_atomic(review_path, json.dumps(remaining, ensure_ascii=False, indent=2) + "\n")
    except OSError as exc:
        return {
            "ok": False,
            "status": "quarantine_failed",
            "project_path": str(project_path),
            "remote_writeback": False,
            "target_count": len(targets),
            "quarantined_count": 0,
            "backup_root": str(backup_root),
            "error": str(exc),
            "hint": "The original review.json was preserved; inspect the backup directory before retrying.",
        }

    return {
        "ok": True,
        "status": "quarantined",
        "project_path": str(project_path),
        "remote_writeback": False,
        "target_count": len(targets),
        "quarantined_count": len(targets),
        "review_total": len(data),
        "remaining_total": len(remaining),
        "backup_path": str(backup_path),
        "quarantine_path": str(quarantine_path),
        "targets": [
            {"index": item["index"], "reason": item["reason"], "id": item["record"].get("id")}
            for item in targets
        ],
        "hint": "Anomalous records were quarantined locally; they were not marked resolved and no Lumina writeback occurred.",
    }
