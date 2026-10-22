from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.orm import Session

from app.core.dependencies import get_db
from app.core.public_cache import apply_public_cache_headers
from app.domain.sitemap_service import get_sitemap_page
from app.schemas.sitemap import SitemapKind, SitemapPage

router = APIRouter()


@router.get("/api/sitemap/{kind}", response_model=SitemapPage)
def sitemap_page(
    kind: SitemapKind,
    response: Response,
    cursor: str | None = None,
    size: int = Query(default=500, ge=1, le=500),
    db: Session = Depends(get_db),
):
    # XML is cached at the web boundary, keyed by origin; this projection is
    # deliberately credential-independent and does not load ORM relationships.
    result = get_sitemap_page(db, kind, cursor, size)
    apply_public_cache_headers(response)
    return result
