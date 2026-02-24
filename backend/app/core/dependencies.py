import secrets
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials
from sqlalchemy.orm import Session

from app.core.settings import get_settings
from auth import check_is_admin, get_admin_settings, get_current_admin, security
from models import AdminSettings, get_db, now_str

settings = get_settings()
security_settings = settings.security

DEFAULT_BASIC_SETTINGS = {
    "default_language": "zh-CN",
    "site_name": "Lumina",
    "site_description": "信息灯塔",
    "site_logo_url": "",
    "home_badge_text": "",
    "home_tagline_text": "",
    "home_primary_button_text": "",
    "home_primary_button_url": "",
    "home_secondary_button_text": "",
    "home_secondary_button_url": "",
}


def is_internal_request(request: Request) -> bool:
    if not security_settings.internal_api_token:
        return False
    provided = request.headers.get("X-Internal-Token") or ""
    return secrets.compare_digest(provided, security_settings.internal_api_token)


def require_internal_token(request: Request) -> bool:
    if not is_internal_request(request):
        raise HTTPException(status_code=403, detail="内部请求鉴权失败")
    return True


def get_admin_or_internal(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
    db: Session = Depends(get_db),
) -> bool:
    if is_internal_request(request):
        return True
    return get_current_admin(credentials=credentials, db=db)


def check_is_admin_or_internal(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
    db: Session = Depends(get_db),
) -> bool:
    if is_internal_request(request):
        return True
    return check_is_admin(credentials=credentials, db=db)


def build_basic_settings(admin: Optional[AdminSettings]) -> dict:
    if admin is None:
        return DEFAULT_BASIC_SETTINGS.copy()
    return {
        "default_language": admin.default_language
        or DEFAULT_BASIC_SETTINGS["default_language"],
        "site_name": admin.site_name or DEFAULT_BASIC_SETTINGS["site_name"],
        "site_description": admin.site_description
        or DEFAULT_BASIC_SETTINGS["site_description"],
        "site_logo_url": admin.site_logo_url or "",
        "home_badge_text": admin.home_badge_text or "",
        "home_tagline_text": admin.home_tagline_text or "",
        "home_primary_button_text": admin.home_primary_button_text or "",
        "home_primary_button_url": admin.home_primary_button_url or "",
        "home_secondary_button_text": admin.home_secondary_button_text or "",
        "home_secondary_button_url": admin.home_secondary_button_url or "",
    }


def validate_home_button_url(value: str, field_name: str) -> str:
    normalized = value.strip()
    if not normalized:
        return ""
    if normalized.startswith("/"):
        return normalized
    if normalized.startswith("http://") or normalized.startswith("https://"):
        return normalized
    raise HTTPException(
        status_code=400,
        detail=f"{field_name}仅支持以 / 开头的站内路径或 http/https 外链地址",
    )


def normalize_date_bound(value: Optional[str], is_end: bool) -> Optional[str]:
    if not value:
        return None
    raw = value.strip()
    if not raw:
        return None
    try:
        if raw.endswith("Z"):
            raw = raw[:-1] + "+00:00"
        if "T" in raw:
            dt = datetime.fromisoformat(raw)
        else:
            dt = datetime.fromisoformat(raw)
            if is_end:
                dt = dt.replace(hour=23, minute=59, second=59, microsecond=0)
            else:
                dt = dt.replace(hour=0, minute=0, second=0, microsecond=0)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.isoformat()
    except Exception:
        return None


def ensure_nextauth_secret(db: Session, admin: AdminSettings) -> str:
    if admin.nextauth_secret:
        return admin.nextauth_secret
    admin.nextauth_secret = uuid.uuid4().hex + uuid.uuid4().hex
    admin.updated_at = now_str()
    db.commit()
    db.refresh(admin)
    return admin.nextauth_secret


def comments_enabled(db: Session) -> bool:
    admin = get_admin_settings(db)
    if admin is None:
        return True
    return bool(admin.comments_enabled)


def get_sensitive_words(db: Session) -> tuple[bool, list[str]]:
    admin = get_admin_settings(db)
    if admin is None:
        return False, []
    enabled = bool(admin.sensitive_filter_enabled)
    words_raw = admin.sensitive_words or ""
    words = [w.strip() for w in words_raw.replace(",", "\n").splitlines() if w.strip()]
    return enabled, words


def contains_sensitive_word(content: str, words: list[str]) -> bool:
    if not content:
        return False
    return any(word in content for word in words)
