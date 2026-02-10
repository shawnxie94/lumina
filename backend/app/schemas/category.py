from typing import Optional

from pydantic import BaseModel


class CategoryCreate(BaseModel):
    name: str
    description: Optional[str] = None
    color: Optional[str] = None
    sort_order: Optional[int] = 0


class CategorySortItem(BaseModel):
    id: str
    sort_order: int


class CategorySortRequest(BaseModel):
    items: list[CategorySortItem]
