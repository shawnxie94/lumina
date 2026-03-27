from __future__ import annotations

from typing import TYPE_CHECKING
from urllib.parse import quote

from fastapi import HTTPException, Request
from fastapi.responses import Response as FastAPIResponse
from sqlalchemy.orm import Session

from app.core.dependencies import build_basic_settings
from app.core.public_cache import CACHE_KEY_ARTICLES_RSS_PUBLIC_PREFIX
from app.core.settings import get_settings
from auth import get_admin_settings

if TYPE_CHECKING:
    from app.domain.article_query_service import ArticleQueryService


class ArticleRssService:
    def assert_rss_enabled(self, db: Session) -> None:
        basic_settings = build_basic_settings(get_admin_settings(db))
        if not basic_settings.get("rss_enabled"):
            raise HTTPException(status_code=404, detail="RSS未开启")

    def normalize_tag_ids(self, raw_value: str | None) -> list[str]:
        if not raw_value:
            return []
        return sorted(
            {
                item.strip()
                for item in raw_value.split(",")
                if item and item.strip()
            }
        )

    def resolve_public_base_url(self, request: Request) -> str:
        origin = (request.headers.get("origin") or "").strip()
        if origin.startswith(("http://", "https://")):
            return origin.rstrip("/")

        forwarded_proto = (request.headers.get("x-forwarded-proto") or "").split(",")[0].strip()
        forwarded_host = (request.headers.get("x-forwarded-host") or "").split(",")[0].strip()
        if (
            forwarded_proto in {"http", "https"}
            and forwarded_host
            and "\n" not in forwarded_host
            and "\r" not in forwarded_host
        ):
            return f"{forwarded_proto}://{forwarded_host}".rstrip("/")

        configured_base_url = get_settings().app_public_base_url.strip()
        if configured_base_url:
            return configured_base_url.rstrip("/")

        return str(request.base_url).rstrip("/")

    def build_cache_key(
        self,
        public_base_url: str,
        *,
        category_id: str | None,
        tag_ids: list[str],
    ) -> str:
        encoded_base = quote(public_base_url or "", safe="")
        encoded_category = quote((category_id or "").strip(), safe="")
        encoded_tag_ids = quote(",".join(tag_ids), safe="")
        return (
            f"{CACHE_KEY_ARTICLES_RSS_PUBLIC_PREFIX}"
            f"{encoded_base}:category:{encoded_category}:tags:{encoded_tag_ids}"
        )

    def build_feed_content(
        self,
        *,
        db: Session,
        article_query_service: "ArticleQueryService",
        public_base_url: str,
        category_id: str | None,
        tag_ids: list[str],
    ) -> str:
        articles = article_query_service.get_articles_for_rss(
            db=db,
            category_id=category_id,
            tag_ids=tag_ids,
        )
        basic_settings = build_basic_settings(get_admin_settings(db))
        return article_query_service.render_articles_rss(
            articles=articles,
            public_base_url=public_base_url,
            site_name=basic_settings["site_name"],
            site_description=basic_settings["site_description"],
            category_id=category_id,
            tag_ids=tag_ids,
        )

    def build_response(self, content: str) -> FastAPIResponse:
        response = FastAPIResponse(content=content, media_type="application/rss+xml")
        response.headers["Content-Type"] = "application/rss+xml; charset=utf-8"
        return response
