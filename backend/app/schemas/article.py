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
    skip_ai_processing: Optional[bool] = False


class ArticleReportByUrlRequest(BaseModel):
    url: str
    category_id: Optional[str] = None
    is_visible: Optional[bool] = None
    skip_ai_processing: Optional[bool] = False


class ArticleUpdate(BaseModel):
    title: Optional[str] = None
    author: Optional[str] = None
    published_at: Optional[str] = None
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
    article_slugs: Optional[list[str]] = None
    category_id: Optional[str] = None
    search: Optional[str] = None
    source_domain: Optional[str] = None
    author: Optional[str] = None
    is_visible: Optional[bool] = None
    published_at_start: Optional[str] = None
    published_at_end: Optional[str] = None
    created_at_start: Optional[str] = None
    created_at_end: Optional[str] = None

    def has_filter_conditions(self) -> bool:
        if self.is_visible is not None:
            return True
        string_fields = (
            self.category_id,
            self.search,
            self.source_domain,
            self.author,
            self.published_at_start,
            self.published_at_end,
            self.created_at_start,
            self.created_at_end,
        )
        return any((value or "").strip() for value in string_fields)
