# BACKEND AGENTS

## OVERVIEW
FastAPI backend uses app-factory wiring with modular routers under `backend/app/`, while keeping `main.py` stable for runtime entrypoint compatibility.

## STRUCTURE
```
backend/
├── main.py                     # Entrypoint exporting app/create_app
├── app/
│   ├── main.py                 # App factory + middleware/CORS/startup wiring
│   ├── api/
│   │   ├── router_registry.py  # Central router registration
│   │   └── routers/            # Domain routers (auth/articles/comments/...)
│   ├── core/                   # Shared deps + settings + middleware + cache helpers
│   ├── domain/                 # Service layer (query/command/ai/task/backup/embed)
│   └── schemas/                # Shared Pydantic schemas
├── alembic/                    # Alembic migrations
├── docs/                       # Runtime setting docs
├── scripts/                    # Migration/contract checks
├── models.py                   # ORM models + DB init + defaults
├── auth.py                     # JWT auth helpers
├── worker.py                   # Background AI task loop
└── ai_client.py                # OpenAI client wrapper
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Add or modify API endpoints | `backend/app/api/routers/` | Keep URL/response compatibility |
| Router registration | `backend/app/api/router_registry.py` | New routers must be registered here |
| Prefix strategy | `backend/app/api/router_registry.py` | Routers mount with and without `/backend` prefix |
| Shared dependency helpers | `backend/app/core/dependencies.py` | Auth/internal access/date helpers |
| Middleware/CORS setup | `backend/app/core/http.py` | Request-id logging and CORS config |
| Public list cache | `backend/app/core/public_cache.py` | Anonymous read cache helpers |
| Runtime settings + startup validation | `backend/app/core/settings.py` | Centralized env loading and fail-fast checks |
| Startup migration gate | `backend/app/core/db_migrations.py` | Alembic upgrade on startup flow |
| Runtime settings defaults doc | `backend/docs/runtime-settings.md` | Env var defaults, grouping, and validation rules |
| Domain business logic | `backend/app/domain/` | Query/command/AI pipeline/task split |
| Article embedding/recommendation | `backend/app/domain/article_embedding_service.py` | Embedding generation + recommendation support |
| Backup import/export | `backend/app/domain/backup_service.py` | JSON backup and incremental restore |
| Request/response schemas | `backend/app/schemas/` | Reuse schema types across routers |
| DB migrations | `backend/alembic/` `backend/scripts/migrate_db.py` | Alembic revision + upgrade entrypoint |
| Route contract baseline | `backend/scripts/route_contract_baseline.json` | Guard for API signature coverage |
| Response contract baseline | `backend/scripts/response_contract_baseline.json` | Guard for key API response shape regression |
| Worker orchestration | `backend/worker.py` | Uses `app.domain.ai_task_service` |

## CONVENTIONS
- External API behavior must stay backward compatible during modularization.
- Keep both `/api/*` and `/backend/api/*` entrypoints working unless explicitly removing compatibility.
- Runtime validation is strict; missing/invalid settings should fail fast during startup.
- `INTERNAL_API_TOKEN` is required for startup and internal-only endpoints.
- DB uses SQLite by default; timestamps are stored as strings.
- Keep `main.py` entrypoint stable for `uvicorn main:app` and Docker.
- Load env config from `app/core/settings.py`; app/worker fail fast on invalid startup settings.

## ANTI-PATTERNS
- Do not add new routes outside `backend/app/api/routers/`.
- Do not reintroduce duplicated request models in router files.
- Do not bypass domain services from routers for core article/AI/comment flows.

## COMMANDS
```bash
# DB migration
cd backend
python scripts/migrate_db.py

# Route coverage guard (modular routers vs route contract baseline)
python scripts/check_route_coverage.py --verbose
# (Intentional API route contract update only)
python scripts/check_route_coverage.py --write-baseline

# Response contract guard (HTTP status + key fields)
python scripts/check_response_contract.py --verbose

# One-click docker startup + healthcheck (run from repo root)
../scripts/docker_healthcheck.sh
```

## NOTES
- `docker-compose.yml` runs `worker.py` with system Python in container.
- `pyproject.toml` now includes both flat `py-modules` and `app.*` packages.
- Alembic revisions currently extend through `20260212_0006_ai_advanced_cleaning_options.py`.
