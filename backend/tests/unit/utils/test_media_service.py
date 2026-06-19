from io import BytesIO
import os

import pytest
from fastapi import HTTPException
from fastapi import UploadFile
from PIL import Image

from media_service import (
    _apply_lumina_watermark,
    _extract_media_paths_from_markdown,
    _find_existing_media_asset,
    _normalize_media_kind,
    _validate_book_content,
    maybe_ingest_article_images_with_stats,
    save_upload_image,
)
from models import AdminSettings, Article, MediaAsset


@pytest.fixture
def anyio_backend():
    return "asyncio"


def _make_png_bytes(size=(360, 220), color=(245, 245, 245)):
    image = Image.new("RGB", size, color)
    buffer = BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def _bottom_right_pixel_delta(left: bytes, right: bytes) -> float:
    with Image.open(BytesIO(left)) as left_image, Image.open(BytesIO(right)) as right_image:
        left_image = left_image.convert("RGB")
        right_image = right_image.convert("RGB").resize(left_image.size)
        width, height = left_image.size
        box = (width - 180, height - 90, width - 8, height - 8)
        left_pixels = list(left_image.crop(box).getdata())
        right_pixels = list(right_image.crop(box).getdata())
    total = 0
    for (lr, lg, lb), (rr, rg, rb) in zip(left_pixels, right_pixels):
        total += abs(lr - rr) + abs(lg - rg) + abs(lb - rb)
    return total / (len(left_pixels) * 3)


def _changed_columns_ratio(left: bytes, right: bytes) -> float:
    with Image.open(BytesIO(left)) as left_image, Image.open(BytesIO(right)) as right_image:
        left_image = left_image.convert("RGB")
        right_image = right_image.convert("RGB").resize(left_image.size)
        width, height = left_image.size
        box = (width // 2, height - 110, width - 8, height - 8)
        left_crop = left_image.crop(box)
        right_crop = right_image.crop(box)
        crop_width, crop_height = left_crop.size
        changed_columns = 0
        for x in range(crop_width):
            column_delta = 0
            for y in range(crop_height):
                left_pixel = left_crop.getpixel((x, y))
                right_pixel = right_crop.getpixel((x, y))
                column_delta += sum(abs(left_pixel[index] - right_pixel[index]) for index in range(3))
            if column_delta / (crop_height * 3) > 1:
                changed_columns += 1
    return changed_columns / crop_width


def test_normalize_media_kind_defaults_to_image():
    assert _normalize_media_kind(None) == "image"


def test_normalize_media_kind_accepts_book():
    assert _normalize_media_kind("book") == "book"


def test_normalize_media_kind_rejects_unknown_kind():
    with pytest.raises(HTTPException) as exc_info:
        _normalize_media_kind("video")

    assert exc_info.value.status_code == 400
    assert exc_info.value.detail == "仅支持 image 或 book 类型"


def test_validate_book_content_supports_known_mime():
    content_type, extension = _validate_book_content("application/pdf", "demo.bin")

    assert content_type == "application/pdf"
    assert extension == ".pdf"


def test_validate_book_content_falls_back_to_extension():
    content_type, extension = _validate_book_content(
        "application/octet-stream",
        "https://example.com/books/demo.epub",
    )

    assert content_type == "application/epub+zip"
    assert extension == ".epub"


def test_validate_book_content_rejects_unknown_types():
    with pytest.raises(HTTPException) as exc_info:
        _validate_book_content("application/zip", "https://example.com/archive.zip")

    assert exc_info.value.status_code == 400
    assert exc_info.value.detail == "仅支持 PDF/EPUB/MOBI 文件"


def test_apply_lumina_watermark_outputs_webp_with_visible_text():
    original = _make_png_bytes()

    watermarked, content_type, ext = _apply_lumina_watermark(original, "image/png", 80)

    assert content_type == "image/webp"
    assert ext == ".webp"
    assert _bottom_right_pixel_delta(watermarked, original) > 1
    assert _changed_columns_ratio(watermarked, original) > 0.25


def test_apply_lumina_watermark_resizes_large_pixel_images():
    original = _make_png_bytes(size=(2400, 1200))

    watermarked, content_type, ext = _apply_lumina_watermark(
        original,
        "image/png",
        80,
        max_dim=600,
    )

    assert content_type == "image/webp"
    assert ext == ".webp"
    with Image.open(BytesIO(watermarked)) as image:
        assert max(image.size) == 600


def test_find_existing_media_asset_reuses_existing_file(db_session, tmp_path, monkeypatch):
    import media_service

    monkeypatch.setattr(media_service, "MEDIA_ROOT", str(tmp_path))
    media_file = tmp_path / "2026" / "04" / "demo.webp"
    media_file.parent.mkdir(parents=True)
    media_file.write_bytes(b"WEBP")
    article = Article(title="Demo", slug="demo")
    db_session.add(article)
    db_session.flush()
    asset = MediaAsset(
        article_id=article.id,
        storage_path="2026/04/demo.webp",
        content_type="image/webp",
        size=4,
        original_url="https://example.com/demo.png",
    )
    db_session.add(asset)
    db_session.commit()

    existing = _find_existing_media_asset(
        db_session,
        article_id=article.id,
        review_issue_id=None,
        original_url="https://example.com/demo.png",
    )

    assert existing is not None
    assert existing.id == asset.id


@pytest.mark.anyio
async def test_save_upload_image_persists_watermarked_webp(db_session, tmp_path, monkeypatch):
    import media_service

    monkeypatch.setattr(media_service, "MEDIA_ROOT", str(tmp_path))
    db_session.add(
        AdminSettings(
            password_hash="hash",
            jwt_secret="secret",
            media_storage_enabled=True,
        )
    )
    article = Article(title="Demo", slug="demo")
    db_session.add(article)
    db_session.commit()
    db_session.refresh(article)

    upload = UploadFile(filename="cover.png", file=BytesIO(_make_png_bytes()))
    upload.headers = {"content-type": "image/png"}

    asset, url = await save_upload_image(db_session, article.id, upload)

    assert asset.content_type == "image/webp"
    assert asset.storage_path.endswith(".webp")
    assert url.endswith(".webp")
    saved_path = os.path.join(str(tmp_path), asset.storage_path)
    saved_data = open(saved_path, "rb").read()
    assert _bottom_right_pixel_delta(saved_data, _make_png_bytes()) > 1


def test_extract_media_paths_from_markdown_includes_links_and_images():
    content = """
![cover](/backend/media/2026/02/cover.webp)
[📚 书籍](/backend/media/2026/02/book.pdf)
[外链](https://example.com/book.pdf)
"""
    paths = _extract_media_paths_from_markdown(content)

    assert "2026/02/cover.webp" in paths
    assert "2026/02/book.pdf" in paths
    assert len(paths) == 2


@pytest.mark.anyio
async def test_ingest_article_images_handles_jina_markdown_image_inside_html(
    db_session,
    monkeypatch,
):
    import media_service

    captured_urls = []

    async def fake_ingest_external_image(_db, article_id, url, kind="image", **_kwargs):
        captured_urls.append((article_id, url, kind))
        asset = MediaAsset(
            article_id=article_id,
            storage_path="2026/06/body.webp",
            content_type="image/webp",
            size=10,
            original_url=url,
        )
        _db.add(asset)
        _db.commit()
        _db.refresh(asset)
        return asset, "/media/2026/06/body.webp"

    monkeypatch.setattr(
        media_service,
        "ingest_external_image",
        fake_ingest_external_image,
    )
    db_session.add(
        AdminSettings(
            password_hash="hash",
            jwt_secret="secret",
            media_storage_enabled=True,
        )
    )
    article = Article(
        title="Jina HTML",
        slug="jina-html",
        content_html=(
            "<p>![Image](https://cdn.example.com/body.png?x=1&amp;y=2)"
            "正文</p>"
        ),
        content_md="正文",
    )
    db_session.add(article)
    db_session.commit()
    db_session.refresh(article)

    stats = await maybe_ingest_article_images_with_stats(db_session, article)

    assert stats == {"total": 1, "success": 1, "failed": 0, "updated": True}
    assert captured_urls == [
        (article.id, "https://cdn.example.com/body.png?x=1&y=2", "image")
    ]
    assert article.content_html == "<p>![Image](/media/2026/06/body.webp)正文</p>"


@pytest.mark.anyio
async def test_ingest_article_images_unescapes_html_image_urls(
    db_session,
    monkeypatch,
):
    import media_service

    captured_urls = []

    async def fake_ingest_external_image(_db, article_id, url, kind="image", **_kwargs):
        captured_urls.append((article_id, url, kind))
        asset = MediaAsset(
            article_id=article_id,
            storage_path="2026/06/html-body.webp",
            content_type="image/webp",
            size=10,
            original_url=url,
        )
        _db.add(asset)
        _db.commit()
        _db.refresh(asset)
        return asset, "/media/2026/06/html-body.webp"

    monkeypatch.setattr(
        media_service,
        "ingest_external_image",
        fake_ingest_external_image,
    )
    db_session.add(
        AdminSettings(
            password_hash="hash",
            jwt_secret="secret",
            media_storage_enabled=True,
        )
    )
    article = Article(
        title="HTML image",
        slug="html-image",
        content_html='<p><img src="https://cdn.example.com/body.png?x=1&amp;y=2"></p>',
        content_md="正文",
    )
    db_session.add(article)
    db_session.commit()
    db_session.refresh(article)

    stats = await maybe_ingest_article_images_with_stats(db_session, article)

    assert stats == {"total": 1, "success": 1, "failed": 0, "updated": True}
    assert captured_urls == [
        (article.id, "https://cdn.example.com/body.png?x=1&y=2", "image")
    ]
    assert article.content_html == '<p><img src="/media/2026/06/html-body.webp"></p>'
