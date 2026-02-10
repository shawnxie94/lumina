# PROJECT KNOWLEDGE BASE

**Generated:** 2026-02-05 13:19 Asia/Shanghai
**Commit:** 0d035de
**Branch:** main

## OVERVIEW
Article Database System: Next.js 14 frontend (pages router) + FastAPI backend + WXT extension for capture and AI summarization.

## STRUCTURE
```
./
├── backend/              # FastAPI app, models, worker
├── frontend/             # Next.js pages router (CSR)
├── extension/            # WXT browser extension
├── docs/                 # TRD and project plans
└── data/                 # SQLite database volume
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Backend app entry | `backend/main.py` `backend/app/main.py` | `main.py` exports app; app factory in `backend/app/main.py` |
| Backend API routers | `backend/app/api/routers/` | Routers split by domain, URLs unchanged |
| Backend dependencies/middleware | `backend/app/core/dependencies.py` `backend/app/core/http.py` | Shared auth/internal/cors/request-id logic |
| Backend domain services | `backend/app/domain/` | Query/command/AI/task split |
| Legacy compatibility layer | `backend/app/legacy/` | Transitional old route/service modules |
| DB models + init | `backend/models.py` | Models + DB setup + defaults |
| AI worker loop | `backend/worker.py` | Background task processor |
| Frontend list page | `frontend/pages/index.tsx` | Filters, batch ops, pagination |
| Frontend detail page | `frontend/pages/article/[id].tsx` | AI panels, polling, TOC |
| Frontend settings | `frontend/pages/settings.tsx` | Model/prompt config UI |
| Frontend API client | `frontend/lib/api.ts` | Axios base + typed exports |
| Extension API client | `extension/utils/api.ts` | Fetch wrapper + auth headers |
| Extension popup UI | `extension/entrypoints/popup/main.js` | Main capture flow |
| Extension extraction | `extension/entrypoints/content.ts` `extension/utils/siteAdapters.ts` | Content parsing + adapters |
| Product docs | `docs/trd/trd-optimized.md` `docs/trd/trd-minimal.md` | TRD baselines |

## CODE MAP
| Symbol | Type | Location | Role |
|--------|------|----------|------|
| Home | Function | `frontend/pages/index.tsx` | Article list page controller |
| PopupController | Class | `extension/entrypoints/popup/main.js` | Extension popup UI logic |

## CONVENTIONS
- Next.js config sets `reactStrictMode: false` and `images.unoptimized: true`.
- TypeScript uses `strict: true`, `moduleResolution: "bundler"`, `target: "es5"`, `noEmit: true`, `@/*` path alias.
- Backend requires Python 3.11 and keeps runtime entrypoint as `uvicorn main:app`.
- WXT manifest enables `<all_urls>` host permissions and devtools; build target `esnext`.
- Biome disables `noUnknownAtRules` in `biome.json` and `frontend/biome.json` (Tailwind).
- User-facing text is Chinese; keep alerts and UI strings in Chinese.
- Tests are not configured; no `test` scripts or test configs are present.

## ANTI-PATTERNS (THIS PROJECT)
- No explicit DO NOT/NEVER/ALWAYS/DEPRECATED guidance found.

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
python scripts/check_route_coverage.py --verbose

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
