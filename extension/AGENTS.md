# EXTENSION AGENTS
**Updated:** 2026-07-22 18:01 Asia/Shanghai (`25404b1`)

## OVERVIEW
WXT-based browser extension with popup/background/content entrypoints, Defuddle-first extraction, and local helper modules for history/errors/i18n.

## STRUCTURE
```
extension/
├── entrypoints/         # popup + background + content entrypoints
├── utils/               # API/extraction/history/error/i18n helpers
├── styles/              # Popup CSS
├── public/              # Icons + MAIN-world helper scripts
├── types/               # Shared TS request/response types
├── scripts/             # Build helpers + extraction fixtures
└── wxt.config.ts        # Manifest + build config (outDir: .output)
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Popup UI flow | `extension/entrypoints/popup/main.js` | Main capture flow |
| Background context menu | `extension/entrypoints/background.ts` | One-click capture entry |
| Content extraction | `extension/entrypoints/content.ts` | Defuddle cascade; empty-only URL fallback |
| Defuddle adapter | `extension/utils/defuddleExtract.ts` | `defuddle/full` + first-party `contentMarkdown` (no custom turndown) |
| Shadow flatten | `extension/utils/flattenShadowDom.ts` + `public/flatten-shadow-dom.js` | MAIN-world stamp for isolated content scripts |
| API wrapper | `extension/utils/api.ts` | Token storage + headers |
| Capture history + logs | `extension/utils/history.ts` `extension/utils/errorLogger.ts` | Popup recent list and diagnostics |
| Popup i18n switch | `extension/utils/i18n.ts` | zh-CN/en translation helpers |
| WXT manifest | `extension/wxt.config.ts` | Permissions + build target + esbuild charset |
| ASCII postbuild | `extension/scripts/ensure-js-ascii.mjs` | Chrome content-script UTF-8 safety |

## LOAD EXTENSION
- Build output: `extension/.output/chrome-mv3` (WXT `outDir: .output`). Load **unpacked** from this folder in Chrome.
- Content scripts must stay pure-ASCII after build (postbuild rewrites non-ASCII escapes).

## CONVENTIONS
- Entry points are file-based: each page has its own `index.html` + `main.js` + CSS.
- Background/content entrypoints are TypeScript (`background.ts`, `content.ts`); UI entrypoints use `main.js`.
- API host and token are stored in `chrome.storage.local`.
- Use `chrome.scripting.executeScript` for extraction; no persistent content scripts.
- Keep extension-facing strings translatable via `utils/i18n.ts`.
- Default extraction uses Defuddle (`defuddle` npm pin), not site adapters or Readability.
- Plugin-captured body is final at create; do not depend on backend re-cleaning plugin HTML with Jina.
- For math-heavy pages, keep extraction fallback that retains MathML/MathJax when Defuddle body is empty/weak.

## ANTI-PATTERNS
- Avoid embedding backend endpoint strings in popup logic when `ApiClient` already encapsulates them.
- Do not reintroduce a large per-site adapter table or custom full-article turndown without evidence.

## NOTES
- `entrypoints/content.ts` is large; keep changes task-scoped.
- Keep extension `defuddle` version aligned with `backend/package.json` and `scripts/defuddle-version.txt` (`python3 scripts/check_defuddle_version_sync.py`).
- Extension verification relies on fixture script + manual browser loading (`npm run build` + load unpacked from `.output/chrome-mv3`).

## EXTRACTION VERIFICATION
- `npm run verify:extraction` — Defuddle golden HTML fixtures (not a substitute for live page QA)
- Live QA still needs real pages (WeChat / formula / code / generic)
