# BACKEND AGENTS

## OVERVIEW
FastAPI backend now uses app-factory style and modular routers under `backend/app/`, while preserving `main.py` as the runtime entrypoint.

## STRUCTURE
```
backend/
├── main.py                      # Entrypoint exporting app/create_app
├── app/
│   ├── main.py                  # App factory + middleware/CORS/startup wiring
│   ├── api/
│   │   ├── router_registry.py   # Central router registration
│   │   └── routers/             # Domain routers (auth/settings/articles/...)
│   ├── core/                    # Shared dependencies and HTTP middleware setup
│   ├── domain/                  # Split service layer (query/command/ai/task)
│   ├── schemas/                 # Shared Pydantic request models
│   └── legacy/                  # Temporary compatibility modules
├── models.py                    # ORM models + DB init + defaults
├── article_service.py           # Compatibility facade to legacy service
├── auth.py                      # JWT auth helpers
├── worker.py                    # Background AI task loop
└── ai_client.py                 # OpenAI client wrapper
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Add or modify API endpoints | `backend/app/api/routers/` | Keep URL/response compatibility |
| Router registration | `backend/app/api/router_registry.py` | New routers must be registered here |
| Shared dependency helpers | `backend/app/core/dependencies.py` | Auth/internal access/date helpers |
| Middleware/CORS setup | `backend/app/core/http.py` | Request-id logging and CORS config |
| Domain business logic | `backend/app/domain/` | Query/command/AI pipeline/task split |
| DB schema or defaults | `backend/models.py` | Models + seed defaults |
| Legacy compatibility | `backend/app/legacy/` | Transitional source of old routes/services |
| Worker orchestration | `backend/worker.py` | Uses `app.domain.ai_task_service` |

## CONVENTIONS
- External API behavior must stay backward compatible during modularization.
- User-facing error messages remain Chinese.
- DB uses SQLite by default; timestamps are stored as strings.
- Keep `main.py` entrypoint stable for `uvicorn main:app` and Docker.

## ANTI-PATTERNS
- Do not add new routes directly into `backend/app/legacy/legacy_main.py`.

## COMMANDS
```bash
# Route coverage guard (modular routers vs legacy routes)
cd backend
python scripts/check_route_coverage.py --verbose

# One-click docker startup + healthcheck (run from repo root)
../scripts/docker_healthcheck.sh
```

## NOTES
- `docker-compose.yml` runs `worker.py` directly from the venv.
- `pyproject.toml` now includes both legacy `py-modules` and `app.*` packages.
