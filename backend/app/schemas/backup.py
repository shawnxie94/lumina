from __future__ import annotations

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
