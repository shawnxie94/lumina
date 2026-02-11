from __future__ import annotations

import json
import uuid
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[2]
ENV_FILE = BACKEND_DIR / ".env"
DEFAULT_MEDIA_ROOT = str(BACKEND_DIR / "data" / "media")


@dataclass(frozen=True)
class SecuritySettings:
    internal_api_token: str


@dataclass(frozen=True)
class MediaSettings:
    root: str
    base_url: str
    public_base_url: str
    max_size: int

    @property
    def normalized_base_url(self) -> str:
        base = self.base_url.strip() or "/backend/media"
        if not base.startswith("/"):
            base = f"/{base}"
        return base.rstrip("/") or "/backend/media"


@dataclass(frozen=True)
class AIWorkerSettings:
    poll_interval: float
    lock_timeout: int
    task_timeout: int
    worker_id: str


class AppSettings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(ENV_FILE),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    database_url: str = Field(default="sqlite:///./data/articles.db", alias="DATABASE_URL")
    internal_api_token: str = Field(default="", alias="INTERNAL_API_TOKEN")

    allowed_origins: str = Field(default="", alias="ALLOWED_ORIGINS")

    media_root: str = Field(default=DEFAULT_MEDIA_ROOT, alias="MEDIA_ROOT")
    media_base_url: str = Field(default="/backend/media", alias="MEDIA_BASE_URL")
    media_public_base_url: str = Field(default="", alias="MEDIA_PUBLIC_BASE_URL")
    max_media_size: int = Field(default=8 * 1024 * 1024, alias="MAX_MEDIA_SIZE")

    ai_worker_poll_interval: float = Field(default=3.0, alias="AI_WORKER_POLL_INTERVAL")
    ai_task_lock_timeout: int = Field(default=300, alias="AI_TASK_LOCK_TIMEOUT")
    ai_task_timeout: int = Field(default=900, alias="AI_TASK_TIMEOUT")
    ai_worker_id: str = Field(default_factory=lambda: str(uuid.uuid4()), alias="AI_WORKER_ID")

    @property
    def security(self) -> SecuritySettings:
        return SecuritySettings(internal_api_token=self.internal_api_token.strip())

    @property
    def media(self) -> MediaSettings:
        return MediaSettings(
            root=self.media_root.strip(),
            base_url=self.media_base_url,
            public_base_url=self.media_public_base_url.strip(),
            max_size=self.max_media_size,
        )

    @property
    def ai_worker(self) -> AIWorkerSettings:
        return AIWorkerSettings(
            poll_interval=self.ai_worker_poll_interval,
            lock_timeout=self.ai_task_lock_timeout,
            task_timeout=self.ai_task_timeout,
            worker_id=self.ai_worker_id,
        )

    @property
    def cors_allow_origins(self) -> list[str]:
        raw = self.allowed_origins.strip()
        if not raw:
            return ["http://localhost:3000", "http://127.0.0.1:3000"]
        if raw == "*":
            return ["*"]

        if raw.startswith("["):
            try:
                parsed = json.loads(raw)
            except json.JSONDecodeError:
                parsed = None
            if isinstance(parsed, list):
                return [str(origin).strip() for origin in parsed if str(origin).strip()]

        return [origin.strip() for origin in raw.split(",") if origin.strip()]


def validate_startup_settings(settings: AppSettings) -> None:
    errors: list[str] = []

    if not settings.database_url.strip():
        errors.append("DATABASE_URL 不能为空")

    if not settings.internal_api_token.strip():
        errors.append("INTERNAL_API_TOKEN 不能为空")

    media = settings.media
    if not media.root:
        errors.append("MEDIA_ROOT 不能为空")
    if media.max_size <= 0:
        errors.append("MAX_MEDIA_SIZE 必须为正整数")

    ai_worker = settings.ai_worker
    if ai_worker.poll_interval <= 0:
        errors.append("AI_WORKER_POLL_INTERVAL 必须大于 0")
    if ai_worker.lock_timeout <= 0:
        errors.append("AI_TASK_LOCK_TIMEOUT 必须大于 0")
    if ai_worker.task_timeout <= 0:
        errors.append("AI_TASK_TIMEOUT 必须大于 0")
    if ai_worker.task_timeout < ai_worker.lock_timeout:
        errors.append("AI_TASK_TIMEOUT 不能小于 AI_TASK_LOCK_TIMEOUT")

    media_base = media.base_url.strip()
    if media_base and not media_base.startswith("/"):
        errors.append("MEDIA_BASE_URL 必须以 / 开头")

    media_public = media.public_base_url
    if media_public and not media_public.startswith(("http://", "https://")):
        errors.append("MEDIA_PUBLIC_BASE_URL 必须以 http:// 或 https:// 开头")

    if errors:
        detail = "\n".join(f"- {item}" for item in errors)
        raise RuntimeError(f"启动配置校验失败:\n{detail}")


@lru_cache(maxsize=1)
def get_settings() -> AppSettings:
    return AppSettings()
