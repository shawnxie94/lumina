from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.domain.article_query_service import ArticleQueryService
from app.schemas import ExportRequest
from auth import get_current_admin
from models import get_db

router = APIRouter()
article_query_service = ArticleQueryService()


@router.post("/api/export")
async def export_articles(
    request: ExportRequest,
    http_request: Request,
    db: Session = Depends(get_db),
    _: bool = Depends(get_current_admin),
):
    try:
        origin = (http_request.headers.get("origin") or "").strip()
        if origin.startswith(("http://", "https://")):
            public_base_url = origin.rstrip("/")
        else:
            public_base_url = str(http_request.base_url).rstrip("/")
        markdown_content = article_query_service.export_articles(
            db,
            request.article_slugs,
            public_base_url=public_base_url,
        )
        return {"content": markdown_content, "filename": "articles_export.md"}
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))
