import logging
import mimetypes
import os
import re
import uuid
from datetime import datetime
from urllib.parse import urlparse

import httpx
from PIL import Image
from io import BytesIO
from fastapi import HTTPException, UploadFile
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.settings import get_settings
from models import AdminSettings, MediaAsset, Article, now_str

logger = logging.getLogger("media_service")

settings = get_settings()
media_settings = settings.media
MEDIA_ROOT = media_settings.root
MEDIA_BASE_URL = media_settings.normalized_base_url
MAX_MEDIA_SIZE = media_settings.max_size
DEFAULT_COMPRESS_THRESHOLD = 1536 * 1024
DEFAULT_MAX_DIM = 2000
DEFAULT_WEBP_QUALITY = 80


def ensure_media_root() -> None:
    os.makedirs(MEDIA_ROOT, exist_ok=True)


def is_media_enabled(db: Session) -> bool:
    admin = db.query(AdminSettings).first()
    if not admin:
        return False
    return bool(admin.media_storage_enabled)


def is_internal_media_url(url: str) -> bool:
    if not url:
        return False
    raw = url.strip()
    if not raw:
        return False
    parsed = urlparse(raw)
    path = (parsed.path or raw).replace("\\", "/")
    if not path.startswith("/"):
        return False

    prefixes = _internal_media_path_prefixes()
    return any(path.startswith(prefix) for prefix in prefixes)


def _internal_media_path_prefixes() -> tuple[str, ...]:
    prefixes = [
        f"{MEDIA_BASE_URL.rstrip('/')}/",
        "/media/",
        "/backend/media/",
    ]
    seen: list[str] = []
    for prefix in prefixes:
        if prefix not in seen:
            seen.append(prefix)
    return tuple(seen)


def _guess_extension(content_type: str | None, url: str | None = None) -> str:
    ext = ""
    if content_type:
        ext = mimetypes.guess_extension(content_type.split(";")[0].strip()) or ""
    if not ext and url:
        parsed = urlparse(url)
        _, ext = os.path.splitext(parsed.path)
    if not ext:
        ext = ".jpg"
    if not ext.startswith("."):
        ext = f".{ext}"
    return ext.lower()


def _build_storage_path(ext: str) -> str:
    now = datetime.utcnow()
    folder = f"{now.year:04d}/{now.month:02d}"
    filename = f"{uuid.uuid4().hex}{ext}"
    return os.path.join(folder, filename)


def _write_bytes(storage_path: str, data: bytes) -> None:
    ensure_media_root()
    full_path = os.path.join(MEDIA_ROOT, storage_path)
    os.makedirs(os.path.dirname(full_path), exist_ok=True)
    with open(full_path, "wb") as f:
        f.write(data)


def _create_asset(
    db: Session,
    article_id: str,
    storage_path: str,
    content_type: str | None,
    size: int | None,
    original_url: str | None = None,
) -> MediaAsset:
    asset = MediaAsset(
        article_id=article_id,
        storage_path=storage_path.replace("\\", "/"),
        content_type=content_type,
        size=size,
        original_url=original_url,
        created_at=now_str(),
    )
    db.add(asset)
    db.commit()
    db.refresh(asset)
    return asset


def _build_media_url(storage_path: str) -> str:
    public_base = media_settings.public_base_url.rstrip("/")
    normalized = storage_path.replace("\\", "/")
    relative = f"{MEDIA_BASE_URL}/{normalized.lstrip('/')}"
    if public_base:
        return f"{public_base}{relative}"
    return relative


def _validate_image_content_type(content_type: str | None) -> str:
    raw = (content_type or "").split(";")[0].strip().lower()
    if not raw.startswith("image/"):
        raise HTTPException(status_code=400, detail="仅支持图片文件")
    return raw


def _validate_size(size: int) -> None:
    if size > MAX_MEDIA_SIZE:
        raise HTTPException(status_code=400, detail="图片过大，超出限制")


def _get_media_settings(db: Session) -> dict:
    admin = db.query(AdminSettings).first()
    return {
        "compress_threshold": (
            admin.media_compress_threshold
            if admin and admin.media_compress_threshold is not None
            else DEFAULT_COMPRESS_THRESHOLD
        ),
        "max_dim": (
            admin.media_max_dim if admin and admin.media_max_dim is not None else DEFAULT_MAX_DIM
        ),
        "webp_quality": (
            admin.media_webp_quality
            if admin and admin.media_webp_quality is not None
            else DEFAULT_WEBP_QUALITY
        ),
    }


def _maybe_compress_image(
    data: bytes,
    content_type: str | None,
    compress_threshold: int,
    max_dim: int,
    webp_quality: int,
) -> tuple[bytes, str | None, str | None]:
    if not data:
        return data, content_type, None
    if len(data) <= compress_threshold:
        return data, content_type, None
    if not content_type or not content_type.startswith("image/"):
        return data, content_type, None

    try:
        with Image.open(BytesIO(data)) as img:
            original_format = img.format or "PNG"
            is_animated = bool(getattr(img, "is_animated", False))
            if max(img.size) > max_dim:
                img.thumbnail((max_dim, max_dim))

            buffer = BytesIO()
            if not is_animated and original_format.upper() != "GIF":
                if img.mode in ["RGBA", "LA", "P"]:
                    img = img.convert("RGBA")
                else:
                    img = img.convert("RGB")
                img.save(
                    buffer,
                    format="WEBP",
                    quality=webp_quality,
                    method=6,
                )
                return buffer.getvalue(), "image/webp", ".webp"
            if original_format.upper() == "PNG":
                img.save(buffer, format="PNG", optimize=True, compress_level=9)
            elif original_format.upper() == "WEBP":
                img.save(
                    buffer,
                    format="WEBP",
                    quality=webp_quality,
                    method=6,
                )
            else:
                img.save(buffer, format=original_format)
            return buffer.getvalue(), content_type, None
    except Exception as exc:
        logger.warning("image_compress_failed: %s", str(exc))
        return data, content_type, None


async def save_upload_image(
    db: Session, article_id: str, file: UploadFile
) -> tuple[MediaAsset, str]:
    content_type = _validate_image_content_type(file.content_type)
    settings = _get_media_settings(db)
    data = await file.read()
    data, content_type, ext_override = _maybe_compress_image(
        data,
        content_type,
        settings["compress_threshold"],
        settings["max_dim"],
        settings["webp_quality"],
    )
    size = len(data)
    _validate_size(size)
    ext = ext_override or _guess_extension(content_type, file.filename)
    storage_path = _build_storage_path(ext)
    _write_bytes(storage_path, data)
    asset = _create_asset(
        db=db,
        article_id=article_id,
        storage_path=storage_path,
        content_type=content_type,
        size=size,
        original_url=None,
    )
    return asset, _build_media_url(storage_path)


async def ingest_external_image(
    db: Session, article_id: str, url: str
) -> tuple[MediaAsset, str]:
    if not url or not url.startswith(("http://", "https://")):
        raise HTTPException(status_code=400, detail="图片链接无效")

    timeout = httpx.Timeout(10.0, connect=5.0)
    async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
        response = await client.get(url)

    if response.status_code >= 400:
        raise HTTPException(status_code=400, detail="图片下载失败")

    content_type = _validate_image_content_type(response.headers.get("content-type"))
    settings = _get_media_settings(db)
    data = response.content or b""
    data, content_type, ext_override = _maybe_compress_image(
        data,
        content_type,
        settings["compress_threshold"],
        settings["max_dim"],
        settings["webp_quality"],
    )
    _validate_size(len(data))

    ext = ext_override or _guess_extension(content_type, url)
    storage_path = _build_storage_path(ext)
    _write_bytes(storage_path, data)
    asset = _create_asset(
        db=db,
        article_id=article_id,
        storage_path=storage_path,
        content_type=content_type,
        size=len(data),
        original_url=url,
    )
    return asset, _build_media_url(storage_path)


async def maybe_ingest_top_image(db: Session, article) -> str | None:
    if not article or not article.top_image:
        return None
    if not is_media_enabled(db):
        return None
    if is_internal_media_url(article.top_image):
        return None
    try:
        _, url = await ingest_external_image(db, article.id, article.top_image)
    except HTTPException as exc:
        logger.warning("top_image_ingest_failed: %s", exc.detail)
        return None
    except Exception as exc:
        logger.warning("top_image_ingest_failed: %s", str(exc))
        return None

    article.top_image = url
    article.updated_at = now_str()
    db.commit()
    db.refresh(article)
    return url


def _merge_ingest_stats(
    target: dict[str, int], source: dict[str, int]
) -> dict[str, int]:
    target["total"] += source.get("total", 0)
    target["success"] += source.get("success", 0)
    target["failed"] += source.get("failed", 0)
    return target


async def maybe_ingest_article_images_with_stats(db: Session, article) -> dict:
    stats = {"total": 0, "success": 0, "failed": 0, "updated": False}
    if not article:
        return stats
    if not is_media_enabled(db):
        return stats

    updated = False

    if article.content_md:
        updated_md, md_stats = await _ingest_images_in_markdown(
            db, article.id, article.content_md
        )
        _merge_ingest_stats(stats, md_stats)
        if updated_md != article.content_md:
            article.content_md = updated_md
            updated = True

    if article.content_html:
        updated_html, html_stats = await _ingest_images_in_html(
            db, article.id, article.content_html
        )
        _merge_ingest_stats(stats, html_stats)
        if updated_html != article.content_html:
            article.content_html = updated_html
            updated = True

    if updated:
        article.updated_at = now_str()
        db.commit()
        db.refresh(article)
    stats["updated"] = updated
    return stats


async def maybe_ingest_article_images(db: Session, article) -> bool:
    stats = await maybe_ingest_article_images_with_stats(db, article)
    return bool(stats.get("updated"))


async def _ingest_images_in_markdown(
    db: Session, article_id: str, markdown: str
) -> tuple[str, dict[str, int]]:
    stats = {"total": 0, "success": 0, "failed": 0}
    if not markdown:
        return markdown, stats

    pattern = re.compile(
        r"!\[([^\]]*)\]\((\S+?)(?:\s+\"([^\"]*)\")?\)"
    )

    async def replace(match: re.Match) -> str:
        alt = match.group(1) or ""
        url = match.group(2) or ""
        title = match.group(3)
        if not url or is_internal_media_url(url):
            return match.group(0)
        if not url.startswith(("http://", "https://")):
            return match.group(0)
        stats["total"] += 1
        try:
            _, new_url = await ingest_external_image(db, article_id, url)
        except Exception as exc:
            logger.warning("markdown_image_ingest_failed: %s", str(exc))
            stats["failed"] += 1
            return match.group(0)
        stats["success"] += 1
        title_part = f' "{title}"' if title else ""
        return f"![{alt}]({new_url}{title_part})"

    parts = []
    last = 0
    for match in pattern.finditer(markdown):
        parts.append(markdown[last : match.start()])
        parts.append(await replace(match))
        last = match.end()
    parts.append(markdown[last:])
    return "".join(parts), stats


async def _ingest_images_in_html(
    db: Session, article_id: str, html: str
) -> tuple[str, dict[str, int]]:
    stats = {"total": 0, "success": 0, "failed": 0}
    if not html:
        return html, stats

    pattern = re.compile(r"(<img[^>]+src=[\"'])([^\"']+)([\"'])", re.IGNORECASE)

    async def replace(match: re.Match) -> str:
        prefix = match.group(1)
        url = match.group(2)
        suffix = match.group(3)
        if not url or is_internal_media_url(url):
            return match.group(0)
        if not url.startswith(("http://", "https://")):
            return match.group(0)
        stats["total"] += 1
        try:
            _, new_url = await ingest_external_image(db, article_id, url)
        except Exception as exc:
            logger.warning("html_image_ingest_failed: %s", str(exc))
            stats["failed"] += 1
            return match.group(0)
        stats["success"] += 1
        return f"{prefix}{new_url}{suffix}"

    parts = []
    last = 0
    for match in pattern.finditer(html):
        parts.append(html[last : match.start()])
        parts.append(await replace(match))
        last = match.end()
    parts.append(html[last:])
    return "".join(parts), stats


def cleanup_media_assets(db: Session, article_ids: list[str]) -> int:
    if not article_ids:
        return 0
    assets = (
        db.query(MediaAsset)
        .filter(MediaAsset.article_id.in_(article_ids))
        .all()
    )
    count = 0
    for asset in assets:
        if asset.storage_path:
            full_path = os.path.join(MEDIA_ROOT, asset.storage_path)
            try:
                os.remove(full_path)
            except FileNotFoundError:
                pass
            except Exception as exc:
                logger.warning("media_delete_failed: %s", str(exc))
        db.delete(asset)
        count += 1
    db.commit()
    return count


def _extract_internal_media_rel_path(url: str) -> str | None:
    if not url:
        return None
    raw = url.strip()
    if not raw:
        return None

    parsed = urlparse(raw)
    path = (parsed.path or raw).replace("\\", "/")
    if not path:
        return None

    prefixes = _internal_media_path_prefixes()
    for prefix in prefixes:
        if path.startswith(prefix):
            rel = path[len(prefix) :].lstrip("/")
            return rel or None
    return None


def _extract_media_paths_from_markdown(content: str) -> set[str]:
    if not content:
        return set()
    paths: set[str] = set()
    pattern = re.compile(r"!\[[^\]]*\]\((\S+?)(?:\s+\"[^\"]*\")?\)")
    for match in pattern.finditer(content):
        rel = _extract_internal_media_rel_path(match.group(1) or "")
        if rel:
            paths.add(rel)
    return paths


def cleanup_orphan_media(db: Session) -> dict:
    ensure_media_root()
    articles = db.query(Article.id, Article.content_md, Article.top_image).all()
    referenced_paths: set[str] = set()
    for article_id, content_md, top_image in articles:
        referenced_paths |= _extract_media_paths_from_markdown(content_md or "")
        rel = _extract_internal_media_rel_path(top_image or "")
        if rel:
            referenced_paths.add(rel)

    assets = db.query(MediaAsset).all()
    removed_records = 0
    removed_files = 0
    keep_paths: set[str] = set()

    for asset in assets:
        storage_path = (asset.storage_path or "").replace("\\", "/")
        if not storage_path:
            db.delete(asset)
            removed_records += 1
            continue
        if storage_path not in referenced_paths:
            full_path = os.path.join(MEDIA_ROOT, storage_path)
            try:
                os.remove(full_path)
                removed_files += 1
            except FileNotFoundError:
                pass
            except Exception as exc:
                logger.warning("media_delete_failed: %s", str(exc))
            db.delete(asset)
            removed_records += 1
        else:
            keep_paths.add(storage_path)

    db.commit()

    preserve_paths = keep_paths | referenced_paths
    for root, _dirs, files in os.walk(MEDIA_ROOT):
        for filename in files:
            full_path = os.path.join(root, filename)
            rel_path = os.path.relpath(full_path, MEDIA_ROOT).replace("\\", "/")
            if rel_path not in preserve_paths:
                try:
                    os.remove(full_path)
                    removed_files += 1
                except FileNotFoundError:
                    pass
                except Exception as exc:
                    logger.warning("media_delete_failed: %s", str(exc))

    return {
        "removed_records": removed_records,
        "removed_files": removed_files,
        "kept": len(keep_paths),
    }


def get_media_storage_stats(db: Session) -> dict:
    ensure_media_root()
    total_records, total_size = (
        db.query(
            func.count(MediaAsset.id),
            func.coalesce(func.sum(MediaAsset.size), 0),
        )
        .one()
    )

    file_count = 0
    disk_size = 0
    for root, _dirs, files in os.walk(MEDIA_ROOT):
        for filename in files:
            full_path = os.path.join(root, filename)
            try:
                stat = os.stat(full_path)
            except FileNotFoundError:
                continue
            except Exception as exc:
                logger.warning("media_stat_failed: %s", str(exc))
                continue
            file_count += 1
            disk_size += int(stat.st_size)

    return {
        "asset_count": int(total_records or 0),
        "asset_total_size": int(total_size or 0),
        "disk_file_count": int(file_count),
        "disk_total_size": int(disk_size),
    }
