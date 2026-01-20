# AGENTS.md - Coding Guide for Agentic Work

## Project Overview
Article Database System - Multi-part system: Next.js frontend, FastAPI backend, WXT browser extension.

---

## Build/Lint/Test Commands

### Frontend (Next.js)
```bash
cd frontend
npm run dev          # Start development server
npm run build        # Build for production
npm run lint         # Run ESLint (Next.js default)
```

### Backend (FastAPI/Python)
```bash
cd backend
uv sync                      # Install dependencies
uv run uvicorn main:app --reload    # Start dev server
```

### Extension (WXT)
```bash
cd extension
npm run dev          # Start development mode
npm run build        # Build extension
```

### Docker
```bash
docker-compose up -d    # Start all services
docker-compose down     # Stop all services
```

### Testing (NOT CONFIGURED)
⚠️ No testing framework configured. Add before critical changes:

**Frontend/Extension:**
```bash
npm install --save-dev vitest
# Add to package.json: "test": "vitest"
# Run single test: npx vitest path/to/test.spec.ts -t "test_name"
```

**Backend:**
```bash
uv add pytest pytest-asyncio httpx
# Run single test: uv run pytest tests/test_file.py::test_function_name
# Run filtered: uv run pytest tests/ -k "test_name"
```

---

## Code Style Guidelines

### TypeScript/JavaScript (Frontend & Extension)

**Imports:** React → Third-party → Local with blank lines between groups. Use `@/` alias for frontend root paths. Type imports: `import type { Name }`.

```typescript
import { useState, useEffect } from 'react';
import axios from 'axios';
import { articleApi, type Article } from '@/lib/api';
```

**Naming:** Components: PascalCase, Functions: camelCase, Variables: camelCase, Constants: UPPER_SNAKE_CASE, Interfaces: PascalCase. Files: camelCase for utilities, PascalCase for components.

**Formatting:** 2-space indentation, semicolons consistent, line length <100 chars, Tailwind CSS for styling.

**TypeScript:** `interface` for objects, `type` for unions/primitives, type all params/returns, avoid `any` - use `unknown`, strict mode enabled.

**Error Handling:**
```typescript
try { await api.doSomething(); }
catch (error) { console.error('Failed:', error); alert('操作失败'); }
```

### Python (Backend)

**Imports:** Standard lib → Third-party → Local with blank lines between.

**Naming:** Classes: PascalCase, Functions: snake_case, Variables: snake_case, Constants: UPPER_SNAKE_CASE. Files: snake_case.

**Formatting:** 4-space indentation, max line length 88 chars (PEP 8), type hints required on all functions: `def func(x: str) -> int:`

**Error Handling:**
```python
try: result = do_something()
except ValueError as e: raise HTTPException(status_code=404, detail=str(e))
except Exception as e: raise HTTPException(status_code=400, detail=str(e))
```

---

## Key Patterns

**API Calls (Frontend):** Use axios from `lib/api.ts`, define types first, try/catch with user feedback.

**Database Operations (Backend):** SQLAlchemy ORM, session from `get_db()` dependency injection, always `db.commit()` after changes, use relationships: `article.category.name`.

**React Components:** Functional components with hooks, state for data, effects for side effects, destructure props. Event handlers: `handle*` (handleDelete, handleSave). Fetch functions: `fetch*` (fetchArticles, fetchCategories).

---

## Project Structure

```
article-database/
├── backend/          # FastAPI backend (models.py, ai_client.py, article_service.py, main.py)
├── frontend/         # Next.js frontend (pages/, lib/, package.json)
├── extension/        # WXT browser extension (entrypoints/, types/, utils/)
└── data/             # SQLite database (gitignored)
```

---

## Development Notes

**Environment Variables:** Backend: `OPENAI_API_KEY` (required). Frontend: `NEXT_PUBLIC_API_URL` (defaults to localhost:8000). Extension: API host in chrome.storage.local.

**Database:** SQLite in `data/articles.db`, models auto-created on startup, no migrations - manual schema changes.

**Adding Features:** 1. Modify `backend/models.py`, 2. Add routes in `backend/main.py`, 3. Add service methods in `backend/article_service.py`, 4. Update types in `frontend/lib/api.ts`, 5. Update frontend components.

**UI Language:** All user-facing text and error messages in Chinese (e.g., "操作失败", "删除成功").

---

## Important Warnings

- ⚠️ No tests configured - add tests before critical changes
- ⚠️ No Prettier/Black configured - add formatting tools
- ⚠️ Extension uses chrome APIs - test in actual browser
- ⚠️ AI features require valid OpenAI API key
- ⚠️ Docker volumes persist - use `docker-compose down -v` to reset

---

## Quick Reference

| Task | Command |
|------|---------|
| Start all | `docker-compose up -d` |
| Frontend dev | `cd frontend && npm run dev` |
| Backend dev | `cd backend && uv run uvicorn main:app --reload` |
| Extension dev | `cd extension && npm run dev` |
| Lint frontend | `cd frontend && npm run lint` |
| Load extension | Chrome: `chrome://extensions/` → Load unpacked → `.output/chrome-mv3` |
| Run single test (after setup) | `uv run pytest tests/test_file.py::test_function_name` |
