import json
import logging
import os
import time
import uuid
import ipaddress

from fastapi import FastAPI, HTTPException, Depends, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, List
from models import (
    get_db,
    init_db,
    now_str,
    Category,
    Article,
    AITask,
    AIUsageLog,
    ModelAPIConfig,
    PromptConfig,
    ArticleComment,
    AdminSettings,
)
from article_service import ArticleService
from sqlalchemy import func
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

logger = logging.getLogger("article_api")
if not logger.handlers:
    logging.basicConfig(level=logging.INFO)

INTERNAL_API_TOKEN = os.getenv("INTERNAL_API_TOKEN", "")


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


def comments_enabled(db: Session) -> bool:
    admin = get_admin_settings(db)
    if admin is None:
        return True
    return bool(admin.comments_enabled)


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
if allowed_origins_env:
    allowed_origins = [
        origin.strip() for origin in allowed_origins_env.split(",") if origin.strip()
    ]
else:
    allowed_origins = [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

article_service = ArticleService()


class ArticleCreate(BaseModel):
    title: str
    content_html: Optional[str] = None
    content_md: str
    source_url: str
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


class ArticleBatchVisibility(BaseModel):
    article_ids: List[str]
    is_visible: bool


class ArticleBatchCategory(BaseModel):
    article_ids: List[str]
    category_id: Optional[str] = None


class ArticleBatchDelete(BaseModel):
    article_ids: List[str]


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


class ExportRequest(BaseModel):
    article_ids: List[str]


class ModelAPIConfigBase(BaseModel):
    name: str
    base_url: str
    api_key: str
    model_name: str = "gpt-4o"
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


@app.on_event("startup")
async def startup_event():
    init_db()


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
        return {"id": article_id, "status": "processing"}
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


@app.get("/api/articles/{article_id}")
async def get_article(
    article_id: str,
    db: Session = Depends(get_db),
    is_admin: bool = Depends(check_is_admin),
):
    article = article_service.get_article(db, article_id)
    if not article:
        raise HTTPException(status_code=404, detail="文章不存在")

    if not is_admin and not article.is_visible:
        raise HTTPException(status_code=404, detail="文章不存在")

    prev_article, next_article = article_service.get_article_neighbors(
        db, article, is_admin=is_admin
    )

    return {
        "id": article.id,
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
            "title": prev_article.title,
        }
        if prev_article
        else None,
        "next_article": {
            "id": next_article.id,
            "title": next_article.title,
        }
        if next_article
        else None,
    }


@app.get("/api/articles/{article_id}/comments")
async def get_article_comments(article_id: str, db: Session = Depends(get_db)):
    if not comments_enabled(db):
        raise HTTPException(status_code=403, detail="评论已关闭")
    article = db.query(Article).filter(Article.id == article_id).first()
    if not article:
        raise HTTPException(status_code=404, detail="文章不存在")
    comments = (
        db.query(ArticleComment)
        .filter(ArticleComment.article_id == article_id)
        .order_by(ArticleComment.created_at.asc())
        .all()
    )
    return [
        {
            "id": c.id,
            "article_id": c.article_id,
            "user_id": c.user_id,
            "user_name": c.user_name,
            "user_avatar": c.user_avatar,
            "provider": c.provider,
            "content": c.content,
            "reply_to_id": c.reply_to_id,
            "created_at": c.created_at,
            "updated_at": c.updated_at,
        }
        for c in comments
    ]


@app.post("/api/articles/{article_id}/comments")
async def create_article_comment(
    article_id: str,
    payload: CommentCreate,
    db: Session = Depends(get_db),
):
    if not comments_enabled(db):
        raise HTTPException(status_code=403, detail="评论已关闭")
    article = db.query(Article).filter(Article.id == article_id).first()
    if not article:
        raise HTTPException(status_code=404, detail="文章不存在")
    content = payload.content.strip()
    if not content:
        raise HTTPException(status_code=400, detail="评论内容不能为空")
    if len(content) > 1000:
        raise HTTPException(status_code=400, detail="评论内容过长")
    comment = ArticleComment(
        article_id=article_id,
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
        "created_at": comment.created_at,
        "updated_at": comment.updated_at,
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


@app.put("/api/articles/{article_id}/notes")
async def update_article_notes(
    article_id: str,
    payload: ArticleNotesUpdate,
    db: Session = Depends(get_db),
    _: bool = Depends(get_current_admin),
):
    article = article_service.get_article(db, article_id)
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


@app.delete("/api/articles/{article_id}")
async def delete_article(
    article_id: str,
    db: Session = Depends(get_db),
    _: bool = Depends(get_current_admin),
):
    article = db.query(Article).filter(Article.id == article_id).first()
    if not article:
        raise HTTPException(status_code=404, detail="文章不存在")

    if article.ai_analysis:
        db.delete(article.ai_analysis)
    db.delete(article)
    db.commit()
    return {"message": "删除成功"}


@app.put("/api/articles/{article_id}")
async def update_article(
    article_id: str,
    article_data: ArticleUpdate,
    db: Session = Depends(get_db),
    _: bool = Depends(get_current_admin),
):
    article = db.query(Article).filter(Article.id == article_id).first()
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
    if not request.article_ids:
        raise HTTPException(status_code=400, detail="请选择文章")
    updated = (
        db.query(Article)
        .filter(Article.id.in_(request.article_ids))
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
    if not request.article_ids:
        raise HTTPException(status_code=400, detail="请选择文章")
    if request.category_id:
        category = db.query(Category).filter(Category.id == request.category_id).first()
        if not category:
            raise HTTPException(status_code=404, detail="分类不存在")
    updated = (
        db.query(Article)
        .filter(Article.id.in_(request.article_ids))
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
    if not request.article_ids:
        raise HTTPException(status_code=400, detail="请选择文章")
    deleted = (
        db.query(Article)
        .filter(Article.id.in_(request.article_ids))
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
    article_id: Optional[str] = None,
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
    if article_id:
        query = query.filter(AITask.article_id == article_id)

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
            db.query(Article.id, Article.title)
            .filter(Article.id.in_(article_ids))
            .all()
        )
        article_map = {article.id: article.title for article in articles}

    return {
        "data": [
            {
                "id": task.id,
                "article_id": task.article_id,
                "article_title": article_map.get(task.article_id),
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

    updated = (
        db.query(AITask)
        .filter(AITask.id.in_(request.task_ids))
        .update(
            {
                "status": "pending",
                "run_at": now_str(),
                "locked_at": None,
                "locked_by": None,
                "last_error": None,
                "updated_at": now_str(),
            },
            synchronize_session=False,
        )
    )
    db.commit()
    return {"updated": updated}


@app.post("/api/ai-tasks/cancel")
async def cancel_ai_tasks(
    request: AITaskCancelRequest,
    db: Session = Depends(get_db),
    _: bool = Depends(get_current_admin),
):
    if not request.task_ids:
        raise HTTPException(status_code=400, detail="请选择任务")

    updated = (
        db.query(AITask)
        .filter(AITask.id.in_(request.task_ids))
        .filter(AITask.status.in_(["pending", "processing"]))
        .update(
            {
                "status": "cancelled",
                "locked_at": None,
                "locked_by": None,
                "updated_at": now_str(),
                "finished_at": now_str(),
            },
            synchronize_session=False,
        )
    )
    db.commit()
    return {"updated": updated}


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

    items = []
    for log, model_name in logs:
        items.append(
            {
                "id": log.id,
                "model_api_config_id": log.model_api_config_id,
                "model_api_config_name": model_name,
                "task_id": log.task_id,
                "article_id": log.article_id,
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


@app.put("/api/articles/{article_id}/visibility")
async def update_article_visibility(
    article_id: str,
    data: VisibilityUpdate,
    db: Session = Depends(get_db),
    _: bool = Depends(get_current_admin),
):
    article = db.query(Article).filter(Article.id == article_id).first()
    if not article:
        raise HTTPException(status_code=404, detail="文章不存在")

    article.is_visible = data.is_visible
    from models import now_str

    article.updated_at = now_str()
    db.commit()

    return {"id": article.id, "is_visible": article.is_visible}


@app.post("/api/articles/{article_id}/retry")
async def retry_article_ai(
    article_id: str,
    db: Session = Depends(get_db),
    _: bool = Depends(get_current_admin),
):
    try:
        article_id = await article_service.retry_article_ai(db, article_id)
        return {"id": article_id, "status": "processing"}
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/articles/{article_id}/retry-translation")
async def retry_article_translation(
    article_id: str,
    db: Session = Depends(get_db),
    _: bool = Depends(get_current_admin),
):
    try:
        article_id = await article_service.retry_article_translation(db, article_id)
        return {"id": article_id, "translation_status": "processing"}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/articles/{article_id}/generate/{content_type}")
async def generate_ai_content(
    article_id: str,
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
        await article_service.generate_ai_content(
            db,
            article_id,
            content_type,
            model_config_id=model_config_id,
            prompt_config_id=prompt_config_id,
        )
        return {"id": article_id, "content_type": content_type, "status": "processing"}
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
        markdown_content = article_service.export_articles(db, request.article_ids)
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
            "model_name": c.model_name,
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
        "model_name": config.model_name,
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
            "model_name": new_config.model_name,
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
        existing_config.model_name = config.model_name
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
            "model_name": existing_config.model_name,
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
