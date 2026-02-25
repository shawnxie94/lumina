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
from models import get_db

router = APIRouter()


@router.post("/api/media/upload")
async def upload_media(
    file: UploadFile = File(...),
    article_id: str = Form(...),
    kind: str = Form("image"),
    request: Request = None,
    db: Session = Depends(get_db),
    _: bool = Depends(get_current_admin),
):
    if not is_media_enabled(db):
        raise HTTPException(status_code=403, detail="未开启本地存储")
    asset, url = await save_upload_image(db, article_id, file, kind=kind)
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
    asset, url = await ingest_external_image(
        db,
        payload.article_id,
        payload.url,
        kind=payload.kind,
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
