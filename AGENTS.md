# PROJECT KNOWLEDGE BASE

**Updated:** 2026-07-22 18:01 Asia/Shanghai
**Commit:** 25404b1
**Branch:** main

## OVERVIEW
Lumina is a content workspace with a Next.js 14 frontend (pages router), FastAPI backend, and WXT extension for web capture, AI reading, columns, RSS, comments, and content operations workflows.

## STRUCTURE
```
./
├── backend/              # FastAPI app, models, worker, migrations (+ local Node Defuddle)
├── frontend/             # Next.js pages router app (web UI + API routes)
├── extension/            # WXT browser extension (Defuddle capture)
├── docs/                 # Ops notes, API notes, assets (no active TRD tree)
├── deploy/               # Deploy helpers (e.g. nginx)
├── scripts/              # Repo-level scripts (docker healthcheck, version sync)
└── data/                 # SQLite database + media volume
```

Nested agent maps (prefer these for domain detail):
- `backend/AGENTS.md`
- `frontend/AGENTS.md` / `frontend/pages/AGENTS.md`
- `extension/AGENTS.md` / `extension/utils/AGENTS.md`

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Backend app entry | `backend/main.py` `backend/app/main.py` | `main.py` exports app; app factory in `backend/app/main.py` |
| Backend API routers | `backend/app/api/routers/` | Routers split by domain, URLs unchanged |
| Backend router wiring | `backend/app/api/router_registry.py` | Mounted under `/backend/api/*` only |
| Backend dependencies/middleware | `backend/app/core/dependencies.py` `backend/app/core/http.py` | Shared auth/internal/cors/request-id logic |
| Backend runtime settings | `backend/app/core/settings.py` | Central env loading + startup fail-fast validation |
| Backend settings reference | `backend/docs/runtime-settings.md` | Runtime env defaults and validation constraints |
| Backend domain services | `backend/app/domain/` | Query/command/AI/task split |
| Article create / ingest commands | `backend/app/domain/article_command_service.py` | Plugin create path does **not** re-clean body with Jina |
| URL / HTML extraction | `backend/app/domain/article_extraction_service.py` | URL ingest: local Defuddle + optional Jina |
| Local Defuddle (Node) | `backend/app/domain/defuddle_local_extractor.py` `backend/scripts/defuddle_extract.mjs` | Needs Node + `backend/node_modules/defuddle` |
| URL ingest orchestration | `backend/app/domain/article_url_ingest_service.py` | report-by-URL path |
| Article digest / writing loop | `backend/app/domain/article_digest.py` | Digest / outline-related backend |
| Reviews | `backend/app/domain/review_service.py` `backend/app/api/routers/review_router.py` | Review workflows |
| Backend language heuristic | `backend/ai_client.py` | `is_english_content` cleaned-text ratio + Han-char guard |
| Backend recommendation refresh API | `backend/app/api/routers/settings_router.py` | Admin embedding rebuild |
| Backend embedding batch logic | `backend/app/domain/article_embedding_service.py` | Model/hash skip logic |
| Backend RSS generation | `backend/app/domain/article_rss_service.py` | Public RSS feed + cache key |
| Backend backup import/export | `backend/app/api/routers/backup_router.py` `backend/app/domain/backup_service.py` | JSON backup stream |
| Backend tag APIs | `backend/app/api/routers/tag_router.py` `backend/app/domain/article_tag_service.py` | Tags + orphan cleanup |
| Backend DB migrations | `backend/alembic/` `backend/scripts/migrate_db.py` | Alembic schema path |
| Backend unit tests | `backend/tests/unit/` | Pytest core/domain/utils |
| Route contract baseline | `backend/scripts/route_contract_baseline.json` | Router signature regression |
| Response contract baseline | `backend/scripts/response_contract_baseline.json` | Response shape regression |
| Defuddle version pin | `scripts/defuddle-version.txt` `scripts/check_defuddle_version_sync.py` | Keep extension + backend exact pin |
| DB models + init | `backend/models.py` | Models + DB setup + defaults |
| AI worker loop | `backend/worker.py` | Background task processor |
| Frontend home page | `frontend/pages/index.tsx` | Hero + latest-article cards |
| Frontend list page | `frontend/pages/list.tsx` | Filters, batch ops, pagination |
| Frontend detail page | `frontend/pages/article/[id].tsx` | AI panels, TOC, notes, tags |
| Frontend columns | `frontend/pages/columns/` | Column list + detail |
| Frontend admin settings | `frontend/pages/admin.tsx` | Model/prompt/admin config UI |
| Frontend admin reviews | `frontend/pages/admin/reviews.tsx` | Review console surface |
| Frontend login/setup | `frontend/pages/login.tsx` | Admin setup + login gate |
| Frontend shared app header | `frontend/components/AppHeader.tsx` | Theme/language, notifications, RSS |
| Frontend comment auth API | `frontend/pages/api/auth/[...nextauth].ts` | OAuth from backend settings |
| Frontend comment proxy API | `frontend/pages/api/comments/[articleId].ts` | Comments proxy |
| Frontend API client | `frontend/lib/api.ts` | Axios base + typed exports |
| Frontend i18n dictionary | `frontend/lib/i18n.ts` | zh-CN/en strings |
| Frontend notification store | `frontend/lib/notifications.ts` | Local persisted notifications |
| Frontend markdown rendering | `frontend/lib/safeHtml.ts` | GFM + math + sanitize + embeds |
| Extension API client | `extension/utils/api.ts` | Fetch wrapper + auth headers |
| Extension popup UI | `extension/entrypoints/popup/main.js` | Main capture flow |
| Extension extraction | `extension/entrypoints/content.ts` `extension/utils/defuddleExtract.ts` | Defuddle + first-party markdown |
| Extension shadow flatten | `extension/utils/flattenShadowDom.ts` | Prep for Defuddle |
| Extension shared helpers | `extension/utils/` | History/error/i18n helpers |
| Ops notes | `docs/` `docs/api/` | Ops/API notes; no `docs/trd/` tree currently |

## ARTICLE EXTRACTION BOUNDARY
- **Browser extension body is final at create time**: plugin-captured `content_html` / `content_md` are stored as-is; do not re-run Jina HTML cleaning on create.
- **Default engine**: Defuddle (`defuddle@0.19.1` pin). Extension uses first-party `contentMarkdown` (no custom turndown / site-adapter table).
- **URL / API ingest** may still use backend local Defuddle and optional Jina via extraction settings.
- **Empty extract only** may fall back to report-by-URL; do not soft-fail quality gates into URL re-fetch by default.
- **Version sync**: extension + backend + `scripts/defuddle-version.txt` must stay exact; check with `python3 scripts/check_defuddle_version_sync.py`.
- Load unpacked extension from `extension/.output/chrome-mv3` (ASCII-safe content scripts via postbuild).

## CODE MAP
| Symbol | Type | Location | Role |
|--------|------|----------|------|
| HomePage | Function | `frontend/pages/index.tsx` | Landing page + latest content feed |
| Home | Function | `frontend/pages/list.tsx` | Article list page controller |
| AppHeader | Function | `frontend/components/AppHeader.tsx` | Global header controls |
| PopupController | Class | `extension/entrypoints/popup/main.js` | Extension popup UI logic |

## CONVENTIONS
- Next.js config sets `reactStrictMode: false` and `images.unoptimized: true`.
- TypeScript uses `strict: true`, `moduleResolution: "bundler"`, `target: "es5"`, `noEmit: true`, `@/*` path alias.
- Backend requires Python 3.11 and keeps runtime entrypoint as `uvicorn main:app`.
- Backend local Defuddle path needs Node 20 + `cd backend && npm ci` (Docker image already installs this).
- Backend startup requires `INTERNAL_API_TOKEN`; app/worker fail fast on invalid runtime settings.
- Backend API routes are served under `/backend/api/*` only.
- Frontend API base resolves at runtime and defaults to `/backend` in same-origin environments.
- Public RSS feed is served from `/backend/api/articles/rss.xml` and supports category/tag filtering.
- Comment OAuth providers are loaded dynamically by `frontend/pages/api/auth/[...nextauth].ts` from backend comment settings.
- Header notifications are persisted in browser localStorage via `frontend/lib/notifications.ts`.
- Markdown rendering uses `remark-math` + `rehype-katex` with `sanitize-html` allowlists.
- WXT manifest enables `<all_urls>` host permissions and devtools; build target `esnext`; output under `.output/`.
- Biome disables `noUnknownAtRules` in `biome.json` and `frontend/biome.json` (Tailwind).
- UI language supports `zh-CN` and `en`, with `ui_language` stored client-side.
- Backend has pytest unit tests under `backend/tests/unit/`; frontend currently has no built-in test scripts; extension has fixture verify script.

## ANTI-PATTERNS (THIS PROJECT)
- Avoid broad refactors in very large files (`frontend/pages/admin.tsx`, `frontend/pages/article/[id].tsx`, `frontend/pages/list.tsx`, `extension/entrypoints/content.ts`) unless task-scoped.
- Do not reintroduce a large per-site adapter table or custom full-article turndown without evidence.
- Do not re-clean plugin-captured body with Jina at create time.
- Do not treat missing Node/defuddle package as silent success for local URL extract quality (falls back to regex).

## UNIQUE STYLES
- Extension uses multi-entrypoint pages (`entrypoints/*/index.html` + `main.js`).
- Extraction uses `chrome.scripting.executeScript` injection; no persistent content scripts.
- API clients are duplicated in frontend and extension; keep endpoints aligned with backend.
- Frontend theme tokens are CSS variables in `frontend/styles/globals.css` mapped into Tailwind.
- Frontend chrome combines theme, language, RSS, and notification controls in `frontend/components/AppHeader.tsx`.
- Recommendation similarity candidate and admin batch-refresh scope are both capped at 500 items.

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
npm ci   # local Defuddle (optional outside Docker)
uv run uvicorn main:app --reload
uv run uvicorn main:app --host 0.0.0.0 --port 8000
uv run python scripts/migrate_db.py
uv run python scripts/check_route_coverage.py --verbose
uv run python scripts/check_response_contract.py --verbose
uv run pytest tests/unit

# Extension
cd extension
npm install
npm run dev
npm run build
npm run verify:extraction
npm run zip
# Load unpacked: extension/.output/chrome-mv3

# Repo checks
python3 scripts/check_defuddle_version_sync.py

# Docker
docker compose up -d
docker compose up -d --build api worker
docker compose down
docker compose down -v
docker compose logs web
docker compose logs api

# One-click startup + healthcheck
./scripts/docker_healthcheck.sh
```

## NOTES
- `docker-compose.yml` defines a separate `worker` service with AI polling env vars; local compose file is gitignored (`docker-compose.yml.example` is the template).
- Compose may also run Neo4j when knowledge-graph features are enabled in the local stack; treat graph services as optional infra unless the task is graph-related.
- `data/` is a persistent SQLite volume; reset with `docker compose down -v`.
- Extension requires manual browser testing via Chrome load unpacked from `.output/chrome-mv3`.
- `frontend/pages/api/auth/[...nextauth].ts` depends on `BACKEND_API_URL` and `INTERNAL_API_TOKEN` to read comment OAuth settings.
- Repo contains generated artifacts: `backend/.venv`, `backend/node_modules`, `backend/.pytest_cache`, `frontend/.next`, `frontend/tsconfig.tsbuildinfo`, `extension/.output`, `extension/.wxt`, `data/articles.db`.
