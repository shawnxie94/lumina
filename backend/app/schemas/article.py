from typing import Optional

from pydantic import BaseModel


class ArticleCreate(BaseModel):
    title: str
    content_html: Optional[str] = None
    content_structured: Optional[dict] = None
    content_md: Optional[str] = None
    source_url: Optional[str] = None
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
    category_id: Optional[str] = None


class ArticleVisibilityUpdate(BaseModel):
    is_visible: bool


class ArticleBatchVisibility(BaseModel):
    article_slugs: list[str]
    is_visible: bool


class ArticleBatchCategory(BaseModel):
    article_slugs: list[str]
    category_id: Optional[str] = None


class ArticleBatchDelete(BaseModel):
    article_slugs: list[str]


class ArticleNotesUpdate(BaseModel):
    note_content: Optional[str] = None
    annotations: Optional[list[dict]] = None


class ExportRequest(BaseModel):
    article_slugs: list[str]
