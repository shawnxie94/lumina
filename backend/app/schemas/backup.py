from __future__ import annotations

from typing import Literal

from pydantic import BaseModel


class BackupRestoreIncludes(BaseModel):
    comments: bool
    media: bool
    secrets: bool


class BackupRestoreMeta(BaseModel):
    backup_exported_at: str
    backup_format_version: int
    backup_source_schema_version: str
    restored_at: str


class BackupRestorePayload(BaseModel):
    includes: BackupRestoreIncludes


class BackupRestoreResult(BaseModel):
    success: bool
    meta: BackupRestoreMeta
    restored: BackupRestorePayload


class BackupExportJobStatus(BaseModel):
    status: Literal["idle", "processing", "completed", "failed"]
    filename: str | None = None
    file_path: str | None = None
    file_size: int | None = None
    error_message: str | None = None
    created_at: str | None = None
    started_at: str | None = None
    finished_at: str | None = None
