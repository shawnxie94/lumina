from fastapi import FastAPI, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, List
from models import get_db, init_db, Category, Article, AIConfig
from article_service import ArticleService
from sqlalchemy.orm import Session

app = FastAPI(title="文章知识库API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

article_service = ArticleService()


class ArticleCreate(BaseModel):
    title: str
    content_html: str
    content_md: str
    source_url: str
    top_image: Optional[str] = None
    author: Optional[str] = None
    published_at: Optional[str] = None
    source_domain: Optional[str] = None
    category_id: Optional[str] = None


class CategoryCreate(BaseModel):
    name: str
    description: Optional[str] = None
    color: Optional[str] = None
    sort_order: Optional[int] = 0


class ExportRequest(BaseModel):
    article_ids: List[str]


class AIConfigBase(BaseModel):
    category_id: Optional[str] = None
    dimension: str
    is_enabled: bool = True
    model_name: str = "gpt-4o"
    prompt_template: Optional[str] = None
    parameters: Optional[str] = None


@app.on_event("startup")
async def startup_event():
    init_db()


@app.post("/api/articles")
async def create_article(article: ArticleCreate, db: Session = Depends(get_db)):
    try:
        article_id = article_service.create_article(article.dict(), db)
        return {"id": article_id, "status": "processing"}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/api/articles")
async def get_articles(
    page: int = 1,
    size: int = 20,
    category_id: Optional[str] = None,
    search: Optional[str] = None,
    db: Session = Depends(get_db),
):
    articles, total = article_service.get_articles(db, page, size, category_id, search)
    return {
        "data": [
            {
                "id": a.id,
                "title": a.title,
                "summary": a.ai_analysis.summary if a.ai_analysis else "",
                "top_image": a.top_image,
                "category": {"id": a.category.id, "name": a.category.name}
                if a.category
                else None,
                "author": a.author,
                "status": a.status,
                "created_at": a.created_at,
            }
            for a in articles
        ],
        "pagination": {
            "page": page,
            "size": size,
            "total": total,
            "total_pages": (total + size - 1) // size,
        },
    }


@app.get("/api/articles/{article_id}")
async def get_article(article_id: str, db: Session = Depends(get_db)):
    article = article_service.get_article(db, article_id)
    if not article:
        raise HTTPException(status_code=404, detail="文章不存在")

    return {
        "id": article.id,
        "title": article.title,
        "content_html": article.content_html,
        "content_md": article.content_md,
        "content_trans": article.content_trans,
        "source_url": article.source_url,
        "top_image": article.top_image,
        "category": {"id": article.category.id, "name": article.category.name}
        if article.category
        else None,
        "author": article.author,
        "status": article.status,
        "created_at": article.created_at,
        "ai_analysis": {
            "summary": article.ai_analysis.summary if article.ai_analysis else None
        }
        if article.ai_analysis
        else None,
    }


@app.delete("/api/articles/{article_id}")
async def delete_article(article_id: str, db: Session = Depends(get_db)):
    article = db.query(Article).filter(Article.id == article_id).first()
    if not article:
        raise HTTPException(status_code=404, detail="文章不存在")

    db.delete(article)
    db.commit()
    return {"message": "删除成功"}


@app.post("/api/articles/{article_id}/retry")
async def retry_article_ai(article_id: str, db: Session = Depends(get_db)):
    try:
        article_id = article_service.retry_article_ai(db, article_id)
        return {"id": article_id, "status": "processing"}
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/api/categories")
async def get_categories(db: Session = Depends(get_db)):
    categories = db.query(Category).order_by(Category.sort_order).all()
    return [
        {
            "id": c.id,
            "name": c.name,
            "description": c.description,
            "color": c.color,
            "article_count": len(c.articles),
        }
        for c in categories
    ]


@app.post("/api/categories")
async def create_category(category: CategoryCreate, db: Session = Depends(get_db)):
    try:
        new_category = Category(**category.dict())
        db.add(new_category)
        db.commit()
        db.refresh(new_category)
        return {"id": new_category.id, "name": new_category.name}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.delete("/api/categories/{category_id}")
async def delete_category(category_id: str, db: Session = Depends(get_db)):
    category = db.query(Category).filter(Category.id == category_id).first()
    if not category:
        raise HTTPException(status_code=404, detail="分类不存在")

    db.delete(category)
    db.commit()
    return {"message": "删除成功"}


@app.post("/api/export")
async def export_articles(request: ExportRequest, db: Session = Depends(get_db)):
    try:
        markdown_content = article_service.export_articles(db, request.article_ids)
        return {"content": markdown_content, "filename": "articles_export.md"}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/api/configs/ai")
async def get_ai_configs(
    category_id: Optional[str] = None, db: Session = Depends(get_db)
):
    query = db.query(AIConfig)

    if category_id:
        query = query.filter(AIConfig.category_id == category_id)

    configs = query.all()

    return [
        {
            "id": c.id,
            "category_id": c.category_id,
            "dimension": c.dimension,
            "is_enabled": c.is_enabled,
            "model_name": c.model_name,
            "prompt_template": c.prompt_template,
            "parameters": c.parameters,
        }
        for c in configs
    ]


@app.put("/api/configs/ai/{config_id}")
async def update_ai_config(
    config_id: str, config: AIConfigBase, db: Session = Depends(get_db)
):
    ai_config = db.query(AIConfig).filter(AIConfig.id == config_id).first()

    if not ai_config:
        raise HTTPException(status_code=404, detail="AI配置不存在")

    ai_config.category_id = config.category_id
    ai_config.dimension = config.dimension
    ai_config.is_enabled = config.is_enabled
    ai_config.model_name = config.model_name
    ai_config.prompt_template = config.prompt_template
    ai_config.parameters = config.parameters

    db.commit()
    db.refresh(ai_config)

    return {
        "id": ai_config.id,
        "category_id": ai_config.category_id,
        "dimension": ai_config.dimension,
        "is_enabled": ai_config.is_enabled,
        "model_name": ai_config.model_name,
        "prompt_template": ai_config.prompt_template,
        "parameters": ai_config.parameters,
    }


@app.get("/")
async def root():
    return {"message": "文章知识库API", "version": "1.0.0"}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
