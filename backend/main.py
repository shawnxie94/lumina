from fastapi import FastAPI, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, List
from models import (
    get_db,
    init_db,
    Category,
    Article,
    AIConfig,
    ModelAPIConfig,
    PromptConfig,
)
from article_service import ArticleService
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
)

app = FastAPI(title="文章知识库API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
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


class CategoryCreate(BaseModel):
    name: str
    description: Optional[str] = None
    color: Optional[str] = None
    sort_order: Optional[int] = 0


class ExportRequest(BaseModel):
    article_ids: List[str]


class AIConfigBase(BaseModel):
    category_id: Optional[str] = None
    dimension: str
    is_enabled: bool = True
    base_url: str
    api_key: str
    model_name: str = "gpt-4o"
    prompt_template: Optional[str] = None
    parameters: Optional[str] = None
    is_default: bool = False


class ModelAPIConfigBase(BaseModel):
    name: str
    base_url: str
    api_key: str
    model_name: str = "gpt-4o"
    is_enabled: bool = True
    is_default: bool = False


class PromptConfigBase(BaseModel):
    name: str
    category_id: Optional[str] = None
    type: str  # summary, outline, key_points, mindmap, etc.
    prompt: str
    model_api_config_id: Optional[str] = None
    is_enabled: bool = True
    is_default: bool = False


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

    admin = create_admin_settings(db, request.password)
    token = create_token(admin.jwt_secret)
    return LoginResponse(token=token, message="管理员密码设置成功")


@app.post("/api/auth/login")
async def login(request: LoginRequest, db: Session = Depends(get_db)):
    """管理员登录"""
    admin = get_admin_settings(db)
    if admin is None:
        raise HTTPException(status_code=400, detail="系统未初始化，请先设置管理员密码")

    if not verify_password(request.password, admin.password_hash):
        raise HTTPException(status_code=401, detail="密码错误")

    token = create_token(admin.jwt_secret)
    return LoginResponse(token=token, message="登录成功")


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

    if not verify_password(request.old_password, admin.password_hash):
        raise HTTPException(status_code=401, detail="原密码错误")

    update_admin_password(db, admin, request.new_password)
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
    published_at_start: Optional[str] = None,
    published_at_end: Optional[str] = None,
    created_at_start: Optional[str] = None,
    created_at_end: Optional[str] = None,
    sort_by: Optional[str] = "created_at_desc",
    db: Session = Depends(get_db),
    is_admin: bool = Depends(check_is_admin),
):
    articles, total = article_service.get_articles(
        db,
        page,
        size,
        category_id,
        search,
        source_domain,
        author,
        published_at_start,
        published_at_end,
        created_at_start,
        created_at_end,
        sort_by,
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
        }
        if article.ai_analysis
        else None,
    }


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

    categories = db.query(Category).order_by(Category.sort_order).all()
    result = []

    for c in categories:
        query = db.query(Article).filter(Article.category_id == c.id)

        if search:
            query = query.filter(Article.title.contains(search))
        if source_domain:
            query = query.filter(Article.source_domain == source_domain)
        if author:
            query = query.filter(Article.author == author)
        if published_at_start:
            query = query.filter(
                func.substr(Article.published_at, 1, 10) >= published_at_start
            )
        if published_at_end:
            query = query.filter(
                func.substr(Article.published_at, 1, 10) <= published_at_end
            )
        if created_at_start:
            query = query.filter(
                func.substr(Article.created_at, 1, 10) >= created_at_start
            )
        if created_at_end:
            query = query.filter(
                func.substr(Article.created_at, 1, 10) <= created_at_end
            )

        count = query.count()
        result.append(
            {
                "id": c.id,
                "name": c.name,
                "color": c.color,
                "article_count": count,
            }
        )

    return result


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
async def export_articles(request: ExportRequest, db: Session = Depends(get_db)):
    try:
        markdown_content = article_service.export_articles(db, request.article_ids)
        return {"content": markdown_content, "filename": "articles_export.md"}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/api/configs/ai")
async def get_ai_configs(
    category_id: Optional[str] = None, db: Session = Depends(get_db)
):
    query = db.query(AIConfig)

    if category_id:
        query = query.filter(AIConfig.category_id == category_id)

    configs = query.all()

    return [
        {
            "id": c.id,
            "category_id": c.category_id,
            "dimension": c.dimension,
            "is_enabled": c.is_enabled,
            "base_url": c.base_url,
            "api_key": c.api_key,
            "model_name": c.model_name,
            "prompt_template": c.prompt_template,
            "parameters": c.parameters,
            "is_default": c.is_default,
        }
        for c in configs
    ]


@app.post("/api/configs/ai")
async def create_ai_config(
    config: AIConfigBase,
    db: Session = Depends(get_db),
    _: bool = Depends(get_current_admin),
):
    try:
        new_config = AIConfig(**config.dict())
        db.add(new_config)
        db.commit()
        db.refresh(new_config)
        return {
            "id": new_config.id,
            "category_id": new_config.category_id,
            "dimension": new_config.dimension,
            "is_enabled": new_config.is_enabled,
            "base_url": new_config.base_url,
            "api_key": new_config.api_key,
            "model_name": new_config.model_name,
            "prompt_template": new_config.prompt_template,
            "parameters": new_config.parameters,
            "is_default": new_config.is_default,
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.put("/api/configs/ai/{config_id}")
async def update_ai_config(
    config_id: str,
    config: AIConfigBase,
    db: Session = Depends(get_db),
    _: bool = Depends(get_current_admin),
):
    ai_config = db.query(AIConfig).filter(AIConfig.id == config_id).first()

    if not ai_config:
        raise HTTPException(status_code=404, detail="AI配置不存在")

    ai_config.category_id = config.category_id
    ai_config.dimension = config.dimension
    ai_config.is_enabled = config.is_enabled
    ai_config.base_url = config.base_url
    ai_config.api_key = config.api_key
    ai_config.model_name = config.model_name
    ai_config.prompt_template = config.prompt_template
    ai_config.parameters = config.parameters
    ai_config.is_default = config.is_default

    db.commit()
    db.refresh(ai_config)

    return {
        "id": ai_config.id,
        "category_id": ai_config.category_id,
        "dimension": ai_config.dimension,
        "is_enabled": ai_config.is_enabled,
        "base_url": ai_config.base_url,
        "api_key": ai_config.api_key,
        "model_name": ai_config.model_name,
        "prompt_template": ai_config.prompt_template,
        "parameters": ai_config.parameters,
        "is_default": ai_config.is_default,
    }


@app.delete("/api/configs/ai/{config_id}")
async def delete_ai_config(
    config_id: str,
    db: Session = Depends(get_db),
    _: bool = Depends(get_current_admin),
):
    ai_config = db.query(AIConfig).filter(AIConfig.id == config_id).first()

    if not ai_config:
        raise HTTPException(status_code=404, detail="AI配置不存在")

    db.delete(ai_config)
    db.commit()

    return {"message": "删除成功"}


# Model API Config endpoints
@app.get("/api/model-api-configs")
async def get_model_api_configs(db: Session = Depends(get_db)):
    configs = db.query(ModelAPIConfig).order_by(ModelAPIConfig.created_at.desc()).all()

    return [
        {
            "id": c.id,
            "name": c.name,
            "base_url": c.base_url,
            "api_key": c.api_key,
            "model_name": c.model_name,
            "is_enabled": c.is_enabled,
            "is_default": c.is_default,
            "created_at": c.created_at,
            "updated_at": c.updated_at,
        }
        for c in configs
    ]


@app.get("/api/model-api-configs/{config_id}")
async def get_model_api_config(config_id: str, db: Session = Depends(get_db)):
    config = db.query(ModelAPIConfig).filter(ModelAPIConfig.id == config_id).first()

    if not config:
        raise HTTPException(status_code=404, detail="模型API配置不存在")

    return {
        "id": config.id,
        "name": config.name,
        "base_url": config.base_url,
        "api_key": config.api_key,
        "model_name": config.model_name,
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
    db: Session = Depends(get_db),
    _: bool = Depends(get_current_admin),
):
    config = db.query(ModelAPIConfig).filter(ModelAPIConfig.id == config_id).first()

    if not config:
        raise HTTPException(status_code=404, detail="模型API配置不存在")

    try:
        # Test API connection by making a simple request
        import httpx

        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{config.base_url}/chat/completions",
                headers={
                    "Authorization": f"Bearer {config.api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": config.model_name,
                    "messages": [{"role": "user", "content": "test"}],
                    "max_tokens": 5,
                },
                timeout=10.0,
            )

            if response.status_code in [200, 201]:
                return {"success": True, "message": "连接测试成功"}
            else:
                return {
                    "success": False,
                    "message": f"连接测试失败: {response.status_code}",
                }
    except Exception as e:
        return {"success": False, "message": f"连接测试失败: {str(e)}"}


# Prompt Config endpoints
@app.get("/api/prompt-configs")
async def get_prompt_configs(
    category_id: Optional[str] = None,
    type: Optional[str] = None,
    db: Session = Depends(get_db),
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
async def get_prompt_config(config_id: str, db: Session = Depends(get_db)):
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
