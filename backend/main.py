import json
import logging
import os
import time
import uuid
import ipaddress

from fastapi import FastAPI, HTTPException, Depends, Request, UploadFile, File, Form
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, timezone
from models import (
    get_db,
    init_db,
    now_str,
    Category,
    Article,
    AITask,
    AIUsageLog,
    ArticleEmbedding,
    ModelAPIConfig,
    PromptConfig,
    ArticleComment,
    AdminSettings,
)
from article_service import ArticleService
from sqlalchemy import func, or_
from sqlalchemy.orm import Session
from auth import (
    LoginRequest,
    LoginResponse,
    ChangePasswordRequest,
    SetupRequest,
    get_current_admin,
    check_is_admin,
    get_admin_settings,
    create_admin_settings,
    update_admin_password,
    verify_password,
    create_token,
    security,
)
from fastapi.security import HTTPAuthorizationCredentials
from media_service import (
    ensure_media_root,
    ingest_external_image,
    save_upload_image,
    is_media_enabled,
    cleanup_media_assets,
    cleanup_orphan_media,
    MEDIA_ROOT,
    MEDIA_BASE_URL,
)

logger = logging.getLogger("article_api")
if not logger.handlers:
    logging.basicConfig(level=logging.INFO)

INTERNAL_API_TOKEN = os.getenv("INTERNAL_API_TOKEN", "")
SIMILAR_ARTICLE_CANDIDATE_LIMIT = 500
CATEGORY_SIMILARITY_BOOST = 0.05
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


def log_event(event: str, request_id: str, **fields) -> None:
    payload = {"event": event, "request_id": request_id, **fields}
    logger.info(json.dumps(payload, ensure_ascii=False))


def is_internal_request(request: Request) -> bool:
    if not INTERNAL_API_TOKEN:
        return False
    return request.headers.get("X-Internal-Token") == INTERNAL_API_TOKEN


def is_private_request(request: Request) -> bool:
    if not request.client:
        return False
    try:
        ip = ipaddress.ip_address(request.client.host)
        return ip.is_private or ip.is_loopback
    except ValueError:
        return False


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


def get_admin_or_internal(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
    db: Session = Depends(get_db),
) -> bool:
    if is_internal_request(request):
        return True
    if not INTERNAL_API_TOKEN and is_private_request(request):
        return True
    return get_current_admin(credentials=credentials, db=db)


app = FastAPI(title="文章知识库API", version="1.0.0")

app.mount(
    MEDIA_BASE_URL, StaticFiles(directory=MEDIA_ROOT, check_dir=False), name="media"
)


@app.middleware("http")
async def request_id_middleware(request: Request, call_next):
    request_id = request.headers.get("X-Request-Id") or str(uuid.uuid4())
    request.state.request_id = request_id
    start_time = time.perf_counter()
    log_event(
        "request_start",
        request_id,
        method=request.method,
        path=str(request.url.path),
        client=request.client.host if request.client else None,
    )
    try:
        response = await call_next(request)
    except Exception as exc:
        duration_ms = round((time.perf_counter() - start_time) * 1000, 2)
        log_event(
            "request_error",
            request_id,
            method=request.method,
            path=str(request.url.path),
            duration_ms=duration_ms,
            error=str(exc),
        )
        raise
    duration_ms = round((time.perf_counter() - start_time) * 1000, 2)
    response.headers["X-Request-Id"] = request_id
    log_event(
        "request_end",
        request_id,
        method=request.method,
        path=str(request.url.path),
        status_code=response.status_code,
        duration_ms=duration_ms,
    )
    return response


allowed_origins_env = os.getenv("ALLOWED_ORIGINS", "")
allow_credentials = True
if allowed_origins_env:
    if allowed_origins_env.strip() == "*":
        allowed_origins = ["*"]
        allow_credentials = False
    else:
        allowed_origins = [
            origin.strip()
            for origin in allowed_origins_env.split(",")
            if origin.strip()
        ]
else:
    allowed_origins = [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=allow_credentials,
    allow_methods=["*"],
    allow_headers=["*"],
)

article_service = ArticleService()


class ArticleCreate(BaseModel):
    title: str
    content_html: Optional[str] = None
    content_structured: Optional[dict] = None
    content_md: Optional[str] = None
    source_url: Optional[str] = None
    top_image: Optional[str] = None
    author: Optional[str] = None
    published_at: Optional[str] = None
    source_domain: Optional[str] = None
    category_id: Optional[str] = None


class ArticleUpdate(BaseModel):
    title: Optional[str] = None
    author: Optional[str] = None
    top_image: Optional[str] = None
    content_md: Optional[str] = None
    content_trans: Optional[str] = None
    is_visible: Optional[bool] = None
    category_id: Optional[str] = None


class ArticleBatchVisibility(BaseModel):
    article_slugs: List[str]
    is_visible: bool


class ArticleBatchCategory(BaseModel):
    article_slugs: List[str]
    category_id: Optional[str] = None


class ArticleBatchDelete(BaseModel):
    article_slugs: List[str]


class AITaskRetryRequest(BaseModel):
    task_ids: List[str]


class AITaskCancelRequest(BaseModel):
    task_ids: List[str]


class CategoryCreate(BaseModel):
    name: str
    description: Optional[str] = None
    color: Optional[str] = None
    sort_order: Optional[int] = 0


class ArticleNotesUpdate(BaseModel):
    note_content: Optional[str] = None
    annotations: Optional[list[dict]] = None


class ModelAPITestRequest(BaseModel):
    prompt: Optional[str] = None
    max_tokens: Optional[int] = None


class ModelAPIModelsRequest(BaseModel):
    base_url: str
    api_key: str
    provider: Optional[str] = None


class ExportRequest(BaseModel):
    article_slugs: List[str]


class ModelAPIConfigBase(BaseModel):
    name: str
    base_url: str
    api_key: str
    provider: str = "openai"
    model_name: str = "gpt-4o"
    model_type: str = "general"
    price_input_per_1k: Optional[float] = None
    price_output_per_1k: Optional[float] = None
    currency: Optional[str] = None
    is_enabled: bool = True
    is_default: bool = False


class PromptConfigBase(BaseModel):
    name: str
    category_id: Optional[str] = None
    type: str  # summary, outline, key_points, mindmap, etc.
    prompt: str
    system_prompt: Optional[str] = None
    response_format: Optional[str] = None
    temperature: Optional[float] = None
    max_tokens: Optional[int] = None
    top_p: Optional[float] = None
    model_api_config_id: Optional[str] = None
    is_enabled: bool = True
    is_default: bool = False


class CommentCreate(BaseModel):
    content: str
    user_id: str
    user_name: str
    user_avatar: Optional[str] = None
    provider: Optional[str] = None
    reply_to_id: Optional[str] = None


class CommentUpdate(BaseModel):
    content: str
    reply_to_id: Optional[str] = None


class CommentSettingsUpdate(BaseModel):
    comments_enabled: Optional[bool] = None
    github_client_id: Optional[str] = None
    github_client_secret: Optional[str] = None
    google_client_id: Optional[str] = None
    google_client_secret: Optional[str] = None
    nextauth_secret: Optional[str] = None
    sensitive_filter_enabled: Optional[bool] = None
    sensitive_words: Optional[str] = None


class StorageSettingsUpdate(BaseModel):
    media_storage_enabled: Optional[bool] = None
    media_compress_threshold: Optional[int] = None
    media_max_dim: Optional[int] = None
    media_webp_quality: Optional[int] = None


class RecommendationSettingsUpdate(BaseModel):
    recommendations_enabled: Optional[bool] = None
    recommendation_model_config_id: Optional[str] = None


class BasicSettingsUpdate(BaseModel):
    default_language: Optional[str] = None
    site_name: Optional[str] = None
    site_description: Optional[str] = None
    site_logo_url: Optional[str] = None
    home_badge_text: Optional[str] = None
    home_tagline_text: Optional[str] = None
    home_primary_button_text: Optional[str] = None
    home_primary_button_url: Optional[str] = None
    home_secondary_button_text: Optional[str] = None
    home_secondary_button_url: Optional[str] = None


class MediaIngestRequest(BaseModel):
    url: str
    article_id: str


class CommentVisibilityUpdate(BaseModel):
    is_hidden: bool


@app.on_event("startup")
async def startup_event():
    init_db()
    ensure_media_root()


# ============ 认证路由 ============


@app.get("/api/auth/status")
async def get_auth_status(db: Session = Depends(get_db)):
    """获取认证状态：是否已初始化管理员密码"""
    admin = get_admin_settings(db)
    return {"initialized": admin is not None}


@app.post("/api/auth/setup")
async def setup_admin(request: SetupRequest, db: Session = Depends(get_db)):
    """首次设置管理员密码"""
    admin = get_admin_settings(db)
    if admin is not None:
        raise HTTPException(status_code=400, detail="管理员密码已设置")

    try:
        admin = create_admin_settings(db, request.password)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    token = create_token(admin.jwt_secret)
    return LoginResponse(token=token, message="管理员密码设置成功")


@app.post("/api/auth/login")
async def login(request: LoginRequest, db: Session = Depends(get_db)):
    """管理员登录"""
    admin = get_admin_settings(db)
    if admin is None:
        raise HTTPException(status_code=400, detail="系统未初始化，请先设置管理员密码")

    is_valid, needs_upgrade = verify_password(request.password, admin.password_hash)
    if not is_valid:
        raise HTTPException(status_code=401, detail="密码错误")

    if needs_upgrade:
        update_admin_password(db, admin, request.password)

    token = create_token(admin.jwt_secret)
    return LoginResponse(token=token, message="登录成功")


# ============ 基础配置 ============


@app.get("/api/settings/basic")
async def get_basic_settings(
    _: bool = Depends(get_admin_or_internal),
    db: Session = Depends(get_db),
):
    admin = get_admin_settings(db)
    if admin is None:
        raise HTTPException(status_code=404, detail="未初始化管理员设置")
    return build_basic_settings(admin)


@app.put("/api/settings/basic")
async def update_basic_settings(
    payload: BasicSettingsUpdate,
    db: Session = Depends(get_db),
    _: bool = Depends(get_current_admin),
):
    admin = get_admin_settings(db)
    if admin is None:
        raise HTTPException(status_code=404, detail="未初始化管理员设置")
    if payload.default_language is not None:
        if payload.default_language not in ("zh-CN", "en"):
            raise HTTPException(status_code=400, detail="默认语言仅支持 zh-CN 或 en")
        admin.default_language = payload.default_language
    if payload.site_name is not None:
        admin.site_name = payload.site_name or DEFAULT_BASIC_SETTINGS["site_name"]
    if payload.site_description is not None:
        admin.site_description = (
            payload.site_description or DEFAULT_BASIC_SETTINGS["site_description"]
        )
    if payload.site_logo_url is not None:
        admin.site_logo_url = payload.site_logo_url or ""
    if payload.home_badge_text is not None:
        admin.home_badge_text = payload.home_badge_text or ""
    if payload.home_tagline_text is not None:
        admin.home_tagline_text = payload.home_tagline_text or ""
    if payload.home_primary_button_text is not None:
        admin.home_primary_button_text = payload.home_primary_button_text or ""
    if payload.home_primary_button_url is not None:
        admin.home_primary_button_url = validate_home_button_url(
            payload.home_primary_button_url,
            "首页主按钮链接",
        )
    if payload.home_secondary_button_text is not None:
        admin.home_secondary_button_text = payload.home_secondary_button_text or ""
    if payload.home_secondary_button_url is not None:
        admin.home_secondary_button_url = validate_home_button_url(
            payload.home_secondary_button_url,
            "首页副按钮链接",
        )
    admin.updated_at = now_str()
    db.commit()
    db.refresh(admin)
    return {"success": True}


@app.get("/api/settings/basic/public")
async def get_basic_settings_public(db: Session = Depends(get_db)):
    admin = get_admin_settings(db)
    return build_basic_settings(admin)


# ============ 评论配置 ============


@app.get("/api/settings/comments")
async def get_comment_settings(
    _: bool = Depends(get_admin_or_internal),
    db: Session = Depends(get_db),
):
    admin = get_admin_settings(db)
    if admin is None:
        raise HTTPException(status_code=404, detail="未初始化管理员设置")
    secret = ensure_nextauth_secret(db, admin)
    return {
        "comments_enabled": bool(admin.comments_enabled),
        "github_client_id": admin.github_client_id or "",
        "github_client_secret": admin.github_client_secret or "",
        "google_client_id": admin.google_client_id or "",
        "google_client_secret": admin.google_client_secret or "",
        "nextauth_secret": secret or "",
        "sensitive_filter_enabled": bool(admin.sensitive_filter_enabled),
        "sensitive_words": admin.sensitive_words or "",
    }


@app.put("/api/settings/comments")
async def update_comment_settings(
    payload: CommentSettingsUpdate,
    db: Session = Depends(get_db),
    _: bool = Depends(get_current_admin),
):
    admin = get_admin_settings(db)
    if admin is None:
        raise HTTPException(status_code=404, detail="未初始化管理员设置")
    if payload.comments_enabled is not None:
        admin.comments_enabled = bool(payload.comments_enabled)
    if payload.github_client_id is not None:
        admin.github_client_id = payload.github_client_id or ""
    if payload.github_client_secret is not None:
        admin.github_client_secret = payload.github_client_secret or ""
    if payload.google_client_id is not None:
        admin.google_client_id = payload.google_client_id or ""
    if payload.google_client_secret is not None:
        admin.google_client_secret = payload.google_client_secret or ""
    if payload.nextauth_secret is not None:
        admin.nextauth_secret = payload.nextauth_secret or ""
    if payload.sensitive_filter_enabled is not None:
        admin.sensitive_filter_enabled = bool(payload.sensitive_filter_enabled)
    if payload.sensitive_words is not None:
        admin.sensitive_words = payload.sensitive_words or ""
    if not admin.nextauth_secret:
        admin.nextauth_secret = uuid.uuid4().hex + uuid.uuid4().hex
    admin.updated_at = now_str()
    db.commit()
    db.refresh(admin)
    return {"success": True}


@app.get("/api/settings/comments/public")
async def get_comment_settings_public(db: Session = Depends(get_db)):
    admin = get_admin_settings(db)
    return {
        "comments_enabled": bool(admin.comments_enabled) if admin else True,
        "providers": {
            "github": bool(admin.github_client_id) if admin else False,
            "google": bool(admin.google_client_id) if admin else False,
        },
    }


# ============ 存储配置 ============


@app.get("/api/settings/storage")
async def get_storage_settings(
    _: bool = Depends(get_admin_or_internal),
    db: Session = Depends(get_db),
):
    admin = get_admin_settings(db)
    if admin is None:
        raise HTTPException(status_code=404, detail="未初始化管理员设置")
    return {
        "media_storage_enabled": bool(admin.media_storage_enabled),
        "media_compress_threshold": admin.media_compress_threshold
        if admin.media_compress_threshold is not None
        else 1536 * 1024,
        "media_max_dim": admin.media_max_dim
        if admin.media_max_dim is not None
        else 2000,
        "media_webp_quality": admin.media_webp_quality
        if admin.media_webp_quality is not None
        else 80,
    }


@app.put("/api/settings/storage")
async def update_storage_settings(
    payload: StorageSettingsUpdate,
    db: Session = Depends(get_db),
    _: bool = Depends(get_current_admin),
):
    admin = get_admin_settings(db)
    if admin is None:
        raise HTTPException(status_code=404, detail="未初始化管理员设置")
    if payload.media_storage_enabled is not None:
        admin.media_storage_enabled = bool(payload.media_storage_enabled)
    if payload.media_compress_threshold is not None:
        admin.media_compress_threshold = max(
            256 * 1024, payload.media_compress_threshold
        )
    if payload.media_max_dim is not None:
        admin.media_max_dim = max(600, payload.media_max_dim)
    if payload.media_webp_quality is not None:
        admin.media_webp_quality = min(95, max(30, payload.media_webp_quality))
    admin.updated_at = now_str()
    db.commit()
    db.refresh(admin)
    return {"success": True}


# ============ 文章推荐配置 ============


@app.get("/api/settings/recommendations")
async def get_recommendation_settings(
    _: bool = Depends(get_admin_or_internal),
    db: Session = Depends(get_db),
):
    admin = get_admin_settings(db)
    if admin is None:
        raise HTTPException(status_code=404, detail="未初始化管理员设置")
    return {
        "recommendations_enabled": bool(admin.recommendations_enabled),
        "recommendation_model_config_id": admin.recommendation_model_config_id or "",
    }


@app.put("/api/settings/recommendations")
async def update_recommendation_settings(
    payload: RecommendationSettingsUpdate,
    db: Session = Depends(get_db),
    _: bool = Depends(get_current_admin),
):
    admin = get_admin_settings(db)
    if admin is None:
        raise HTTPException(status_code=404, detail="未初始化管理员设置")
    if payload.recommendations_enabled is not None:
        admin.recommendations_enabled = bool(payload.recommendations_enabled)
    if payload.recommendation_model_config_id is not None:
        admin.recommendation_model_config_id = (
            payload.recommendation_model_config_id or ""
        )
    admin.updated_at = now_str()
    db.commit()
    db.refresh(admin)
    return {"success": True}


# ============ 媒体存储 ============


@app.post("/api/media/upload")
async def upload_media(
    file: UploadFile = File(...),
    article_id: str = Form(...),
    request: Request = None,
    db: Session = Depends(get_db),
    _: bool = Depends(get_current_admin),
):
    if not is_media_enabled(db):
        raise HTTPException(status_code=403, detail="未开启本地存储")
    asset, url = await save_upload_image(db, article_id, file)
    if request is not None and url.startswith("/"):
        base_url = str(request.base_url).rstrip("/")
        url = f"{base_url}{url}"
    return {
        "asset_id": asset.id,
        "url": url,
        "filename": os.path.basename(asset.storage_path),
        "size": asset.size,
        "content_type": asset.content_type,
    }


@app.post("/api/media/ingest")
async def ingest_media(
    payload: MediaIngestRequest,
    request: Request = None,
    db: Session = Depends(get_db),
    _: bool = Depends(get_current_admin),
):
    if not is_media_enabled(db):
        raise HTTPException(status_code=403, detail="未开启本地存储")
    asset, url = await ingest_external_image(db, payload.article_id, payload.url)
    if request is not None and url.startswith("/"):
        base_url = str(request.base_url).rstrip("/")
        url = f"{base_url}{url}"
    return {
        "asset_id": asset.id,
        "url": url,
        "filename": os.path.basename(asset.storage_path),
        "size": asset.size,
        "content_type": asset.content_type,
    }


@app.post("/api/media/cleanup")
async def cleanup_media(
    db: Session = Depends(get_db),
    _: bool = Depends(get_current_admin),
):
    result = cleanup_orphan_media(db)
    return {"success": True, **result}


@app.get("/api/auth/verify")
async def verify_auth(is_admin: bool = Depends(check_is_admin)):
    """验证当前 token 是否有效"""
    return {"valid": is_admin, "role": "admin" if is_admin else "guest"}


@app.put("/api/auth/password")
async def change_password(
    request: ChangePasswordRequest,
    db: Session = Depends(get_db),
    _: bool = Depends(get_current_admin),
):
    """修改管理员密码（需要登录）"""
    admin = get_admin_settings(db)

    is_valid, _ = verify_password(request.old_password, admin.password_hash)
    if not is_valid:
        raise HTTPException(status_code=401, detail="原密码错误")

    try:
        update_admin_password(db, admin, request.new_password)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    token = create_token(admin.jwt_secret)
    return LoginResponse(token=token, message="密码修改成功，请使用新 token")


# ============ 文章路由 ============


@app.post("/api/articles")
async def create_article(
    article: ArticleCreate,
    db: Session = Depends(get_db),
    _: bool = Depends(get_current_admin),
):
    try:
        article_id = await article_service.create_article(article.dict(), db)
        # 获取生成的slug
        article_obj = db.query(Article).filter(Article.id == article_id).first()
        slug = article_obj.slug if article_obj else article_id
        return {"id": article_id, "slug": slug, "status": "processing"}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/api/articles")
async def get_articles(
    page: int = 1,
    size: int = 20,
    category_id: Optional[str] = None,
    search: Optional[str] = None,
    source_domain: Optional[str] = None,
    author: Optional[str] = None,
    is_visible: Optional[bool] = None,
    published_at_start: Optional[str] = None,
    published_at_end: Optional[str] = None,
    created_at_start: Optional[str] = None,
    created_at_end: Optional[str] = None,
    sort_by: Optional[str] = "created_at_desc",
    db: Session = Depends(get_db),
    is_admin: bool = Depends(check_is_admin),
):
    articles, total = article_service.get_articles(
        db=db,
        page=page,
        size=size,
        category_id=category_id,
        search=search,
        source_domain=source_domain,
        author=author,
        is_visible=is_visible,
        published_at_start=published_at_start,
        published_at_end=published_at_end,
        created_at_start=created_at_start,
        created_at_end=created_at_end,
        sort_by=sort_by,
        is_admin=is_admin,
    )
    return {
        "data": [
            {
                "id": a.id,
                "slug": a.slug,
                "title": a.title,
                "summary": a.ai_analysis.summary if a.ai_analysis else "",
                "top_image": a.top_image,
                "category": {
                    "id": a.category.id,
                    "name": a.category.name,
                    "color": a.category.color,
                }
                if a.category
                else None,
                "author": a.author,
                "status": a.status,
                "source_domain": a.source_domain,
                "published_at": a.published_at,
                "created_at": a.created_at,
                "is_visible": a.is_visible,
                "original_language": a.original_language,
            }
            for a in articles
        ],
        "pagination": {
            "page": page,
            "size": size,
            "total": total,
            "total_pages": (total + size - 1) // size,
        },
    }


@app.get("/api/articles/search")
async def search_articles(
    query: str = "",
    limit: int = 20,
    db: Session = Depends(get_db),
    _: bool = Depends(get_current_admin),
):
    """搜索文章，用于下拉选择框"""
    if not query or len(query) < 1:
        return []

    articles = (
        db.query(Article.id, Article.title, Article.slug)
        .filter(Article.title.contains(query))
        .order_by(Article.created_at.desc())
        .limit(limit)
        .all()
    )

    return [{"id": a.id, "title": a.title, "slug": a.slug} for a in articles]


@app.get("/api/articles/{article_slug}")
async def get_article(
    article_slug: str,
    db: Session = Depends(get_db),
    is_admin: bool = Depends(check_is_admin),
):
    article = article_service.get_article_by_slug(db, article_slug)
    if not article:
        raise HTTPException(status_code=404, detail="文章不存在")

    if not is_admin and not article.is_visible:
        raise HTTPException(status_code=404, detail="文章不存在")

    prev_article, next_article = article_service.get_article_neighbors(
        db, article, is_admin=is_admin
    )

    return {
        "id": article.id,
        "slug": article.slug,
        "title": article.title,
        "content_html": article.content_html,
        "content_md": article.content_md,
        "content_trans": article.content_trans,
        "translation_status": article.translation_status,
        "translation_error": article.translation_error,
        "source_url": article.source_url,
        "top_image": article.top_image,
        "category": {"id": article.category.id, "name": article.category.name}
        if article.category
        else None,
        "author": article.author,
        "status": article.status,
        "is_visible": article.is_visible,
        "published_at": article.published_at,
        "created_at": article.created_at,
        "note_content": article.note_content,
        "note_annotations": article.note_annotations,
        "ai_analysis": {
            "summary": article.ai_analysis.summary if article.ai_analysis else None,
            "summary_status": article.ai_analysis.summary_status
            if article.ai_analysis
            else None,
            "key_points": article.ai_analysis.key_points
            if article.ai_analysis
            else None,
            "key_points_status": article.ai_analysis.key_points_status
            if article.ai_analysis
            else None,
            "outline": article.ai_analysis.outline if article.ai_analysis else None,
            "outline_status": article.ai_analysis.outline_status
            if article.ai_analysis
            else None,
            "quotes": article.ai_analysis.quotes if article.ai_analysis else None,
            "quotes_status": article.ai_analysis.quotes_status
            if article.ai_analysis
            else None,
            "classification_status": article.ai_analysis.classification_status
            if article.ai_analysis
            else None,
            "error_message": article.ai_analysis.error_message
            if article.ai_analysis
            else None,
            "updated_at": article.ai_analysis.updated_at
            if article.ai_analysis
            else None,
        }
        if article.ai_analysis
        else None,
        "prev_article": {
            "id": prev_article.id,
            "slug": prev_article.slug,
            "title": prev_article.title,
        }
        if prev_article
        else None,
        "next_article": {
            "id": next_article.id,
            "slug": next_article.slug,
            "title": next_article.title,
        }
        if next_article
        else None,
    }


@app.get("/api/articles/{article_slug}/similar")
async def get_similar_articles(
    article_slug: str,
    limit: int = 4,
    db: Session = Depends(get_db),
    is_admin: bool = Depends(check_is_admin),
):
    admin = get_admin_settings(db)
    if admin and not bool(admin.recommendations_enabled):
        return {"status": "disabled", "items": []}

    article = article_service.get_article_by_slug(db, article_slug)
    if not article:
        raise HTTPException(status_code=404, detail="文章不存在")

    if not is_admin and not article.is_visible:
        raise HTTPException(status_code=404, detail="文章不存在")

    embedding = (
        db.query(ArticleEmbedding)
        .filter(ArticleEmbedding.article_id == article.id)
        .first()
    )
    if not embedding:
        article_service.enqueue_task(
            db,
            task_type="process_article_embedding",
            article_id=article.id,
            content_type="embedding",
        )
        return {"status": "pending", "items": []}

    try:
        base_vector = json.loads(embedding.embedding)
    except Exception:
        return {"status": "pending", "items": []}

    query = (
        db.query(ArticleEmbedding, Article)
        .join(Article, ArticleEmbedding.article_id == Article.id)
        .filter(ArticleEmbedding.article_id != article.id)
        .filter(ArticleEmbedding.embedding.isnot(None))
        .filter(ArticleEmbedding.model == embedding.model)
    )
    if not is_admin:
        query = query.filter(Article.is_visible == True)

    candidates = (
        query.order_by(Article.created_at.desc())
        .limit(SIMILAR_ARTICLE_CANDIDATE_LIMIT)
        .all()
    )

    scored = []
    base_category_id = article.category_id
    for record, candidate_article in candidates:
        try:
            vector = json.loads(record.embedding)
        except Exception:
            continue
        score = article_service.cosine_similarity(base_vector, vector)
        if base_category_id and candidate_article.category_id == base_category_id:
            score += CATEGORY_SIMILARITY_BOOST
        scored.append((score, candidate_article))

    scored.sort(key=lambda item: item[0], reverse=True)
    items = []
    for _, candidate_article in scored[: max(0, limit)]:
        items.append(
            {
                "id": candidate_article.id,
                "slug": candidate_article.slug,
                "title": candidate_article.title,
                "published_at": candidate_article.published_at,
                "created_at": candidate_article.created_at,
            }
        )
    return {"status": "ready", "items": items}


@app.post("/api/articles/{article_slug}/embedding")
async def regenerate_article_embedding(
    article_slug: str,
    db: Session = Depends(get_db),
    _: bool = Depends(get_current_admin),
):
    article = article_service.get_article_by_slug(db, article_slug)
    if not article:
        raise HTTPException(status_code=404, detail="文章不存在")

    task_id = article_service.enqueue_task(
        db,
        task_type="process_article_embedding",
        article_id=article.id,
        content_type="embedding",
    )
    return {"success": True, "task_id": task_id}


@app.get("/api/articles/{article_slug}/comments")
async def get_article_comments(
    article_slug: str,
    include_hidden: bool = False,
    db: Session = Depends(get_db),
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
):
    if not comments_enabled(db):
        raise HTTPException(status_code=403, detail="评论已关闭")
    article = article_service.get_article_by_slug(db, article_slug)
    if not article:
        raise HTTPException(status_code=404, detail="文章不存在")
    is_admin = False
    if include_hidden and credentials is not None:
        try:
            is_admin = bool(get_current_admin(credentials=credentials, db=db))
        except HTTPException:
            is_admin = False
    query = db.query(ArticleComment).filter(ArticleComment.article_id == article.id)
    if not is_admin:
        query = query.filter(
            (ArticleComment.is_hidden == False) | (ArticleComment.is_hidden.is_(None))
        )
    comments = query.order_by(ArticleComment.created_at.asc()).all()
    return [
        {
            "id": c.id,
            "article_id": c.article_id,
            "article_slug": article.slug,
            "user_id": c.user_id,
            "user_name": c.user_name,
            "user_avatar": c.user_avatar,
            "provider": c.provider,
            "content": c.content,
            "reply_to_id": c.reply_to_id,
            "is_hidden": bool(c.is_hidden),
            "created_at": c.created_at,
            "updated_at": c.updated_at,
        }
        for c in comments
    ]


@app.post("/api/articles/{article_slug}/comments")
async def create_article_comment(
    article_slug: str,
    payload: CommentCreate,
    db: Session = Depends(get_db),
):
    if not comments_enabled(db):
        raise HTTPException(status_code=403, detail="评论已关闭")
    article = article_service.get_article_by_slug(db, article_slug)
    if not article:
        raise HTTPException(status_code=404, detail="文章不存在")
    # 使用实际的 article.id (UUID) 来存储评论
    actual_article_id = article.id
    content = payload.content.strip()
    if not content:
        raise HTTPException(status_code=400, detail="评论内容不能为空")
    if len(content) > 1000:
        raise HTTPException(status_code=400, detail="评论内容过长")
    filter_enabled, words = get_sensitive_words(db)
    if filter_enabled and words and contains_sensitive_word(content, words):
        raise HTTPException(status_code=400, detail="评论包含敏感词")
    comment = ArticleComment(
        article_id=actual_article_id,
        user_id=payload.user_id,
        user_name=payload.user_name,
        user_avatar=payload.user_avatar,
        provider=payload.provider,
        content=content,
        reply_to_id=payload.reply_to_id,
        created_at=now_str(),
        updated_at=now_str(),
    )
    db.add(comment)
    db.commit()
    db.refresh(comment)
    return {
        "id": comment.id,
        "article_id": comment.article_id,
        "user_id": comment.user_id,
        "user_name": comment.user_name,
        "user_avatar": comment.user_avatar,
        "provider": comment.provider,
        "content": comment.content,
        "reply_to_id": comment.reply_to_id,
        "is_hidden": bool(comment.is_hidden),
        "created_at": comment.created_at,
        "updated_at": comment.updated_at,
    }


@app.get("/api/comments/{comment_id}")
async def get_comment(comment_id: str, db: Session = Depends(get_db)):
    if not comments_enabled(db):
        raise HTTPException(status_code=403, detail="评论已关闭")
    comment = db.query(ArticleComment).filter(ArticleComment.id == comment_id).first()
    if not comment:
        raise HTTPException(status_code=404, detail="评论不存在")
    return {
        "id": comment.id,
        "article_id": comment.article_id,
        "user_id": comment.user_id,
        "user_name": comment.user_name,
        "user_avatar": comment.user_avatar,
        "provider": comment.provider,
        "content": comment.content,
        "reply_to_id": comment.reply_to_id,
        "is_hidden": bool(comment.is_hidden),
        "created_at": comment.created_at,
        "updated_at": comment.updated_at,
    }


@app.get("/api/comments")
async def list_comments(
    query: Optional[str] = None,
    article_title: Optional[str] = None,
    author: Optional[str] = None,
    created_start: Optional[str] = None,
    created_end: Optional[str] = None,
    is_hidden: Optional[bool] = None,
    has_reply: Optional[bool] = None,
    page: int = 1,
    size: int = 20,
    db: Session = Depends(get_db),
    _: bool = Depends(get_current_admin),
):
    page = max(page, 1)
    size = min(max(size, 1), 100)
    query_stmt = db.query(ArticleComment)

    if article_title:
        # 通过文章标题模糊匹配找到文章ID列表
        matching_articles = (
            db.query(Article.id).filter(Article.title.contains(article_title)).all()
        )
        article_ids = [a.id for a in matching_articles]
        if article_ids:
            query_stmt = query_stmt.filter(ArticleComment.article_id.in_(article_ids))
        else:
            # 如果没有匹配的文章，返回空结果
            query_stmt = query_stmt.filter(False)
    if author:
        query_stmt = query_stmt.filter(ArticleComment.user_name.contains(author))
    if query:
        query_stmt = query_stmt.filter(
            or_(
                ArticleComment.content.contains(query),
                ArticleComment.user_name.contains(query),
            )
        )

    start_bound = normalize_date_bound(created_start, False)
    end_bound = normalize_date_bound(created_end, True)
    if start_bound:
        query_stmt = query_stmt.filter(ArticleComment.created_at >= start_bound)
    if end_bound:
        query_stmt = query_stmt.filter(ArticleComment.created_at <= end_bound)

    if is_hidden is not None:
        query_stmt = query_stmt.filter(ArticleComment.is_hidden == bool(is_hidden))
    if has_reply is True:
        query_stmt = query_stmt.filter(ArticleComment.reply_to_id.isnot(None))
    if has_reply is False:
        query_stmt = query_stmt.filter(ArticleComment.reply_to_id.is_(None))

    total = query_stmt.count()
    items = (
        query_stmt.order_by(ArticleComment.created_at.desc())
        .offset((page - 1) * size)
        .limit(size)
        .all()
    )

    # 获取所有相关文章的slug
    article_ids = [c.article_id for c in items]
    articles = db.query(Article).filter(Article.id.in_(article_ids)).all()
    article_slug_map = {a.id: a.slug for a in articles}

    return {
        "items": [
            {
                "id": c.id,
                "article_id": c.article_id,
                "article_slug": article_slug_map.get(c.article_id, c.article_id),
                "user_id": c.user_id,
                "user_name": c.user_name,
                "user_avatar": c.user_avatar,
                "provider": c.provider,
                "content": c.content,
                "reply_to_id": c.reply_to_id,
                "is_hidden": bool(c.is_hidden),
                "created_at": c.created_at,
                "updated_at": c.updated_at,
            }
            for c in items
        ],
        "pagination": {
            "page": page,
            "size": size,
            "total": total,
            "total_pages": (total + size - 1) // size,
        },
    }


@app.put("/api/comments/{comment_id}")
async def update_comment(
    comment_id: str, payload: CommentUpdate, db: Session = Depends(get_db)
):
    if not comments_enabled(db):
        raise HTTPException(status_code=403, detail="评论已关闭")
    comment = db.query(ArticleComment).filter(ArticleComment.id == comment_id).first()
    if not comment:
        raise HTTPException(status_code=404, detail="评论不存在")
    content = payload.content.strip()
    if not content:
        raise HTTPException(status_code=400, detail="评论内容不能为空")
    if len(content) > 1000:
        raise HTTPException(status_code=400, detail="评论内容过长")
    filter_enabled, words = get_sensitive_words(db)
    if filter_enabled and words and contains_sensitive_word(content, words):
        raise HTTPException(status_code=400, detail="评论包含敏感词")
    comment.content = content
    if payload.reply_to_id is not None:
        comment.reply_to_id = payload.reply_to_id or None
    comment.updated_at = now_str()
    db.commit()
    db.refresh(comment)
    return {
        "id": comment.id,
        "article_id": comment.article_id,
        "user_id": comment.user_id,
        "user_name": comment.user_name,
        "user_avatar": comment.user_avatar,
        "provider": comment.provider,
        "content": comment.content,
        "reply_to_id": comment.reply_to_id,
        "is_hidden": bool(comment.is_hidden),
        "created_at": comment.created_at,
        "updated_at": comment.updated_at,
    }


@app.delete("/api/comments/{comment_id}")
async def delete_comment(comment_id: str, db: Session = Depends(get_db)):
    if not comments_enabled(db):
        raise HTTPException(status_code=403, detail="评论已关闭")
    comment = db.query(ArticleComment).filter(ArticleComment.id == comment_id).first()
    if not comment:
        raise HTTPException(status_code=404, detail="评论不存在")
    db.delete(comment)
    db.commit()
    return {"success": True}


@app.put("/api/comments/{comment_id}/visibility")
async def update_comment_visibility(
    comment_id: str,
    payload: CommentVisibilityUpdate,
    db: Session = Depends(get_db),
    _: bool = Depends(get_current_admin),
):
    comment = db.query(ArticleComment).filter(ArticleComment.id == comment_id).first()
    if not comment:
        raise HTTPException(status_code=404, detail="评论不存在")
    comment.is_hidden = bool(payload.is_hidden)
    comment.updated_at = now_str()
    db.commit()
    db.refresh(comment)
    return {
        "id": comment.id,
        "is_hidden": bool(comment.is_hidden),
        "updated_at": comment.updated_at,
    }


@app.put("/api/articles/{article_slug}/notes")
async def update_article_notes(
    article_slug: str,
    payload: ArticleNotesUpdate,
    db: Session = Depends(get_db),
    _: bool = Depends(get_current_admin),
):
    article = article_service.get_article_by_slug(db, article_slug)
    if not article:
        raise HTTPException(status_code=404, detail="文章不存在")
    if payload.note_content is not None:
        article.note_content = payload.note_content
    if payload.annotations is not None:
        article.note_annotations = json.dumps(payload.annotations, ensure_ascii=False)
    article.updated_at = now_str()
    db.commit()
    db.refresh(article)
    return {"success": True}


@app.delete("/api/articles/{article_slug}")
async def delete_article(
    article_slug: str,
    db: Session = Depends(get_db),
    _: bool = Depends(get_current_admin),
):
    article = article_service.get_article_by_slug(db, article_slug)
    if not article:
        raise HTTPException(status_code=404, detail="文章不存在")

    cleanup_media_assets(db, [article.id])
    if article.ai_analysis:
        db.delete(article.ai_analysis)
    db.delete(article)
    db.commit()
    return {"message": "删除成功"}


@app.put("/api/articles/{article_slug}")
async def update_article(
    article_slug: str,
    article_data: ArticleUpdate,
    db: Session = Depends(get_db),
    _: bool = Depends(get_current_admin),
):
    article = article_service.get_article_by_slug(db, article_slug)
    if not article:
        raise HTTPException(status_code=404, detail="文章不存在")

    try:
        if article_data.title is not None:
            article.title = article_data.title
        if article_data.author is not None:
            article.author = article_data.author
        if article_data.top_image is not None:
            article.top_image = article_data.top_image
        if article_data.content_md is not None:
            article.content_md = article_data.content_md
        if article_data.content_trans is not None:
            article.content_trans = article_data.content_trans
        if article_data.is_visible is not None:
            article.is_visible = article_data.is_visible
        if "category_id" in article_data.__fields_set__:
            article.category_id = article_data.category_id

        from models import now_str

        article.updated_at = now_str()

        db.commit()
        db.refresh(article)

        return {
            "id": article.id,
            "title": article.title,
            "author": article.author,
            "top_image": article.top_image,
            "content_md": article.content_md,
            "content_trans": article.content_trans,
            "is_visible": article.is_visible,
            "updated_at": article.updated_at,
        }
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/articles/batch/visibility")
async def batch_update_visibility(
    request: ArticleBatchVisibility,
    db: Session = Depends(get_db),
    _: bool = Depends(get_current_admin),
):
    if not request.article_slugs:
        raise HTTPException(status_code=400, detail="请选择文章")
    updated = (
        db.query(Article)
        .filter(Article.slug.in_(request.article_slugs))
        .update({"is_visible": request.is_visible}, synchronize_session=False)
    )
    db.commit()
    return {"updated": updated}


@app.post("/api/articles/batch/category")
async def batch_update_category(
    request: ArticleBatchCategory,
    db: Session = Depends(get_db),
    _: bool = Depends(get_current_admin),
):
    if not request.article_slugs:
        raise HTTPException(status_code=400, detail="请选择文章")
    if request.category_id:
        category = db.query(Category).filter(Category.id == request.category_id).first()
        if not category:
            raise HTTPException(status_code=404, detail="分类不存在")
    updated = (
        db.query(Article)
        .filter(Article.slug.in_(request.article_slugs))
        .update({"category_id": request.category_id}, synchronize_session=False)
    )
    db.commit()
    return {"updated": updated}


@app.post("/api/articles/batch/delete")
async def batch_delete_articles(
    request: ArticleBatchDelete,
    db: Session = Depends(get_db),
    _: bool = Depends(get_current_admin),
):
    if not request.article_slugs:
        raise HTTPException(status_code=400, detail="请选择文章")
    article_ids = [
        row[0]
        for row in db.query(Article.id)
        .filter(Article.slug.in_(request.article_slugs))
        .all()
    ]
    cleanup_media_assets(db, article_ids)
    deleted = (
        db.query(Article)
        .filter(Article.slug.in_(request.article_slugs))
        .delete(synchronize_session=False)
    )
    db.commit()
    return {"deleted": deleted}


@app.get("/api/ai-tasks")
async def list_ai_tasks(
    page: int = 1,
    size: int = 20,
    status: Optional[str] = None,
    task_type: Optional[str] = None,
    content_type: Optional[str] = None,
    article_title: Optional[str] = None,
    db: Session = Depends(get_db),
    _: bool = Depends(get_current_admin),
):
    query = db.query(AITask)

    if status:
        query = query.filter(AITask.status == status)
    if task_type:
        query = query.filter(AITask.task_type == task_type)
    if content_type:
        query = query.filter(AITask.content_type == content_type)
    if article_title:
        # 通过文章标题模糊匹配找到文章ID列表
        matching_articles = (
            db.query(Article.id).filter(Article.title.contains(article_title)).all()
        )
        article_ids = [a.id for a in matching_articles]
        if article_ids:
            query = query.filter(AITask.article_id.in_(article_ids))
        else:
            # 如果没有匹配的文章，返回空结果
            query = query.filter(False)

    total = query.count()
    tasks = (
        query.order_by(AITask.created_at.desc())
        .offset((page - 1) * size)
        .limit(size)
        .all()
    )

    article_ids = [task.article_id for task in tasks if task.article_id]
    article_map = {}
    if article_ids:
        articles = (
            db.query(Article.id, Article.title, Article.slug)
            .filter(Article.id.in_(article_ids))
            .all()
        )
        article_map = {
            article.id: {"title": article.title, "slug": article.slug}
            for article in articles
        }

    return {
        "data": [
            {
                "id": task.id,
                "article_id": task.article_id,
                "article_title": article_map.get(task.article_id, {}).get("title")
                if task.article_id
                else None,
                "article_slug": article_map.get(task.article_id, {}).get("slug")
                if task.article_id
                else None,
                "task_type": task.task_type,
                "content_type": task.content_type,
                "status": task.status,
                "attempts": task.attempts,
                "max_attempts": task.max_attempts,
                "run_at": task.run_at,
                "locked_at": task.locked_at,
                "locked_by": task.locked_by,
                "last_error": task.last_error,
                "last_error_type": task.last_error_type,
                "created_at": task.created_at,
                "updated_at": task.updated_at,
                "finished_at": task.finished_at,
            }
            for task in tasks
        ],
        "pagination": {
            "page": page,
            "size": size,
            "total": total,
            "total_pages": (total + size - 1) // size,
        },
    }


@app.get("/api/ai-tasks/{task_id}")
async def get_ai_task(
    task_id: str,
    db: Session = Depends(get_db),
    _: bool = Depends(get_current_admin),
):
    task = db.query(AITask).filter(AITask.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")

    article_title = None
    if task.article_id:
        article = (
            db.query(Article.id, Article.title)
            .filter(Article.id == task.article_id)
            .first()
        )
        if article:
            article_title = article.title

    return {
        "id": task.id,
        "article_id": task.article_id,
        "article_title": article_title,
        "task_type": task.task_type,
        "content_type": task.content_type,
        "status": task.status,
        "payload": task.payload,
        "attempts": task.attempts,
        "max_attempts": task.max_attempts,
        "run_at": task.run_at,
        "locked_at": task.locked_at,
        "locked_by": task.locked_by,
        "last_error": task.last_error,
        "last_error_type": task.last_error_type,
        "created_at": task.created_at,
        "updated_at": task.updated_at,
        "finished_at": task.finished_at,
    }


@app.post("/api/ai-tasks/retry")
async def retry_ai_tasks(
    request: AITaskRetryRequest,
    db: Session = Depends(get_db),
    _: bool = Depends(get_current_admin),
):
    if not request.task_ids:
        raise HTTPException(status_code=400, detail="请选择任务")

    task_ids = list(dict.fromkeys(request.task_ids))
    tasks = db.query(AITask).filter(AITask.id.in_(task_ids)).all()
    task_map = {task.id: task for task in tasks}
    now_iso = now_str()

    updated_ids: list[str] = []
    skipped_ids: list[str] = []

    for task_id in task_ids:
        task = task_map.get(task_id)
        if not task:
            skipped_ids.append(task_id)
            continue
        if task.status not in ["failed", "cancelled"]:
            skipped_ids.append(task_id)
            continue

        task.status = "pending"
        task.attempts = 0
        task.run_at = now_iso
        task.locked_at = None
        task.locked_by = None
        task.last_error = None
        task.last_error_type = None
        task.finished_at = None
        task.updated_at = now_iso
        updated_ids.append(task_id)

    db.commit()
    return {
        "updated": len(updated_ids),
        "updated_ids": updated_ids,
        "skipped": len(skipped_ids),
        "skipped_ids": skipped_ids,
    }


@app.post("/api/ai-tasks/cancel")
async def cancel_ai_tasks(
    request: AITaskCancelRequest,
    db: Session = Depends(get_db),
    _: bool = Depends(get_current_admin),
):
    if not request.task_ids:
        raise HTTPException(status_code=400, detail="请选择任务")

    task_ids = list(dict.fromkeys(request.task_ids))
    tasks = db.query(AITask).filter(AITask.id.in_(task_ids)).all()
    task_map = {task.id: task for task in tasks}
    now_iso = now_str()

    updated_ids: list[str] = []
    skipped_ids: list[str] = []

    for task_id in task_ids:
        task = task_map.get(task_id)
        if not task:
            skipped_ids.append(task_id)
            continue
        if task.status != "pending":
            skipped_ids.append(task_id)
            continue

        task.status = "cancelled"
        task.locked_at = None
        task.locked_by = None
        task.updated_at = now_iso
        task.finished_at = now_iso
        updated_ids.append(task_id)

    db.commit()
    return {
        "updated": len(updated_ids),
        "updated_ids": updated_ids,
        "skipped": len(skipped_ids),
        "skipped_ids": skipped_ids,
    }


@app.get("/api/ai-usage")
async def get_ai_usage_logs(
    model_api_config_id: Optional[str] = None,
    status: Optional[str] = None,
    task_type: Optional[str] = None,
    content_type: Optional[str] = None,
    start: Optional[str] = None,
    end: Optional[str] = None,
    page: int = 1,
    size: int = 20,
    db: Session = Depends(get_db),
    _: bool = Depends(get_current_admin),
):
    query = db.query(AIUsageLog, ModelAPIConfig.name).outerjoin(
        ModelAPIConfig, AIUsageLog.model_api_config_id == ModelAPIConfig.id
    )

    if model_api_config_id:
        query = query.filter(AIUsageLog.model_api_config_id == model_api_config_id)
    if status:
        query = query.filter(AIUsageLog.status == status)
    if task_type:
        query = query.filter(AIUsageLog.task_type == task_type)
    if content_type:
        query = query.filter(AIUsageLog.content_type == content_type)
    if start:
        query = query.filter(AIUsageLog.created_at >= start)
    if end:
        query = query.filter(AIUsageLog.created_at <= end)

    total = query.count()
    logs = (
        query.order_by(AIUsageLog.created_at.desc())
        .offset((page - 1) * size)
        .limit(size)
        .all()
    )

    # 获取所有相关文章的slug
    article_ids = [log.article_id for log, _ in logs if log.article_id]
    article_map = {}
    if article_ids:
        articles = (
            db.query(Article.id, Article.slug).filter(Article.id.in_(article_ids)).all()
        )
        article_map = {article.id: article.slug for article in articles}

    items = []
    for log, model_name in logs:
        items.append(
            {
                "id": log.id,
                "model_api_config_id": log.model_api_config_id,
                "model_api_config_name": model_name,
                "task_id": log.task_id,
                "article_id": log.article_id,
                "article_slug": article_map.get(log.article_id)
                if log.article_id
                else None,
                "task_type": log.task_type,
                "content_type": log.content_type,
                "status": log.status,
                "prompt_tokens": log.prompt_tokens,
                "completion_tokens": log.completion_tokens,
                "total_tokens": log.total_tokens,
                "cost_input": log.cost_input,
                "cost_output": log.cost_output,
                "cost_total": log.cost_total,
                "currency": log.currency,
                "latency_ms": log.latency_ms,
                "error_message": log.error_message,
                "request_payload": log.request_payload,
                "response_payload": log.response_payload,
                "created_at": log.created_at,
            }
        )

    return {"items": items, "total": total, "page": page, "size": size}


@app.get("/api/ai-usage/summary")
async def get_ai_usage_summary(
    model_api_config_id: Optional[str] = None,
    status: Optional[str] = None,
    task_type: Optional[str] = None,
    content_type: Optional[str] = None,
    start: Optional[str] = None,
    end: Optional[str] = None,
    db: Session = Depends(get_db),
    _: bool = Depends(get_current_admin),
):
    base_query = db.query(AIUsageLog)

    if model_api_config_id:
        base_query = base_query.filter(
            AIUsageLog.model_api_config_id == model_api_config_id
        )
    if status:
        base_query = base_query.filter(AIUsageLog.status == status)
    if task_type:
        base_query = base_query.filter(AIUsageLog.task_type == task_type)
    if content_type:
        base_query = base_query.filter(AIUsageLog.content_type == content_type)
    if start:
        base_query = base_query.filter(AIUsageLog.created_at >= start)
    if end:
        base_query = base_query.filter(AIUsageLog.created_at <= end)

    overall = base_query.with_entities(
        func.count(AIUsageLog.id),
        func.coalesce(func.sum(AIUsageLog.prompt_tokens), 0),
        func.coalesce(func.sum(AIUsageLog.completion_tokens), 0),
        func.coalesce(func.sum(AIUsageLog.total_tokens), 0),
        func.coalesce(func.sum(AIUsageLog.cost_total), 0.0),
    ).first()

    grouped = (
        base_query.join(
            ModelAPIConfig,
            AIUsageLog.model_api_config_id == ModelAPIConfig.id,
            isouter=True,
        )
        .with_entities(
            AIUsageLog.model_api_config_id,
            ModelAPIConfig.name,
            ModelAPIConfig.currency,
            func.count(AIUsageLog.id),
            func.coalesce(func.sum(AIUsageLog.prompt_tokens), 0),
            func.coalesce(func.sum(AIUsageLog.completion_tokens), 0),
            func.coalesce(func.sum(AIUsageLog.total_tokens), 0),
            func.coalesce(func.sum(AIUsageLog.cost_total), 0.0),
        )
        .group_by(
            AIUsageLog.model_api_config_id, ModelAPIConfig.name, ModelAPIConfig.currency
        )
        .order_by(func.coalesce(func.sum(AIUsageLog.cost_total), 0.0).desc())
        .all()
    )

    by_model = []
    for (
        config_id,
        model_name,
        currency,
        calls,
        prompt_tokens,
        completion_tokens,
        total_tokens,
        cost_total,
    ) in grouped:
        by_model.append(
            {
                "model_api_config_id": config_id,
                "model_api_config_name": model_name,
                "currency": currency,
                "calls": calls,
                "prompt_tokens": prompt_tokens,
                "completion_tokens": completion_tokens,
                "total_tokens": total_tokens,
                "cost_total": cost_total,
            }
        )

    return {
        "summary": {
            "calls": overall[0] or 0,
            "prompt_tokens": overall[1] or 0,
            "completion_tokens": overall[2] or 0,
            "total_tokens": overall[3] or 0,
            "cost_total": overall[4] or 0.0,
        },
        "by_model": by_model,
    }


class VisibilityUpdate(BaseModel):
    is_visible: bool


@app.put("/api/articles/{article_slug}/visibility")
async def update_article_visibility(
    article_slug: str,
    data: VisibilityUpdate,
    db: Session = Depends(get_db),
    _: bool = Depends(get_current_admin),
):
    article = article_service.get_article_by_slug(db, article_slug)
    if not article:
        raise HTTPException(status_code=404, detail="文章不存在")

    article.is_visible = data.is_visible
    from models import now_str

    article.updated_at = now_str()
    db.commit()

    return {"id": article.id, "is_visible": article.is_visible}


@app.post("/api/articles/{article_slug}/retry")
async def retry_article_ai(
    article_slug: str,
    db: Session = Depends(get_db),
    _: bool = Depends(get_current_admin),
):
    try:
        article = article_service.get_article_by_slug(db, article_slug)
        if not article:
            raise HTTPException(status_code=404, detail="文章不存在")
        actual_article_id = await article_service.retry_article_ai(db, article.id)
        return {"id": actual_article_id, "status": "processing"}
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/articles/{article_slug}/retry-translation")
async def retry_article_translation(
    article_slug: str,
    db: Session = Depends(get_db),
    _: bool = Depends(get_current_admin),
):
    try:
        article = article_service.get_article_by_slug(db, article_slug)
        if not article:
            raise HTTPException(status_code=404, detail="文章不存在")
        actual_article_id = await article_service.retry_article_translation(
            db, article.id
        )
        return {"id": actual_article_id, "translation_status": "processing"}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/articles/{article_slug}/generate/{content_type}")
async def generate_ai_content(
    article_slug: str,
    content_type: str,
    model_config_id: str = None,
    prompt_config_id: str = None,
    db: Session = Depends(get_db),
    _: bool = Depends(get_current_admin),
):
    valid_types = ["summary", "key_points", "outline", "quotes"]
    if content_type not in valid_types:
        raise HTTPException(
            status_code=400, detail=f"无效的内容类型，支持: {', '.join(valid_types)}"
        )

    try:
        article = article_service.get_article_by_slug(db, article_slug)
        if not article:
            raise HTTPException(status_code=404, detail="文章不存在")
        await article_service.generate_ai_content(
            db,
            article.id,
            content_type,
            model_config_id=model_config_id,
            prompt_config_id=prompt_config_id,
        )
        return {"id": article.id, "content_type": content_type, "status": "processing"}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/api/authors")
async def get_authors(db: Session = Depends(get_db)):
    authors = (
        db.query(Article.author)
        .filter(Article.author.isnot(None))
        .filter(Article.author != "")
        .distinct()
        .order_by(Article.author)
        .all()
    )
    return [a[0] for a in authors]


@app.get("/api/sources")
async def get_sources(db: Session = Depends(get_db)):
    sources = (
        db.query(Article.source_domain)
        .filter(Article.source_domain.isnot(None))
        .filter(Article.source_domain != "")
        .distinct()
        .order_by(Article.source_domain)
        .all()
    )
    return [s[0] for s in sources]


@app.get("/api/categories")
async def get_categories(db: Session = Depends(get_db)):
    categories = db.query(Category).order_by(Category.sort_order).all()
    return [
        {
            "id": c.id,
            "name": c.name,
            "description": c.description,
            "color": c.color,
            "sort_order": c.sort_order,
            "article_count": len(c.articles),
        }
        for c in categories
    ]


@app.get("/api/categories/stats")
async def get_category_stats(
    search: Optional[str] = None,
    source_domain: Optional[str] = None,
    author: Optional[str] = None,
    published_at_start: Optional[str] = None,
    published_at_end: Optional[str] = None,
    created_at_start: Optional[str] = None,
    created_at_end: Optional[str] = None,
    db: Session = Depends(get_db),
):
    from sqlalchemy import func

    stats_query = db.query(
        Article.category_id.label("category_id"),
        func.count(Article.id).label("article_count"),
    )

    if search:
        stats_query = stats_query.filter(Article.title.contains(search))
    if source_domain:
        stats_query = stats_query.filter(Article.source_domain == source_domain)
    if author:
        stats_query = stats_query.filter(Article.author == author)
    if published_at_start:
        stats_query = stats_query.filter(
            func.substr(Article.published_at, 1, 10) >= published_at_start
        )
    if published_at_end:
        stats_query = stats_query.filter(
            func.substr(Article.published_at, 1, 10) <= published_at_end
        )
    if created_at_start:
        stats_query = stats_query.filter(
            func.substr(Article.created_at, 1, 10) >= created_at_start
        )
    if created_at_end:
        stats_query = stats_query.filter(
            func.substr(Article.created_at, 1, 10) <= created_at_end
        )

    stats_subquery = stats_query.group_by(Article.category_id).subquery()
    categories = (
        db.query(
            Category,
            func.coalesce(stats_subquery.c.article_count, 0).label("article_count"),
        )
        .outerjoin(stats_subquery, Category.id == stats_subquery.c.category_id)
        .order_by(Category.sort_order)
        .all()
    )

    return [
        {
            "id": category.id,
            "name": category.name,
            "color": category.color,
            "article_count": article_count,
        }
        for category, article_count in categories
    ]


@app.post("/api/categories")
async def create_category(
    category: CategoryCreate,
    db: Session = Depends(get_db),
    _: bool = Depends(get_current_admin),
):
    try:
        new_category = Category(**category.dict())
        db.add(new_category)
        db.commit()
        db.refresh(new_category)
        return {"id": new_category.id, "name": new_category.name}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


class CategorySortItem(BaseModel):
    id: str
    sort_order: int


class CategorySortRequest(BaseModel):
    items: List[CategorySortItem]


@app.put("/api/categories/sort")
async def update_categories_sort(
    request: CategorySortRequest,
    db: Session = Depends(get_db),
    _: bool = Depends(get_current_admin),
):
    try:
        for item in request.items:
            category = db.query(Category).filter(Category.id == item.id).first()
            if category:
                category.sort_order = item.sort_order
        db.commit()
        return {"message": "排序更新成功"}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))


@app.put("/api/categories/{category_id}")
async def update_category(
    category_id: str,
    category: CategoryCreate,
    db: Session = Depends(get_db),
    _: bool = Depends(get_current_admin),
):
    existing_category = db.query(Category).filter(Category.id == category_id).first()
    if not existing_category:
        raise HTTPException(status_code=404, detail="分类不存在")

    try:
        if category.name is not None:
            existing_category.name = category.name
        if category.description is not None:
            existing_category.description = category.description
        if category.color is not None:
            existing_category.color = category.color
        if category.sort_order is not None:
            existing_category.sort_order = category.sort_order

        db.commit()
        db.refresh(existing_category)
        return {
            "id": existing_category.id,
            "name": existing_category.name,
            "description": existing_category.description,
            "color": existing_category.color,
            "sort_order": existing_category.sort_order,
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.delete("/api/categories/{category_id}")
async def delete_category(
    category_id: str,
    db: Session = Depends(get_db),
    _: bool = Depends(get_current_admin),
):
    category = db.query(Category).filter(Category.id == category_id).first()
    if not category:
        raise HTTPException(status_code=404, detail="分类不存在")

    db.delete(category)
    db.commit()
    return {"message": "删除成功"}


@app.post("/api/export")
async def export_articles(
    request: ExportRequest,
    db: Session = Depends(get_db),
    _: bool = Depends(get_current_admin),
):
    try:
        markdown_content = article_service.export_articles(db, request.article_slugs)
        return {"content": markdown_content, "filename": "articles_export.md"}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


# Model API Config endpoints
@app.get("/api/model-api-configs")
async def get_model_api_configs(
    db: Session = Depends(get_db),
    _: bool = Depends(get_current_admin),
):
    configs = db.query(ModelAPIConfig).order_by(ModelAPIConfig.created_at.desc()).all()

    return [
        {
            "id": c.id,
            "name": c.name,
            "base_url": c.base_url,
            "api_key": c.api_key,
            "provider": c.provider or "openai",
            "model_name": c.model_name,
            "model_type": c.model_type or "general",
            "price_input_per_1k": c.price_input_per_1k,
            "price_output_per_1k": c.price_output_per_1k,
            "currency": c.currency,
            "is_enabled": c.is_enabled,
            "is_default": c.is_default,
            "created_at": c.created_at,
            "updated_at": c.updated_at,
        }
        for c in configs
    ]


@app.get("/api/model-api-configs/{config_id}")
async def get_model_api_config(
    config_id: str,
    db: Session = Depends(get_db),
    _: bool = Depends(get_current_admin),
):
    config = db.query(ModelAPIConfig).filter(ModelAPIConfig.id == config_id).first()

    if not config:
        raise HTTPException(status_code=404, detail="模型API配置不存在")

    return {
        "id": config.id,
        "name": config.name,
        "base_url": config.base_url,
        "api_key": config.api_key,
        "provider": config.provider or "openai",
        "model_name": config.model_name,
        "model_type": config.model_type or "general",
        "price_input_per_1k": config.price_input_per_1k,
        "price_output_per_1k": config.price_output_per_1k,
        "currency": config.currency,
        "is_enabled": config.is_enabled,
        "is_default": config.is_default,
        "created_at": config.created_at,
        "updated_at": config.updated_at,
    }


@app.post("/api/model-api-configs")
async def create_model_api_config(
    config: ModelAPIConfigBase,
    db: Session = Depends(get_db),
    _: bool = Depends(get_current_admin),
):
    try:
        # If this is set as default, unset other defaults
        if config.is_default:
            db.query(ModelAPIConfig).filter(ModelAPIConfig.is_default == True).update(
                {"is_default": False}
            )

        new_config = ModelAPIConfig(**config.dict())
        db.add(new_config)
        db.commit()
        db.refresh(new_config)
        return {
            "id": new_config.id,
            "name": new_config.name,
            "base_url": new_config.base_url,
            "api_key": new_config.api_key,
            "provider": new_config.provider or "openai",
            "model_name": new_config.model_name,
            "model_type": new_config.model_type or "general",
            "price_input_per_1k": new_config.price_input_per_1k,
            "price_output_per_1k": new_config.price_output_per_1k,
            "currency": new_config.currency,
            "is_enabled": new_config.is_enabled,
            "is_default": new_config.is_default,
            "created_at": new_config.created_at,
            "updated_at": new_config.updated_at,
        }
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))


@app.put("/api/model-api-configs/{config_id}")
async def update_model_api_config(
    config_id: str,
    config: ModelAPIConfigBase,
    db: Session = Depends(get_db),
    _: bool = Depends(get_current_admin),
):
    existing_config = (
        db.query(ModelAPIConfig).filter(ModelAPIConfig.id == config_id).first()
    )

    if not existing_config:
        raise HTTPException(status_code=404, detail="模型API配置不存在")

    try:
        # If this is set as default, unset other defaults
        if config.is_default:
            db.query(ModelAPIConfig).filter(ModelAPIConfig.is_default == True).filter(
                ModelAPIConfig.id != config_id
            ).update({"is_default": False})

        existing_config.name = config.name
        existing_config.base_url = config.base_url
        existing_config.api_key = config.api_key
        existing_config.provider = config.provider or "openai"
        existing_config.model_name = config.model_name
        existing_config.model_type = config.model_type or "general"
        existing_config.price_input_per_1k = config.price_input_per_1k
        existing_config.price_output_per_1k = config.price_output_per_1k
        existing_config.currency = config.currency
        existing_config.is_enabled = config.is_enabled
        existing_config.is_default = config.is_default

        db.commit()
        db.refresh(existing_config)

        return {
            "id": existing_config.id,
            "name": existing_config.name,
            "base_url": existing_config.base_url,
            "api_key": existing_config.api_key,
            "provider": existing_config.provider or "openai",
            "model_name": existing_config.model_name,
            "model_type": existing_config.model_type or "general",
            "price_input_per_1k": existing_config.price_input_per_1k,
            "price_output_per_1k": existing_config.price_output_per_1k,
            "currency": existing_config.currency,
            "is_enabled": existing_config.is_enabled,
            "is_default": existing_config.is_default,
            "created_at": existing_config.created_at,
            "updated_at": existing_config.updated_at,
        }
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))


@app.delete("/api/model-api-configs/{config_id}")
async def delete_model_api_config(
    config_id: str,
    db: Session = Depends(get_db),
    _: bool = Depends(get_current_admin),
):
    config = db.query(ModelAPIConfig).filter(ModelAPIConfig.id == config_id).first()

    if not config:
        raise HTTPException(status_code=404, detail="模型API配置不存在")

    db.delete(config)
    db.commit()

    return {"message": "删除成功"}


@app.post("/api/model-api-configs/{config_id}/test")
async def test_model_api_config(
    config_id: str,
    payload: Optional[ModelAPITestRequest] = None,
    db: Session = Depends(get_db),
    _: bool = Depends(get_current_admin),
):
    config = db.query(ModelAPIConfig).filter(ModelAPIConfig.id == config_id).first()

    if not config:
        raise HTTPException(status_code=404, detail="模型API配置不存在")

    try:
        # Test API connection by making a simple request
        import httpx

        prompt = payload.prompt if payload and payload.prompt else "test"
        max_tokens = payload.max_tokens if payload and payload.max_tokens else 200

        async with httpx.AsyncClient() as client:
            is_vector = (config.model_type or "general") == "vector"
            provider = (config.provider or "openai").lower()
            if is_vector:
                if provider == "jina":
                    jina_base = config.base_url.rstrip("/")
                    if not jina_base.endswith("/v1"):
                        jina_base = f"{jina_base}/v1"
                    response = await client.post(
                        f"{jina_base}/embeddings",
                        headers={
                            "Authorization": f"Bearer {config.api_key}",
                            "Content-Type": "application/json",
                            "Accept": "application/json",
                        },
                        json={
                            "model": config.model_name,
                            "input": [prompt],
                        },
                        timeout=10.0,
                    )
                else:
                    response = await client.post(
                        f"{config.base_url}/embeddings",
                        headers={
                            "Authorization": f"Bearer {config.api_key}",
                            "Content-Type": "application/json",
                        },
                        json={
                            "model": config.model_name,
                            "input": prompt,
                        },
                        timeout=10.0,
                    )
            else:
                response = await client.post(
                    f"{config.base_url}/chat/completions",
                    headers={
                        "Authorization": f"Bearer {config.api_key}",
                        "Content-Type": "application/json",
                    },
                    json={
                        "model": config.model_name,
                        "messages": [{"role": "user", "content": prompt}],
                        "max_tokens": max_tokens,
                        "temperature": 0.2,
                    },
                    timeout=10.0,
                )

            if response.status_code in [200, 201]:
                content = ""
                try:
                    data = response.json()
                    if (config.model_type or "general") == "vector":
                        embedding = (data.get("data") or [{}])[0].get("embedding") or []
                        content = f"embedding维度: {len(embedding)}"
                    else:
                        content = (
                            data.get("choices", [{}])[0]
                            .get("message", {})
                            .get("content", "")
                        )
                except Exception:
                    content = response.text
                return {
                    "success": True,
                    "message": "调用成功",
                    "content": content,
                    "raw_response": response.text,
                    "status_code": response.status_code,
                }
            return {
                "success": False,
                "message": f"调用失败: {response.status_code}",
                "content": response.text,
                "raw_response": response.text,
                "status_code": response.status_code,
            }
    except Exception as e:
        return {"success": False, "message": f"调用失败: {str(e)}"}


@app.post("/api/model-api-configs/models")
async def fetch_model_api_models(
    payload: ModelAPIModelsRequest,
    _: bool = Depends(get_current_admin),
):
    try:
        import httpx

        base_url = payload.base_url.rstrip("/")
        provider = (payload.provider or "openai").lower()
        if provider == "jina":
            return {"success": True, "models": [], "raw_response": "jina"}
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{base_url}/models",
                headers={
                    "Authorization": f"Bearer {payload.api_key}",
                    "Content-Type": "application/json",
                },
                timeout=10.0,
            )
            if response.status_code not in [200, 201]:
                return {
                    "success": False,
                    "message": f"获取模型失败: {response.status_code}",
                    "raw_response": response.text,
                }
            data = response.json()
            models = []
            if isinstance(data, dict):
                items = data.get("data") or data.get("models") or []
                if isinstance(items, list):
                    models = [item.get("id") for item in items if item.get("id")]
            return {"success": True, "models": models, "raw_response": response.text}
    except Exception as e:
        return {"success": False, "message": f"获取模型失败: {str(e)}"}


# Prompt Config endpoints
@app.get("/api/prompt-configs")
async def get_prompt_configs(
    category_id: Optional[str] = None,
    type: Optional[str] = None,
    db: Session = Depends(get_db),
    _: bool = Depends(get_current_admin),
):
    query = db.query(PromptConfig)

    if category_id:
        query = query.filter(PromptConfig.category_id == category_id)
    if type:
        query = query.filter(PromptConfig.type == type)

    configs = query.order_by(PromptConfig.created_at.desc()).all()

    return [
        {
            "id": c.id,
            "name": c.name,
            "category_id": c.category_id,
            "category_name": c.category.name if c.category else None,
            "type": c.type,
            "prompt": c.prompt,
            "system_prompt": c.system_prompt,
            "response_format": c.response_format,
            "temperature": c.temperature,
            "max_tokens": c.max_tokens,
            "top_p": c.top_p,
            "model_api_config_id": c.model_api_config_id,
            "model_api_config_name": c.model_api_config.name
            if c.model_api_config
            else None,
            "is_enabled": c.is_enabled,
            "is_default": c.is_default,
            "created_at": c.created_at,
            "updated_at": c.updated_at,
        }
        for c in configs
    ]


@app.get("/api/prompt-configs/{config_id}")
async def get_prompt_config(
    config_id: str,
    db: Session = Depends(get_db),
    _: bool = Depends(get_current_admin),
):
    config = db.query(PromptConfig).filter(PromptConfig.id == config_id).first()

    if not config:
        raise HTTPException(status_code=404, detail="提示词配置不存在")

    return {
        "id": config.id,
        "name": config.name,
        "category_id": config.category_id,
        "category_name": config.category.name if config.category else None,
        "type": config.type,
        "prompt": config.prompt,
        "system_prompt": config.system_prompt,
        "response_format": config.response_format,
        "temperature": config.temperature,
        "max_tokens": config.max_tokens,
        "top_p": config.top_p,
        "model_api_config_id": config.model_api_config_id,
        "model_api_config_name": config.model_api_config.name
        if config.model_api_config
        else None,
        "is_enabled": config.is_enabled,
        "is_default": config.is_default,
        "created_at": config.created_at,
        "updated_at": config.updated_at,
    }


@app.post("/api/prompt-configs")
async def create_prompt_config(
    config: PromptConfigBase,
    db: Session = Depends(get_db),
    _: bool = Depends(get_current_admin),
):
    try:
        # If this is set as default, unset other defaults of same type
        if config.is_default:
            db.query(PromptConfig).filter(
                PromptConfig.type == config.type, PromptConfig.is_default == True
            ).update({"is_default": False})

        new_config = PromptConfig(**config.dict())
        db.add(new_config)
        db.commit()
        db.refresh(new_config)
        return {
            "id": new_config.id,
            "name": new_config.name,
            "category_id": new_config.category_id,
            "category_name": new_config.category.name if new_config.category else None,
            "type": new_config.type,
            "prompt": new_config.prompt,
            "system_prompt": new_config.system_prompt,
            "response_format": new_config.response_format,
            "temperature": new_config.temperature,
            "max_tokens": new_config.max_tokens,
            "top_p": new_config.top_p,
            "model_api_config_id": new_config.model_api_config_id,
            "model_api_config_name": new_config.model_api_config.name
            if new_config.model_api_config
            else None,
            "is_enabled": new_config.is_enabled,
            "is_default": new_config.is_default,
            "created_at": new_config.created_at,
            "updated_at": new_config.updated_at,
        }
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))


@app.put("/api/prompt-configs/{config_id}")
async def update_prompt_config(
    config_id: str,
    config: PromptConfigBase,
    db: Session = Depends(get_db),
    _: bool = Depends(get_current_admin),
):
    existing_config = (
        db.query(PromptConfig).filter(PromptConfig.id == config_id).first()
    )

    if not existing_config:
        raise HTTPException(status_code=404, detail="提示词配置不存在")

    try:
        # If this is set as default, unset other defaults of same type
        if config.is_default:
            db.query(PromptConfig).filter(
                PromptConfig.type == config.type,
                PromptConfig.is_default == True,
                PromptConfig.id != config_id,
            ).update({"is_default": False})

        existing_config.name = config.name
        existing_config.category_id = config.category_id
        existing_config.type = config.type
        existing_config.prompt = config.prompt
        existing_config.system_prompt = config.system_prompt
        existing_config.response_format = config.response_format
        existing_config.temperature = config.temperature
        existing_config.max_tokens = config.max_tokens
        existing_config.top_p = config.top_p
        existing_config.model_api_config_id = config.model_api_config_id
        existing_config.is_enabled = config.is_enabled
        existing_config.is_default = config.is_default

        db.commit()
        db.refresh(existing_config)

        return {
            "id": existing_config.id,
            "name": existing_config.name,
            "category_id": existing_config.category_id,
            "category_name": existing_config.category.name
            if existing_config.category
            else None,
            "type": existing_config.type,
            "prompt": existing_config.prompt,
            "system_prompt": existing_config.system_prompt,
            "response_format": existing_config.response_format,
            "temperature": existing_config.temperature,
            "max_tokens": existing_config.max_tokens,
            "top_p": existing_config.top_p,
            "model_api_config_id": existing_config.model_api_config_id,
            "model_api_config_name": existing_config.model_api_config.name
            if existing_config.model_api_config
            else None,
            "is_enabled": existing_config.is_enabled,
            "is_default": existing_config.is_default,
            "created_at": existing_config.created_at,
            "updated_at": existing_config.updated_at,
        }
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))


@app.delete("/api/prompt-configs/{config_id}")
async def delete_prompt_config(
    config_id: str,
    db: Session = Depends(get_db),
    _: bool = Depends(get_current_admin),
):
    config = db.query(PromptConfig).filter(PromptConfig.id == config_id).first()

    if not config:
        raise HTTPException(status_code=404, detail="提示词配置不存在")

    db.delete(config)
    db.commit()

    return {"message": "删除成功"}


@app.get("/")
async def root():
    return {"message": "文章知识库API", "version": "1.0.0"}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
