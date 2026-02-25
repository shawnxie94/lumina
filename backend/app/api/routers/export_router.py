from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.core.dependencies import get_admin_or_internal
from app.domain.article_query_service import ArticleQueryService
from app.schemas import ExportRequest
from models import get_db

router = APIRouter()
article_query_service = ArticleQueryService()


@router.post("/api/export")
async def export_articles(
    request: ExportRequest,
    http_request: Request,
    db: Session = Depends(get_db),
    _: bool = Depends(get_admin_or_internal),
):
    try:
        origin = (http_request.headers.get("origin") or "").strip()
        if origin.startswith(("http://", "https://")):
            public_base_url = origin.rstrip("/")
        else:
            public_base_url = str(http_request.base_url).rstrip("/")
        if request.article_slugs is not None:
            markdown_content = article_query_service.export_articles(
                db,
                request.article_slugs,
                public_base_url=public_base_url,
            )
        else:
            if not request.has_filter_conditions():
                raise HTTPException(
                    status_code=400,
                    detail="article_slugs 未提供时，至少需要一个筛选条件",
                )
            markdown_content = article_query_service.export_articles_by_filters(
                db,
                category_id=request.category_id,
                search=request.search,
                source_domain=request.source_domain,
                author=request.author,
                is_visible=request.is_visible,
                published_at_start=request.published_at_start,
                published_at_end=request.published_at_end,
                created_at_start=request.created_at_start,
                created_at_end=request.created_at_end,
                is_admin=True,
                public_base_url=public_base_url,
            )
        return {"content": markdown_content, "filename": "articles_export.md"}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))
