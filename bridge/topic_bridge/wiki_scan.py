from __future__ import annotations

import re
from pathlib import Path
from typing import Any

FRONTMATTER_RE = re.compile(r"^---\s*\n(.*?)\n---\s*\n?", re.S)
WIKILINK_RE = re.compile(r"\[\[([^\]]+)\]\]")
ARTICLE_URL_RE = re.compile(r"/article/([a-zA-Z0-9\-_%]+)")
LUMINA_ID_RE = re.compile(r"lumina_id\s*:\s*([a-f0-9\-]{8,})", re.I)
UUID_RE = re.compile(
    r"\b[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\b",
    re.I,
)
UGLY_SOURCE_DISPLAY_RE = re.compile(
    r"(?:^|\b)(?:\d+-)?lumina--|/sources/|f0bcf0bf|[0-9a-f]{8,}--",
    re.I,
)


def _parse_frontmatter(text: str) -> tuple[dict[str, Any], str]:
    match = FRONTMATTER_RE.match(text)
    if not match:
        return {}, text
    meta: dict[str, Any] = {}
    for line in match.group(1).splitlines():
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        key = key.strip()
        value = value.strip()
        if value.startswith("[") and value.endswith("]"):
            inner = value[1:-1].strip()
            if not inner:
                meta[key] = []
            else:
                items = []
                for part in inner.split(","):
                    item = part.strip().strip('"').strip("'")
                    if item:
                        items.append(item)
                meta[key] = items
        else:
            meta[key] = value.strip('"').strip("'")
    return meta, text[match.end() :]


def _wikilink_parts(raw: str) -> tuple[str, str]:
    value = (raw or "").strip()
    if not value:
        return "", ""
    target = value
    display = value
    if "|" in value:
        target, display = value.split("|", 1)
        target = target.strip()
        display = display.strip()
    display_name = display.split("/")[-1]
    display_name = re.sub(r"\.(md|markdown)$", "", display_name, flags=re.I)
    return target.strip(), (display_name or display or target).strip()


def _wikilink_display(raw: str) -> str:
    _, display = _wikilink_parts(raw)
    return display


def _is_source_target(target: str) -> bool:
    lower = (target or "").strip().lower().replace("\\", "/")
    return (
        lower.startswith("sources/")
        or "/sources/" in lower
        or lower.startswith("raw/sources/")
        or lower.startswith("lumina/")
    )


def _is_ugly_source_label(value: str) -> bool:
    text = (value or "").strip()
    if not text:
        return True
    if UGLY_SOURCE_DISPLAY_RE.search(text):
        return True
    if text.count("-") >= 5 and len(text) >= 40:
        return True
    return False


def _lookup_source_link(
    target: str,
    source_links: dict[str, dict[str, str]],
) -> dict[str, str] | None:
    if not target:
        return None
    raw = target.strip().replace("\\", "/")
    name = Path(raw).name
    stem = Path(name).stem
    candidates = [
        raw,
        raw.lower(),
        name,
        stem,
        f"sources/{stem}",
        f"sources/{name}",
        stem.replace("---lumina", "").replace("--lumina", ""),
    ]
    # also strip leading sources/
    if raw.lower().startswith("sources/"):
        candidates.append(raw.split("/", 1)[1])
        candidates.append(Path(raw.split("/", 1)[1]).stem)
    for key in candidates:
        key = str(key or "").strip()
        if key and key in source_links:
            return source_links[key]
        lower = key.lower()
        if lower and lower in source_links:
            return source_links[lower]
    return None


def rewrite_wiki_links_for_lumina(
    body: str,
    *,
    source_links: dict[str, dict[str, str]] | None = None,
) -> str:
    links = source_links or {}

    def repl(match: re.Match[str]) -> str:
        raw = match.group(1).strip()
        target, display = _wikilink_parts(raw)
        if not target and not display:
            return display
        if _is_source_target(target) or _lookup_source_link(target, links):
            info = _lookup_source_link(target, links)
            if info and info.get("slug"):
                label = display
                if _is_ugly_source_label(label):
                    label = info.get("title") or info.get("slug") or label
                label = (label or info.get("title") or info.get("slug") or "文章").strip()
                return f"[{label}](/article/{info['slug']})"
            # unresolved source: drop ugly ids, keep readable alias only
            if display and not _is_ugly_source_label(display):
                return display
            return ""
        key = _normalize_key(Path(target.split("/")[-1]).stem or display)
        if not key:
            return display
        label = display or key
        return f"[{label}](/topics/{key})"

    return WIKILINK_RE.sub(repl, body or "")


def derive_summary_from_markdown(content_md: str | None, *, limit: int = 180) -> str:
    """Derive a short summary from cleaned markdown body. Not an independent field."""
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
    return ""


def _normalize_topic_body(
    body: str,
    *,
    title: str | None = None,
    source_links: dict[str, dict[str, str]] | None = None,
) -> str:
    content = rewrite_wiki_links_for_lumina(body or "", source_links=source_links).strip()
    if not content:
        return ""
    lines = content.splitlines()
    if lines:
        first = lines[0].strip()
        if first.startswith("# "):
            heading = first[2:].strip()
            if (
                not title
                or heading == title.strip()
                or _normalize_key(heading) == _normalize_key(title)
            ):
                lines = lines[1:]
                while lines and not lines[0].strip():
                    lines = lines[1:]
    # collapse leftover double spaces from removed unresolved source links
    cleaned_lines = []
    for line in lines:
        cleaned = re.sub(r"[ \t]{2,}", " ", line).rstrip()
        cleaned_lines.append(cleaned)
    text = "\n".join(cleaned_lines).strip()
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text


def _extract_claims(body: str) -> list[str]:
    claims: list[str] = []
    for line in (body or "").splitlines():
        stripped = line.strip()
        if re.match(r"^[-*+]\s+\*\*.+\*\*", stripped):
            claims.append(re.sub(r"^[-*+]\s+", "", stripped)[:300])
        elif re.match(r"^\d+\.\s+", stripped):
            claims.append(re.sub(r"^\d+\.\s+", "", stripped)[:300])
        if len(claims) >= 5:
            break
    return claims


def _normalize_key(value: str) -> str:
    text = (value or "").strip().lower()
    text = re.sub(r"[\s_]+", "-", text)
    text = re.sub(r"[^a-z0-9\u4e00-\u9fff-]+", "", text)
    text = re.sub(r"-{2,}", "-", text).strip("-")
    return text[:80]


def _unique(items: list[str]) -> list[str]:
    seen: set[str] = set()
    ordered: list[str] = []
    for item in items:
        if not item or item in seen:
            continue
        seen.add(item)
        ordered.append(item)
    return ordered


def _add_source_link(
    index: dict[str, dict[str, str]],
    key: str,
    *,
    article_id: str,
    slug: str,
    title: str = "",
) -> None:
    cleaned = str(key or "").strip()
    if not cleaned or not article_id or not slug:
        return
    payload = {
        "article_id": article_id,
        "slug": slug,
        "title": (title or "").strip(),
    }
    for candidate in {cleaned, cleaned.lower()}:
        current = index.get(candidate)
        if current is None:
            index[candidate] = payload
            continue
        # prefer entries that already have title
        if not current.get("title") and payload["title"]:
            index[candidate] = payload


def _build_source_link_index(
    wiki_dir: Path,
    *,
    article_paths: dict[str, str],
    slug_to_id: dict[str, str],
) -> dict[str, dict[str, str]]:
    """Map source stems/paths -> Lumina article link info."""
    index: dict[str, dict[str, str]] = {}
    id_to_slug = {article_id: "" for article_id in article_paths}
    id_to_title: dict[str, str] = {}

    # exported raw files carry lumina_id / lumina_slug / title
    for article_id, rel in article_paths.items():
        path = wiki_dir.parent / rel
        if not path.exists():
            # still index by relative path stem using slug_to_id inverse later
            stem = Path(rel).stem
            slug = next((s for s, i in slug_to_id.items() if i == article_id), "")
            if slug:
                id_to_slug[article_id] = slug
                _add_source_link(
                    index,
                    stem,
                    article_id=article_id,
                    slug=slug,
                )
                _add_source_link(
                    index,
                    Path(rel).name,
                    article_id=article_id,
                    slug=slug,
                )
            continue
        text = path.read_text(encoding="utf-8", errors="ignore")
        meta, _ = _parse_frontmatter(text)
        resolved_id = str(meta.get("lumina_id") or article_id or "").strip()
        slug = str(meta.get("lumina_slug") or "").strip()
        title = str(meta.get("title") or "").strip()
        if not slug:
            slug = next((s for s, i in slug_to_id.items() if i == resolved_id), "")
        if not resolved_id or not slug:
            continue
        id_to_slug[resolved_id] = slug
        if title:
            id_to_title[resolved_id] = title
        for key in (
            path.stem,
            path.name,
            slug,
            rel,
            Path(rel).name,
            Path(rel).stem,
            f"lumina/{Path(rel).name}",
            f"lumina/{Path(rel).stem}",
            f"raw/sources/lumina/{Path(rel).name}",
            f"raw/sources/lumina/{Path(rel).stem}",
        ):
            _add_source_link(
                index,
                key,
                article_id=resolved_id,
                slug=slug,
                title=title,
            )

    # fill slug keys
    for slug, article_id in slug_to_id.items():
        slug = str(slug or "").strip()
        article_id = str(article_id or "").strip()
        if not slug or not article_id:
            continue
        id_to_slug.setdefault(article_id, slug)
        _add_source_link(
            index,
            slug,
            article_id=article_id,
            slug=id_to_slug.get(article_id) or slug,
            title=id_to_title.get(article_id, ""),
        )

    sources_dir = wiki_dir / "sources"
    if sources_dir.exists():
        for path in sources_dir.glob("*.md"):
            text = path.read_text(encoding="utf-8", errors="ignore")
            meta, body = _parse_frontmatter(text)
            title = str(meta.get("title") or "").strip()
            source_vals = meta.get("sources") or []
            if not isinstance(source_vals, list):
                source_vals = [source_vals] if source_vals else []
            resolved: dict[str, str] | None = None
            for source in source_vals:
                resolved = _lookup_source_link(str(source), index)
                if resolved:
                    break
            if not resolved:
                blob_parts = [path.stem, path.name, title, body]
                for value in meta.values():
                    if isinstance(value, list):
                        blob_parts.extend(str(v) for v in value)
                    else:
                        blob_parts.append(str(value))
                blob = "\n".join(blob_parts)
                for match in ARTICLE_URL_RE.findall(blob):
                    slug = match.strip()
                    if slug in slug_to_id:
                        article_id = slug_to_id[slug]
                        resolved = {
                            "article_id": article_id,
                            "slug": slug,
                            "title": title or id_to_title.get(article_id, ""),
                        }
                        break
                if not resolved:
                    for match in list(LUMINA_ID_RE.findall(blob)) + list(
                        UUID_RE.findall(blob)
                    ):
                        article_id = match.strip()
                        slug = id_to_slug.get(article_id) or next(
                            (s for s, i in slug_to_id.items() if i == article_id),
                            "",
                        )
                        if article_id in article_paths or slug:
                            if slug:
                                resolved = {
                                    "article_id": article_id,
                                    "slug": slug,
                                    "title": title or id_to_title.get(article_id, ""),
                                }
                                break
            if not resolved:
                continue
            if title and not resolved.get("title"):
                resolved = {**resolved, "title": title}
            for key in (
                path.stem,
                path.name,
                f"sources/{path.stem}",
                f"sources/{path.name}",
                f"wiki/sources/{path.stem}",
                f"wiki/sources/{path.name}",
            ):
                _add_source_link(
                    index,
                    key,
                    article_id=resolved["article_id"],
                    slug=resolved["slug"],
                    title=resolved.get("title") or title,
                )
    return index


def _build_source_index(
    wiki_dir: Path,
    *,
    article_paths: dict[str, str],
    slug_to_id: dict[str, str],
) -> dict[str, list[str]]:
    """Map source stem / filename -> article ids."""
    link_index = _build_source_link_index(
        wiki_dir,
        article_paths=article_paths,
        slug_to_id=slug_to_id,
    )
    index: dict[str, list[str]] = {}
    for key, info in link_index.items():
        article_id = str(info.get("article_id") or "").strip()
        if not article_id:
            continue
        index.setdefault(key, [])
        if article_id not in index[key]:
            index[key].append(article_id)
    return index


def _resolve_article_ids(
    sources: list[str],
    *,
    source_index: dict[str, list[str]],
    article_paths: dict[str, str],
    slug_to_id: dict[str, str],
) -> list[str]:
    ids: list[str] = []
    for source in sources:
        raw = str(source or "").strip()
        if not raw:
            continue
        name = Path(raw).name
        stem = Path(name).stem
        for key in (
            raw,
            name,
            stem,
            stem.replace("---Lumina", ""),
            stem.replace("--Lumina", ""),
            f"lumina/{name}",
            f"lumina/{stem}",
        ):
            key = key.strip()
            if key in source_index:
                ids.extend(source_index[key])
            lower = key.lower()
            if lower in source_index:
                ids.extend(source_index[lower])
            if key in slug_to_id:
                ids.append(slug_to_id[key])
        for article_id, rel_path in article_paths.items():
            rel_stem = Path(rel_path).stem
            if (
                stem == rel_stem
                or stem.endswith(article_id[:8])
                or article_id[:8] in stem
            ):
                ids.append(article_id)
        for slug, article_id in slug_to_id.items():
            if slug and len(slug) >= 8 and slug in stem:
                ids.append(article_id)
    return _unique(ids)


def _filter_related_topic_keys(keys: list[str], *, self_key: str) -> list[str]:
    ordered: list[str] = []
    seen: set[str] = set()
    for item in keys:
        key = _normalize_key(str(item))
        if not key or key == self_key or key in seen:
            continue
        raw = str(item or "").strip().lower()
        if raw.startswith("sources/") or raw.startswith("raw/sources/"):
            continue
        if key.startswith("sources-") or "lumina--" in key:
            continue
        if re.match(r"^\d+-lumina", key):
            continue
        seen.add(key)
        ordered.append(key)
    return ordered



def list_wiki_topic_keys(wiki_dir: Path) -> list[str]:
    """Return normalized entity/concept keys currently present in local wiki."""
    keys: list[str] = []
    seen: set[str] = set()
    if not wiki_dir.exists():
        return keys
    for sub in ("entities", "concepts"):
        folder = wiki_dir / sub
        if not folder.exists():
            continue
        for path in sorted(folder.glob("*.md")):
            try:
                text = path.read_text(encoding="utf-8", errors="ignore")
            except OSError:
                continue
            meta, body = _parse_frontmatter(text)
            expected_type = "entity" if sub == "entities" else "concept"
            if str(meta.get("type") or "").strip().lower() != expected_type:
                continue
            tags = meta.get("tags") or []
            if isinstance(tags, list) and "stub" in {str(tag).strip().lower() for tag in tags}:
                continue
            title = str(meta.get("title") or "").strip()
            if not title or not body.strip():
                continue
            key = _normalize_key(str(meta.get("key") or title))
            if not key or key in seen:
                continue
            seen.add(key)
            keys.append(key)
    return keys


def scan_wiki_topics(
    wiki_dir: Path,
    *,
    article_paths: dict[str, str],
    slug_to_id: dict[str, str],
    file_cache: dict[str, dict] | None = None,
) -> list[dict[str, Any]]:
    """Scan entity/concept pages.

    file_cache is an optional mutable map:
      rel_path -> {mtime, size, mapping_fp, topic}
    Reuses parsed topic payloads when file mtime/size and article mapping
    fingerprint are unchanged. Callers should persist the updated cache.
    """
    topics: list[dict[str, Any]] = []
    if not wiki_dir.exists():
        return topics

    mapping_fp = _article_mapping_fingerprint(article_paths, slug_to_id)
    source_links = _build_source_link_index(
        wiki_dir,
        article_paths=article_paths,
        slug_to_id=slug_to_id,
    )
    source_index = _build_source_index(
        wiki_dir,
        article_paths=article_paths,
        slug_to_id=slug_to_id,
    )

    next_cache: dict[str, dict] = {}
    for kind, sub in (("concept", "concepts"), ("entity", "entities")):
        folder = wiki_dir / sub
        if not folder.exists():
            continue
        for path in sorted(folder.glob("*.md")):
            try:
                stat = path.stat()
            except OSError:
                continue
            try:
                rel = str(path.relative_to(wiki_dir.parent))
            except Exception:
                rel = str(path)
            cached = (file_cache or {}).get(rel) if file_cache is not None else None
            if (
                isinstance(cached, dict)
                and cached.get("mtime") == stat.st_mtime
                and cached.get("size") == stat.st_size
                and cached.get("mapping_fp") == mapping_fp
                and isinstance(cached.get("topic"), dict)
            ):
                topic = dict(cached["topic"])
                topics.append(topic)
                next_cache[rel] = cached
                continue

            text = path.read_text(encoding="utf-8", errors="ignore")
            meta, body = _parse_frontmatter(text)
            if str(meta.get("type") or "").strip().lower() != kind:
                continue
            tags = meta.get("tags") or []
            if isinstance(tags, list) and "stub" in {str(tag).strip().lower() for tag in tags}:
                continue
            title = str(meta.get("title") or path.stem).strip()
            if not title or not body.strip():
                continue
            key = _normalize_key(str(meta.get("key") or title))
            if not key:
                continue
            related = meta.get("related") or []
            if not isinstance(related, list):
                related = []
            related_keys = _filter_related_topic_keys(
                [str(item) for item in related],
                self_key=key,
            )
            sources = meta.get("sources") or []
            if not isinstance(sources, list):
                sources = []
            article_ids = _resolve_article_ids(
                [str(item) for item in sources],
                source_index=source_index,
                article_paths=article_paths,
                slug_to_id=slug_to_id,
            )
            tags = meta.get("tags") or []
            if not isinstance(tags, list):
                tags = []
            tags = [str(item).strip() for item in tags if str(item).strip()]
            claims = [
                {"text": claim, "article_ids": article_ids[:]}
                for claim in _extract_claims(body)
            ]
            content_md = _normalize_topic_body(
                body,
                title=title,
                source_links=source_links,
            )
            topic = {
                "key": key,
                "title": title,
                "content_md": content_md,
                "tags": tags,
                "status": "active",
                "topic_type": kind,
                "article_ids": article_ids,
                "claims": claims,
                "related_topic_keys": related_keys,
                "compiler_ref": rel if rel.startswith("wiki/") else str(path.relative_to(wiki_dir.parent)),
            }
            topics.append(topic)
            next_cache[rel] = {
                "mtime": stat.st_mtime,
                "size": stat.st_size,
                "mapping_fp": mapping_fp,
                "topic": topic,
            }

    if file_cache is not None:
        file_cache.clear()
        file_cache.update(next_cache)
    return topics


def _article_mapping_fingerprint(
    article_paths: dict[str, str],
    slug_to_id: dict[str, str],
) -> str:
    import hashlib
    import json

    payload = {
        "article_paths": {
            str(k): str(v)
            for k, v in sorted((article_paths or {}).items(), key=lambda item: str(item[0]))
        },
        "slug_to_id": {
            str(k): str(v)
            for k, v in sorted((slug_to_id or {}).items(), key=lambda item: str(item[0]))
        },
    }
    raw = json.dumps(payload, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()
