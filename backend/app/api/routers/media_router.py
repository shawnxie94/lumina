import os

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from sqlalchemy.orm import Session

from app.schemas import MediaIngestRequest
from auth import get_current_admin
from media_service import (
    cleanup_orphan_media,
    ingest_external_image,
    is_media_enabled,
    save_upload_image,
)
from models import get_db

router = APIRouter()


@router.post("/api/media/upload")
async def upload_media(
    file: UploadFile = File(...),
    article_id: str = Form(...),
    request: Request = None,
    db: Session = Depends(get_db),
    _: bool = Depends(get_current_admin),
):
    if not is_media_enabled(db):
        raise HTTPException(status_code=403, detail="未开启本地存储")
    asset, url = await save_upload_image(db, article_id, file)
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
    asset, url = await ingest_external_image(db, payload.article_id, payload.url)
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
