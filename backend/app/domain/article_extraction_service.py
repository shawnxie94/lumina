from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass, field
from html import escape, unescape
from urllib.parse import quote, urlparse

import httpx
from sqlalchemy.orm import Session

from app.domain.article_top_image_service import resolve_top_image
from auth import get_admin_settings

logger = logging.getLogger("article_extraction")

MAX_HTML_SIZE_BYTES = 2 * 1024 * 1024
DEFAULT_REQUEST_TIMEOUT = httpx.Timeout(15.0, connect=5.0)
USER_AGENT = "LuminaURLIngest/1.0 (+https://github.com/shawnxie94/lumina)"
DEFAULT_JINA_READER_BASE_URL = "https://r.jina.ai"
MIN_EXTRACTED_TEXT_LENGTH = 40

_ATTR_RE = re.compile(
    r"([A-Za-z_:][-A-Za-z0-9_:.]*)\s*=\s*(\"[^\"]*\"|'[^']*'|[^\s\"'=<>`]+)"
)
_TITLE_RE = re.compile(r"<title\b[^>]*>(.*?)</title>", re.IGNORECASE | re.DOTALL)
_H1_RE = re.compile(r"<h1\b[^>]*>(.*?)</h1>", re.IGNORECASE | re.DOTALL)
_META_RE = re.compile(r"<meta\b[^>]*>", re.IGNORECASE)
_TIME_RE = re.compile(
    r"<time\b[^>]*datetime=(\"[^\"]+\"|'[^']+')[^>]*>",
    re.IGNORECASE,
)
_TAG_RE = re.compile(r"<[^>]+>")
_NOISE_TAG_RE = re.compile(
    r"<(script|style|noscript|template)\b[^>]*>.*?</\1>",
    re.IGNORECASE | re.DOTALL,
)
_ARTICLE_RE = re.compile(r"<article\b[^>]*>.*?</article>", re.IGNORECASE | re.DOTALL)
_MAIN_RE = re.compile(r"<main\b[^>]*>.*?</main>", re.IGNORECASE | re.DOTALL)
_BODY_RE = re.compile(r"<body\b[^>]*>(.*)</body>", re.IGNORECASE | re.DOTALL)
_LINE_BREAK_RE = re.compile(r"<br\s*/?>", re.IGNORECASE)
_BLOCK_END_RE = re.compile(
    r"</(p|div|li|h[1-6]|section|article|main|tr|blockquote)>",
    re.IGNORECASE,
)
_LIST_ITEM_RE = re.compile(r"<li\b[^>]*>", re.IGNORECASE)
_MULTI_SPACE_RE = re.compile(r"[ \t\r\f\v]+")
_MULTI_NEWLINE_RE = re.compile(r"\n{3,}")
_MARKDOWN_HEADING_RE = re.compile(r"^\s*#\s+(.+?)\s*$", re.MULTILINE)
_CJK_RE = re.compile(r"[\u3400-\u9fff]")
_C1_CONTROL_RE = re.compile(r"[\u0080-\u009f]")
_MOJIBAKE_MARKER_RE = re.compile(r"[ÂÃ]|â[\u0080-\uffff]|[åæçèéäöüœž]")

_CP1252_ENCODE_OVERRIDES = {
    0x20AC: 0x80,
    0x201A: 0x82,
    0x0192: 0x83,
    0x201E: 0x84,
    0x2026: 0x85,
    0x2020: 0x86,
    0x2021: 0x87,
    0x02C6: 0x88,
    0x2030: 0x89,
    0x0160: 0x8A,
    0x2039: 0x8B,
    0x0152: 0x8C,
    0x017D: 0x8E,
    0x2018: 0x91,
    0x2019: 0x92,
    0x201C: 0x93,
    0x201D: 0x94,
    0x2022: 0x95,
    0x2013: 0x96,
    0x2014: 0x97,
    0x02DC: 0x98,
    0x2122: 0x99,
    0x0161: 0x9A,
    0x203A: 0x9B,
    0x0153: 0x9C,
    0x017E: 0x9E,
    0x0178: 0x9F,
}


class ArticleExtractionError(Exception):
    def __init__(self, detail: str):
        super().__init__(detail)
        self.detail = detail


class ArticleExtractionBadRequestError(ArticleExtractionError):
    pass


class ArticleExtractionContentTypeError(ArticleExtractionError):
    pass


class ArticleExtractionBadGatewayError(ArticleExtractionError):
    pass


class ArticleExtractionGatewayTimeoutError(ArticleExtractionError):
    pass


def _count_cjk(value: str) -> int:
    return len(_CJK_RE.findall(value or ""))


def _mojibake_marker_score(value: str) -> int:
    text = value or ""
    return len(_C1_CONTROL_RE.findall(text)) + len(_MOJIBAKE_MARKER_RE.findall(text))


def _is_mojibake_byte_like(char: str | None) -> bool:
    if not char:
        return False
    codepoint = ord(char)
    return codepoint >= 0x80 or codepoint in _CP1252_ENCODE_OVERRIDES


def _encode_mojibake_as_bytes(value: str) -> bytes:
    payload = bytearray()
    for index, char in enumerate(value):
        if (
            char == " "
            and _is_mojibake_byte_like(value[index - 1] if index > 0 else None)
            and _is_mojibake_byte_like(
                value[index + 1] if index + 1 < len(value) else None
            )
        ):
            payload.append(0xA0)
            continue

        codepoint = ord(char)
        if codepoint <= 0xFF:
            payload.append(codepoint)
            continue
        override = _CP1252_ENCODE_OVERRIDES.get(codepoint)
        if override is None:
            raise UnicodeEncodeError(
                "cp1252-or-latin1",
                char,
                0,
                1,
                "character cannot be mapped back to one byte",
            )
        payload.append(override)
    return bytes(payload)


def _is_utf8_continuation_byte(value: int) -> bool:
    return 0x80 <= value <= 0xBF


def _decode_mojibake_bytes(payload: bytes) -> str:
    try:
        return payload.decode("utf-8")
    except UnicodeDecodeError:
        repaired = bytearray()
        index = 0
        while index < len(payload):
            current = payload[index]
            next_byte = payload[index + 1] if index + 1 < len(payload) else None
            third_byte = payload[index + 2] if index + 2 < len(payload) else None

            if 0xE0 <= current <= 0xEF and next_byte is not None:
                if (
                    next_byte == 0x20
                    and third_byte is not None
                    and _is_utf8_continuation_byte(third_byte)
                ):
                    repaired.extend((current, 0xA0, third_byte))
                    index += 3
                    continue

                if _is_utf8_continuation_byte(next_byte) and (
                    third_byte is None or not _is_utf8_continuation_byte(third_byte)
                ):
                    repaired.extend((current, 0xA0, next_byte))
                    index += 2
                    continue

            repaired.append(current)
            index += 1

        repaired_payload = bytes(repaired)
        try:
            return repaired_payload.decode("utf-8")
        except UnicodeDecodeError:
            return repaired_payload.decode("utf-8", errors="replace")


def _repair_utf8_mojibake(value: str) -> str:
    if not value:
        return value

    original_marker_score = _mojibake_marker_score(value)
    if original_marker_score < 3:
        return value

    try:
        candidate = _decode_mojibake_bytes(_encode_mojibake_as_bytes(value))
    except (UnicodeDecodeError, UnicodeEncodeError):
        return value

    if candidate == value:
        return value

    original_cjk_count = _count_cjk(value)
    candidate_cjk_count = _count_cjk(candidate)
    candidate_marker_score = _mojibake_marker_score(candidate)

    if (
        candidate_cjk_count >= max(3, original_cjk_count + 3)
        and candidate_marker_score < original_marker_score
    ):
        return candidate

    if (
        candidate_marker_score * 2 < original_marker_score
        and len(candidate) <= len(value)
    ):
        return candidate

    return value


@dataclass(frozen=True)
class LocalFetchResult:
    final_url: str
    html: str


@dataclass(frozen=True)
class ExtractedArticle:
    title: str
    content_html: str | None
    content_md: str
    source_url: str
    top_image: str | None
    author: str | None
    published_at: str | None
    source_domain: str
    provider: str
    status: str = "completed"
    error: str | None = None
    metadata: dict = field(default_factory=dict)


@dataclass(frozen=True)
class ExtractionSettings:
    jina_reader_enabled: bool
    jina_reader_base_url: str
    jina_reader_api_key: str
    jina_reader_timeout_seconds: int
    jina_reader_token_budget: int | None
    jina_reader_prefer_mode: str


class ArticleExtractionService:
    def resolve_settings(self, db: Session) -> ExtractionSettings:
        admin = get_admin_settings(db)
        base_url = (
            getattr(admin, "jina_reader_base_url", None) or DEFAULT_JINA_READER_BASE_URL
        )
        prefer_mode = getattr(admin, "jina_reader_prefer_mode", None) or "jina_first"
        if prefer_mode not in {"jina_first", "local_first", "local_only"}:
            prefer_mode = "jina_first"
        if not bool(getattr(admin, "jina_reader_enabled", False)):
            prefer_mode = "local_only"
        jina_reader_enabled = prefer_mode != "local_only"
        try:
            timeout_seconds = int(getattr(admin, "jina_reader_timeout_seconds", 15) or 15)
        except Exception:
            timeout_seconds = 15
        timeout_seconds = min(60, max(3, timeout_seconds))
        token_budget = getattr(admin, "jina_reader_token_budget", None)
        try:
            token_budget = int(token_budget) if token_budget else None
        except Exception:
            token_budget = None
        if token_budget is not None and token_budget <= 0:
            token_budget = None
        return ExtractionSettings(
            jina_reader_enabled=jina_reader_enabled,
            jina_reader_base_url=(base_url or DEFAULT_JINA_READER_BASE_URL).rstrip("/"),
            jina_reader_api_key=getattr(admin, "jina_reader_api_key", None) or "",
            jina_reader_timeout_seconds=timeout_seconds,
            jina_reader_token_budget=token_budget,
            jina_reader_prefer_mode=prefer_mode,
        )

    async def extract_url(
        self,
        db: Session,
        source_url: str,
        *,
        ensure_public_url,
    ) -> ExtractedArticle:
        settings = self.resolve_settings(db)
        attempts: list[dict] = []

        if (
            settings.jina_reader_enabled
            and settings.jina_reader_prefer_mode == "jina_first"
        ):
            try:
                result = await self._extract_with_jina(source_url, settings)
                ensure_public_url(result.source_url)
                return result
            except ArticleExtractionError as exc:
                attempts.append({"provider": "jina", "error": exc.detail})
                logger.info("jina_extraction_failed: %s", exc.detail)

        try:
            local = await self._extract_with_local_html(source_url)
            ensure_public_url(local.source_url)
            if attempts:
                return ExtractedArticle(
                    **{
                        **local.__dict__,
                        "status": "fallback_used",
                        "error": attempts[-1]["error"],
                        "metadata": {**local.metadata, "attempts": attempts},
                    }
                )
            return local
        except ArticleExtractionError:
            if settings.jina_reader_enabled and settings.jina_reader_prefer_mode == "local_first":
                try:
                    result = await self._extract_with_jina(source_url, settings)
                    ensure_public_url(result.source_url)
                    return result
                except ArticleExtractionError as jina_exc:
                    attempts.append({"provider": "jina", "error": jina_exc.detail})
            raise

    async def _extract_with_jina(
        self,
        source_url: str,
        settings: ExtractionSettings,
    ) -> ExtractedArticle:
        request_url = self._build_jina_url(settings.jina_reader_base_url, source_url)
        headers = {
            "Accept": "application/json",
            "User-Agent": USER_AGENT,
        }
        if settings.jina_reader_api_key:
            headers["Authorization"] = f"Bearer {settings.jina_reader_api_key}"
        if settings.jina_reader_token_budget:
            headers["X-Token-Budget"] = str(settings.jina_reader_token_budget)

        timeout = httpx.Timeout(float(settings.jina_reader_timeout_seconds), connect=5.0)
        try:
            async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
                response = await client.get(request_url, headers=headers)
        except httpx.TimeoutException as exc:
            raise ArticleExtractionGatewayTimeoutError("Jina Reader 解析超时") from exc
        except httpx.HTTPError as exc:
            raise ArticleExtractionBadGatewayError(f"Jina Reader 请求失败: {str(exc)}") from exc

        if response.status_code >= 400:
            raise ArticleExtractionBadGatewayError(
                f"Jina Reader 解析失败，状态码 {response.status_code}"
            )

        parsed = self._parse_jina_response(response)
        content_md = (parsed.get("content_md") or "").strip()
        if not self._is_valid_markdown(content_md):
            raise ArticleExtractionBadRequestError("Jina Reader 返回内容为空或过短")

        final_url = (parsed.get("source_url") or source_url).strip() or source_url
        title = (
            parsed.get("title")
            or self._extract_title_from_markdown(content_md)
            or self._title_from_url(final_url)
        )
        top_image = parsed.get("top_image")
        return ExtractedArticle(
            title=title,
            content_html=self._markdown_to_basic_html(content_md),
            content_md=content_md,
            source_url=final_url,
            top_image=top_image,
            author=parsed.get("author"),
            published_at=parsed.get("published_at"),
            source_domain=(urlparse(final_url).hostname or "").lower(),
            provider="jina",
            metadata={
                "reader_url": str(response.url),
                "status_code": response.status_code,
                "content_length": len(content_md),
            },
        )

    async def extract_html(
        self,
        db: Session,
        *,
        html: str,
        source_url: str | None = None,
        title: str | None = None,
        top_image: str | None = None,
        author: str | None = None,
        published_at: str | None = None,
        source_domain: str | None = None,
    ) -> ExtractedArticle:
        settings = self.resolve_settings(db)
        if (
            not settings.jina_reader_enabled
            or settings.jina_reader_prefer_mode == "local_only"
        ):
            raise ArticleExtractionBadRequestError("Jina Reader 未启用")
        return await self._extract_with_jina_html(
            html=html,
            settings=settings,
            source_url=source_url,
            title=title,
            top_image=top_image,
            author=author,
            published_at=published_at,
            source_domain=source_domain,
        )

    async def _extract_with_jina_html(
        self,
        *,
        html: str,
        settings: ExtractionSettings,
        source_url: str | None = None,
        title: str | None = None,
        top_image: str | None = None,
        author: str | None = None,
        published_at: str | None = None,
        source_domain: str | None = None,
    ) -> ExtractedArticle:
        html = (html or "").strip()
        if not html:
            raise ArticleExtractionBadRequestError("HTML内容为空")

        request_url = self._build_jina_html_url(settings.jina_reader_base_url)
        headers = {
            "Accept": "application/json",
            "Content-Type": "application/json",
            "User-Agent": USER_AGENT,
        }
        if settings.jina_reader_api_key:
            headers["Authorization"] = f"Bearer {settings.jina_reader_api_key}"
        if settings.jina_reader_token_budget:
            headers["X-Token-Budget"] = str(settings.jina_reader_token_budget)

        payload = {"html": html}
        if source_url:
            payload["url"] = source_url

        timeout = httpx.Timeout(float(settings.jina_reader_timeout_seconds), connect=5.0)
        try:
            async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
                response = await client.post(request_url, headers=headers, json=payload)
        except httpx.TimeoutException as exc:
            raise ArticleExtractionGatewayTimeoutError("Jina Reader HTML清洗超时") from exc
        except httpx.HTTPError as exc:
            raise ArticleExtractionBadGatewayError(
                f"Jina Reader HTML清洗失败: {str(exc)}"
            ) from exc

        if response.status_code >= 400:
            raise ArticleExtractionBadGatewayError(
                f"Jina Reader HTML清洗失败，状态码 {response.status_code}"
            )

        parsed = self._parse_jina_response(response)
        content_md = (parsed.get("content_md") or "").strip()
        if not self._is_valid_markdown(content_md):
            raise ArticleExtractionBadRequestError("Jina Reader HTML清洗结果为空或过短")

        final_url = (parsed.get("source_url") or source_url or "").strip()
        final_domain = source_domain or (urlparse(final_url).hostname or "").lower()
        final_title = (
            title
            or parsed.get("title")
            or self._extract_title_from_markdown(content_md)
            or (self._title_from_url(final_url) if final_url else "")
        )
        return ExtractedArticle(
            title=final_title,
            content_html=self._markdown_to_basic_html(content_md),
            content_md=content_md,
            source_url=final_url,
            top_image=top_image or parsed.get("top_image"),
            author=author or parsed.get("author"),
            published_at=published_at or parsed.get("published_at"),
            source_domain=final_domain,
            provider="jina_html",
            metadata={
                "reader_url": str(response.url),
                "status_code": response.status_code,
                "content_length": len(content_md),
                "input_html_length": len(html),
            },
        )

    def _build_jina_html_url(self, base_url: str) -> str:
        return f"{(base_url or DEFAULT_JINA_READER_BASE_URL).rstrip('/')}/"

    def _build_jina_url(self, base_url: str, source_url: str) -> str:
        normalized_base = (base_url or DEFAULT_JINA_READER_BASE_URL).rstrip("/")
        if normalized_base.endswith("/http:") or normalized_base.endswith("/https:"):
            return f"{normalized_base}//{quote(source_url, safe=':/?&=%#[]@!$&()*+,;')}"
        return f"{normalized_base}/{source_url}"

    def _parse_jina_response(self, response: httpx.Response) -> dict:
        content_type = (response.headers.get("content-type") or "").lower()
        if "application/json" in content_type:
            try:
                payload = response.json()
            except ValueError as exc:
                raise ArticleExtractionBadGatewayError("Jina Reader 返回 JSON 无法解析") from exc
            data = payload.get("data") if isinstance(payload, dict) else None
            if not isinstance(data, dict):
                data = payload if isinstance(payload, dict) else {}
            images = data.get("images")
            top_image = None
            if isinstance(images, list) and images:
                top_image = images[0]
            elif isinstance(images, dict) and images:
                top_image = next(iter(images.values()))
            return {
                "title": _repair_utf8_mojibake(
                    data.get("title") or data.get("name") or ""
                ),
                "content_md": _repair_utf8_mojibake(
                    data.get("content") or data.get("markdown") or ""
                ),
                "source_url": data.get("url") or data.get("source_url") or "",
                "top_image": data.get("image") or top_image,
                "author": _repair_utf8_mojibake(data.get("author") or ""),
                "published_at": data.get("publishedTime") or data.get("published_at") or "",
            }
        return {"content_md": _repair_utf8_mojibake(response.text or "")}

    async def _extract_with_local_html(self, source_url: str) -> ExtractedArticle:
        fetch_result = await self._fetch_html_from_url(source_url)
        extracted = self._extract_article_fields(fetch_result.html, fetch_result.final_url)
        return ExtractedArticle(
            title=extracted["title"],
            content_html=extracted["content_html"],
            content_md=extracted["content_md"],
            source_url=fetch_result.final_url,
            top_image=extracted["top_image"],
            author=extracted["author"],
            published_at=extracted["published_at"],
            source_domain=extracted["source_domain"],
            provider="local_html",
            metadata={"content_length": len(extracted["content_md"])},
        )

    async def _fetch_html_from_url(self, url: str) -> LocalFetchResult:
        headers = {
            "User-Agent": USER_AGENT,
            "Accept": "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
        }

        try:
            async with httpx.AsyncClient(
                timeout=DEFAULT_REQUEST_TIMEOUT,
                follow_redirects=True,
            ) as client:
                async with client.stream("GET", url, headers=headers) as response:
                    if response.status_code >= 400:
                        raise ArticleExtractionBadGatewayError(
                            f"抓取失败，状态码 {response.status_code}"
                        )

                    content_type_header = response.headers.get("content-type", "")
                    content_type = content_type_header.split(";")[0].strip().lower()
                    if content_type and content_type not in {
                        "text/html",
                        "application/xhtml+xml",
                    }:
                        raise ArticleExtractionContentTypeError("目标URL不是HTML页面")

                    payload = bytearray()
                    async for chunk in response.aiter_bytes():
                        if not chunk:
                            continue
                        payload.extend(chunk)
                        if len(payload) > MAX_HTML_SIZE_BYTES:
                            raise ArticleExtractionBadRequestError("页面内容过大，超过限制")

                    final_url = str(response.url)

        except ArticleExtractionError:
            raise
        except httpx.TimeoutException as exc:
            raise ArticleExtractionGatewayTimeoutError("抓取超时，请稍后重试") from exc
        except httpx.HTTPError as exc:
            raise ArticleExtractionBadGatewayError(f"抓取失败: {str(exc)}") from exc

        encoding = self._extract_charset(content_type_header) or "utf-8"
        html = bytes(payload).decode(encoding, errors="ignore").strip()
        if not html:
            raise ArticleExtractionBadRequestError("页面内容为空")
        return LocalFetchResult(final_url=final_url, html=html)

    def _extract_charset(self, content_type_header: str) -> str | None:
        if not content_type_header:
            return None
        for segment in content_type_header.split(";")[1:]:
            key, _, value = segment.partition("=")
            if key.strip().lower() == "charset":
                cleaned = value.strip().strip("'\"")
                if cleaned:
                    return cleaned
        return None

    def _extract_article_fields(self, html: str, source_url: str) -> dict:
        cleaned_html = self._remove_noise_tags(html)
        content_html = self._extract_primary_content(cleaned_html)
        content_text = self._html_to_text(content_html)
        if not content_text:
            raise ArticleExtractionBadRequestError("文章内容为空")

        title = self._extract_title(cleaned_html) or self._title_from_url(source_url)
        markdown = self._html_to_markdown(content_html) or content_text

        return {
            "title": title,
            "content_html": content_html,
            "content_md": markdown,
            "top_image": self._extract_top_image(
                cleaned_html,
                content_html,
                source_url,
            ),
            "author": self._extract_author(cleaned_html),
            "published_at": self._extract_published_at(cleaned_html),
            "source_domain": (urlparse(source_url).hostname or "").lower(),
        }

    def _remove_noise_tags(self, html: str) -> str:
        return _NOISE_TAG_RE.sub("", html or "")

    def _extract_primary_content(self, html: str) -> str:
        for pattern in (_ARTICLE_RE, _MAIN_RE):
            match = pattern.search(html)
            if not match:
                continue
            snippet = match.group(0).strip()
            if len(self._html_to_text(snippet)) >= MIN_EXTRACTED_TEXT_LENGTH:
                return snippet

        body_match = _BODY_RE.search(html)
        if body_match:
            body = body_match.group(1).strip()
            if body:
                return body

        return html.strip()

    def _extract_title(self, html: str) -> str:
        meta_title = self._extract_meta_content(
            html,
            properties={"og:title"},
            names={"twitter:title"},
        )
        if meta_title:
            return meta_title

        title_match = _TITLE_RE.search(html)
        if title_match:
            text = self._html_to_text(title_match.group(1))
            if text:
                return text

        h1_match = _H1_RE.search(html)
        if h1_match:
            text = self._html_to_text(h1_match.group(1))
            if text:
                return text

        return ""

    def _extract_top_image(
        self,
        html: str,
        content_html: str,
        source_url: str,
    ) -> str | None:
        meta_image = self._extract_meta_content(
            html,
            properties={"og:image"},
            names={"twitter:image"},
        )
        return resolve_top_image(
            meta_image,
            content_html=content_html,
            base_url=source_url,
        )

    def _extract_author(self, html: str) -> str | None:
        author = self._extract_meta_content(
            html,
            properties={"article:author", "author"},
            names={"author"},
        )
        return author or None

    def _extract_published_at(self, html: str) -> str | None:
        published = self._extract_meta_content(
            html,
            properties={"article:published_time", "og:published_time"},
            names={"pubdate", "publishdate", "date", "article:published_time"},
        )
        if published:
            return published

        time_match = _TIME_RE.search(html)
        if time_match:
            value = time_match.group(1).strip().strip("'\"")
            return value or None
        return None

    def _extract_meta_content(
        self,
        html: str,
        *,
        properties: set[str],
        names: set[str],
    ) -> str:
        target_properties = {item.lower() for item in properties}
        target_names = {item.lower() for item in names}
        for tag in _META_RE.findall(html):
            attrs = self._parse_tag_attrs(tag)
            if not attrs:
                continue
            prop = (attrs.get("property") or "").lower()
            name = (attrs.get("name") or "").lower()
            content = (attrs.get("content") or "").strip()
            if not content:
                continue
            if prop and prop in target_properties:
                return content
            if name and name in target_names:
                return content
        return ""

    def _parse_tag_attrs(self, raw_tag: str) -> dict[str, str]:
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

    def _html_to_text(self, value: str) -> str:
        if not value:
            return ""
        normalized = _LINE_BREAK_RE.sub("\n", value)
        normalized = _BLOCK_END_RE.sub("\n", normalized)
        normalized = _LIST_ITEM_RE.sub("- ", normalized)
        normalized = _TAG_RE.sub(" ", normalized)
        normalized = unescape(normalized).replace("\xa0", " ")
        normalized = _MULTI_SPACE_RE.sub(" ", normalized)
        normalized = re.sub(r"\s*\n\s*", "\n", normalized)
        normalized = _MULTI_NEWLINE_RE.sub("\n\n", normalized)
        return normalized.strip()

    def _html_to_markdown(self, value: str) -> str:
        return self._html_to_text(value)

    def _is_valid_markdown(self, value: str) -> bool:
        text = (value or "").strip()
        if not text:
            return False
        plain = re.sub(r"[#*_>`\-\[\]()!]", "", text)
        plain = re.sub(r"\s+", " ", plain).strip()
        return len(plain) >= MIN_EXTRACTED_TEXT_LENGTH

    def _extract_title_from_markdown(self, value: str) -> str:
        match = _MARKDOWN_HEADING_RE.search(value or "")
        return (match.group(1).strip() if match else "") or ""

    def _markdown_to_basic_html(self, value: str) -> str:
        paragraphs = [part.strip() for part in re.split(r"\n{2,}", value or "") if part.strip()]
        return "\n".join(f"<p>{escape(part)}</p>" for part in paragraphs)

    def _title_from_url(self, source_url: str) -> str:
        parsed = urlparse(source_url)
        host = parsed.hostname or "untitled"
        path = (parsed.path or "").strip("/")
        if path:
            return f"{host} / {path}"
        return host

    def metadata_to_json(self, metadata: dict | None) -> str | None:
        if not metadata:
            return None
        return json.dumps(metadata, ensure_ascii=False, sort_keys=True)
