from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.core.public_cache import (
    CACHE_KEY_AUTHORS_PUBLIC,
    CACHE_KEY_CATEGORIES_PUBLIC,
    CACHE_KEY_SETTINGS_BASIC_PUBLIC,
    CACHE_KEY_SETTINGS_COMMENTS_PUBLIC,
    CACHE_KEY_SOURCES_PUBLIC,
    CACHE_KEY_TAGS_PUBLIC,
    invalidate_public_cache,
)
from app.core.dependencies import get_admin_or_internal
from app.domain.backup_service import BackupService
from app.schemas import BackupRestoreResult
from auth import get_current_admin
from models import get_db

router = APIRouter()
backup_service = BackupService()


@router.get("/api/backup/export")
async def export_backup(
    db: Session = Depends(get_db),
    _: bool = Depends(get_admin_or_internal),
):
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"lumina-backup-{timestamp}.zip"
    headers = {"Content-Disposition": f'attachment; filename="{filename}"'}
    return StreamingResponse(
        backup_service.export_backup_stream(db),
        media_type="application/zip",
        headers=headers,
    )


@router.post("/api/backup/import", response_model=BackupRestoreResult)
async def import_backup(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    _: bool = Depends(get_current_admin),
):
    try:
        result = backup_service.import_backup(db, file.file)
        invalidate_public_cache(
            CACHE_KEY_AUTHORS_PUBLIC,
            CACHE_KEY_CATEGORIES_PUBLIC,
            CACHE_KEY_SETTINGS_BASIC_PUBLIC,
            CACHE_KEY_SETTINGS_COMMENTS_PUBLIC,
            CACHE_KEY_SOURCES_PUBLIC,
            CACHE_KEY_TAGS_PUBLIC,
        )
        return result
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=f"导入失败：{str(exc)}")
