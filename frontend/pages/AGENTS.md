# FRONTEND PAGES AGENTS

## OVERVIEW
Next.js pages router; page files hold most UI state and API calls.

## STRUCTURE
```
frontend/pages/
├── list.tsx            # Article list + filters + batch ops
├── article/[id].tsx    # Article detail + AI panels
├── admin.tsx           # Admin settings + monitoring + model/prompt config UI
└── auth/extension.tsx  # Extension auth handoff
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| List filters/batch actions | `frontend/pages/list.tsx` | Large, state-heavy page |
| Article detail + AI results | `frontend/pages/article/[id].tsx` | Polling + panels |
| Model/prompt config | `frontend/pages/admin.tsx` | Admin config flows |
| Extension auth flow | `frontend/pages/auth/extension.tsx` | Token handoff |

## CONVENTIONS
- Use `articleApi`/`categoryApi` from `frontend/lib/api.ts` for all requests.
- User-facing text is Chinese; keep alerts and empty states localized.

## ANTI-PATTERNS
- None documented in code comments.

## NOTES
- `list.tsx` and `article/[id].tsx` are >500 lines; keep edits minimal and scoped.
