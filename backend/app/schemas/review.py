from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, ConfigDict


class ReviewSchemaModel(BaseModel):
    model_config = ConfigDict(protected_namespaces=())


class ReviewTemplateBase(ReviewSchemaModel):
    name: str
    description: Optional[str] = None
    color: str = "#3B82F6"
    sort_order: int = 0


class ReviewTemplateUpdate(ReviewSchemaModel):
    name: Optional[str] = None
    description: Optional[str] = None
    color: Optional[str] = None
    sort_order: Optional[int] = None


class ReviewIssueUpdateRequest(ReviewSchemaModel):
    title: Optional[str] = None
    published_at: Optional[str] = None
    top_image: Optional[str] = None
    markdown_content: str


class ReviewTemplateManualRunRequest(ReviewSchemaModel):
    title: Optional[str] = None


class ReviewTemplateSortItem(ReviewSchemaModel):
    id: str
    sort_order: int


class ReviewTemplateSortRequest(ReviewSchemaModel):
    items: list[ReviewTemplateSortItem]
