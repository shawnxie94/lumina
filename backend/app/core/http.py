import json
import logging
import time
import uuid

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from app.core.settings import get_settings

logger = logging.getLogger("article_api")
if not logger.handlers:
    logging.basicConfig(level=logging.INFO)


def log_event(event: str, request_id: str, **fields) -> None:
    payload = {"event": event, "request_id": request_id, **fields}
    logger.info(json.dumps(payload, ensure_ascii=False))


def configure_cors(app: FastAPI) -> None:
    settings = get_settings()
    allowed_origins = settings.cors_allow_origins
    allow_credentials = "*" not in allowed_origins

    app.add_middleware(
        CORSMiddleware,
        allow_origins=allowed_origins,
        allow_credentials=allow_credentials,
        allow_methods=["*"],
        allow_headers=["*"],
    )


def configure_request_middleware(app: FastAPI) -> None:
    @app.middleware("http")
    async def request_id_middleware(request: Request, call_next):
        request_id = request.headers.get("X-Request-Id") or str(uuid.uuid4())
        request.state.request_id = request_id
        start_time = time.perf_counter()
        log_event(
            "request_start",
            request_id,
            method=request.method,
            path=str(request.url.path),
            client=request.client.host if request.client else None,
        )
        try:
            response = await call_next(request)
        except Exception as exc:
            duration_ms = round((time.perf_counter() - start_time) * 1000, 2)
            log_event(
                "request_error",
                request_id,
                method=request.method,
                path=str(request.url.path),
                duration_ms=duration_ms,
                error=str(exc),
            )
            raise
        duration_ms = round((time.perf_counter() - start_time) * 1000, 2)
        response.headers["X-Request-Id"] = request_id
        log_event(
            "request_end",
            request_id,
            method=request.method,
            path=str(request.url.path),
            status_code=response.status_code,
            duration_ms=duration_ms,
        )
        return response
