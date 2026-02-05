# FRONTEND AGENTS

## OVERVIEW
Next.js pages-router frontend with Tailwind UI and shared API client utilities.

## STRUCTURE
```
frontend/
├── components/   # Shared UI components + providers
├── contexts/     # Global state (auth)
├── lib/          # API client + shared helpers
├── pages/        # Route-level pages
├── styles/       # Global CSS + tokens
└── public/       # Fonts and static assets
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| API client + token helpers | `frontend/lib/api.ts` | Axios instance + typed modules |
| Auth state + gating | `frontend/contexts/AuthContext.tsx` | Provider + login/setup |
| Toasts + notifications | `frontend/components/Toast.tsx` | Toast provider + animation |
| Global theme tokens | `frontend/styles/globals.css` | CSS variables + font-face |
| Tailwind theme mapping | `frontend/tailwind.config.js` | CSS vars → Tailwind |
| Page-specific guidance | `frontend/pages/AGENTS.md` | Large pages + UI flows |

## CONVENTIONS
- API auth token stored in `localStorage` key `admin_token`; axios adds `Authorization: Bearer`.
- Tailwind colors/radii/shadows are mapped to CSS variables in `frontend/styles/globals.css`.
- Font family is `LXGW WenKai Mono` loaded from `frontend/public/fonts/LXGWWenKaiMono.ttf`.

## ANTI-PATTERNS
- None documented in code comments.
