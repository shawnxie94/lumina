# EXTENSION UTILS AGENTS

## OVERVIEW
Shared helper layer for extension API calls, extraction pipeline, popup state utilities, and language/error tooling.

## STRUCTURE
```
extension/utils/
├── api.ts               # Fetch wrapper + auth headers + health checks
├── articleExtractor.ts  # Readability + selection extraction
├── contentScript.ts     # Content script loader/injection helpers
├── dateParser.ts        # Date normalization helpers
├── errorLogger.ts       # Error capture + persistence
├── history.ts           # Recent capture history helpers
├── i18n.ts              # zh-CN/en translation and language storage
├── markdownConverter.ts # HTML-to-markdown conversion
├── markdownImages.ts    # Markdown image normalization helpers
└── siteAdapters.ts      # Site-specific parsing rules
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| API requests | `extension/utils/api.ts` | Uses chrome storage for token |
| Extraction entry | `extension/utils/articleExtractor.ts` | Main extraction behavior before upload |
| Content-script readiness | `extension/utils/contentScript.ts` | Inject/reuse content script bridge |
| Site parsing rules | `extension/utils/siteAdapters.ts` | Large, per-site logic |
| Markdown conversion | `extension/utils/markdownConverter.ts` | Shared HTML -> markdown conversion |
| Markdown image handling | `extension/utils/markdownImages.ts` | URL/media cleanup helpers |
| Error logging | `extension/utils/errorLogger.ts` | Popup-visible error timeline |
| Capture history | `extension/utils/history.ts` | Popup "recent captures" list |
| Language handling | `extension/utils/i18n.ts` | Translate UI strings and persist setting |

## CONVENTIONS
- Keep adapter logic isolated per site; avoid cross-site coupling.
- Favor pure helpers in utils; side effects belong in entrypoints.
- Keep storage keys stable (`apiHost`, `adminToken`, `ui_language`) for popup compatibility.
- Keep formula-related extraction helpers compatible with backend math-preservation preprocessing (`$...$` / `$$...$$` path).

## ANTI-PATTERNS
- Avoid direct DOM/UI coupling inside util modules.
