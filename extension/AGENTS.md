# EXTENSION AGENTS

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
| Content extraction | `extension/entrypoints/content.ts` | Scripted extraction pipeline + formula-preserving fallback |
| Per-site adapters | `extension/utils/siteAdapters.ts` | Site-specific rules |
| Readability extraction | `extension/utils/articleExtractor.ts` | Core extraction helpers |
| API wrapper | `extension/utils/api.ts` | Token storage + headers |
| Capture history + logs | `extension/utils/history.ts` `extension/utils/errorLogger.ts` | Popup recent list and diagnostics |
| Popup i18n switch | `extension/utils/i18n.ts` | zh-CN/en translation helpers |
| WXT manifest | `extension/wxt.config.ts` | Permissions + build target |

## CONVENTIONS
- Entry points are file-based: each page has its own `index.html` + `main.js` + CSS.
- Background/content entrypoints are TypeScript (`background.ts`, `content.ts`); UI entrypoints use `main.js`.
- API host and token are stored in `chrome.storage.local`.
- Use `chrome.scripting.executeScript` for extraction; no persistent content scripts.
- Keep extension-facing strings translatable via `utils/i18n.ts`.
- For math-heavy pages, keep extraction fallback that retains MathML/MathJax before handing content to backend cleaning.

## ANTI-PATTERNS
- Avoid embedding backend endpoint strings in popup logic when `ApiClient` already encapsulates them.

## NOTES
- `entrypoints/content.ts` and `utils/siteAdapters.ts` are >500 lines; avoid refactors while fixing bugs.
