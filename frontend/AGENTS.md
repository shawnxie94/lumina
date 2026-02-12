# FRONTEND AGENTS

## OVERVIEW
Next.js 14 pages-router frontend with Tailwind + Ant Design, shared API helpers, and bilingual UI (`zh-CN`/`en`).

## STRUCTURE
```
frontend/
├── components/      # Shared UI components
├── contexts/        # Auth + basic settings providers
├── lib/             # API client + i18n + notifications
├── pages/           # Route-level pages + Next API routes
├── styles/          # Global CSS + theme tokens
├── public/          # Fonts and static assets
└── features/        # Reserved feature-split directories (currently scaffolding)
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| API client + token helpers | `frontend/lib/api.ts` | Axios instance + typed modules |
| API base/runtime resolution | `frontend/lib/api.ts` | Handles localhost vs `/backend` origin routing |
| Language dictionary | `frontend/lib/i18n.ts` | Core zh-CN/en translation keys |
| Notification center store | `frontend/lib/notifications.ts` | API and UI event notifications |
| Auth state + gating | `frontend/contexts/AuthContext.tsx` | Provider + login/setup |
| Site config context | `frontend/contexts/BasicSettingsContext.tsx` | Site name/logo/default language |
| Toasts + notifications | `frontend/components/Toast.tsx` | Toast provider + animation |
| Global theme tokens | `frontend/styles/globals.css` | CSS variables + font-face |
| Tailwind theme mapping | `frontend/tailwind.config.js` | CSS vars → Tailwind |
| Page-specific guidance | `frontend/pages/AGENTS.md` | Large pages + UI flows |

## CONVENTIONS
- API auth token stored in `localStorage` key `admin_token`; axios adds `Authorization: Bearer`.
- UI language preference is persisted in `localStorage` key `ui_language`.
- Prefer `useI18n().t(...)` for user-facing strings instead of hardcoded literal text.
- Tailwind colors/radii/shadows are mapped to CSS variables in `frontend/styles/globals.css`.
- Font family is `LXGW WenKai Mono` loaded from `frontend/public/fonts/LXGWWenKaiMono.ttf`.

## ANTI-PATTERNS
- Do not hardcode backend origin; use helpers in `frontend/lib/api.ts`.
- Avoid broad rewrites of very large page files unless scoped to requested behavior.
