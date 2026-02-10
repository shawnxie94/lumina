from fastapi import APIRouter, Depends, HTTPException
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
    db: Session = Depends(get_db),
    _: bool = Depends(get_current_admin),
):
    try:
        markdown_content = article_query_service.export_articles(db, request.article_slugs)
        return {"content": markdown_content, "filename": "articles_export.md"}
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))
