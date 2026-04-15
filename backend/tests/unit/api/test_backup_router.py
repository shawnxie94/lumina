from __future__ import annotations

import time
from pathlib import Path
from threading import Event

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.routers import backup_router
from app.core.dependencies import get_admin_or_internal
from app.domain.backup_export_runtime import BackupExportRuntime
from models import get_db


def _create_client(
    *,
    tmp_path: Path,
    db_session,
    monkeypatch,
    export_backup_file,
) -> tuple[TestClient, BackupExportRuntime]:
    app = FastAPI()
    app.include_router(backup_router.router)

    def _get_db():
        yield db_session

    app.dependency_overrides[get_db] = _get_db
    app.dependency_overrides[get_admin_or_internal] = lambda: True

    runtime = BackupExportRuntime(export_root=tmp_path / "backups")
    service = type(
        "StubBackupService",
        (),
        {
            "export_backup_file": staticmethod(export_backup_file),
            "import_backup": staticmethod(lambda *args, **kwargs: {}),
        },
    )()

    monkeypatch.setattr(backup_router, "backup_export_runtime", runtime)
    monkeypatch.setattr(backup_router, "backup_service", service)
    return TestClient(app), runtime


def test_post_latest_backup_export_job_returns_processing_and_deduplicates(
    db_session, tmp_path: Path, monkeypatch
):
    started = Event()
    release = Event()
    calls: list[tuple[Path, str]] = []

    def export_backup_file(_db=None, *, export_root, filename):
        export_dir = Path(export_root)
        export_dir.mkdir(parents=True, exist_ok=True)
        calls.append((export_dir, filename))
        started.set()
        assert release.wait(timeout=2)
        target = export_dir / filename
        target.write_bytes(b"zip-data")
        return {
            "path": str(target),
            "filename": filename,
            "file_size": target.stat().st_size,
            "created_at": "2026-04-12T00:00:00+00:00",
        }

    client, runtime = _create_client(
        tmp_path=tmp_path,
        db_session=db_session,
        monkeypatch=monkeypatch,
        export_backup_file=export_backup_file,
    )

    first = client.post("/api/backup/export-jobs/latest")
    assert first.status_code == 200
    assert first.json()["status"] == "processing"
    assert started.wait(timeout=1)

    second = client.post("/api/backup/export-jobs/latest")
    assert second.status_code == 200
    assert second.json()["status"] == "processing"
    assert calls == [(tmp_path / "backups", "lumina-backup-latest.zip")]

    release.set()
    deadline = time.time() + 2
    while time.time() < deadline:
        if runtime.get_state().status == "completed":
            break
        time.sleep(0.01)

    assert runtime.get_state().status == "completed"


def test_get_latest_backup_export_job_returns_recovered_state(
    db_session, tmp_path: Path, monkeypatch
):
    client, runtime = _create_client(
        tmp_path=tmp_path,
        db_session=db_session,
        monkeypatch=monkeypatch,
        export_backup_file=lambda *args, **kwargs: {},
    )

    backup_path = runtime.latest_file_path
    backup_path.parent.mkdir(parents=True, exist_ok=True)
    backup_path.write_bytes(b"zip")
    runtime.recover_existing_file()

    response = client.get("/api/backup/export-jobs/latest")
    assert response.status_code == 200
    assert response.json()["status"] == "completed"
    assert response.json()["filename"] == "lumina-backup-latest.zip"
    assert response.json()["file_size"] == 3


def test_download_latest_backup_export_returns_zip_file(
    db_session, tmp_path: Path, monkeypatch
):
    client, runtime = _create_client(
        tmp_path=tmp_path,
        db_session=db_session,
        monkeypatch=monkeypatch,
        export_backup_file=lambda *args, **kwargs: {},
    )

    backup_path = runtime.latest_file_path
    backup_path.parent.mkdir(parents=True, exist_ok=True)
    backup_path.write_bytes(b"zip")
    runtime.recover_existing_file()

    response = client.get("/api/backup/export-jobs/latest/download")
    assert response.status_code == 200
    assert response.content == b"zip"
    assert response.headers["content-type"] == "application/zip"
    assert 'filename="lumina-backup-latest.zip"' in response.headers["content-disposition"]


def test_download_latest_backup_export_returns_404_when_missing(
    db_session, tmp_path: Path, monkeypatch
):
    client, _runtime = _create_client(
        tmp_path=tmp_path,
        db_session=db_session,
        monkeypatch=monkeypatch,
        export_backup_file=lambda *args, **kwargs: {},
    )

    response = client.get("/api/backup/export-jobs/latest/download")
    assert response.status_code == 404


def test_legacy_streaming_backup_export_route_is_unavailable(
    db_session, tmp_path: Path, monkeypatch
):
    client, _runtime = _create_client(
        tmp_path=tmp_path,
        db_session=db_session,
        monkeypatch=monkeypatch,
        export_backup_file=lambda *args, **kwargs: {},
    )

    response = client.get("/api/backup/export")
    assert response.status_code == 404
