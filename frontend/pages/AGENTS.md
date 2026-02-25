# FRONTEND PAGES AGENTS
**Updated:** 2026-02-25 12:36 Asia/Shanghai (`b908bf4`)

## OVERVIEW
Next.js pages-router entry layer; major page files contain most UI state, data fetching, and admin workflows.

## STRUCTURE
```
frontend/pages/
├── index.tsx                 # Landing page + latest content cards
├── list.tsx                  # Article list + filters + batch ops
├── article/[id].tsx          # Article detail + AI panels + comments
├── admin.tsx                 # Admin settings + monitoring + model/prompt/comment/storage
├── login.tsx                 # Admin setup/login page
├── auth/extension.tsx        # Extension auth handoff
└── api/                      # Next API routes (auth + comments proxy)
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Landing page hero/latest | `frontend/pages/index.tsx` | Uses basic settings and latest articles |
| List filters/batch actions | `frontend/pages/list.tsx` | Large, state-heavy page |
| Article detail + AI/comments | `frontend/pages/article/[id].tsx` | Polling + panels + comments + immersive mode |
| Admin console modules | `frontend/pages/admin.tsx` | Basic/AI/categories/monitoring/comments/storage/recommendation refresh |
| Admin setup/login flow | `frontend/pages/login.tsx` | First-time setup + normal login |
| Extension auth flow | `frontend/pages/auth/extension.tsx` | Token handoff |
| NextAuth bootstrap | `frontend/pages/api/auth/[...nextauth].ts` | OAuth providers from backend comment settings |
| Comment API proxy | `frontend/pages/api/comments/[articleId].ts` | Guest reads + logged-in posting flow |

## CONVENTIONS
- Use `articleApi`/`categoryApi` from `frontend/lib/api.ts` for all requests.
- Prefer `useI18n().t(...)` for page text to keep zh-CN/en parity.
- For server-side API routes under `pages/api`, read backend origin from `BACKEND_API_URL`.
- In `admin.tsx`, recommendation settings include a bulk embedding refresh action (scope 500); keep UI state and API response fields aligned.

## ANTI-PATTERNS
- Do not introduce new direct `fetch` calls to backend in page components when typed API helpers already exist.

## NOTES
- `frontend/pages/list.tsx`, `frontend/pages/article/[id].tsx`, and `frontend/pages/admin.tsx` are very large; keep edits minimal and task-scoped.
- When page logic changes are significant, prioritize checking `/`, `/list`, `/article/[id]`, `/admin`, and `/login` flows in local dev.
