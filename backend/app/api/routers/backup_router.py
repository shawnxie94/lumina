from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.domain.backup_service import BackupService
from app.schemas import BackupImportRequest
from auth import get_current_admin
from models import get_db

router = APIRouter()
backup_service = BackupService()


@router.get("/api/backup/export")
async def export_backup(
    db: Session = Depends(get_db),
    _: bool = Depends(get_current_admin),
):
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"lumina-backup-{timestamp}.json"
    headers = {"Content-Disposition": f'attachment; filename="{filename}"'}
    return StreamingResponse(
        backup_service.export_backup_stream(db),
        media_type="application/json; charset=utf-8",
        headers=headers,
    )


@router.post("/api/backup/import")
async def import_backup(
    request: BackupImportRequest,
    db: Session = Depends(get_db),
    _: bool = Depends(get_current_admin),
):
    try:
        return backup_service.import_backup(db, request.model_dump())
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=f"导入失败：{str(exc)}")
