from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials
from sqlalchemy import String, cast, desc, func, literal, or_, select, union_all
from sqlalchemy.orm import Session

from app.core.dependencies import (
    comments_enabled,
    contains_sensitive_word,
    get_admin_or_internal,
    get_sensitive_words,
    normalize_date_bound,
    require_internal_token,
)
from app.domain.article_query_service import ArticleQueryService
from app.domain.comment_utils import build_user_github_url
from app.schemas import CommentCreate, CommentUpdate, CommentVisibilityUpdate
from auth import check_is_admin, get_current_admin, security
from models import Article, ArticleComment, ReviewComment, ReviewIssue, get_db, now_str

router = APIRouter()
article_query_service = ArticleQueryService()


def _collect_article_comment_descendant_ids(db: Session, root_comment_id: str) -> list[str]:
    pending_parent_ids = [root_comment_id]
    descendant_ids: list[str] = []
    seen_ids: set[str] = set()

    while pending_parent_ids:
        child_rows = (
            db.query(ArticleComment.id)
            .filter(ArticleComment.reply_to_id.in_(pending_parent_ids))
            .all()
        )
        child_ids = [row[0] for row in child_rows if row[0] not in seen_ids]
        if not child_ids:
            break
        descendant_ids.extend(child_ids)
        seen_ids.update(child_ids)
        pending_parent_ids = child_ids

    return descendant_ids


def _apply_common_comment_filters(
    select_stmt,
    comment_model,
    *,
    query: str | None = None,
    author: str | None = None,
    created_start: str | None = None,
    created_end: str | None = None,
    is_hidden: bool | None = None,
    has_reply: bool | None = None,
    after: str | None = None,
    visible_only: bool = False,
):
    filters = []
    if author:
        filters.append(comment_model.user_name.contains(author))
    if query:
        filters.append(
            or_(
                comment_model.content.contains(query),
                comment_model.user_name.contains(query),
            )
        )

    start_bound = normalize_date_bound(created_start, False)
    end_bound = normalize_date_bound(created_end, True)
    if start_bound:
        filters.append(comment_model.created_at >= start_bound)
    if end_bound:
        filters.append(comment_model.created_at <= end_bound)
    if after:
        filters.append(comment_model.created_at > after)

    if visible_only:
        filters.append((comment_model.is_hidden == False) | (comment_model.is_hidden.is_(None)))
    elif is_hidden is not None:
        filters.append(comment_model.is_hidden == bool(is_hidden))
    if has_reply is True:
        filters.append(comment_model.reply_to_id.isnot(None))
    if has_reply is False:
        filters.append(comment_model.reply_to_id.is_(None))
    if filters:
        select_stmt = select_stmt.where(*filters)
    return select_stmt


def _null_string_column(label: str):
    return cast(literal(None), String).label(label)


def _build_admin_comment_union(
    *,
    query: str | None = None,
    article_title: str | None = None,
    author: str | None = None,
    created_start: str | None = None,
    created_end: str | None = None,
    is_hidden: bool | None = None,
    has_reply: bool | None = None,
    after: str | None = None,
    visible_only: bool = False,
):
    article_stmt = select(
        ArticleComment.id.label("id"),
        literal("article").label("resource_type"),
        Article.title.label("resource_title"),
        ArticleComment.article_id.label("article_id"),
        Article.slug.label("article_slug"),
        Article.title.label("article_title"),
        _null_string_column("review_id"),
        _null_string_column("review_slug"),
        _null_string_column("review_title"),
        ArticleComment.user_id.label("user_id"),
        ArticleComment.user_name.label("user_name"),
        ArticleComment.github_username.label("github_username"),
        ArticleComment.user_avatar.label("user_avatar"),
        ArticleComment.provider.label("provider"),
        ArticleComment.content.label("content"),
        ArticleComment.reply_to_id.label("reply_to_id"),
        ArticleComment.is_hidden.label("is_hidden"),
        ArticleComment.created_at.label("created_at"),
        ArticleComment.updated_at.label("updated_at"),
    ).select_from(ArticleComment).join(Article, Article.id == ArticleComment.article_id)
    if article_title:
        article_stmt = article_stmt.where(Article.title.contains(article_title))
    article_stmt = _apply_common_comment_filters(
        article_stmt,
        ArticleComment,
        query=query,
        author=author,
        created_start=created_start,
        created_end=created_end,
        is_hidden=is_hidden,
        has_reply=has_reply,
        after=after,
        visible_only=visible_only,
    )

    review_stmt = select(
        ReviewComment.id.label("id"),
        literal("review").label("resource_type"),
        ReviewIssue.title.label("resource_title"),
        _null_string_column("article_id"),
        _null_string_column("article_slug"),
        _null_string_column("article_title"),
        ReviewComment.issue_id.label("review_id"),
        ReviewIssue.slug.label("review_slug"),
        ReviewIssue.title.label("review_title"),
        ReviewComment.user_id.label("user_id"),
        ReviewComment.user_name.label("user_name"),
        ReviewComment.github_username.label("github_username"),
        ReviewComment.user_avatar.label("user_avatar"),
        ReviewComment.provider.label("provider"),
        ReviewComment.content.label("content"),
        ReviewComment.reply_to_id.label("reply_to_id"),
        ReviewComment.is_hidden.label("is_hidden"),
        ReviewComment.created_at.label("created_at"),
        ReviewComment.updated_at.label("updated_at"),
    ).select_from(ReviewComment).join(ReviewIssue, ReviewIssue.id == ReviewComment.issue_id)
    if article_title:
        review_stmt = review_stmt.where(ReviewIssue.title.contains(article_title))
    review_stmt = _apply_common_comment_filters(
        review_stmt,
        ReviewComment,
        query=query,
        author=author,
        created_start=created_start,
        created_end=created_end,
        is_hidden=is_hidden,
        has_reply=has_reply,
        after=after,
        visible_only=visible_only,
    )

    return union_all(article_stmt, review_stmt).subquery()


def _serialize_admin_comment_row(row: Any) -> dict[str, Any]:
    payload = dict(row._mapping)
    payload["is_hidden"] = bool(payload.get("is_hidden"))
    payload["user_github_url"] = build_user_github_url(
        payload.get("provider"),
        payload.get("user_id"),
        payload.get("github_username"),
        payload.get("user_name"),
    )
    return payload


@router.get("/api/articles/{article_slug}/comments")
async def get_article_comments(
    article_slug: str,
    include_hidden: bool = False,
    request: Request = None,
    db: Session = Depends(get_db),
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
):
    if not comments_enabled(db):
        raise HTTPException(status_code=403, detail="评论已关闭")
    article = article_query_service.get_article_by_slug(db, article_slug)
    if not article:
        raise HTTPException(status_code=404, detail="文章不存在")

    is_admin = False
    if include_hidden and request is not None:
        is_admin = bool(check_is_admin(request=request, credentials=credentials, db=db))

    query = db.query(ArticleComment).filter(ArticleComment.article_id == article.id)
    if not is_admin:
        query = query.filter(
            (ArticleComment.is_hidden == False) | (ArticleComment.is_hidden.is_(None))
        )

    comments = query.order_by(ArticleComment.created_at.asc()).all()
    return [
        {
            "id": comment.id,
            "article_id": comment.article_id,
            "article_slug": article.slug,
            "user_id": comment.user_id,
            "user_name": comment.user_name,
            "user_avatar": comment.user_avatar,
            "user_github_url": build_user_github_url(
                comment.provider,
                comment.user_id,
                comment.github_username,
                comment.user_name,
            ),
            "provider": comment.provider,
            "content": comment.content,
            "reply_to_id": comment.reply_to_id,
            "is_hidden": bool(comment.is_hidden),
            "created_at": comment.created_at,
            "updated_at": comment.updated_at,
        }
        for comment in comments
    ]


@router.post("/api/articles/{article_slug}/comments")
async def create_article_comment(
    article_slug: str,
    payload: CommentCreate,
    db: Session = Depends(get_db),
    _: bool = Depends(require_internal_token),
):
    if not comments_enabled(db):
        raise HTTPException(status_code=403, detail="评论已关闭")
    article = article_query_service.get_article_by_slug(db, article_slug)
    if not article:
        raise HTTPException(status_code=404, detail="文章不存在")

    content = payload.content.strip()
    if not content:
        raise HTTPException(status_code=400, detail="评论内容不能为空")
    if len(content) > 1000:
        raise HTTPException(status_code=400, detail="评论内容过长")

    filter_enabled, words = get_sensitive_words(db)
    if filter_enabled and words and contains_sensitive_word(content, words):
        raise HTTPException(status_code=400, detail="评论包含敏感词")

    comment = ArticleComment(
        article_id=article.id,
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

    return {
        "id": comment.id,
        "article_id": comment.article_id,
        "user_id": comment.user_id,
        "user_name": comment.user_name,
        "user_avatar": comment.user_avatar,
        "user_github_url": build_user_github_url(
            comment.provider,
            comment.user_id,
            comment.github_username,
            comment.user_name,
        ),
        "provider": comment.provider,
        "content": comment.content,
        "reply_to_id": comment.reply_to_id,
        "is_hidden": bool(comment.is_hidden),
        "created_at": comment.created_at,
        "updated_at": comment.updated_at,
    }


@router.get("/api/comments/{comment_id}")
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


@router.get("/api/comments")
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
    admin_comment_rows = _build_admin_comment_union(
        query=query,
        article_title=article_title,
        author=author,
        created_start=created_start,
        created_end=created_end,
        is_hidden=is_hidden,
        has_reply=has_reply,
    )
    total = int(db.execute(select(func.count()).select_from(admin_comment_rows)).scalar() or 0)
    rows = db.execute(
        select(admin_comment_rows)
        .order_by(
            desc(admin_comment_rows.c.created_at),
            desc(admin_comment_rows.c.updated_at),
            desc(admin_comment_rows.c.id),
        )
        .offset((page - 1) * size)
        .limit(size)
    ).all()
    page_items = [_serialize_admin_comment_row(row) for row in rows]

    return {
        "items": page_items,
        "pagination": {
            "page": page,
            "size": size,
            "total": total,
            "total_pages": (total + size - 1) // size,
        },
    }


@router.put("/api/comments/{comment_id}")
async def update_comment(
    comment_id: str,
    payload: CommentUpdate,
    db: Session = Depends(get_db),
    _: bool = Depends(require_internal_token),
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


@router.delete("/api/comments/{comment_id}")
async def delete_comment(
    comment_id: str,
    db: Session = Depends(get_db),
    _: bool = Depends(get_admin_or_internal),
):
    if not comments_enabled(db):
        raise HTTPException(status_code=403, detail="评论已关闭")
    comment = db.query(ArticleComment).filter(ArticleComment.id == comment_id).first()
    if not comment:
        raise HTTPException(status_code=404, detail="评论不存在")

    deleted = 1
    descendant_ids = _collect_article_comment_descendant_ids(db, comment.id)
    if descendant_ids:
        deleted += (
            db.query(ArticleComment)
            .filter(ArticleComment.id.in_(descendant_ids))
            .delete(synchronize_session=False)
        )

    db.delete(comment)
    db.commit()
    return {"success": True, "deleted": deleted}


@router.put("/api/comments/{comment_id}/visibility")
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


@router.get("/api/comments/admin/notifications")
async def get_comment_notifications(
    after: Optional[str] = None,
    db: Session = Depends(get_db),
    _: bool = Depends(get_current_admin),
):
    """Get recent comments for admin notifications."""
    admin_comment_rows = _build_admin_comment_union(after=after, visible_only=True)
    rows = db.execute(
        select(admin_comment_rows)
        .order_by(
            desc(admin_comment_rows.c.created_at),
            desc(admin_comment_rows.c.updated_at),
            desc(admin_comment_rows.c.id),
        )
        .limit(50)
    ).all()
    return [_serialize_admin_comment_row(row) for row in rows]


@router.get("/api/comments/notifications")
async def get_comment_notifications_deprecated(
    after: Optional[str] = None,
    db: Session = Depends(get_db),
    _: bool = Depends(get_current_admin),
):
    """Deprecated: Use /api/comments/admin/notifications instead."""
    return await get_comment_notifications(after=after, db=db, _=True)
