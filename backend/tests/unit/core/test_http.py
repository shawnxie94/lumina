from __future__ import annotations

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.core import http


def test_request_middleware_blocks_mutating_requests_during_restore(monkeypatch):
    app = FastAPI()
    http.configure_request_middleware(app)

    @app.get("/api/health")
    async def health():
        return {"ok": True}

    @app.post("/api/articles")
    async def create_article():
        return {"ok": True}

    @app.post("/api/backup/import")
    async def import_backup():
        return {"ok": True}

    sequence = iter([True, True, True])
    monkeypatch.setattr(http, "restore_lock_active", lambda: next(sequence))

    client = TestClient(app)

    blocked = client.post("/api/articles")
    assert blocked.status_code == 423
    assert blocked.json()["detail"] == "镜像恢复进行中，请稍后再试"

    allowed_import = client.post("/api/backup/import")
    assert allowed_import.status_code == 200

    allowed_read = client.get("/api/health")
    assert allowed_read.status_code == 200
