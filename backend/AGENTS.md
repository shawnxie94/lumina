# BACKEND AGENTS

## OVERVIEW
FastAPI backend with all API routes in `main.py` and SQLAlchemy models in `models.py`.

## STRUCTURE
```
backend/
├── main.py            # FastAPI routes, schemas, dependencies
├── models.py          # ORM models + DB init + defaults
├── article_service.py # Domain logic for articles
├── auth.py            # JWT auth helpers + request models
├── worker.py          # Background AI task loop
└── ai_client.py       # OpenAI client wrapper
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Add or modify API endpoints | `backend/main.py` | All routes are in one file |
| DB schema or defaults | `backend/models.py` | Models + seed defaults |
| Article business logic | `backend/article_service.py` | Keep route handlers thin |
| Auth flows | `backend/auth.py` | JWT creation + verification |
| AI task polling | `backend/worker.py` | Runs via docker-compose worker |

## CONVENTIONS
- All routes are `async def` and use `Depends(get_db)` for sessions.
- User-facing error messages are Chinese.
- DB uses SQLite by default; timestamps are stored as strings.

## ANTI-PATTERNS
- None documented in code comments.

## NOTES
- `docker-compose.yml` runs `worker.py` directly from the venv.
- `pyproject.toml` declares `py-modules` explicitly; add new modules there if needed.
