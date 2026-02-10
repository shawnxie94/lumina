from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.core.dependencies import (
    comments_enabled,
    contains_sensitive_word,
    get_sensitive_words,
    normalize_date_bound,
)
from app.schemas import CommentCreate, CommentUpdate, CommentVisibilityUpdate
from app.domain.article_query_service import ArticleQueryService
from auth import get_current_admin, security
from models import Article, ArticleComment, get_db, now_str

router = APIRouter()
article_query_service = ArticleQueryService()


@router.get("/api/articles/{article_slug}/comments")
async def get_article_comments(
    article_slug: str,
    include_hidden: bool = False,
    db: Session = Depends(get_db),
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
):
    if not comments_enabled(db):
        raise HTTPException(status_code=403, detail="评论已关闭")
    article = article_query_service.get_article_by_slug(db, article_slug)
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
            "id": comment.id,
            "article_id": comment.article_id,
            "article_slug": article.slug,
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
        for comment in comments
    ]


@router.post("/api/articles/{article_slug}/comments")
async def create_article_comment(
    article_slug: str,
    payload: CommentCreate,
    db: Session = Depends(get_db),
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
    query_stmt = db.query(ArticleComment)

    if article_title:
        matching_articles = (
            db.query(Article.id).filter(Article.title.contains(article_title)).all()
        )
        article_ids = [article.id for article in matching_articles]
        if article_ids:
            query_stmt = query_stmt.filter(ArticleComment.article_id.in_(article_ids))
        else:
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

    article_ids = [comment.article_id for comment in items]
    articles = db.query(Article).filter(Article.id.in_(article_ids)).all()
    article_slug_map = {article.id: article.slug for article in articles}

    return {
        "items": [
            {
                "id": comment.id,
                "article_id": comment.article_id,
                "article_slug": article_slug_map.get(comment.article_id, comment.article_id),
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
            for comment in items
        ],
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
async def delete_comment(comment_id: str, db: Session = Depends(get_db)):
    if not comments_enabled(db):
        raise HTTPException(status_code=403, detail="评论已关闭")
    comment = db.query(ArticleComment).filter(ArticleComment.id == comment_id).first()
    if not comment:
        raise HTTPException(status_code=404, detail="评论不存在")

    deleted = 1
    if comment.reply_to_id is None:
        pending_parent_ids = [comment.id]
        descendant_ids: list[str] = []
        while pending_parent_ids:
            child_rows = (
                db.query(ArticleComment.id)
                .filter(ArticleComment.reply_to_id.in_(pending_parent_ids))
                .all()
            )
            child_ids = [row[0] for row in child_rows]
            if not child_ids:
                break
            descendant_ids.extend(child_ids)
            pending_parent_ids = child_ids

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
