# EXTENSION AGENTS
**Updated:** 2026-02-25 22:22 Asia/Shanghai (`6573af1`)

## OVERVIEW
WXT-based browser extension with popup/background/content entrypoints, script-driven extraction, and local helper modules for history/errors/i18n.

## STRUCTURE
```
extension/
├── entrypoints/         # popup + background + content entrypoints
├── utils/               # API/extraction/history/error/i18n helpers
├── styles/              # Popup CSS
├── public/icon/         # Extension icons
├── types/               # Shared TS request/response types
├── scripts/             # Dev verification scripts
└── wxt.config.ts        # Manifest + build config
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Popup UI flow | `extension/entrypoints/popup/main.js` | Main capture flow |
| Background context menu | `extension/entrypoints/background.ts` | One-click capture entry |
| Content extraction | `extension/entrypoints/content.ts` | Defuddle default cascade + soft quality/fallback |
| Defuddle adapter | `extension/utils/defuddleExtract.ts` | Defuddle/full + first-party contentMarkdown (no custom turndown) |
| Shadow flatten | `extension/utils/flattenShadowDom.ts` + `public/flatten-shadow-dom.js` | MAIN-world stamp for isolated content scripts |
| API wrapper | `extension/utils/api.ts` | Token storage + headers |
| Capture history + logs | `extension/utils/history.ts` `extension/utils/errorLogger.ts` | Popup recent list and diagnostics |
| Popup i18n switch | `extension/utils/i18n.ts` | zh-CN/en translation helpers |
| WXT manifest | `extension/wxt.config.ts` | Permissions + build target |

## LOAD EXTENSION
- Build output: `extension/.output/chrome-mv3` (WXT `outDir: .output`). Load **unpacked** from this folder in Chrome.
- 
## CONVENTIONS
- Entry points are file-based: each page has its own `index.html` + `main.js` + CSS.
- Background/content entrypoints are TypeScript (`background.ts`, `content.ts`); UI entrypoints use `main.js`.
- API host and token are stored in `chrome.storage.local`.
- Use `chrome.scripting.executeScript` for extraction; no persistent content scripts.
- Keep extension-facing strings translatable via `utils/i18n.ts`.
- Default extraction uses Defuddle (`defuddle` npm), not site adapters or Readability.
- For math-heavy pages, keep extraction fallback that retains MathML/MathJax before handing content to backend cleaning.
- See `docs/trd/browser-article-extraction-simplification.md` for cascade + soft quality-gate design.

## ANTI-PATTERNS
- Avoid embedding backend endpoint strings in popup logic when `ApiClient` already encapsulates them.

## NOTES
- `entrypoints/content.ts` is large; keep changes task-scoped.
- Site adapters were removed; do not reintroduce a large per-site adapter table without an evidence-driven TRD.
- Keep extension `defuddle` version aligned with `backend/package.json` and `scripts/defuddle-version.txt` (`python scripts/check_defuddle_version_sync.py`).
- Extension verification relies on manual browser loading/testing (`npm run dev` + load unpacked extension).

## EXTRACTION VERIFICATION
- `npm run verify:extraction` — Defuddle golden HTML fixtures (not a substitute for live page QA)
- Live checklist: `docs/trd/browser-article-extraction-sample-checklist.md`
- Upgrade steps: `docs/trd/browser-article-extraction-simplification.md` §12
