from __future__ import annotations

from dataclasses import asdict, dataclass, replace
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock, Thread
from typing import Any

from app.core.settings import get_settings


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def resolve_backup_export_root(database_url: str | None = None) -> Path:
    url = (database_url or get_settings().database_url).strip()
    if url.startswith("sqlite:///"):
        database_path = Path(url.removeprefix("sqlite:///"))
        if not database_path.is_absolute():
            database_path = (Path.cwd() / database_path).resolve()
        return database_path.parent / "backups"
    return (Path.cwd() / "data" / "backups").resolve()


@dataclass
class BackupExportState:
    status: str = "idle"
    filename: str | None = None
    file_path: str | None = None
    file_size: int | None = None
    error_message: str | None = None
    created_at: str | None = None
    started_at: str | None = None
    finished_at: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


class BackupExportRuntime:
    def __init__(
        self,
        *,
        export_root: str | Path,
        filename: str = "lumina-backup-latest.zip",
    ) -> None:
        self.export_root = Path(export_root)
        self.filename = filename
        self._lock = Lock()
        self._state = BackupExportState()
        self.recover_existing_file()

    @property
    def latest_file_path(self) -> Path:
        return self.export_root / self.filename

    def get_state(self) -> BackupExportState:
        with self._lock:
            return replace(self._state)

    def recover_existing_file(self) -> BackupExportState:
        file_path = self.latest_file_path
        with self._lock:
            if not file_path.exists():
                if self._state.status != "processing":
                    self._state = BackupExportState()
                return replace(self._state)

            stat = file_path.stat()
            recovered_at = datetime.fromtimestamp(
                stat.st_mtime,
                tz=timezone.utc,
            ).isoformat()
            self._state = BackupExportState(
                status="completed",
                filename=file_path.name,
                file_path=str(file_path),
                file_size=stat.st_size,
                created_at=recovered_at,
                started_at=recovered_at,
                finished_at=recovered_at,
            )
            return replace(self._state)

    def start_or_get_current(
        self,
        runner,
    ) -> BackupExportState:
        file_path = self.latest_file_path
        with self._lock:
            if self._state.status == "processing":
                return replace(self._state)

            started_at = _utc_now_iso()
            self._state = BackupExportState(
                status="processing",
                filename=file_path.name,
                file_path=str(file_path),
                error_message=None,
                started_at=started_at,
            )

        Thread(
            target=self._run_export,
            args=(file_path, runner),
            daemon=True,
            name="lumina-backup-export",
        ).start()
        return self.get_state()

    def _run_export(self, file_path: Path, runner) -> None:
        try:
            result = runner(file_path) or {}
            final_path = Path(result.get("path") or file_path)
            stat = final_path.stat()
            finished_at = _utc_now_iso()

            with self._lock:
                started_at = self._state.started_at
                self._state = BackupExportState(
                    status="completed",
                    filename=str(result.get("filename") or final_path.name),
                    file_path=str(final_path),
                    file_size=int(result.get("file_size") or stat.st_size),
                    error_message=None,
                    created_at=str(result.get("created_at") or finished_at),
                    started_at=started_at,
                    finished_at=finished_at,
                )
        except Exception as exc:
            finished_at = _utc_now_iso()
            with self._lock:
                started_at = self._state.started_at
                self._state = BackupExportState(
                    status="failed",
                    filename=file_path.name,
                    file_path=str(file_path),
                    file_size=file_path.stat().st_size if file_path.exists() else None,
                    error_message=str(exc),
                    created_at=None,
                    started_at=started_at,
                    finished_at=finished_at,
                )


backup_export_runtime = BackupExportRuntime(
    export_root=resolve_backup_export_root(),
)
