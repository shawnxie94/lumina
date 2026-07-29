from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy.orm import Session, joinedload

from app.core.dependencies import check_is_admin_or_internal, get_admin_or_internal, get_current_admin
from app.core.public_cache import TOPICS_CACHE_TTL_SECONDS, apply_public_cache_headers
from app.domain.topic_service import topic_service
from app.schemas.topic import TopicCompileResultsRequest, TopicOrphanCleanupRequest
from models import Article, get_db

router = APIRouter(tags=["topics"])


@router.get("/api/topics")
async def list_topics(
    q: str | None = Query(None),
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=100),
    response: Response = None,
    db: Session = Depends(get_db),
    is_admin: bool = Depends(check_is_admin_or_internal),
):
    if not is_admin and not topic_service.is_topics_enabled(db):
        return {
            "data": [],
            "pagination": {"page": page, "size": size, "total": 0, "total_pages": 0},
        }
    if not is_admin and response is not None:
        apply_public_cache_headers(response, ttl_seconds=TOPICS_CACHE_TTL_SECONDS)
    return topic_service.list_topics(db, q=q, page=page, size=size, include_ignored=is_admin)


@router.post("/api/topics/compile-results")
async def write_compile_results(
    payload: TopicCompileResultsRequest,
    db: Session = Depends(get_db),
    _: bool = Depends(get_admin_or_internal),
):
    try:
        return topic_service.apply_compile_results(db, payload.model_dump())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/api/topics/export/articles")
async def export_articles_for_bridge(
    updated_after: str | None = Query(None),
    page: int = Query(1, ge=1),
    size: int = Query(50, ge=1, le=100),
    include_stale_only: bool = Query(False),
    db: Session = Depends(get_db),
    _: bool = Depends(get_admin_or_internal),
):
    query = (
        db.query(Article)
        .options(
            joinedload(Article.category),
            joinedload(Article.ai_analysis),
        )
        .filter(Article.is_visible == True)  # noqa: E712
    )
    if updated_after:
        query = query.filter(Article.updated_at > updated_after)
    if include_stale_only:
        query = query.filter(Article.compile_status.in_(["none", "stale", "failed", "queued"]))
    total = query.count()
    rows = (
        query.order_by(Article.updated_at.asc(), Article.id.asc())
        .offset((page - 1) * size)
        .limit(size)
        .all()
    )
    data = []
    for article in rows:
        if not (
            (article.content_md and article.content_md.strip())
            or (article.content_html and article.content_html.strip())
            or (article.content_trans and article.content_trans.strip())
        ):
            continue
        data.append(
            {
                "id": article.id,
                "slug": article.slug,
                "title": article.title,
                "title_trans": article.title_trans,
                "content_md": article.content_md,
                "content_html": article.content_html,
                "content_trans": article.content_trans,
                "original_language": article.original_language,
                "translation_status": article.translation_status,
                "source_url": article.source_url,
                "source_domain": article.source_domain,
                "author": article.author,
                "published_at": article.published_at,
                "created_at": article.created_at,
                "updated_at": article.updated_at,
                "summary": article.ai_analysis.summary if article.ai_analysis else None,
                "category": {
                    "id": article.category.id,
                    "name": article.category.name,
                }
                if article.category
                else None,
                "is_visible": article.is_visible,
                "status": article.status,
                "compile_status": getattr(article, "compile_status", "none") or "none",
                "compiled_at": getattr(article, "compiled_at", None),
                "compile_export_hash": getattr(article, "compile_export_hash", None),
            }
        )
    return {
        "data": data,
        "pagination": {
            "page": page,
            "size": size,
            "total": total,
            "total_pages": (total + size - 1) // size if size else 0,
        },
    }




@router.post("/api/topics/cleanup-orphans")
async def cleanup_orphan_topics(
    payload: TopicOrphanCleanupRequest,
    db: Session = Depends(get_db),
    _: bool = Depends(get_current_admin),
):
    try:
        return topic_service.cleanup_orphan_topics(
            db,
            payload.known_keys,
            dry_run=bool(payload.dry_run),
            fetch_from_bridge=True,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

@router.get("/api/topics/{topic_key}")
async def get_topic_detail(
    topic_key: str,
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=100),
    response: Response = None,
    db: Session = Depends(get_db),
    is_admin: bool = Depends(check_is_admin_or_internal),
):
    if not is_admin and not topic_service.is_topics_enabled(db):
        raise HTTPException(status_code=404, detail="主题不存在")
    detail = topic_service.get_topic_detail(
        db,
        topic_key,
        page=page,
        size=size,
        is_admin=is_admin,
    )
    if not detail:
        raise HTTPException(status_code=404, detail="主题不存在")
    if (detail.get("status") == "ignored") and not is_admin:
        raise HTTPException(status_code=404, detail="主题不存在")
    if not is_admin and response is not None:
        apply_public_cache_headers(response)
    return detail
