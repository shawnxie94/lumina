import os

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from app.core.http import configure_cors, configure_request_middleware
from app.core.settings import get_settings, validate_startup_settings


def create_app() -> FastAPI:
    settings = get_settings()
    validate_startup_settings(settings)

    from app.api.router_registry import register_routers
    from models import init_db

    media = settings.media

    app = FastAPI(title="文章知识库API", version="1.0.0")

    app.mount(
        media.normalized_base_url,
        StaticFiles(directory=media.root, check_dir=False),
        name="media",
    )

    configure_request_middleware(app)
    configure_cors(app)

    @app.on_event("startup")
    async def startup_event():
        init_db()
        os.makedirs(media.root, exist_ok=True)

    register_routers(app)
    return app


app = create_app()
