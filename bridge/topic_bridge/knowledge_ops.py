from __future__ import annotations

import json
import urllib.error
import urllib.request
import shutil
import threading
import time
from pathlib import Path
from typing import Any

from .config import BridgeConfig, load_config
from .export_body import slugify_filename
from .state import BridgeState, utc_now_iso
from .wiki_scan import _parse_frontmatter, scan_wiki_topics
from .writeback import (
    apply_writeback_hashes,
    build_article_writeback_payload,
    filter_changed_topics,
)

from .client import LuminaClient


def reset_local_knowledge_data(config: BridgeConfig) -> dict[str, Any]:
    """Delete local knowledge artifacts so the next sync can rebuild from remote sources.

    Clears:
    - raw/ tree used by Lumina exports
    - wiki/ compiled pages (entities/concepts/sources/queries/...)
    - .llm-wiki runtime caches (queue/review/history/lancedb/ingest-cache)
    - bridge article hash/path cursors

    Keeps project root metadata such as purpose.md / schema.md / .obsidian.
    """
    removed: list[str] = []
    raw_root = config.project_path / "raw"
    wiki_root = config.wiki_dir
    llm_wiki_root = config.project_path / ".llm-wiki"

    def _rm(target: Path) -> None:
        if not target.exists():
            return
        try:
            if target.is_file() or target.is_symlink():
                target.unlink()
            else:
                shutil.rmtree(target)
        except PermissionError as exc:
            raise RuntimeError(
                "Failed to delete local knowledge data under "
                f"{target}. On macOS, LaunchAgent-run Bridge often cannot "
                "access Desktop/Documents/Downloads. Move the knowledge project "
                "outside those folders (for example ~/.lumina/knowledge), grant "
                "Full Disk Access to the Bridge Python, or start Bridge with "
                "`lumina bridge start --no-service` from a Terminal that already "
                f"has access. Underlying error: {exc}"
            ) from exc
        removed.append(str(target))

    # 1) drop runtime caches first so a running llm_wiki is less likely to
    #    rehydrate stale review/history into a half-wiped wiki.
    _rm(llm_wiki_root)
    _rm(raw_root)
    _rm(wiki_root)
    _rm(config.project_path / ".bridge" / "state.json")

    # 2) recreate clean llm_wiki project skeleton
    created: list[str] = []
    config.raw_dir.mkdir(parents=True, exist_ok=True)
    created.append(str(config.raw_dir))
    for sub in ("entities", "concepts", "sources", "queries", "comparisons", "synthesis"):
        path = wiki_root / sub
        path.mkdir(parents=True, exist_ok=True)
        created.append(str(path))
    index = wiki_root / "index.md"
    index.write_text(
        "---\n"
        "type: overview\n"
        "title: Index\n"
        "tags: []\n"
        "related: []\n"
        "---\n\n"
        "# Index\n\n"
        "Lumina knowledge project initialized by topic bridge bootstrap.\n",
        encoding="utf-8",
    )
    created.append(str(index))
    log = wiki_root / "log.md"
    log.write_text("# Wiki Log\n\n", encoding="utf-8")
    created.append(str(log))

    # 3) recreate empty llm_wiki runtime files so desktop app starts clean
    llm_wiki_root.mkdir(parents=True, exist_ok=True)
    clean_runtime = {
        "ingest-queue.json": "[]\n",
        "file-change-queue.json": json.dumps({"version": 1, "tasks": []}, ensure_ascii=False, indent=2) + "\n",
        "file-snapshot.json": json.dumps({"version": 1, "updatedAt": 0, "files": {}}, ensure_ascii=False, indent=2) + "\n",
        "ingest-cache.json": json.dumps({"entries": {}}, ensure_ascii=False, indent=2) + "\n",
        "review.json": "[]\n",
    }
    for name, body in clean_runtime.items():
        path = llm_wiki_root / name
        path.write_text(body, encoding="utf-8")
        created.append(str(path))
    for sub in ("history",):
        path = llm_wiki_root / sub
        path.mkdir(parents=True, exist_ok=True)
        created.append(str(path))

    skeleton = {"ok": True, "created": created, "index": str(index)}

    # 4) reset bridge runtime state cursors
    state = BridgeState()
    state.save(config.state_path)
    removed.append(str(config.state_path))
    return {
        "ok": True,
        "removed": removed,
        "raw_dir": str(config.raw_dir),
        "wiki_dir": str(wiki_root),
        "state_path": str(config.state_path),
        "skeleton": skeleton,
    }



def request_llm_wiki_recompile(config: BridgeConfig) -> dict[str, Any]:
    """Best-effort ask local llm_wiki to re-ingest/compile after sources are rewritten.

    llm_wiki desktop currently exposes limited HTTP surface; we probe a small set of
    endpoints and treat absence as a soft skip with explicit guidance.
    """
    base = (config.llm_wiki_api_url or "").rstrip("/")
    if not base:
        return {
            "ok": False,
            "attempted": False,
            "detail": "llm_wiki_api_url_missing",
        }
    payload = {
        "project_id": config.project_id,
        "project_path": str(config.project_path),
        "reason": "lumina_bridge_full_rebuild",
    }
    candidates = [
        ("/compile", payload),
        ("/api/compile", payload),
        ("/ingest", payload),
        ("/api/ingest", payload),
        ("/reindex", payload),
        ("/api/reindex", payload),
        ("/rebuild", payload),
        ("/api/rebuild", payload),
    ]
    last_error = None
    for path_suffix, body in candidates:
        url = f"{base}{path_suffix}"
        try:
            req = urllib.request.Request(
                url,
                data=json.dumps(body, ensure_ascii=False).encode("utf-8"),
                headers={"Content-Type": "application/json", "Accept": "application/json"},
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=8) as resp:
                raw = resp.read().decode("utf-8", errors="ignore")
                data = json.loads(raw) if raw else {}
                return {
                    "ok": True,
                    "attempted": True,
                    "endpoint": path_suffix,
                    "status_code": getattr(resp, "status", 200),
                    "response": data if isinstance(data, dict) else {"raw": data},
                }
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="ignore")
            last_error = f"{path_suffix}:{exc.code}:{detail[:200]}"
            # 404 means endpoint absent; continue probing
            if exc.code not in {404, 405}:
                return {
                    "ok": False,
                    "attempted": True,
                    "endpoint": path_suffix,
                    "status_code": exc.code,
                    "detail": detail[:500] or str(exc),
                }
        except Exception as exc:  # noqa: BLE001
            last_error = f"{path_suffix}:{exc}"
            continue
    return {
        "ok": False,
        "attempted": True,
        "detail": last_error or "no_compile_endpoint",
        "hint": "Open LLM Wiki and let it recompile the project after sources are rewritten.",
    }



def _wiki_topic_files(config: BridgeConfig) -> list[Path]:
    files: list[Path] = []
    for sub in ("entities", "concepts"):
        root = config.wiki_dir / sub
        if not root.exists():
            continue
        files.extend(sorted(p for p in root.glob("*.md") if p.is_file()))
    return files


def inspect_llm_wiki_compile(config: BridgeConfig) -> dict[str, Any]:
    """Inspect local llm_wiki compile/ingest progress from on-disk queues and wiki pages."""
    queue_path = config.project_path / ".llm-wiki" / "ingest-queue.json"
    cache_path = config.project_path / ".llm-wiki" / "ingest-cache.json"
    queue: list[dict[str, Any]] = []
    if queue_path.exists():
        try:
            raw = json.loads(queue_path.read_text(encoding="utf-8"))
            if isinstance(raw, list):
                queue = [item for item in raw if isinstance(item, dict)]
        except Exception:  # noqa: BLE001
            queue = []
    statuses = [str(item.get("status") or "").lower() for item in queue]
    active = [s for s in statuses if s in {"processing", "pending", "queued", "running", "ingest", "compiling"}]
    failed = [item for item in queue if str(item.get("status") or "").lower() in {"failed", "error"}]
    topic_files = _wiki_topic_files(config)
    cache_entries = 0
    if cache_path.exists():
        try:
            raw = json.loads(cache_path.read_text(encoding="utf-8"))
            entries = raw.get("entries") if isinstance(raw, dict) else None
            if isinstance(entries, dict):
                cache_entries = len(entries)
        except Exception:  # noqa: BLE001
            cache_entries = 0
    ready = bool(topic_files) and not active
    return {
        "queue_size": len(queue),
        "active": len(active),
        "failed": len(failed),
        "topic_files": len(topic_files),
        "cache_entries": cache_entries,
        "ready": ready,
        "statuses": statuses,
        "failed_items": [
            {
                "id": item.get("id"),
                "sourcePath": item.get("sourcePath"),
                "error": item.get("error"),
                "status": item.get("status"),
            }
            for item in failed[:5]
        ],
        "sample_topics": [p.name for p in topic_files[:8]],
    }


def writeback_topics_from_wiki(config: BridgeConfig) -> dict[str, Any]:
    """Scan local wiki topics and write them back without re-exporting sources."""
    state = BridgeState.load(config.state_path)
    client = LuminaClient(config)
    slug_to_id: dict[str, str] = {}
    for article_id, rel in list(state.article_paths.items()):
        raw_path = config.project_path / rel
        slug = ""
        if raw_path.exists():
            try:
                meta, _ = _parse_frontmatter(
                    raw_path.read_text(encoding="utf-8", errors="ignore")
                )
            except Exception:  # noqa: BLE001
                meta = {}
            slug = str(meta.get("lumina_slug") or "").strip()
            meta_id = str(meta.get("lumina_id") or "").strip()
            if meta_id:
                article_id = meta_id
        if not slug:
            stem = Path(rel).stem
            if "__" in stem:
                slug = stem.rsplit("__", 1)[0]
            else:
                slug = stem
        if slug:
            slug_to_id[slug] = article_id
            slug_to_id[slugify_filename(slug)] = article_id

    topics = scan_wiki_topics(
        config.wiki_dir,
        article_paths=state.article_paths,
        slug_to_id=slug_to_id,
        file_cache=state.wiki_file_cache,
    )
    if not topics:
        return {
            "accepted": True,
            "status": "awaiting_compile",
            "mode": "writeback",
            "scanned_topics": 0,
            "writeback_topics": 0,
            "writeback_topics_changed": 0,
            "writeback_topics_unchanged": 0,
            "writeback_articles": 0,
            "writeback_articles_changed": 0,
            "writeback_articles_unchanged": 0,
            "writeback_skipped": True,
            "hint": "No entity/concept pages found yet.",
        }

    compiled_at = utc_now_iso()
    changed_topics, next_topic_hashes, topic_stats = filter_changed_topics(
        topics,
        state,
        force=False,
    )
    # Pure writeback only refreshes articles that already have local source paths.
    known_articles = [
        {"id": article_id}
        for article_id in sorted(state.article_paths.keys())
        if str(article_id).strip()
    ]
    article_payload, next_article_topic_hashes, article_stats = build_article_writeback_payload(
        topics=topics,
        articles=known_articles,
        state=state,
        compiled_at=compiled_at,
        force=False,
        include_unmapped_exported=True,
    )

    writeback_result = None
    if changed_topics or article_payload:
        writeback = {
            "compiler": "llm_wiki",
            "compiler_project_id": config.project_id,
            "compiled_at": compiled_at,
            "topics": changed_topics,
            "articles": article_payload,
        }
        writeback_result = client.write_compile_results(writeback)
        apply_writeback_hashes(
            state,
            topic_hashes=next_topic_hashes,
            article_topic_hashes=next_article_topic_hashes,
        )
        state.last_writeback_at = compiled_at
    else:
        apply_writeback_hashes(
            state,
            topic_hashes=next_topic_hashes,
            article_topic_hashes=next_article_topic_hashes,
        )

    state.save(config.state_path)
    return {
        "accepted": True,
        "status": "completed",
        "mode": "writeback",
        "scanned_topics": topic_stats["scanned_topics"],
        "writeback_topics": topic_stats["changed_topics"],
        "writeback_topics_changed": topic_stats["changed_topics"],
        "writeback_topics_unchanged": topic_stats["unchanged_topics"],
        "writeback_articles": article_stats["changed_articles"],
        "writeback_articles_changed": article_stats["changed_articles"],
        "writeback_articles_unchanged": article_stats["unchanged_articles"],
        "writeback": writeback_result,
        "writeback_skipped": writeback_result is None,
        "compiled_at": compiled_at,
        "hint": (
            None
            if (changed_topics or article_payload)
            else "No topic/article changes detected; writeback skipped."
        ),
    }


_WRITEBACK_LOCK = threading.Lock()
_WRITEBACK_JOB: dict[str, Any] = {
    "active": False,
    "run_id": None,
    "status": "idle",
    "started_at": None,
    "finished_at": None,
    "result": None,
    "error": None,
}


def get_writeback_job() -> dict[str, Any]:
    with _WRITEBACK_LOCK:
        return dict(_WRITEBACK_JOB)


def reset_writeback_job() -> None:
    with _WRITEBACK_LOCK:
        _WRITEBACK_JOB.update(
            {
                "active": False,
                "run_id": None,
                "status": "idle",
                "started_at": None,
                "finished_at": None,
                "result": None,
                "error": None,
            }
        )


def schedule_auto_writeback(
    config: BridgeConfig,
    *,
    run_id: str,
    timeout_sec: float = 1800.0,
    poll_interval_sec: float = 5.0,
) -> dict[str, Any]:
    """Wait until llm_wiki produces topic pages, then automatically write back once."""

    def _runner() -> None:
        started = utc_now_iso()
        with _WRITEBACK_LOCK:
            _WRITEBACK_JOB.update(
                {
                    "active": True,
                    "run_id": run_id,
                    "status": "waiting_compile",
                    "started_at": started,
                    "finished_at": None,
                    "result": None,
                    "error": None,
                }
            )
        deadline = time.time() + max(30.0, timeout_sec)
        last_inspect: dict[str, Any] = {}
        try:
            while time.time() < deadline:
                # Reload CLI config each poll so URL/token/project changes apply
                # without requiring a bridge process restart.
                active = load_config()
                last_inspect = inspect_llm_wiki_compile(active)
                if last_inspect.get("ready"):
                    with _WRITEBACK_LOCK:
                        _WRITEBACK_JOB["status"] = "writing"
                    result = writeback_topics_from_wiki(active)
                    with _WRITEBACK_LOCK:
                        _WRITEBACK_JOB.update(
                            {
                                "active": False,
                                "status": str(result.get("status") or "completed"),
                                "finished_at": utc_now_iso(),
                                "result": result,
                                "error": None,
                                "compile_status": last_inspect,
                            }
                        )
                    return
                if last_inspect.get("failed") and not last_inspect.get("topic_files"):
                    # keep waiting a bit: llm_wiki may retry; only hard-fail at timeout
                    pass
                time.sleep(max(1.0, poll_interval_sec))
            with _WRITEBACK_LOCK:
                _WRITEBACK_JOB.update(
                    {
                        "active": False,
                        "status": "timeout",
                        "finished_at": utc_now_iso(),
                        "result": None,
                        "error": "compile_timeout",
                        "compile_status": last_inspect,
                    }
                )
        except Exception as exc:  # noqa: BLE001
            with _WRITEBACK_LOCK:
                _WRITEBACK_JOB.update(
                    {
                        "active": False,
                        "status": "failed",
                        "finished_at": utc_now_iso(),
                        "result": None,
                        "error": str(exc),
                        "compile_status": last_inspect,
                    }
                )

    with _WRITEBACK_LOCK:
        if _WRITEBACK_JOB.get("active"):
            return {
                "scheduled": False,
                "reason": "already_active",
                "job": dict(_WRITEBACK_JOB),
            }
    thread = threading.Thread(
        target=_runner,
        name=f"lumina-auto-writeback-{run_id}",
        daemon=True,
    )
    thread.start()
    return {
        "scheduled": True,
        "run_id": run_id,
        "timeout_sec": timeout_sec,
        "poll_interval_sec": poll_interval_sec,
        "job": get_writeback_job(),
    }

