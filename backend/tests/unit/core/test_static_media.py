from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.core.static_media import CachedStaticFiles, MEDIA_CACHE_CONTROL


def test_cached_static_files_sets_webp_content_type_and_cache_headers(tmp_path: Path):
    media_file = tmp_path / "cover.webp"
    media_file.write_bytes(b"RIFFxxxxWEBP")
    app = FastAPI()
    app.mount("/media", CachedStaticFiles(directory=str(tmp_path)), name="media")

    response = TestClient(app).get("/media/cover.webp")

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("image/webp")
    assert response.headers["cache-control"] == MEDIA_CACHE_CONTROL
    assert response.headers["x-content-type-options"] == "nosniff"


def test_cached_static_files_preserves_cache_headers_on_not_modified(tmp_path: Path):
    media_file = tmp_path / "cover.webp"
    media_file.write_bytes(b"RIFFxxxxWEBP")
    app = FastAPI()
    app.mount("/media", CachedStaticFiles(directory=str(tmp_path)), name="media")
    client = TestClient(app)
    first_response = client.get("/media/cover.webp")

    response = client.get(
        "/media/cover.webp",
        headers={"If-None-Match": first_response.headers["etag"]},
    )

    assert response.status_code == 304
    assert response.headers["cache-control"] == MEDIA_CACHE_CONTROL
    assert response.headers["x-content-type-options"] == "nosniff"
