from __future__ import annotations

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.core.public_cache import (
    CACHE_KEY_AUTHORS_PUBLIC,
    CACHE_KEY_CATEGORIES_PUBLIC,
    CACHE_KEY_SETTINGS_BASIC_PUBLIC,
    CACHE_KEY_SETTINGS_COMMENTS_PUBLIC,
    CACHE_KEY_SOURCES_PUBLIC,
    invalidate_public_cache,
)
from app.core.dependencies import get_admin_or_internal
from app.domain.backup_export_runtime import backup_export_runtime
from app.domain.backup_service import BackupService
from app.schemas import BackupExportJobStatus, BackupRestoreResult
from auth import get_current_admin
from models import get_db

router = APIRouter()
backup_service = BackupService()


def _serialize_backup_export_state() -> BackupExportJobStatus:
    return BackupExportJobStatus(**backup_export_runtime.get_state().to_dict())

@router.post("/api/backup/export-jobs/latest", response_model=BackupExportJobStatus)
async def create_latest_backup_export_job(
    _: bool = Depends(get_admin_or_internal),
):
    def _run_export(file_path):
        return backup_service.export_backup_file(
            export_root=file_path.parent,
            filename=file_path.name,
        )

    backup_export_runtime.start_or_get_current(_run_export)
    return _serialize_backup_export_state()


@router.get("/api/backup/export-jobs/latest", response_model=BackupExportJobStatus)
async def get_latest_backup_export_job(
    _: bool = Depends(get_admin_or_internal),
):
    return _serialize_backup_export_state()


@router.get("/api/backup/export-jobs/latest/download")
async def download_latest_backup_export_job(
    _: bool = Depends(get_admin_or_internal),
):
    state = backup_export_runtime.get_state()
    if state.status != "completed" or not state.file_path:
        raise HTTPException(status_code=404, detail="备份文件尚未生成")

    file_path = backup_export_runtime.latest_file_path
    if not file_path.exists():
        backup_export_runtime.recover_existing_file()
        raise HTTPException(status_code=404, detail="备份文件不存在")

    return FileResponse(
        file_path,
        media_type="application/zip",
        filename=state.filename or file_path.name,
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
                )
        return result
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=f"导入失败：{str(exc)}")
