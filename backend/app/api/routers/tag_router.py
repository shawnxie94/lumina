from fastapi import APIRouter, Depends, Response
from sqlalchemy.orm import Session

from app.core.public_cache import (
    CACHE_KEY_TAGS_PUBLIC,
    apply_public_cache_headers,
    get_public_cached,
)
from app.core.dependencies import check_is_admin_or_internal
from app.domain.article_tag_service import ArticleTagService
from models import get_db

router = APIRouter()
article_tag_service = ArticleTagService()


@router.get("/api/tags")
async def get_tags(
    response: Response,
    db: Session = Depends(get_db),
    is_admin: bool = Depends(check_is_admin_or_internal),
):
    if is_admin:
        data = article_tag_service.list_tags_with_count(db, include_hidden=True)
    else:
        data = get_public_cached(
            CACHE_KEY_TAGS_PUBLIC,
            lambda: article_tag_service.list_tags_with_count(
                db,
                include_hidden=False,
            ),
        )
        apply_public_cache_headers(response)
    return data
