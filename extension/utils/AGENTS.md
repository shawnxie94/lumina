# EXTENSION UTILS AGENTS

## OVERVIEW
Shared extension helpers for API calls, extraction, and site adapters.

## STRUCTURE
```
extension/utils/
├── api.ts            # Fetch wrapper + auth headers
├── articleQuality.ts # Content quality scoring
├── siteAdapters.ts   # Site-specific parsing rules
├── siteConfig.ts     # Host rules + selectors
└── urlUtils.ts       # URL helpers
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| API requests | `extension/utils/api.ts` | Uses chrome storage for token |
| Site parsing rules | `extension/utils/siteAdapters.ts` | Large, per-site logic |
| Quality warnings | `extension/utils/articleQuality.ts` | Extraction heuristics |
| Host config | `extension/utils/siteConfig.ts` | Adapter mappings |
| URL normalization | `extension/utils/urlUtils.ts` | Shared URL helpers |

## CONVENTIONS
- Keep adapter logic isolated per site; avoid cross-site coupling.
- Favor pure helpers in utils; side effects belong in entrypoints.

## ANTI-PATTERNS
- None documented in code comments.
