from __future__ import annotations

import re
from html import unescape
from urllib.parse import urljoin

_ATTR_RE = re.compile(
    r"([A-Za-z_:][-A-Za-z0-9_:.]*)\s*=\s*(\"[^\"]*\"|'[^']*'|[^\s\"'=<>`]+)"
)
_IMG_RE = re.compile(r"<img\b[^>]*>", re.IGNORECASE)
_MD_IMAGE_RE = re.compile(r"!\[[^\]]*\]\(([^)]+)\)")


def resolve_top_image(
    top_image: str | None,
    *,
    content_html: str | None = None,
    content_md: str | None = None,
    base_url: str | None = None,
) -> str | None:
    normalized = _normalize_image_url(top_image, base_url=base_url)
    if normalized:
        return normalized

    first_html_image = _extract_first_image_from_html(content_html, base_url=base_url)
    if first_html_image:
        return first_html_image

    return _extract_first_image_from_markdown(content_md, base_url=base_url)


def _extract_first_image_from_html(
    html: str | None,
    *,
    base_url: str | None = None,
) -> str | None:
    if not html:
        return None

    for image_match in _IMG_RE.finditer(html):
        attrs = _parse_tag_attrs(image_match.group(0))
        candidate = (
            attrs.get("src")
            or attrs.get("data-src")
            or attrs.get("data-original")
            or attrs.get("data-lazy-src")
        )
        normalized = _normalize_image_url(candidate, base_url=base_url)
        if normalized:
            return normalized
    return None


def _extract_first_image_from_markdown(
    markdown: str | None,
    *,
    base_url: str | None = None,
) -> str | None:
    if not markdown:
        return None

    for match in _MD_IMAGE_RE.finditer(markdown):
        target = (match.group(1) or "").strip()
        if not target:
            continue

        if target.startswith("<") and ">" in target:
            target = target[1 : target.find(">")].strip()
        elif " " in target:
            target = target.split(" ", 1)[0].strip()

        normalized = _normalize_image_url(target, base_url=base_url)
        if normalized:
            return normalized
    return None


def _parse_tag_attrs(raw_tag: str) -> dict[str, str]:
    result: dict[str, str] = {}
    for match in _ATTR_RE.finditer(raw_tag or ""):
        key = (match.group(1) or "").strip().lower()
        if not key:
            continue
        value = (match.group(2) or "").strip()
        if value and (value[0] == value[-1]) and value[0] in {"'", '"'}:
            value = value[1:-1]
        result[key] = unescape(value.strip())
    return result


def _normalize_image_url(value: str | None, *, base_url: str | None = None) -> str | None:
    candidate = unescape((value or "").strip())
    if not candidate:
        return None

    lowered = candidate.lower()
    if lowered.startswith("javascript:") or lowered.startswith("data:"):
        return None

    if base_url:
        return urljoin(base_url, candidate)
    return candidate
