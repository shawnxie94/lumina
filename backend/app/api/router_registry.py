from fastapi import FastAPI

from app.api.routers.ai_tasks_router import router as ai_tasks_router
from app.api.routers.ai_usage_router import router as ai_usage_router
from app.api.routers.article_router import router as article_router
from app.api.routers.auth_router import router as auth_router
from app.api.routers.backup_router import router as backup_router
from app.api.routers.category_router import router as category_router
from app.api.routers.comment_router import router as comment_router
from app.api.routers.export_router import router as export_router
from app.api.routers.health_router import router as health_router
from app.api.routers.media_router import router as media_router
from app.api.routers.model_api_router import router as model_api_router
from app.api.routers.prompt_config_router import router as prompt_config_router
from app.api.routers.settings_router import router as settings_router

BACKEND_PREFIX = "/backend"


def register_routers(app: FastAPI) -> None:
    prefix = BACKEND_PREFIX
    app.include_router(auth_router, prefix=prefix)
    app.include_router(settings_router, prefix=prefix)
    app.include_router(media_router, prefix=prefix)
    app.include_router(article_router, prefix=prefix)
    app.include_router(comment_router, prefix=prefix)
    app.include_router(ai_tasks_router, prefix=prefix)
    app.include_router(ai_usage_router, prefix=prefix)
    app.include_router(category_router, prefix=prefix)
    app.include_router(backup_router, prefix=prefix)
    app.include_router(export_router, prefix=prefix)
    app.include_router(model_api_router, prefix=prefix)
    app.include_router(prompt_config_router, prefix=prefix)

    app.include_router(health_router, prefix=prefix)
