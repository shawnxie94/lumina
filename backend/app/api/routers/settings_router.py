import uuid

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.orm import Session

from app.domain.ai_task_service import AITaskService
from app.core.dependencies import (
    build_basic_settings,
    ensure_nextauth_secret,
    get_admin_or_internal,
    validate_home_button_url,
)
from app.core.public_cache import (
    CACHE_KEY_SETTINGS_BASIC_PUBLIC,
    CACHE_KEY_SETTINGS_COMMENTS_PUBLIC,
    apply_public_cache_headers,
    get_public_cached,
    invalidate_public_cache,
)
from app.schemas import (
    BasicSettingsUpdate,
    CommentSettingsUpdate,
    RecommendationSettingsUpdate,
    StorageSettingsUpdate,
)
from auth import get_admin_settings, get_current_admin
from models import ModelAPIConfig, get_db, now_str

router = APIRouter()
ai_task_service = AITaskService()
RECOMMENDATION_EMBEDDING_REFRESH_LIMIT = 500


def validate_recommendation_model_config(db: Session, config_id: str) -> ModelAPIConfig:
    model_config = db.query(ModelAPIConfig).filter(ModelAPIConfig.id == config_id).first()
    if not model_config:
        raise HTTPException(status_code=400, detail="所选向量模型不存在，请重新选择")
    if not bool(model_config.is_enabled):
        raise HTTPException(status_code=400, detail="所选向量模型已禁用，请重新选择")
    if (model_config.model_type or "general") != "vector":
        raise HTTPException(status_code=400, detail="所选模型不是向量模型，请重新选择")
    return model_config


def build_comment_settings_public_payload(db: Session) -> dict:
    admin = get_admin_settings(db)
    return {
        "comments_enabled": bool(admin.comments_enabled) if admin else True,
        "providers": {
            "github": bool(admin.github_client_id) if admin else False,
            "google": bool(admin.google_client_id) if admin else False,
        },
    }


@router.get("/api/settings/basic")
async def get_basic_settings(
    _: bool = Depends(get_admin_or_internal),
    db: Session = Depends(get_db),
):
    admin = get_admin_settings(db)
    if admin is None:
        raise HTTPException(status_code=404, detail="未初始化管理员设置")
    return build_basic_settings(admin)


@router.put("/api/settings/basic")
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
        admin.site_name = payload.site_name or "Lumina"
    if payload.site_description is not None:
        admin.site_description = payload.site_description or "信息灯塔"
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
    invalidate_public_cache(CACHE_KEY_SETTINGS_BASIC_PUBLIC)
    return {"success": True}


@router.get("/api/settings/basic/public")
async def get_basic_settings_public(
    response: Response,
    db: Session = Depends(get_db),
):
    data = get_public_cached(
        CACHE_KEY_SETTINGS_BASIC_PUBLIC,
        lambda: build_basic_settings(get_admin_settings(db)),
    )
    apply_public_cache_headers(response)
    return data


@router.get("/api/settings/comments")
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


@router.put("/api/settings/comments")
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
    invalidate_public_cache(CACHE_KEY_SETTINGS_COMMENTS_PUBLIC)
    return {"success": True}


@router.get("/api/settings/comments/public")
async def get_comment_settings_public(
    response: Response,
    db: Session = Depends(get_db),
):
    data = get_public_cached(
        CACHE_KEY_SETTINGS_COMMENTS_PUBLIC,
        lambda: build_comment_settings_public_payload(db),
    )
    apply_public_cache_headers(response)
    return data


@router.get("/api/settings/storage")
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
        "media_max_dim": admin.media_max_dim if admin.media_max_dim is not None else 2000,
        "media_webp_quality": admin.media_webp_quality
        if admin.media_webp_quality is not None
        else 80,
    }


@router.put("/api/settings/storage")
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


@router.get("/api/settings/recommendations")
async def get_recommendation_settings(
    _: bool = Depends(get_admin_or_internal),
    db: Session = Depends(get_db),
):
    admin = get_admin_settings(db)
    if admin is None:
        raise HTTPException(status_code=404, detail="未初始化管理员设置")
    model_config_id = (admin.recommendation_model_config_id or "").strip()
    if model_config_id:
        model_config = (
            db.query(ModelAPIConfig).filter(ModelAPIConfig.id == model_config_id).first()
        )
        if (
            not model_config
            or not bool(model_config.is_enabled)
            or (model_config.model_type or "general") != "vector"
        ):
            model_config_id = ""
    return {
        "recommendations_enabled": bool(admin.recommendations_enabled),
        "recommendation_model_config_id": model_config_id,
    }


@router.put("/api/settings/recommendations")
async def update_recommendation_settings(
    payload: RecommendationSettingsUpdate,
    db: Session = Depends(get_db),
    _: bool = Depends(get_current_admin),
):
    admin = get_admin_settings(db)
    if admin is None:
        raise HTTPException(status_code=404, detail="未初始化管理员设置")
    next_enabled = (
        bool(payload.recommendations_enabled)
        if payload.recommendations_enabled is not None
        else bool(admin.recommendations_enabled)
    )
    next_model_config_id = (
        (payload.recommendation_model_config_id or "").strip()
        if payload.recommendation_model_config_id is not None
        else (admin.recommendation_model_config_id or "").strip()
    )

    if payload.recommendation_model_config_id is not None and next_model_config_id:
        validate_recommendation_model_config(db, next_model_config_id)
    if next_enabled:
        if not next_model_config_id:
            raise HTTPException(status_code=400, detail="开启文章推荐前，请先选择远程向量模型")
        validate_recommendation_model_config(db, next_model_config_id)

    if payload.recommendations_enabled is not None:
        admin.recommendations_enabled = next_enabled
    if payload.recommendation_model_config_id is not None:
        admin.recommendation_model_config_id = next_model_config_id
    admin.updated_at = now_str()
    db.commit()
    db.refresh(admin)
    return {"success": True}


@router.post("/api/settings/recommendations/rebuild-embeddings")
async def rebuild_recommendation_embeddings(
    db: Session = Depends(get_db),
    _: bool = Depends(get_current_admin),
):
    admin = get_admin_settings(db)
    if admin is None:
        raise HTTPException(status_code=404, detail="未初始化管理员设置")
    if not bool(admin.recommendations_enabled):
        raise HTTPException(status_code=409, detail="请先开启文章推荐后再刷新向量数据")

    model_config_id = (admin.recommendation_model_config_id or "").strip()
    if not model_config_id:
        raise HTTPException(status_code=400, detail="请先选择远程向量模型")
    model_config = validate_recommendation_model_config(db, model_config_id)
    result = ai_task_service.embedding_service.rebuild_embeddings_for_recommendations(
        db=db,
        model_name=model_config.model_name,
        limit=RECOMMENDATION_EMBEDDING_REFRESH_LIMIT,
        enqueue_embedding_task=lambda article_id: ai_task_service.enqueue_task(
            db,
            task_type="process_article_embedding",
            article_id=article_id,
            content_type="embedding",
        ),
    )

    return {
        "success": True,
        "scope_limit": result["scope_limit"],
        "scanned_articles": result["scanned_articles"],
        "queued_tasks": result["queued_tasks"],
        "skipped_articles": result["skipped_articles"],
    }
