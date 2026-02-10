from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.schemas import CategoryCreate, CategorySortRequest
from auth import get_current_admin
from models import Article, Category, get_db

router = APIRouter()


@router.get("/api/categories")
async def get_categories(db: Session = Depends(get_db)):
    categories = db.query(Category).order_by(Category.sort_order).all()
    return [
        {
            "id": c.id,
            "name": c.name,
            "description": c.description,
            "color": c.color,
            "sort_order": c.sort_order,
            "article_count": len(c.articles),
        }
        for c in categories
    ]


@router.get("/api/categories/stats")
async def get_category_stats(
    search: Optional[str] = None,
    source_domain: Optional[str] = None,
    author: Optional[str] = None,
    published_at_start: Optional[str] = None,
    published_at_end: Optional[str] = None,
    created_at_start: Optional[str] = None,
    created_at_end: Optional[str] = None,
    db: Session = Depends(get_db),
):
    stats_query = db.query(
        Article.category_id.label("category_id"),
        func.count(Article.id).label("article_count"),
    )

    if search:
        stats_query = stats_query.filter(Article.title.contains(search))
    if source_domain:
        stats_query = stats_query.filter(Article.source_domain == source_domain)
    if author:
        stats_query = stats_query.filter(Article.author == author)
    if published_at_start:
        stats_query = stats_query.filter(
            func.substr(Article.published_at, 1, 10) >= published_at_start
        )
    if published_at_end:
        stats_query = stats_query.filter(
            func.substr(Article.published_at, 1, 10) <= published_at_end
        )
    if created_at_start:
        stats_query = stats_query.filter(
            func.substr(Article.created_at, 1, 10) >= created_at_start
        )
    if created_at_end:
        stats_query = stats_query.filter(
            func.substr(Article.created_at, 1, 10) <= created_at_end
        )

    stats_subquery = stats_query.group_by(Article.category_id).subquery()
    categories = (
        db.query(
            Category,
            func.coalesce(stats_subquery.c.article_count, 0).label("article_count"),
        )
        .outerjoin(stats_subquery, Category.id == stats_subquery.c.category_id)
        .order_by(Category.sort_order)
        .all()
    )

    return [
        {
            "id": category.id,
            "name": category.name,
            "color": category.color,
            "article_count": article_count,
        }
        for category, article_count in categories
    ]


@router.post("/api/categories")
async def create_category(
    category: CategoryCreate,
    db: Session = Depends(get_db),
    _: bool = Depends(get_current_admin),
):
    try:
        new_category = Category(**category.dict())
        db.add(new_category)
        db.commit()
        db.refresh(new_category)
        return {"id": new_category.id, "name": new_category.name}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.put("/api/categories/sort")
async def update_categories_sort(
    request: CategorySortRequest,
    db: Session = Depends(get_db),
    _: bool = Depends(get_current_admin),
):
    try:
        for item in request.items:
            category = db.query(Category).filter(Category.id == item.id).first()
            if category:
                category.sort_order = item.sort_order
        db.commit()
        return {"message": "排序更新成功"}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))


@router.put("/api/categories/{category_id}")
async def update_category(
    category_id: str,
    category: CategoryCreate,
    db: Session = Depends(get_db),
    _: bool = Depends(get_current_admin),
):
    existing_category = db.query(Category).filter(Category.id == category_id).first()
    if not existing_category:
        raise HTTPException(status_code=404, detail="分类不存在")

    try:
        if category.name is not None:
            existing_category.name = category.name
        if category.description is not None:
            existing_category.description = category.description
        if category.color is not None:
            existing_category.color = category.color
        if category.sort_order is not None:
            existing_category.sort_order = category.sort_order

        db.commit()
        db.refresh(existing_category)
        return {
            "id": existing_category.id,
            "name": existing_category.name,
            "description": existing_category.description,
            "color": existing_category.color,
            "sort_order": existing_category.sort_order,
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.delete("/api/categories/{category_id}")
async def delete_category(
    category_id: str,
    db: Session = Depends(get_db),
    _: bool = Depends(get_current_admin),
):
    category = db.query(Category).filter(Category.id == category_id).first()
    if not category:
        raise HTTPException(status_code=404, detail="分类不存在")

    db.delete(category)
    db.commit()
    return {"message": "删除成功"}
