from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.security import HTTPAuthorizationCredentials
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload, load_only

from app.core.public_cache import apply_public_cache_headers, get_public_cached
from app.core.dependencies import build_basic_settings
from app.core.dependencies import (
    check_is_admin_or_internal,
    comments_enabled,
    contains_sensitive_word,
    get_admin_or_internal,
    get_sensitive_words,
    normalize_date_bound,
    require_internal_token,
)
from app.domain.article_rss_service import ArticleRssService
from app.domain.detail_markdown_export_service import (
    build_detail_export_markdown,
    build_markdown_response,
    resolve_export_origin,
)
from app.schemas import (
    CommentCreate,
    CommentUpdate,
    CommentVisibilityUpdate,
    ReviewIssueUpdateRequest,
    ReviewTemplateBase,
    ReviewTemplateManualRunRequest,
    ReviewTemplateUpdate,
    ReviewTemplateSortRequest,
)
from app.domain.review_service import ReviewService
from auth import check_is_admin, get_admin_settings, get_current_admin, security
from models import (
    Category,
    ModelAPIConfig,
    ReviewComment,
    ReviewIssue,
    ReviewTemplate,
    get_db,
    now_str,
)
from slug_utils import generate_slug

router = APIRouter()
review_service = ReviewService()
article_rss_service = ArticleRssService()


def _collect_review_comment_descendant_ids(db: Session, root_comment_id: str) -> list[str]:
    pending_parent_ids = [root_comment_id]
    descendant_ids: list[str] = []
    seen_ids: set[str] = set()

    while pending_parent_ids:
        child_rows = (
            db.query(ReviewComment.id)
            .filter(ReviewComment.reply_to_id.in_(pending_parent_ids))
            .all()
        )
        child_ids = [row[0] for row in child_rows if row[0] not in seen_ids]
        if not child_ids:
            break
        descendant_ids.extend(child_ids)
        seen_ids.update(child_ids)
        pending_parent_ids = child_ids

    return descendant_ids



def _build_unique_template_slug(
    db: Session,
    *,
    name: str,
    exclude_template_id: str | None = None,
) -> str:
    base_slug = generate_slug(name.strip() or "review-template")
    slug = base_slug
    suffix = 2
    while True:
        query = db.query(ReviewTemplate).filter(ReviewTemplate.slug == slug)
        if exclude_template_id:
            query = query.filter(ReviewTemplate.id != exclude_template_id)
        existing = query.first()
        if not existing:
            return slug
        slug = f"{base_slug}-{suffix}"
        suffix += 1



@router.get("/api/columns")
async def get_public_reviews(
    response: Response,
    page: int = 1,
    size: int = 20,
    template_id: str | None = None,
    search: str | None = None,
    published_at_start: str | None = None,
    published_at_end: str | None = None,
    visibility: str | None = None,
    db: Session = Depends(get_db),
    is_admin: bool = Depends(check_is_admin_or_internal),
):
    page = max(1, page)
    size = min(max(1, size), 50)
    normalized_start = normalize_date_bound(published_at_start, is_end=False)
    normalized_end = normalize_date_bound(published_at_end, is_end=True)
    issues, total = review_service.get_public_issues(
        db,
        page=page,
        size=size,
        is_admin=is_admin,
        template_id=template_id,
        search=search,
        published_at_start=normalized_start,
        published_at_end=normalized_end,
        visibility=visibility,
    )
    template_filters = review_service.get_issue_template_filters(
        db,
        is_admin=is_admin,
        search=search,
        published_at_start=normalized_start,
        published_at_end=normalized_end,
        visibility=visibility,
    )
    if not is_admin:
        apply_public_cache_headers(response)
    return {
        "data": issues,
        "filters": {
            "templates": template_filters,
        },
        "pagination": {
            "page": page,
            "size": size,
            "total": total,
            "total_pages": (total + size - 1) // size,
        },
    }


@router.get("/api/columns/rss.xml")
async def get_reviews_rss(
    request: Request,
    template_id: str | None = None,
    db: Session = Depends(get_db),
):
    public_base_url = article_rss_service.resolve_public_base_url(request)
    normalized_template_id = (template_id or "").strip() or None
    cache_key = article_rss_service.build_review_cache_key(
        public_base_url,
        template_id=normalized_template_id,
    )

    def load_feed() -> str:
        article_rss_service.assert_rss_enabled(db)
        reviews = review_service.get_reviews_for_rss(
            db,
            template_id=normalized_template_id,
        )
        basic_settings = build_basic_settings(get_admin_settings(db))
        return review_service.render_reviews_rss(
            reviews=reviews,
            public_base_url=public_base_url,
            site_name=basic_settings["site_name"],
            site_description=basic_settings["site_description"],
            template_id=normalized_template_id,
        )

    content = get_public_cached(cache_key, load_feed)
    response = article_rss_service.build_response(content)
    apply_public_cache_headers(response)
    return response


@router.get("/api/columns/{review_slug}")
async def get_public_review_detail(
    review_slug: str,
    db: Session = Depends(get_db),
    is_admin: bool = Depends(check_is_admin_or_internal),
):
    issue = review_service.get_public_issue_by_slug(db, review_slug, is_admin=is_admin)
    return review_service.serialize_issue_detail(db, issue, is_admin=is_admin)


@router.get("/api/columns/{review_slug}/export.md")
async def export_public_review_markdown(
    review_slug: str,
    request: Request,
    db: Session = Depends(get_db),
    is_admin: bool = Depends(check_is_admin_or_internal),
):
    issue = review_service.get_public_issue_by_slug(db, review_slug, is_admin=is_admin)
    markdown = build_detail_export_markdown(
        origin=resolve_export_origin(request),
        title=issue.title,
        top_image=issue.top_image,
        body=review_service.render_issue_markdown(db, issue, is_admin=is_admin)
        or issue.markdown_content,
    )
    return build_markdown_response(markdown, f"review-{issue.slug}.md")


@router.post("/api/columns/{review_slug}/view")
async def record_review_view(
    review_slug: str,
    db: Session = Depends(get_db),
    is_admin: bool = Depends(check_is_admin_or_internal),
):
    query = db.query(ReviewIssue).filter(ReviewIssue.slug == review_slug)
    if not is_admin:
        query = query.filter(ReviewIssue.status == "published")

    updated = query.update(
        {
            ReviewIssue.view_count: func.coalesce(ReviewIssue.view_count, 0) + 1,
        },
        synchronize_session=False,
    )
    if updated == 0:
        raise HTTPException(status_code=404, detail="专栏文章不存在")

    db.commit()
    issue = (
        db.query(ReviewIssue)
        .filter(ReviewIssue.slug == review_slug)
        .options(load_only(ReviewIssue.slug, ReviewIssue.view_count))
        .first()
    )
    if issue is None:
        raise HTTPException(status_code=404, detail="专栏文章不存在")
    return {
        "review_slug": issue.slug,
        "view_count": int(issue.view_count or 0),
        "counted": True,
    }


@router.get("/api/columns/{review_slug}/comments")
async def get_review_comments(
    review_slug: str,
    include_hidden: bool = False,
    request: Request = None,
    db: Session = Depends(get_db),
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
):
    if not comments_enabled(db):
        raise HTTPException(status_code=403, detail="评论已关闭")
    issue = review_service.get_public_issue_by_slug(db, review_slug, is_admin=False)

    is_admin = False
    if include_hidden and request is not None:
        is_admin = bool(check_is_admin(request=request, credentials=credentials, db=db))

    query = db.query(ReviewComment).filter(ReviewComment.issue_id == issue.id)
    if not is_admin:
        query = query.filter(
            (ReviewComment.is_hidden == False) | (ReviewComment.is_hidden.is_(None))
        )

    comments = query.order_by(ReviewComment.created_at.asc()).all()
    return [
        review_service.serialize_review_comment(comment, review_slug=issue.slug)
        for comment in comments
    ]


@router.post("/api/columns/{review_slug}/comments")
async def create_review_comment(
    review_slug: str,
    payload: CommentCreate,
    db: Session = Depends(get_db),
    _: bool = Depends(require_internal_token),
):
    if not comments_enabled(db):
        raise HTTPException(status_code=403, detail="评论已关闭")
    issue = review_service.get_public_issue_by_slug(db, review_slug, is_admin=False)

    content = payload.content.strip()
    if not content:
        raise HTTPException(status_code=400, detail="评论内容不能为空")
    if len(content) > 1000:
        raise HTTPException(status_code=400, detail="评论内容过长")

    filter_enabled, words = get_sensitive_words(db)
    if filter_enabled and words and contains_sensitive_word(content, words):
        raise HTTPException(status_code=400, detail="评论包含敏感词")

    comment = ReviewComment(
        issue_id=issue.id,
        user_id=payload.user_id,
        user_name=payload.user_name,
        github_username=payload.github_username,
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
    return review_service.serialize_review_comment(comment, review_slug=issue.slug)


@router.get("/api/column-comments/{comment_id}")
async def get_review_comment(
    comment_id: str,
    db: Session = Depends(get_db),
):
    if not comments_enabled(db):
        raise HTTPException(status_code=403, detail="评论已关闭")
    comment = (
        db.query(ReviewComment)
        .options(joinedload(ReviewComment.issue))
        .filter(ReviewComment.id == comment_id)
        .first()
    )
    if not comment or not comment.issue or comment.issue.status != "published":
        raise HTTPException(status_code=404, detail="评论不存在")
    return review_service.serialize_review_comment(comment, review_slug=comment.issue.slug)


@router.put("/api/column-comments/{comment_id}")
async def update_review_comment(
    comment_id: str,
    payload: CommentUpdate,
    db: Session = Depends(get_db),
    _: bool = Depends(require_internal_token),
):
    if not comments_enabled(db):
        raise HTTPException(status_code=403, detail="评论已关闭")
    comment = (
        db.query(ReviewComment)
        .options(joinedload(ReviewComment.issue))
        .filter(ReviewComment.id == comment_id)
        .first()
    )
    if not comment or not comment.issue:
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
    return review_service.serialize_review_comment(comment, review_slug=comment.issue.slug)


@router.delete("/api/column-comments/{comment_id}")
async def delete_review_comment(
    comment_id: str,
    db: Session = Depends(get_db),
    _: bool = Depends(get_admin_or_internal),
):
    if not comments_enabled(db):
        raise HTTPException(status_code=403, detail="评论已关闭")
    comment = db.query(ReviewComment).filter(ReviewComment.id == comment_id).first()
    if not comment:
        raise HTTPException(status_code=404, detail="评论不存在")

    deleted = 1
    descendant_ids = _collect_review_comment_descendant_ids(db, comment.id)
    if descendant_ids:
        deleted += (
            db.query(ReviewComment)
            .filter(ReviewComment.id.in_(descendant_ids))
            .delete(synchronize_session=False)
        )

    db.delete(comment)
    db.commit()
    return {"success": True, "deleted": deleted}


@router.put("/api/column-comments/{comment_id}/visibility")
async def update_review_comment_visibility(
    comment_id: str,
    payload: CommentVisibilityUpdate,
    db: Session = Depends(get_db),
    _: bool = Depends(get_current_admin),
):
    comment = db.query(ReviewComment).filter(ReviewComment.id == comment_id).first()
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


@router.get("/api/column-templates")
async def get_review_templates(
    db: Session = Depends(get_db),
    _: bool = Depends(get_current_admin),
):
    rows = (
        db.query(ReviewTemplate)
                .order_by(
            ReviewTemplate.sort_order.asc(),
            ReviewTemplate.created_at.asc(),
            ReviewTemplate.id.asc(),
        )
        .all()
    )
    return [
        {
            "id": row.id,
            "name": row.name,
            "slug": row.slug,
            "description": row.description,
            "color": getattr(row, "color", None) or "#3B82F6",
            "sort_order": int(getattr(row, "sort_order", 0) or 0),
            "created_at": row.created_at,
            "updated_at": row.updated_at,
        }
        for row in rows
    ]


@router.post("/api/column-templates")
async def create_review_template(
    payload: ReviewTemplateBase,
    db: Session = Depends(get_db),
    _: bool = Depends(get_current_admin),
):
    template_slug = _build_unique_template_slug(db, name=payload.name)
    max_sort = db.query(func.max(ReviewTemplate.sort_order)).scalar()
    next_sort = int(max_sort or 0) + 1 if max_sort is not None else 0
    template = ReviewTemplate(
        name=payload.name,
        slug=template_slug,
        description=payload.description,
        color=(payload.color or "#3B82F6").strip() or "#3B82F6",
        sort_order=payload.sort_order if payload.sort_order is not None else next_sort,
        created_at=now_str(),
        updated_at=now_str(),
    )
    db.add(template)
    db.commit()
    db.refresh(template)
    return {"id": template.id}


@router.put("/api/column-templates/sort")
async def update_review_templates_sort(
    request: ReviewTemplateSortRequest,
    db: Session = Depends(get_db),
    _: bool = Depends(get_current_admin),
):
    try:
        for item in request.items:
            template = db.query(ReviewTemplate).filter(ReviewTemplate.id == item.id).first()
            if template:
                template.sort_order = item.sort_order
                template.updated_at = now_str()
        db.commit()
        return {"message": "排序更新成功"}
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.put("/api/column-templates/{template_id}")
async def update_review_template(
    template_id: str,
    payload: ReviewTemplateUpdate,
    db: Session = Depends(get_db),
    _: bool = Depends(get_current_admin),
):
    template = (
        db.query(ReviewTemplate)
                .filter(ReviewTemplate.id == template_id)
        .first()
    )
    if not template:
        raise HTTPException(status_code=404, detail="专栏不存在")
    for field in ("name", "description", "color", "sort_order"):
        value = getattr(payload, field)
        if value is not None:
            setattr(template, field, value)
    template.updated_at = now_str()
    db.commit()
    db.refresh(template)
    return {"success": True}




@router.delete("/api/column-templates/{template_id}")
async def delete_review_template(
    template_id: str,
    db: Session = Depends(get_db),
    _: bool = Depends(get_current_admin),
):
    template = (
        db.query(ReviewTemplate)
                .filter(ReviewTemplate.id == template_id)
        .first()
    )
    if not template:
        raise HTTPException(status_code=404, detail="专栏不存在")
    db.delete(template)
    db.commit()
    return {"success": True}




@router.post("/api/column-templates/{template_id}/run-manual")
async def run_review_template_manual(
    template_id: str,
    payload: ReviewTemplateManualRunRequest,
    db: Session = Depends(get_db),
    _: bool = Depends(get_current_admin),
):
    template = (
        db.query(ReviewTemplate)
                .filter(ReviewTemplate.id == template_id)
        .first()
    )
    if not template:
        raise HTTPException(status_code=404, detail="专栏不存在")
    issue, task_id = review_service.enqueue_manual_issue_task(
        db,
        template,
        title=payload.title,
    )
    return {
        "success": True,
        "task_id": task_id,
        "issue_id": issue.id,
        "issue_slug": issue.slug,
    }


@router.get("/api/column-issues/{issue_id}")
async def get_review_issue_detail(
    issue_id: str,
    db: Session = Depends(get_db),
    _: bool = Depends(get_current_admin),
):
    issue = review_service.get_issue_by_id(db, issue_id)
    return review_service.serialize_issue_detail(db, issue, is_admin=True)


@router.put("/api/column-issues/{issue_id}")
async def update_review_issue(
    issue_id: str,
    payload: ReviewIssueUpdateRequest,
    db: Session = Depends(get_db),
    _: bool = Depends(get_current_admin),
):
    issue = review_service.get_issue_by_id(db, issue_id)
    updated = review_service.update_issue(
        db,
        issue,
        title=payload.title,
        published_at=payload.published_at,
        top_image=payload.top_image,
        markdown_content=payload.markdown_content,
    )
    return review_service.serialize_issue_detail(db, updated, is_admin=True)



@router.post("/api/column-issues/{issue_id}/publish")
async def publish_review_issue(
    issue_id: str,
    db: Session = Depends(get_db),
    _: bool = Depends(get_current_admin),
):
    issue = review_service.get_issue_by_id(db, issue_id)
    issue = review_service.publish_issue(db, issue)
    return {"success": True, "status": issue.status}


@router.post("/api/column-issues/{issue_id}/unpublish")
async def unpublish_review_issue(
    issue_id: str,
    db: Session = Depends(get_db),
    _: bool = Depends(get_current_admin),
):
    issue = review_service.get_issue_by_id(db, issue_id)
    issue = review_service.unpublish_issue(db, issue)
    return {"success": True, "status": issue.status}


@router.delete("/api/column-issues/{issue_id}")
async def delete_review_issue(
    issue_id: str,
    db: Session = Depends(get_db),
    _: bool = Depends(get_current_admin),
):
    issue = review_service.get_issue_by_id(db, issue_id)
    db.delete(issue)
    db.commit()
    return {"success": True}


# Legacy review path aliases for transition period.
_LEGACY_PATH_ALIASES = {
    "/api/columns": "/api/reviews",
    "/api/columns/rss.xml": "/api/reviews/rss.xml",
    "/api/columns/{review_slug}": "/api/reviews/{review_slug}",
    "/api/columns/{review_slug}/export.md": "/api/reviews/{review_slug}/export.md",
    "/api/columns/{review_slug}/view": "/api/reviews/{review_slug}/view",
    "/api/columns/{review_slug}/comments": "/api/reviews/{review_slug}/comments",
    "/api/column-templates": "/api/review-templates",
    "/api/column-templates/sort": "/api/review-templates/sort",
    "/api/column-templates/{template_id}": "/api/review-templates/{template_id}",
    "/api/column-templates/{template_id}/run-manual": "/api/review-templates/{template_id}/run-manual",
    "/api/column-issues/{issue_id}": "/api/review-issues/{issue_id}",
    "/api/column-issues/{issue_id}/publish": "/api/review-issues/{issue_id}/publish",
    "/api/column-issues/{issue_id}/unpublish": "/api/review-issues/{issue_id}/unpublish",
    "/api/column-comments/{comment_id}": "/api/review-comments/{comment_id}",
    "/api/column-comments/{comment_id}/visibility": "/api/review-comments/{comment_id}/visibility",
}


def _register_legacy_review_path_aliases() -> None:
    for route in list(router.routes):
        path = getattr(route, "path", None)
        methods = getattr(route, "methods", None)
        endpoint = getattr(route, "endpoint", None)
        if not path or not methods or endpoint is None:
            continue
        legacy_path = _LEGACY_PATH_ALIASES.get(path)
        if not legacy_path:
            continue
        for method in methods:
            if method in {"HEAD", "OPTIONS"}:
                continue
            router.add_api_route(
                legacy_path,
                endpoint,
                methods=[method],
                include_in_schema=False,
                name=f"legacy_{getattr(route, 'name', endpoint.__name__)}_{method.lower()}",
            )


_register_legacy_review_path_aliases()

