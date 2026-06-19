from __future__ import annotations

import ipaddress
import socket
from urllib.parse import urlparse, urlunparse

from sqlalchemy.orm import Session

from app.domain.article_command_service import ArticleCommandService
from app.domain.article_extraction_service import (
    ArticleExtractionBadGatewayError,
    ArticleExtractionBadRequestError,
    ArticleExtractionContentTypeError,
    ArticleExtractionGatewayTimeoutError,
    ArticleExtractionService,
)
from models import Article


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


class ArticleUrlIngestService:
    def __init__(
        self,
        article_command_service: ArticleCommandService | None = None,
        article_extraction_service: ArticleExtractionService | None = None,
    ):
        self.article_command_service = article_command_service or ArticleCommandService()
        self.article_extraction_service = (
            article_extraction_service or ArticleExtractionService()
        )

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

        try:
            extracted = await self.article_extraction_service.extract_url(
                db,
                normalized_url,
                ensure_public_url=self._ensure_public_url,
            )
        except ArticleExtractionContentTypeError as exc:
            raise ArticleUrlIngestContentTypeError(exc.detail) from exc
        except ArticleExtractionGatewayTimeoutError as exc:
            raise ArticleUrlIngestGatewayTimeoutError(exc.detail) from exc
        except ArticleExtractionBadGatewayError as exc:
            raise ArticleUrlIngestBadGatewayError(exc.detail) from exc
        except ArticleExtractionBadRequestError as exc:
            raise ArticleUrlIngestBadRequestError(exc.detail) from exc

        final_url = extracted.source_url
        self._ensure_public_url(final_url)

        redirected_existing = self._find_existing_article(db, final_url)
        if redirected_existing:
            raise ArticleUrlIngestDuplicateError(
                self._build_existing_payload(redirected_existing)
            )

        article_payload = {
            "title": extracted.title,
            "content_html": extracted.content_html,
            "content_md": extracted.content_md,
            "source_url": final_url,
            "top_image": extracted.top_image,
            "author": extracted.author,
            "published_at": extracted.published_at,
            "source_domain": extracted.source_domain,
            "category_id": category_id,
            "skip_ai_processing": skip_ai_processing,
            "extraction_provider": extracted.provider,
            "extraction_status": extracted.status,
            "extraction_error": extracted.error,
            "extraction_metadata": self.article_extraction_service.metadata_to_json(
                extracted.metadata
            ),
        }

        try:
            article_id = await self.article_command_service.create_article(article_payload, db)
        except ValueError as exc:
            if "该文章已存在" in str(exc):
                race_existing = self._find_existing_article(db, final_url)
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
            "source_url": final_url,
            "extraction_provider": extracted.provider,
            "extraction_status": extracted.status,
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

    def _find_existing_article(self, db: Session, source_url: str) -> Article | None:
        return db.query(Article).filter(Article.source_url == source_url).first()

    def _build_existing_payload(self, article: Article) -> dict:
        return {
            "id": article.id,
            "slug": article.slug,
            "title": article.title,
            "status": article.status,
        }
