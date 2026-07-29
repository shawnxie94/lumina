from __future__ import annotations

import json
import re
import uuid
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

from .client import LuminaClient
from .config import BridgeConfig
from .export_body import body_hash, select_export_body, slugify_filename
from .knowledge_ops import (
    inspect_llm_wiki_compile,
    request_llm_wiki_recompile,
    reset_local_knowledge_data,
    schedule_auto_writeback,
)
from .state import BridgeState, utc_now_iso
from .wiki_scan import _parse_frontmatter, scan_wiki_topics
from .writeback import (
    apply_writeback_hashes,
    build_article_writeback_payload,
    filter_changed_topics,
)

def check_llm_wiki(config: BridgeConfig) -> dict[str, Any]:
    url = f"{config.llm_wiki_api_url}/health"
    try:
        req = urllib.request.Request(url, method="GET")
        with urllib.request.urlopen(req, timeout=3) as resp:
            body = resp.read().decode("utf-8")
            data = json.loads(body) if body else {}
            return {
                "ok": bool(data.get("ok", True)),
                "status": data.get("status") or "online",
                "detail": None,
                "version": data.get("version"),
                "checked_at": utc_now_iso(),
            }
    except Exception as exc:  # noqa: BLE001
        return {
            "ok": False,
            "status": "offline",
            "detail": str(exc),
            "version": None,
            "checked_at": utc_now_iso(),
        }


def project_status(config: BridgeConfig) -> dict[str, Any]:
    ok = config.project_path.exists() and (config.project_path / "wiki").exists()
    return {
        "ok": ok,
        "id": config.project_id,
        "name": config.project_name,
        "path": str(config.project_path),
    }


def _yaml_escape(value: str) -> str:
    if re.search(r'[:#"\'\n]', value):
        return json.dumps(value, ensure_ascii=False)
    return value


def write_raw_article(
    config: BridgeConfig,
    article: dict[str, Any],
    selected: dict[str, str],
) -> Path:
    config.raw_dir.mkdir(parents=True, exist_ok=True)
    article_id = str(article.get("id") or "").strip()
    slug = slugify_filename(str(article.get("slug") or article_id or "article"))
    filename = f"{slug}__{article_id[:8]}.md" if article_id else f"{slug}.md"
    path = config.raw_dir / filename
    tags = article.get("tags") or []
    if not isinstance(tags, list):
        tags = []
    category = article.get("category") or {}
    category_name = ""
    if isinstance(category, dict):
        category_name = str(category.get("name") or "")
    frontmatter = {
        "lumina_id": article_id,
        "lumina_slug": str(article.get("slug") or ""),
        "title": selected["title"],
        "source_url": str(article.get("source_url") or ""),
        "source_domain": str(article.get("source_domain") or ""),
        "author": str(article.get("author") or ""),
        "published_at": str(article.get("published_at") or ""),
        "tags": [str(tag) for tag in tags],
        "category": category_name,
        "original_language": str(article.get("original_language") or ""),
        "body_language": selected["body_language"],
        "body_source": selected["body_source"],
        "translation_fallback": selected["translation_fallback"],
        "synced_at": utc_now_iso(),
    }
    lines = ["---"]
    for key, value in frontmatter.items():
        if isinstance(value, list):
            rendered = "[" + ", ".join(_yaml_escape(str(item)) for item in value) + "]"
            lines.append(f"{key}: {rendered}")
        else:
            lines.append(f"{key}: {_yaml_escape(str(value))}")
    lines.append("---")
    lines.append("")
    lines.append(f"# {selected['title']}")
    lines.append("")
    lines.append(selected["body"])
    lines.append("")
    try:
        path.write_text("\n".join(lines), encoding="utf-8")
    except PermissionError as exc:
        target = str(path)
        lowered = target.lower()
        tcc_hit = any(
            part in lowered
            for part in (
                "/documents/",
                "/desktop/",
                "/downloads/",
                "/movies/",
                "/music/",
                "/pictures/",
            )
        )
        if tcc_hit or "operation not permitted" in str(exc).lower():
            raise PermissionError(
                "Bridge cannot write under a macOS-protected folder "
                f"({target}). Move the knowledge project out of Documents/Desktop/Downloads "
                "(recommended: ~/.lumina/knowledge/<name>), update Lumina CLI project path, "
                "then run `lumina bridge restart`."
            ) from exc
        raise
    return path


def run_sync(
    config: BridgeConfig,
    *,
    mode: str | None = None,
    rebuild: bool = False,
    article_id: str | None = None,
    dry_run: bool = False,
) -> dict[str, Any]:
    requested_mode = (mode or "").strip().lower() or None
    if rebuild:
        requested_mode = "full"
    if requested_mode not in {None, "full", "incremental", "article"}:
        requested_mode = "incremental"

    reset_info = None
    if rebuild and not dry_run:
        reset_info = reset_local_knowledge_data(config)
    elif rebuild and dry_run:
        raw_root = config.project_path / "raw"
        wiki_root = config.wiki_dir
        reset_info = {
            "ok": True,
            "planned": True,
            "would_remove": [
                str(raw_root),
                str(wiki_root),
                str(config.project_path / ".llm-wiki"),
                str(config.project_path / ".bridge/state.json"),
                str(config.state_path),
            ],
            "raw_dir": str(config.raw_dir),
            "wiki_dir": str(wiki_root),
            "state_path": str(config.state_path),
        }

    state = BridgeState.load(config.state_path)
    client = LuminaClient(config)

    updated_after = state.last_article_sync_at
    effective_mode = "incremental" if updated_after else "full"
    if requested_mode == "full" or rebuild:
        updated_after = None
        effective_mode = "full"
    elif requested_mode == "incremental":
        effective_mode = "incremental" if updated_after else "full"
    elif requested_mode == "article":
        effective_mode = "article"

    if dry_run:
        return {
            "accepted": True,
            "dry_run": True,
            "mode": effective_mode,
            "rebuild": bool(rebuild),
            "updated_after": updated_after,
            "article_id": article_id,
            "reset": reset_info,
            "would_export_all": updated_after is None and not article_id,
            "would_request_compile": bool(rebuild or effective_mode == "full"),
            "hint": (
                "Rebuild deletes local raw/wiki, re-exports all sources, then best-effort recompiles."
                if rebuild
                else None
            ),
        }

    articles = client.export_articles(updated_after=updated_after)
    if article_id:
        article_id = str(article_id).strip()
        articles = [item for item in articles if str(item.get("id") or "").strip() == article_id]
        effective_mode = "article"
    exported = 0
    skipped = 0
    max_updated_at = state.last_article_sync_at
    slug_to_id: dict[str, str] = {}

    # Seed slug map from previously exported raw files so source rewrites
    # still resolve even when the current export batch is empty/incremental.
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
            # raw filename uses slug__idprefix
            if "__" in stem:
                slug = stem.rsplit("__", 1)[0]
            else:
                slug = stem
        if slug:
            slug_to_id[slug] = article_id
            slug_to_id[slugify_filename(slug)] = article_id

    for article in articles:
        article_id = str(article.get("id") or "").strip()
        if not article_id:
            continue
        slug = str(article.get("slug") or "").strip()
        if slug:
            slug_to_id[slug] = article_id
            slug_to_id[slugify_filename(slug)] = article_id
        selected = select_export_body(article)
        if not selected["body"].strip():
            skipped += 1
            continue
        digest = body_hash(selected["title"], selected["body"])
        # full/rebuild always rewrites local sources; incremental can skip unchanged bodies
        if effective_mode == "incremental" and state.article_hashes.get(article_id) == digest:
            skipped += 1
            updated_at = str(article.get("updated_at") or "")
            if updated_at and (not max_updated_at or updated_at > max_updated_at):
                max_updated_at = updated_at
            continue
        path = write_raw_article(config, article, selected)
        rel = str(path.relative_to(config.project_path))
        state.article_hashes[article_id] = digest
        state.article_paths[article_id] = rel
        exported += 1
        updated_at = str(article.get("updated_at") or "")
        if updated_at and (not max_updated_at or updated_at > max_updated_at):
            max_updated_at = updated_at

    compile_info = None
    if rebuild or effective_mode == "full":
        # Sources are now on disk; ask llm_wiki to recompile when possible.
        compile_info = request_llm_wiki_recompile(config)

    topics = scan_wiki_topics(
        config.wiki_dir,
        article_paths=state.article_paths,
        slug_to_id=slug_to_id,
        file_cache=state.wiki_file_cache,
    )
    compiled_at = utc_now_iso()

    # After a destructive rebuild, wiki may still be empty until llm_wiki finishes
    # compiling. Avoid a no-op/empty writeback that could confuse operators.
    # If wiki topics are not ready yet (common after rebuild / fresh export),
    # skip empty writeback and schedule an automatic secondary writeback.
    if not topics and (rebuild or effective_mode in {"full", "article"} or exported > 0):
        state.last_article_sync_at = max_updated_at or compiled_at
        state.save(config.state_path)
        run_id = f"sync_{uuid.uuid4().hex[:12]}"
        auto_wb = schedule_auto_writeback(config, run_id=run_id)
        return {
            "accepted": True,
            "run_id": run_id,
            "mode": effective_mode,
            "rebuild": bool(rebuild),
            "reset": reset_info,
            "compile": compile_info,
            "exported_articles": exported,
            "skipped_articles": skipped,
            "scanned_topics": 0,
            "writeback_topics": 0,
            "writeback_topics_changed": 0,
            "writeback_topics_unchanged": 0,
            "writeback_articles": 0,
            "writeback_articles_changed": 0,
            "writeback_articles_unchanged": 0,
            "writeback_skipped": True,
            "auto_writeback": auto_wb,
            "compile_status": inspect_llm_wiki_compile(config),
            "status": "awaiting_compile",
            "hint": (
                "Local sources were exported and llm_wiki compile is in progress. "
                "Bridge will automatically write topics back once entity/concept pages appear."
            ),
        }

    force_writeback = bool(rebuild or effective_mode == "full")
    changed_topics, next_topic_hashes, topic_stats = filter_changed_topics(
        topics,
        state,
        force=force_writeback,
    )
    article_payload, next_article_topic_hashes, article_stats = build_article_writeback_payload(
        topics=topics,
        articles=articles,
        state=state,
        compiled_at=compiled_at,
        force=force_writeback,
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
        # Keep fingerprints aligned even when nothing changed.
        apply_writeback_hashes(
            state,
            topic_hashes=next_topic_hashes,
            article_topic_hashes=next_article_topic_hashes,
        )

    state.last_article_sync_at = max_updated_at or compiled_at
    state.save(config.state_path)

    return {
        "accepted": True,
        "run_id": f"sync_{uuid.uuid4().hex[:12]}",
        "mode": effective_mode,
        "rebuild": bool(rebuild),
        "reset": reset_info,
        "compile": compile_info,
        "exported_articles": exported,
        "skipped_articles": skipped,
        "scanned_topics": topic_stats["scanned_topics"],
        "writeback_topics": topic_stats["changed_topics"],
        "writeback_topics_changed": topic_stats["changed_topics"],
        "writeback_topics_unchanged": topic_stats["unchanged_topics"],
        "writeback_articles": article_stats["changed_articles"],
        "writeback_articles_changed": article_stats["changed_articles"],
        "writeback_articles_unchanged": article_stats["unchanged_articles"],
        "status": "completed",
        "writeback": writeback_result,
        "writeback_skipped": writeback_result is None,
        "hint": (
            None
            if (changed_topics or article_payload)
            else "No topic/article changes detected; writeback skipped."
        ),
    }


# Re-export knowledge ops used by HTTP server / tests.
from .knowledge_ops import (  # noqa: E402
    get_writeback_job,
    inspect_llm_wiki_compile,
    reset_local_knowledge_data,
    reset_writeback_job,
    schedule_auto_writeback,
    writeback_topics_from_wiki,
)
