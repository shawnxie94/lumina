from __future__ import annotations

import re
from urllib.parse import urljoin

from fastapi import Request, Response


_IMAGE_LINK_RE = re.compile(r"!\[([^\]]*)\]\((\S+?)(\s+\"[^\"]*\")?\)")
_MARKDOWN_LINK_RE = re.compile(
    r"(^|[^!])\[([^\]]*)\]\((\S+?)(\s+\"[^\"]*\")?\)",
    re.MULTILINE,
)
_HTML_HREF_RE = re.compile(
    r"<a\b([^>]*?)\shref=([\"'])([^\"']+)\2([^>]*)>",
    re.IGNORECASE,
)
_HTML_SRC_RE = re.compile(
    r"<(img|video|audio|source|embed|iframe)\b([^>]*?)\ssrc=([\"'])([^\"']+)\3([^>]*)>",
    re.IGNORECASE,
)


def normalize_block(value: object) -> str:
    return str(value or "").strip()


def _first_header_value(value: str | None) -> str:
    return normalize_block((value or "").split(",")[0])


def _normalize_host(value: str | None) -> str:
    host = _first_header_value(value)
    if not host or re.search(r"[\s/\\]", host):
        return ""
    return host


def _normalize_protocol(value: str | None) -> str:
    protocol = _first_header_value(value).replace(":", "").lower()
    return protocol if protocol in {"http", "https"} else ""


def resolve_export_origin(request: Request) -> str:
    origin = normalize_block(request.headers.get("origin"))
    if re.match(r"^https?://", origin, re.IGNORECASE):
        return origin.rstrip("/")

    forwarded_host = _normalize_host(request.headers.get("x-forwarded-host"))
    host = forwarded_host or _normalize_host(request.headers.get("host")) or request.url.netloc
    protocol = _normalize_protocol(request.headers.get("x-forwarded-proto")) or request.url.scheme
    return f"{protocol}://{host}".rstrip("/")


def resolve_export_asset_url(origin: str, value: object) -> str:
    normalized = normalize_block(value)
    if not normalized:
        return ""
    lowered = normalized.lower()
    if (
        re.match(r"^(?:https?:)?//", normalized, re.IGNORECASE)
        or normalized.startswith("#")
        or lowered.startswith(("mailto:", "tel:", "data:", "blob:"))
    ):
        return normalized
    if normalized.startswith("/media/"):
        return urljoin(origin, f"/backend{normalized}")
    if normalized.startswith("/backend/") or normalized.startswith("/"):
        return urljoin(origin, normalized)
    return normalized


def absolutize_markdown_media_urls(origin: str, markdown: str) -> str:
    def replace_link(match: re.Match) -> str:
        prefix, text, url, title_part = match.groups()
        return f"{prefix}[{text}]({resolve_export_asset_url(origin, url)}{title_part or ''})"

    def replace_image(match: re.Match) -> str:
        alt, url, title_part = match.groups()
        return f"![{alt}]({resolve_export_asset_url(origin, url)}{title_part or ''})"

    def replace_href(match: re.Match) -> str:
        before_href, quote, href, after_href = match.groups()
        return f"<a{before_href} href={quote}{resolve_export_asset_url(origin, href)}{quote}{after_href}>"

    def replace_src(match: re.Match) -> str:
        tag_name, before_src, quote, src, after_src = match.groups()
        return f"<{tag_name}{before_src} src={quote}{resolve_export_asset_url(origin, src)}{quote}{after_src}>"

    return _HTML_SRC_RE.sub(
        replace_src,
        _HTML_HREF_RE.sub(
            replace_href,
            _IMAGE_LINK_RE.sub(
                replace_image,
                _MARKDOWN_LINK_RE.sub(replace_link, markdown or ""),
            ),
        ),
    )


def build_detail_export_markdown(
    *,
    origin: str,
    title: object,
    top_image: object,
    body: object,
) -> str:
    sections = [f"# {normalize_block(title)}"]
    resolved_top_image = resolve_export_asset_url(origin, top_image)
    normalized_body = absolutize_markdown_media_urls(origin, normalize_block(body))

    if resolved_top_image:
        sections.append(f"![]({resolved_top_image})")
    if normalized_body:
        sections.append(normalized_body)

    return "\n\n".join(section.strip() for section in sections if section.strip()).strip() + "\n"


def build_markdown_response(markdown: str, filename: str) -> Response:
    safe_filename = normalize_block(filename).replace('"', "") or "export.md"
    return Response(
        content=markdown,
        media_type="text/markdown; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="{safe_filename}"',
            "Cache-Control": "public, max-age=300, stale-while-revalidate=300",
        },
    )
