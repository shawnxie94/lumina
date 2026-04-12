import os

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from sqlalchemy.orm import Session

from app.schemas import MediaIngestRequest
from auth import get_current_admin
from media_service import (
    cleanup_orphan_media,
    get_media_storage_stats,
    ingest_external_image,
    is_media_enabled,
    save_upload_image,
)
from models import Article, ReviewIssue, get_db

router = APIRouter()


def _resolve_media_owner(
    db: Session,
    *,
    article_id: str | None,
    review_issue_id: str | None,
) -> tuple[str | None, str | None]:
    normalized_article_id = (article_id or "").strip() or None
    normalized_review_issue_id = (review_issue_id or "").strip() or None
    if normalized_article_id and normalized_review_issue_id:
        raise HTTPException(status_code=400, detail="媒体资源只能归属于文章或回顾之一")
    if not normalized_article_id and not normalized_review_issue_id:
        raise HTTPException(status_code=400, detail="媒体资源必须指定文章或回顾归属")
    if normalized_article_id:
        article = db.query(Article.id).filter(Article.id == normalized_article_id).first()
        if not article:
            raise HTTPException(status_code=404, detail="文章不存在")
        return normalized_article_id, None
    issue = db.query(ReviewIssue.id).filter(ReviewIssue.id == normalized_review_issue_id).first()
    if not issue:
        raise HTTPException(status_code=404, detail="回顾不存在")
    return None, normalized_review_issue_id


@router.post("/api/media/upload")
async def upload_media(
    file: UploadFile = File(...),
    article_id: str | None = Form(None),
    review_issue_id: str | None = Form(None),
    kind: str = Form("image"),
    request: Request = None,
    db: Session = Depends(get_db),
    _: bool = Depends(get_current_admin),
):
    if not is_media_enabled(db):
        raise HTTPException(status_code=403, detail="未开启本地存储")
    resolved_article_id, resolved_review_issue_id = _resolve_media_owner(
        db,
        article_id=article_id,
        review_issue_id=review_issue_id,
    )
    asset, url = await save_upload_image(
        db,
        resolved_article_id,
        file,
        kind=kind,
        review_issue_id=resolved_review_issue_id,
    )
    if request is not None and url.startswith("/"):
        base_url = str(request.base_url).rstrip("/")
        url = f"{base_url}{url}"
    return {
        "asset_id": asset.id,
        "url": url,
        "filename": os.path.basename(asset.storage_path),
        "size": asset.size,
        "content_type": asset.content_type,
    }


@router.post("/api/media/ingest")
async def ingest_media(
    payload: MediaIngestRequest,
    request: Request = None,
    db: Session = Depends(get_db),
    _: bool = Depends(get_current_admin),
):
    if not is_media_enabled(db):
        raise HTTPException(status_code=403, detail="未开启本地存储")
    resolved_article_id, resolved_review_issue_id = _resolve_media_owner(
        db,
        article_id=payload.article_id,
        review_issue_id=payload.review_issue_id,
    )
    asset, url = await ingest_external_image(
        db,
        resolved_article_id,
        payload.url,
        kind=payload.kind,
        review_issue_id=resolved_review_issue_id,
    )
    if request is not None and url.startswith("/"):
        base_url = str(request.base_url).rstrip("/")
        url = f"{base_url}{url}"
    return {
        "asset_id": asset.id,
        "url": url,
        "filename": os.path.basename(asset.storage_path),
        "size": asset.size,
        "content_type": asset.content_type,
    }


@router.post("/api/media/cleanup")
async def cleanup_media(
    db: Session = Depends(get_db),
    _: bool = Depends(get_current_admin),
):
    result = cleanup_orphan_media(db)
    return {"success": True, **result}


@router.get("/api/media/stats")
async def get_media_stats(
    db: Session = Depends(get_db),
    _: bool = Depends(get_current_admin),
):
    stats = get_media_storage_stats(db)
    return {"success": True, **stats}
