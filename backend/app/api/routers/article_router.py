import json
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.schemas import (
    ArticleBatchCategory,
    ArticleBatchDelete,
    ArticleBatchVisibility,
    ArticleCreate,
    ArticleNotesUpdate,
    ArticleUpdate,
)
from app.domain.ai_task_service import AITaskService
from app.domain.article_command_service import ArticleCommandService
from app.domain.article_embedding_service import ArticleEmbeddingService
from app.domain.article_query_service import ArticleQueryService
from auth import check_is_admin, get_admin_settings, get_current_admin
from media_service import cleanup_media_assets
from models import Article, ArticleComment, ArticleEmbedding, Category, get_db, now_str

router = APIRouter()
article_query_service = ArticleQueryService()
ai_task_service = AITaskService()
article_command_service = ArticleCommandService(ai_task_service=ai_task_service)
article_embedding_service = ArticleEmbeddingService()

SIMILAR_ARTICLE_CANDIDATE_LIMIT = 500
CATEGORY_SIMILARITY_BOOST = 0.05


class VisibilityUpdate(BaseModel):
    is_visible: bool


@router.post("/api/articles")
async def create_article(
    article: ArticleCreate,
    db: Session = Depends(get_db),
    _: bool = Depends(get_current_admin),
):
    try:
        article_id = await article_command_service.create_article(article.dict(), db)
        article_obj = db.query(Article).filter(Article.id == article_id).first()
        slug = article_obj.slug if article_obj else article_id
        return {"id": article_id, "slug": slug, "status": "processing"}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/api/articles")
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
    articles, total = article_query_service.get_articles(
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


@router.get("/api/articles/search")
async def search_articles(
    query: str = "",
    limit: int = 20,
    db: Session = Depends(get_db),
    _: bool = Depends(get_current_admin),
):
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


@router.get("/api/articles/{article_slug}")
async def get_article(
    article_slug: str,
    db: Session = Depends(get_db),
    is_admin: bool = Depends(check_is_admin),
):
    article = article_query_service.get_article_by_slug(db, article_slug)
    if not article:
        raise HTTPException(status_code=404, detail="文章不存在")

    if not is_admin and not article.is_visible:
        raise HTTPException(status_code=404, detail="文章不存在")

    prev_article, next_article = article_query_service.get_article_neighbors(
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
            "key_points": article.ai_analysis.key_points if article.ai_analysis else None,
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
            "updated_at": article.ai_analysis.updated_at if article.ai_analysis else None,
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


@router.get("/api/articles/{article_slug}/similar")
async def get_similar_articles(
    article_slug: str,
    limit: int = 4,
    db: Session = Depends(get_db),
    is_admin: bool = Depends(check_is_admin),
):
    admin = get_admin_settings(db)
    if admin and not bool(admin.recommendations_enabled):
        return {"status": "disabled", "items": []}

    article = article_query_service.get_article_by_slug(db, article_slug)
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
        ai_task_service.enqueue_task(
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
        score = article_embedding_service.cosine_similarity(base_vector, vector)
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
                "category_id": candidate_article.category_id,
                "category_name": candidate_article.category.name
                if candidate_article.category
                else None,
                "category_color": candidate_article.category.color
                if candidate_article.category
                else None,
            }
        )
    return {"status": "ready", "items": items}


@router.post("/api/articles/{article_slug}/embedding")
async def regenerate_article_embedding(
    article_slug: str,
    db: Session = Depends(get_db),
    _: bool = Depends(get_current_admin),
):
    article = article_query_service.get_article_by_slug(db, article_slug)
    if not article:
        raise HTTPException(status_code=404, detail="文章不存在")

    task_id = ai_task_service.enqueue_task(
        db,
        task_type="process_article_embedding",
        article_id=article.id,
        content_type="embedding",
    )
    return {"success": True, "task_id": task_id}


@router.put("/api/articles/{article_slug}/notes")
async def update_article_notes(
    article_slug: str,
    payload: ArticleNotesUpdate,
    db: Session = Depends(get_db),
    _: bool = Depends(get_current_admin),
):
    article = article_query_service.get_article_by_slug(db, article_slug)
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


@router.delete("/api/articles/{article_slug}")
async def delete_article(
    article_slug: str,
    db: Session = Depends(get_db),
    _: bool = Depends(get_current_admin),
):
    article = article_query_service.get_article_by_slug(db, article_slug)
    if not article:
        raise HTTPException(status_code=404, detail="文章不存在")

    cleanup_media_assets(db, [article.id])
    if article.ai_analysis:
        db.delete(article.ai_analysis)
    db.delete(article)
    db.commit()
    return {"message": "删除成功"}


@router.put("/api/articles/{article_slug}")
async def update_article(
    article_slug: str,
    article_data: ArticleUpdate,
    db: Session = Depends(get_db),
    _: bool = Depends(get_current_admin),
):
    article = article_query_service.get_article_by_slug(db, article_slug)
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


@router.post("/api/articles/batch/visibility")
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


@router.post("/api/articles/batch/category")
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


@router.post("/api/articles/batch/delete")
async def batch_delete_articles(
    request: ArticleBatchDelete,
    db: Session = Depends(get_db),
    _: bool = Depends(get_current_admin),
):
    if not request.article_slugs:
        raise HTTPException(status_code=400, detail="请选择文章")
    article_ids = [
        row[0]
        for row in db.query(Article.id).filter(Article.slug.in_(request.article_slugs)).all()
    ]
    cleanup_media_assets(db, article_ids)
    if article_ids:
        db.query(ArticleComment).filter(ArticleComment.article_id.in_(article_ids)).delete(
            synchronize_session=False
        )
        db.query(ArticleEmbedding).filter(
            ArticleEmbedding.article_id.in_(article_ids)
        ).delete(synchronize_session=False)
    deleted = (
        db.query(Article)
        .filter(Article.slug.in_(request.article_slugs))
        .delete(synchronize_session=False)
    )
    db.commit()
    return {"deleted": deleted}


@router.put("/api/articles/{article_slug}/visibility")
async def update_article_visibility(
    article_slug: str,
    data: VisibilityUpdate,
    db: Session = Depends(get_db),
    _: bool = Depends(get_current_admin),
):
    article = article_query_service.get_article_by_slug(db, article_slug)
    if not article:
        raise HTTPException(status_code=404, detail="文章不存在")

    article.is_visible = data.is_visible
    article.updated_at = now_str()
    db.commit()

    return {"id": article.id, "is_visible": article.is_visible}


@router.post("/api/articles/{article_slug}/retry")
async def retry_article_ai(
    article_slug: str,
    db: Session = Depends(get_db),
    _: bool = Depends(get_current_admin),
):
    try:
        article = article_query_service.get_article_by_slug(db, article_slug)
        if not article:
            raise HTTPException(status_code=404, detail="文章不存在")
        actual_article_id = await article_command_service.retry_article_ai(db, article.id)
        return {"id": actual_article_id, "status": "processing"}
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/api/articles/{article_slug}/retry-translation")
async def retry_article_translation(
    article_slug: str,
    db: Session = Depends(get_db),
    _: bool = Depends(get_current_admin),
):
    try:
        article = article_query_service.get_article_by_slug(db, article_slug)
        if not article:
            raise HTTPException(status_code=404, detail="文章不存在")
        actual_article_id = await article_command_service.retry_article_translation(db, article.id)
        return {"id": actual_article_id, "translation_status": "processing"}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/api/articles/{article_slug}/generate/{content_type}")
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
        article = article_query_service.get_article_by_slug(db, article_slug)
        if not article:
            raise HTTPException(status_code=404, detail="文章不存在")
        await article_command_service.generate_ai_content(
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


@router.get("/api/authors")
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


@router.get("/api/sources")
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
