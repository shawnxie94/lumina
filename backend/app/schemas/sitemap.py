from typing import Literal

from pydantic import BaseModel


class SitemapItem(BaseModel):
    id: str
    slug: str | None = None
    lastmod: str | None = None


class SitemapPage(BaseModel):
    items: list[SitemapItem]
    next_cursor: str | None = None


SitemapKind = Literal["articles", "categories", "columns"]
