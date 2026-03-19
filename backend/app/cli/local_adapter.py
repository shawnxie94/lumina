from __future__ import annotations

import asyncio
from typing import Any

from fastapi import HTTPException, Response
from sqlalchemy import create_engine, inspect
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import sessionmaker

from app.cli.common import CLIContext
from app.cli.errors import CLIError, cli_error_from_http_exception

REQUIRED_TABLES = {
    "admin_settings",
    "ai_analyses",
    "ai_task_events",
    "ai_tasks",
    "articles",
    "categories",
    "model_api_configs",
    "prompt_configs",
}


def _sqlite_connect_args(database_url: str | None) -> dict[str, Any]:
    if not database_url or not database_url.startswith("sqlite"):
        return {}
    return {"check_same_thread": False, "timeout": 5}


class LocalAdapter:
    def __init__(self, ctx: CLIContext):
        self.ctx = ctx
        self._custom_engine = None
        self._session_factory = None

    def close(self) -> None:
        if self._custom_engine is not None:
            self._custom_engine.dispose()

    def _get_engine_and_session_factory(self):
        if self._session_factory is not None:
            return self._custom_engine, self._session_factory

        if self.ctx.database_url:
            engine = create_engine(
                self.ctx.database_url,
                connect_args=_sqlite_connect_args(self.ctx.database_url),
            )
            self._custom_engine = engine
            self._session_factory = sessionmaker(
                autocommit=False,
                autoflush=False,
                bind=engine,
            )
            return self._custom_engine, self._session_factory

        from models import SessionLocal, engine

        self._custom_engine = engine
        self._session_factory = SessionLocal
        return self._custom_engine, self._session_factory

    def _new_session(self):
        _engine, session_factory = self._get_engine_and_session_factory()
        return session_factory()

    def _ensure_ready(self) -> None:
        doctor = self.system_doctor()
        if not doctor["database"]["connected"]:
            raise CLIError(
                code="database_unreachable",
                message="数据库连接失败",
                exit_code=3,
                details=doctor,
            )
        missing_tables = doctor["database"]["missing_tables"]
        if missing_tables:
            raise CLIError(
                code="database_not_ready",
                message="数据库未初始化完成，请先执行 lumina-cli db migrate",
                exit_code=3,
                details=doctor,
            )

    def _run(self, coro):
        try:
            return asyncio.run(coro)
        except HTTPException as exc:
            raise cli_error_from_http_exception(exc) from exc
        except CLIError:
            raise
        except Exception as exc:
            raise CLIError(
                code="local_command_failed",
                message=str(exc),
                exit_code=5,
            ) from exc

    def system_doctor(self) -> dict[str, Any]:
        engine, _session_factory = self._get_engine_and_session_factory()
        connected = False
        missing_tables: list[str] = []
        initialized = False
        database_error: str | None = None
        try:
            with engine.connect() as connection:
                connection.exec_driver_sql("SELECT 1")
            connected = True
            inspector = inspect(engine)
            existing = set(inspector.get_table_names())
            missing_tables = sorted(REQUIRED_TABLES - existing)
            if "admin_settings" in existing:
                from models import AdminSettings

                session = self._new_session()
                try:
                    initialized = (
                        session.query(AdminSettings.id).limit(1).first() is not None
                    )
                finally:
                    session.close()
        except SQLAlchemyError as exc:
            database_error = str(exc)

        return {
            "database": {
                "database_url": self.ctx.database_url or "default",
                "connected": connected,
                "missing_tables": missing_tables,
                "error": database_error,
            },
            "auth": {
                "initialized": initialized,
            },
            "advice": {
                "migrate_command": "lumina-cli db migrate",
            },
        }

    def db_migrate(self) -> dict[str, Any]:
        from app.core.db_migrations import run_db_migrations

        run_db_migrations(self.ctx.database_url)
        return {
            "success": True,
            "database_url": self.ctx.database_url or "default",
            "revision": "head",
        }

    def article_list(self, args) -> dict[str, Any]:
        self._ensure_ready()
        from app.api.routers.article_router import get_articles

        session = self._new_session()
        try:
            payload = self._run(
                get_articles(
                    response=Response(),
                    page=args.page,
                    size=args.size,
                    category_id=args.category_id,
                    search=args.search,
                    source_domain=args.source_domain,
                    author=args.author,
                    is_visible=args.is_visible,
                    published_at_start=args.published_at_start,
                    published_at_end=args.published_at_end,
                    created_at_start=args.created_at_start,
                    created_at_end=args.created_at_end,
                    sort_by=args.sort_by,
                    db=session,
                    is_admin=True,
                )
            )
            return {"items": payload["data"], "pagination": payload["pagination"]}
        finally:
            session.close()

    def article_get(self, args) -> dict[str, Any]:
        self._ensure_ready()
        from app.api.routers.article_router import get_article

        session = self._new_session()
        try:
            return self._run(
                get_article(
                    article_slug=args.article_slug,
                    response=Response(),
                    db=session,
                    is_admin=True,
                )
            )
        finally:
            session.close()

    def article_create(self, args, payload: dict[str, Any]) -> dict[str, Any]:
        self._ensure_ready()
        from app.api.routers.article_router import create_article
        from app.schemas.article import ArticleCreate

        session = self._new_session()
        try:
            model = ArticleCreate(**payload)
            return self._run(create_article(model, db=session, _=True))
        finally:
            session.close()

    def article_report_url(self, args, payload: dict[str, Any]) -> dict[str, Any]:
        self._ensure_ready()
        from app.api.routers.article_router import report_article_by_url
        from app.schemas.article import ArticleReportByUrlRequest

        session = self._new_session()
        try:
            model = ArticleReportByUrlRequest(**payload)
            return self._run(report_article_by_url(model, db=session, _=True))
        finally:
            session.close()

    def article_update(self, args, payload: dict[str, Any]) -> dict[str, Any]:
        self._ensure_ready()
        from app.api.routers.article_router import update_article
        from app.schemas.article import ArticleUpdate

        session = self._new_session()
        try:
            model = ArticleUpdate(**payload)
            if not model.model_fields_set:
                raise CLIError(
                    code="empty_update",
                    message="article update 至少需要一个更新字段",
                    exit_code=2,
                )
            return self._run(
                update_article(args.article_slug, model, db=session, _=True)
            )
        finally:
            session.close()

    def article_delete(self, args) -> dict[str, Any]:
        self._ensure_ready()
        from app.api.routers.article_router import delete_article

        session = self._new_session()
        try:
            return self._run(delete_article(args.article_slug, db=session, _=True))
        finally:
            session.close()

    def article_export(self, args) -> dict[str, Any]:
        self._ensure_ready()
        from app.domain.article_query_service import ArticleQueryService
        from app.schemas.article import ExportRequest

        payload = ExportRequest(
            article_slugs=args.article_slugs,
            category_id=args.category_id,
            search=args.search,
            source_domain=args.source_domain,
            author=args.author,
            is_visible=args.is_visible,
            published_at_start=args.published_at_start,
            published_at_end=args.published_at_end,
            created_at_start=args.created_at_start,
            created_at_end=args.created_at_end,
        )
        if payload.article_slugs is None and not payload.has_filter_conditions():
            raise CLIError(
                code="bad_request",
                message="未提供 article_slugs 时，至少需要一个筛选条件",
                exit_code=2,
            )

        public_base_url = getattr(args, "public_base_url", None)
        session = self._new_session()
        try:
            service = ArticleQueryService()
            if payload.article_slugs is not None:
                content = service.export_articles(
                    session,
                    payload.article_slugs,
                    public_base_url=public_base_url,
                )
            else:
                content = service.export_articles_by_filters(
                    session,
                    category_id=payload.category_id,
                    search=payload.search,
                    source_domain=payload.source_domain,
                    author=payload.author,
                    is_visible=payload.is_visible,
                    published_at_start=payload.published_at_start,
                    published_at_end=payload.published_at_end,
                    created_at_start=payload.created_at_start,
                    created_at_end=payload.created_at_end,
                    is_admin=True,
                    public_base_url=public_base_url,
                )
            return {"content": content, "filename": "articles_export.md"}
        finally:
            session.close()

    def article_retry(self, args) -> dict[str, Any]:
        self._ensure_ready()
        from app.api.routers.article_router import retry_article_ai

        session = self._new_session()
        try:
            return self._run(
                retry_article_ai(
                    args.article_slug,
                    model_config_id=args.model_config_id,
                    prompt_config_id=args.prompt_config_id,
                    db=session,
                    _=True,
                )
            )
        finally:
            session.close()

    def article_retry_translation(self, args) -> dict[str, Any]:
        self._ensure_ready()
        from app.api.routers.article_router import retry_article_translation

        session = self._new_session()
        try:
            return self._run(
                retry_article_translation(
                    args.article_slug,
                    model_config_id=args.model_config_id,
                    prompt_config_id=args.prompt_config_id,
                    db=session,
                    _=True,
                )
            )
        finally:
            session.close()

    def article_generate(self, args) -> dict[str, Any]:
        self._ensure_ready()
        from app.api.routers.article_router import generate_ai_content

        session = self._new_session()
        try:
            return self._run(
                generate_ai_content(
                    args.article_slug,
                    args.content_type,
                    model_config_id=args.model_config_id,
                    prompt_config_id=args.prompt_config_id,
                    db=session,
                    _=True,
                )
            )
        finally:
            session.close()

    def category_list(self, args) -> list[dict[str, Any]]:
        self._ensure_ready()
        from app.api.routers.category_router import get_categories

        session = self._new_session()
        try:
            return self._run(get_categories(response=Response(), db=session))
        finally:
            session.close()

    def task_list(self, args) -> dict[str, Any]:
        self._ensure_ready()
        from app.api.routers.ai_tasks_router import list_ai_tasks

        session = self._new_session()
        try:
            payload = self._run(
                list_ai_tasks(
                    page=args.page,
                    size=args.size,
                    status=args.status,
                    task_type=args.task_type,
                    content_type=args.content_type,
                    article_id=args.article_id,
                    article_title=args.article_title,
                    db=session,
                    _=True,
                )
            )
            return {"items": payload["data"], "pagination": payload["pagination"]}
        finally:
            session.close()

    def task_get(self, args) -> dict[str, Any]:
        self._ensure_ready()
        from app.api.routers.ai_tasks_router import get_ai_task

        session = self._new_session()
        try:
            return self._run(get_ai_task(args.task_id, db=session, _=True))
        finally:
            session.close()

    def task_timeline(self, args) -> dict[str, Any]:
        self._ensure_ready()
        from app.api.routers.ai_tasks_router import get_ai_task_timeline

        session = self._new_session()
        try:
            return self._run(get_ai_task_timeline(args.task_id, db=session, _=True))
        finally:
            session.close()

    def task_retry(self, args, payload: dict[str, Any]) -> dict[str, Any]:
        self._ensure_ready()
        from app.api.routers.ai_tasks_router import retry_ai_tasks
        from app.schemas.ai import AITaskRetryRequest

        session = self._new_session()
        try:
            model = AITaskRetryRequest(**payload)
            return self._run(retry_ai_tasks(model, db=session, _=True))
        finally:
            session.close()

    def task_cancel(self, args, payload: dict[str, Any]) -> dict[str, Any]:
        self._ensure_ready()
        from app.api.routers.ai_tasks_router import cancel_ai_tasks
        from app.schemas.ai import AITaskCancelRequest

        session = self._new_session()
        try:
            model = AITaskCancelRequest(**payload)
            return self._run(cancel_ai_tasks(model, db=session, _=True))
        finally:
            session.close()
