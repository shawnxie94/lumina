from __future__ import annotations

from typing import Any

from pydantic import BaseModel


class BackupImportRequest(BaseModel):
    meta: dict[str, Any]
    data: dict[str, Any]
