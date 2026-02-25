import pytest
from fastapi import HTTPException

from media_service import (
    _extract_media_paths_from_markdown,
    _normalize_media_kind,
    _validate_book_content,
)


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
