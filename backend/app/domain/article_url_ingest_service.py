from __future__ import annotations

import ipaddress
import re
import socket
from dataclasses import dataclass
from html import unescape
from urllib.parse import urljoin, urlparse, urlunparse

import httpx
from sqlalchemy.orm import Session

from app.domain.article_command_service import ArticleCommandService
from models import Article

MAX_HTML_SIZE_BYTES = 2 * 1024 * 1024
REQUEST_TIMEOUT = httpx.Timeout(15.0, connect=5.0)
USER_AGENT = "LuminaURLIngest/1.0 (+https://github.com/shawnxie94/lumina)"

_ATTR_RE = re.compile(
    r"([A-Za-z_:][-A-Za-z0-9_:.]*)\s*=\s*(\"[^\"]*\"|'[^']*'|[^\s\"'=<>`]+)"
)
_TITLE_RE = re.compile(r"<title\b[^>]*>(.*?)</title>", re.IGNORECASE | re.DOTALL)
_H1_RE = re.compile(r"<h1\b[^>]*>(.*?)</h1>", re.IGNORECASE | re.DOTALL)
_META_RE = re.compile(r"<meta\b[^>]*>", re.IGNORECASE)
_IMG_RE = re.compile(r"<img\b[^>]*>", re.IGNORECASE)
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


class ArticleUrlIngestError(Exception):
    def __init__(self, detail: str):
        super().__init__(detail)
        self.detail = detail


class ArticleUrlIngestBadRequestError(ArticleUrlIngestError):
    pass


class ArticleUrlIngestContentTypeError(ArticleUrlIngestError):
    pass


class ArticleUrlIngestBadGatewayError(ArticleUrlIngestError):
    pass


class ArticleUrlIngestGatewayTimeoutError(ArticleUrlIngestError):
    pass


class ArticleUrlIngestDuplicateError(ArticleUrlIngestError):
    def __init__(self, existing: dict):
        super().__init__("该URL已存在")
        self.existing = existing


@dataclass
class URLFetchResult:
    final_url: str
    html: str


class ArticleUrlIngestService:
    def __init__(self, article_command_service: ArticleCommandService | None = None):
        self.article_command_service = article_command_service or ArticleCommandService()

    async def report_by_url(
        self,
        db: Session,
        *,
        url: str,
        category_id: str | None = None,
        is_visible: bool | None = None,
        skip_ai_processing: bool = False,
    ) -> dict:
        normalized_url = self._normalize_url(url)
        self._ensure_public_url(normalized_url)

        existing = self._find_existing_article(db, normalized_url)
        if existing:
            raise ArticleUrlIngestDuplicateError(self._build_existing_payload(existing))

        fetch_result = await self._fetch_html_from_url(normalized_url)
        self._ensure_public_url(fetch_result.final_url)

        redirected_existing = self._find_existing_article(db, fetch_result.final_url)
        if redirected_existing:
            raise ArticleUrlIngestDuplicateError(
                self._build_existing_payload(redirected_existing)
            )

        extracted = self._extract_article_fields(fetch_result.html, fetch_result.final_url)
        article_payload = {
            "title": extracted["title"],
            "content_html": extracted["content_html"],
            "content_md": extracted["content_md"],
            "source_url": fetch_result.final_url,
            "top_image": extracted["top_image"],
            "author": extracted["author"],
            "published_at": extracted["published_at"],
            "source_domain": extracted["source_domain"],
            "category_id": category_id,
            "skip_ai_processing": skip_ai_processing,
        }

        try:
            article_id = await self.article_command_service.create_article(article_payload, db)
        except ValueError as exc:
            if "该文章已存在" in str(exc):
                race_existing = self._find_existing_article(db, fetch_result.final_url)
                if race_existing is None:
                    race_existing = self._find_existing_article(db, normalized_url)
                if race_existing is not None:
                    raise ArticleUrlIngestDuplicateError(
                        self._build_existing_payload(race_existing)
                    ) from exc
            raise ArticleUrlIngestBadRequestError(str(exc)) from exc

        article = db.query(Article).filter(Article.id == article_id).first()
        if article and is_visible is not None and article.is_visible != bool(is_visible):
            article.is_visible = bool(is_visible)
            db.commit()
            db.refresh(article)

        return {
            "id": article_id,
            "slug": article.slug if article else article_id,
            "status": article.status if article else "processing",
            "source_url": fetch_result.final_url,
        }

    def _normalize_url(self, raw_url: str) -> str:
        value = (raw_url or "").strip()
        if not value:
            raise ArticleUrlIngestBadRequestError("URL不能为空")

        parsed = urlparse(value)
        if parsed.scheme not in {"http", "https"}:
            raise ArticleUrlIngestBadRequestError("URL仅支持 http 或 https")
        if not parsed.netloc or not parsed.hostname:
            raise ArticleUrlIngestBadRequestError("URL格式不合法")

        normalized = urlunparse(parsed._replace(fragment=""))
        return normalized

    def _ensure_public_url(self, url: str) -> None:
        parsed = urlparse(url)
        hostname = (parsed.hostname or "").strip().lower()
        if not hostname:
            raise ArticleUrlIngestBadRequestError("URL缺少主机名")
        if hostname in {"localhost"}:
            raise ArticleUrlIngestBadRequestError("不允许访问内网或本机地址")

        try:
            host_ip = ipaddress.ip_address(hostname)
        except ValueError:
            host_ip = None

        if host_ip is not None:
            if self._is_disallowed_ip(host_ip):
                raise ArticleUrlIngestBadRequestError("不允许访问内网或本机地址")
            return

        if self._hostname_resolves_to_private(hostname):
            raise ArticleUrlIngestBadRequestError("不允许访问内网或本机地址")

    def _hostname_resolves_to_private(self, hostname: str) -> bool:
        try:
            records = socket.getaddrinfo(
                hostname,
                None,
                type=socket.SOCK_STREAM,
            )
        except OSError:
            return False

        for record in records:
            ip_text = record[4][0]
            try:
                ip_obj = ipaddress.ip_address(ip_text)
            except ValueError:
                continue
            if self._is_disallowed_ip(ip_obj):
                return True
        return False

    def _is_disallowed_ip(
        self,
        ip_obj: ipaddress.IPv4Address | ipaddress.IPv6Address,
    ) -> bool:
        return bool(
            ip_obj.is_private
            or ip_obj.is_loopback
            or ip_obj.is_link_local
            or ip_obj.is_reserved
            or ip_obj.is_multicast
            or ip_obj.is_unspecified
        )

    async def _fetch_html_from_url(self, url: str) -> URLFetchResult:
        headers = {
            "User-Agent": USER_AGENT,
            "Accept": "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
        }

        try:
            async with httpx.AsyncClient(
                timeout=REQUEST_TIMEOUT,
                follow_redirects=True,
            ) as client:
                async with client.stream("GET", url, headers=headers) as response:
                    if response.status_code >= 400:
                        raise ArticleUrlIngestBadGatewayError(
                            f"抓取失败，状态码 {response.status_code}"
                        )

                    content_type_header = response.headers.get("content-type", "")
                    content_type = content_type_header.split(";")[0].strip().lower()
                    if content_type and content_type not in {
                        "text/html",
                        "application/xhtml+xml",
                    }:
                        raise ArticleUrlIngestContentTypeError("目标URL不是HTML页面")

                    payload = bytearray()
                    async for chunk in response.aiter_bytes():
                        if not chunk:
                            continue
                        payload.extend(chunk)
                        if len(payload) > MAX_HTML_SIZE_BYTES:
                            raise ArticleUrlIngestBadRequestError("页面内容过大，超过限制")

                    final_url = str(response.url)

        except ArticleUrlIngestError:
            raise
        except httpx.TimeoutException as exc:
            raise ArticleUrlIngestGatewayTimeoutError("抓取超时，请稍后重试") from exc
        except httpx.HTTPError as exc:
            raise ArticleUrlIngestBadGatewayError(f"抓取失败: {str(exc)}") from exc

        encoding = self._extract_charset(content_type_header) or "utf-8"
        html = bytes(payload).decode(encoding, errors="ignore").strip()
        if not html:
            raise ArticleUrlIngestBadRequestError("页面内容为空")
        return URLFetchResult(final_url=final_url, html=html)

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
            raise ArticleUrlIngestBadRequestError("文章内容为空")

        title = self._extract_title(cleaned_html) or self._title_from_url(source_url)
        markdown = self._html_to_markdown(content_html) or content_text

        return {
            "title": title,
            "content_html": content_html,
            "content_md": markdown,
            "top_image": self._extract_top_image(cleaned_html, source_url),
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
            if len(self._html_to_text(snippet)) >= 40:
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

    def _extract_top_image(self, html: str, source_url: str) -> str | None:
        meta_image = self._extract_meta_content(
            html,
            properties={"og:image"},
            names={"twitter:image"},
        )
        if meta_image:
            return urljoin(source_url, meta_image)

        image_match = _IMG_RE.search(html)
        if image_match:
            attrs = self._parse_tag_attrs(image_match.group(0))
            src = attrs.get("src") or attrs.get("data-src")
            if src:
                return urljoin(source_url, src)
        return None

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

    def _title_from_url(self, source_url: str) -> str:
        parsed = urlparse(source_url)
        host = parsed.hostname or "untitled"
        path = (parsed.path or "").strip("/")
        if path:
            return f"{host} / {path}"
        return host

    def _find_existing_article(self, db: Session, source_url: str) -> Article | None:
        return db.query(Article).filter(Article.source_url == source_url).first()

    def _build_existing_payload(self, article: Article) -> dict:
        return {
            "id": article.id,
            "slug": article.slug,
            "title": article.title,
            "status": article.status,
        }
