# PROJECT KNOWLEDGE BASE

**Generated:** 2026-02-12 20:22 Asia/Shanghai
**Commit:** 827a834
**Branch:** main

## OVERVIEW
Lumina is a content workspace with a Next.js 14 frontend (pages router), FastAPI backend, and WXT extension for web capture + AI reading workflows.

## STRUCTURE
```
./
├── backend/              # FastAPI app, models, worker, migrations
├── frontend/             # Next.js pages router app (web UI + API routes)
├── extension/            # WXT browser extension
├── docs/                 # Product docs and screenshots
├── scripts/              # Repo-level scripts (docker healthcheck, etc.)
└── data/                 # SQLite database + media volume
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Backend app entry | `backend/main.py` `backend/app/main.py` | `main.py` exports app; app factory in `backend/app/main.py` |
| Backend API routers | `backend/app/api/routers/` | Routers split by domain, URLs unchanged |
| Backend router wiring | `backend/app/api/router_registry.py` | Routers are mounted for both `/api/*` and `/backend/api/*` |
| Backend dependencies/middleware | `backend/app/core/dependencies.py` `backend/app/core/http.py` | Shared auth/internal/cors/request-id logic |
| Backend runtime settings | `backend/app/core/settings.py` | Central env loading + startup fail-fast validation |
| Backend settings reference | `backend/docs/runtime-settings.md` | Runtime env defaults and validation constraints |
| Backend domain services | `backend/app/domain/` | Query/command/AI/task split |
| Backend DB migrations | `backend/alembic/` `backend/scripts/migrate_db.py` | Alembic-based schema/index upgrade path |
| Route contract baseline | `backend/scripts/route_contract_baseline.json` | API signature regression baseline for modular routers |
| Response contract baseline | `backend/scripts/response_contract_baseline.json` | Key API response shape regression baseline |
| DB models + init | `backend/models.py` | Models + DB setup + defaults |
| AI worker loop | `backend/worker.py` | Background task processor |
| Frontend home page | `frontend/pages/index.tsx` | Hero + latest-article cards |
| Frontend list page | `frontend/pages/list.tsx` | Filters, batch ops, pagination |
| Frontend detail page | `frontend/pages/article/[id].tsx` | AI panels, polling, TOC |
| Frontend admin settings | `frontend/pages/admin.tsx` | Model/prompt/admin config UI |
| Frontend login/setup | `frontend/pages/login.tsx` | Admin setup + login gate |
| Frontend comment auth API | `frontend/pages/api/auth/[...nextauth].ts` | OAuth provider config from backend settings |
| Frontend comment proxy API | `frontend/pages/api/comments/[articleId].ts` | Reads posts comments via Next API route |
| Frontend API client | `frontend/lib/api.ts` | Axios base + typed exports |
| Frontend i18n dictionary | `frontend/lib/i18n.ts` | zh-CN/en string map used across pages |
| Extension API client | `extension/utils/api.ts` | Fetch wrapper + auth headers |
| Extension popup UI | `extension/entrypoints/popup/main.js` | Main capture flow |
| Extension extraction | `extension/entrypoints/content.ts` `extension/utils/siteAdapters.ts` | Content parsing + adapters |
| Extension shared helpers | `extension/utils/` | History/error/i18n/markdown helper modules |
| Product docs | `docs/trd/trd-optimized.md` `docs/trd/trd-minimal.md` | TRD baselines |

## CODE MAP
| Symbol | Type | Location | Role |
|--------|------|----------|------|
| HomePage | Function | `frontend/pages/index.tsx` | Landing page + latest content feed |
| Home | Function | `frontend/pages/list.tsx` | Article list page controller |
| PopupController | Class | `extension/entrypoints/popup/main.js` | Extension popup UI logic |

## CONVENTIONS
- Next.js config sets `reactStrictMode: false` and `images.unoptimized: true`.
- TypeScript uses `strict: true`, `moduleResolution: "bundler"`, `target: "es5"`, `noEmit: true`, `@/*` path alias.
- Backend requires Python 3.11 and keeps runtime entrypoint as `uvicorn main:app`.
- Backend startup requires `INTERNAL_API_TOKEN`; app/worker fail fast on invalid runtime settings.
- Frontend API base resolves at runtime and defaults to `/backend` in same-origin environments.
- WXT manifest enables `<all_urls>` host permissions and devtools; build target `esnext`.
- Biome disables `noUnknownAtRules` in `biome.json` and `frontend/biome.json` (Tailwind).
- UI language supports `zh-CN` and `en`, with `ui_language` stored client-side.
- Tests are not configured; no `test` scripts or test configs are present.

## ANTI-PATTERNS (THIS PROJECT)
- Avoid broad refactors in very large files (`frontend/pages/admin.tsx`, `frontend/pages/article/[id].tsx`, `frontend/pages/list.tsx`) unless task-scoped.

## UNIQUE STYLES
- Extension uses multi-entrypoint pages (`entrypoints/*/index.html` + `main.js`).
- Extraction uses `chrome.scripting.executeScript` injection; no persistent content scripts.
- API clients are duplicated in frontend and extension; keep endpoints aligned with backend.
- Frontend theme tokens are CSS variables in `frontend/styles/globals.css` mapped into Tailwind.

## LOCAL AGENTS
- `backend/AGENTS.md`
- `frontend/AGENTS.md`
- `frontend/pages/AGENTS.md`
- `extension/AGENTS.md`
- `extension/utils/AGENTS.md`

## COMMANDS
```bash
# Frontend
cd frontend
npm install
npm run dev
npm run build
npm run lint

# Backend
cd backend
uv sync
uv run uvicorn main:app --reload
uv run uvicorn main:app --host 0.0.0.0 --port 8000
python scripts/migrate_db.py
python scripts/check_route_coverage.py --verbose
python scripts/check_response_contract.py --verbose

# Extension
cd extension
npm install
npm run dev
npm run build
npm run zip

# Docker
docker-compose up -d
docker-compose down
docker-compose down -v
docker-compose logs web
docker-compose logs api

# One-click startup + healthcheck
./scripts/docker_healthcheck.sh
```

## NOTES
- `docker-compose.yml` defines a separate `worker` service with AI polling env vars.
- `data/` is a persistent SQLite volume; reset with `docker-compose down -v`.
- Extension requires manual browser testing via Chrome extension load.
- `docker-compose.yml` is gitignored; local edits won't show in git status.
- Repo contains generated artifacts: `backend/.venv`, `frontend/.next`, `frontend/tsconfig.tsbuildinfo`, `extension/.output`, `extension/.wxt`, `data/articles.db`.
