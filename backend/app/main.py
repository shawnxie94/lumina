from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from app.api.router_registry import register_routers
from app.core.http import configure_cors, configure_request_middleware
from media_service import MEDIA_BASE_URL, MEDIA_ROOT, ensure_media_root
from models import init_db


def create_app() -> FastAPI:
    app = FastAPI(title="文章知识库API", version="1.0.0")

    app.mount(
        MEDIA_BASE_URL,
        StaticFiles(directory=MEDIA_ROOT, check_dir=False),
        name="media",
    )

    configure_request_middleware(app)
    configure_cors(app)

    @app.on_event("startup")
    async def startup_event():
        init_db()
        ensure_media_root()

    register_routers(app)
    return app


app = create_app()
