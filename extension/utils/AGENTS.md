# EXTENSION UTILS AGENTS
**Updated:** 2026-02-25 22:22 Asia/Shanghai (`6573af1`)

## OVERVIEW
Shared helper layer for extension API calls, extraction pipeline, popup state utilities, and language/error tooling.

## STRUCTURE
```
extension/utils/
├── api.ts               # Fetch wrapper + auth headers + health checks
├── contentScript.ts     # Content script loader/injection helpers
├── dateParser.ts        # Date normalization helpers
├── defuddleExtract.ts   # Defuddle/full HTML + first-party markdown
├── errorLogger.ts       # Error capture + persistence
├── flattenShadowDom.ts  # Shadow DOM flatten for extraction
├── history.ts           # Recent capture history helpers
├── i18n.ts              # zh-CN/en translation and language storage
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| API requests | `extension/utils/api.ts` | Uses chrome storage for token |
| Content-script readiness | `extension/utils/contentScript.ts` | Inject/reuse content script bridge |
| Defuddle extract + markdown | `extension/utils/defuddleExtract.ts` | `defuddle/full` HTML + `createMarkdownContent` |
| Shadow DOM prep | `extension/utils/flattenShadowDom.ts` | Used before Defuddle parse |
| Error logging | `extension/utils/errorLogger.ts` | Popup-visible error timeline |
| Capture history | `extension/utils/history.ts` | Popup "recent captures" list |
| Language handling | `extension/utils/i18n.ts` | Translate UI strings and persist setting |

## CONVENTIONS
- Default extraction is Defuddle; do not reintroduce a large site-adapter table without TRD evidence.
- Favor pure helpers in utils; side effects belong in entrypoints.
- Keep storage keys stable (`apiHost`, `adminToken`, `ui_language`) for popup compatibility.
- Keep extension `defuddle` version aligned with backend (`scripts/check_defuddle_version_sync.py`).

## ANTI-PATTERNS
- Avoid direct DOM/UI coupling inside util modules.

## NOTES
- Utility changes should be validated from popup capture flow and content extraction flow together to avoid runtime drift.
