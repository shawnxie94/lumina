# EXTENSION AGENTS

## OVERVIEW
WXT-based browser extension with multi-entrypoint UI pages and script-driven extraction.

## STRUCTURE
```
extension/
├── entrypoints/       # popup page + background/content scripts
├── utils/             # API client + site adapters
├── public/icon/       # Extension icons
└── wxt.config.ts      # Manifest + build config
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Popup UI flow | `extension/entrypoints/popup/main.js` | Main capture flow |
| Content extraction | `extension/entrypoints/content.ts` | Scripted extraction pipeline |
| Per-site adapters | `extension/utils/siteAdapters.ts` | Site-specific rules |
| API wrapper | `extension/utils/api.ts` | Token storage + headers |
| WXT manifest | `extension/wxt.config.ts` | Permissions + build target |

## CONVENTIONS
- Entry points are file-based: each page has its own `index.html` + `main.js` + CSS.
- Background/content entrypoints are TypeScript (`background.ts`, `content.ts`); UI entrypoints use `main.js`.
- API host and token are stored in `chrome.storage.local`.
- Use `chrome.scripting.executeScript` for extraction; no persistent content scripts.

## ANTI-PATTERNS
- None documented in code comments.

## NOTES
- `entrypoints/content.ts` and `utils/siteAdapters.ts` are >500 lines; avoid refactors while fixing bugs.
