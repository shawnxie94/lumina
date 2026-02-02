# AGENTS.md - Coding Guide for Agentic Work

## Project Overview
Article Database System - AI-powered personal knowledge base with browser extension for article collection, automatic AI summarization, and category management.

**Architecture:** Next.js 14 frontend (CSR) + FastAPI backend + WXT browser extension

---

## Build/Lint/Test Commands

### Frontend (Next.js 14)
```bash
cd frontend
npm install              # Install dependencies
npm run dev              # Start dev server (localhost:3000)
npm run build            # Build for production
npm run lint             # Run ESLint
```

### Backend (FastAPI + uv)
```bash
cd backend
uv sync                              # Install dependencies
uv run uvicorn main:app --reload     # Start dev server (localhost:8000)
uv run uvicorn main:app --host 0.0.0.0 --port 8000  # Production
```

### Extension (WXT)
```bash
cd extension
npm install              # Install dependencies
npm run dev              # Dev mode with hot reload
npm run build            # Build extension
npm run zip              # Package for distribution
```

### Docker
```bash
docker-compose up -d         # Start all services
docker-compose down          # Stop all
docker-compose down -v       # Stop + remove volumes (reset DB)
docker-compose logs web      # Frontend logs
docker-compose logs api      # Backend logs
```

### Testing (Not Yet Configured)
```bash
# Frontend - add vitest:
npm install --save-dev vitest
npx vitest path/to/test.spec.ts              # Run single file
npx vitest path/to/test.spec.ts -t "name"    # Run single test

# Backend - add pytest:
uv add --dev pytest pytest-asyncio httpx
uv run pytest tests/test_file.py::test_name  # Run single test
uv run pytest tests/ -k "pattern"            # Run filtered tests
```

---

## Code Style Guidelines

### TypeScript (Frontend)

**Imports:** React → Third-party → Local (with blank lines). Use `@/` path alias.
```typescript
import { useState, useEffect } from 'react';

import Link from 'next/link';
import axios from 'axios';

import { articleApi, categoryApi, type Article, type Category } from '@/lib/api';
```

**Naming:**
- Components/Pages: `PascalCase` (e.g., `Home`, `ArticleDetail`)
- Functions/Variables: `camelCase` (e.g., `fetchArticles`, `selectedCategory`)
- Event handlers: `handle*` prefix (e.g., `handleDelete`, `handleSearch`)
- Fetch functions: `fetch*` prefix (e.g., `fetchArticles`, `fetchCategories`)
- Files: `camelCase.ts` for utils, `PascalCase.tsx` for components

**Types:** Use `interface` for objects, `type` for unions. Always type function params/returns.
```typescript
interface Article { id: string; title: string; }
type Status = 'pending' | 'completed' | 'failed';
const fetchArticles = async (): Promise<Article[]> => { ... }
```

**Formatting:** 2-space indent, Tailwind CSS classes, <100 char lines.

**Error Handling:** Console log + Chinese user alerts.
```typescript
try {
  await articleApi.deleteArticle(id);
} catch (error) {
  console.error('Failed to delete article:', error);
  alert('删除失败');
}
```

### Python (Backend)

**Imports:** Standard → Third-party → Local (with blank lines).
```python
from typing import Optional, List
from datetime import datetime

from fastapi import FastAPI, HTTPException, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from models import get_db, Article, Category
from article_service import ArticleService
```

**Naming:**
- Classes: `PascalCase` (e.g., `ArticleCreate`, `ModelAPIConfig`)
- Functions/Variables: `snake_case` (e.g., `get_articles`, `category_id`)
- Constants: `UPPER_SNAKE_CASE` (e.g., `DATABASE_URL`)
- Files: `snake_case.py`

**Formatting:** 4-space indent, line length 88 (ruff configured), type hints required.

**Route Pattern:** All routes `async def`, use `Depends(get_db)` for DB sessions.
```python
@app.get("/api/articles/{article_id}")
async def get_article(article_id: str, db: Session = Depends(get_db)):
    article = article_service.get_article(db, article_id)
    if not article:
        raise HTTPException(status_code=404, detail="文章不存在")
    return {...}
```

**Error Handling:** Rollback on DB errors, raise HTTPException with Chinese messages.
```python
try:
    db.commit()
except IntegrityError as e:
    db.rollback()
    raise HTTPException(status_code=400, detail=str(e))
```

### Extension (JavaScript)

**Class Pattern:** Private fields with `#`, async `init()` method.
```javascript
class PopupController {
  #apiClient;
  #articleData = null;

  constructor() {
    this.#apiClient = new ApiClient();
  }

  async init() {
    await this.loadConfig();
    await this.setupEventListeners();
  }
}
```

**Chrome APIs:** `chrome.storage.local` for config, `chrome.scripting.executeScript` for page extraction, `chrome.tabs` for navigation.

---

## Key Patterns

**Frontend API Client:** Centralized in `lib/api.ts` with typed exports.
```typescript
export const articleApi = { getArticles, getArticle, deleteArticle, ... };
export const categoryApi = { getCategories, createCategory, ... };
```

**Database Models:** SQLAlchemy ORM with String UUIDs, ISO timestamps, cascade deletes.
```python
id = Column(String, primary_key=True, default=generate_uuid)
created_at = Column(String, default=lambda: datetime.utcnow().isoformat())
category = relationship("Category", back_populates="articles")
```

**Extension Content Extraction:** No content scripts - use `executeScript` injection.
```javascript
const results = await chrome.scripting.executeScript({
  target: { tabId: tab.id },
  func: () => { /* extraction logic */ }
});
```

---

## File Structure

```
backend/
├── main.py              # FastAPI routes (all endpoints)
├── models.py            # SQLAlchemy models + DB setup
├── article_service.py   # Business logic
├── ai_client.py         # OpenAI integration
└── pyproject.toml       # Dependencies (uv)

frontend/
├── pages/               # Next.js pages (CSR)
│   ├── index.tsx        # Article list
│   ├── settings.tsx     # Config management
│   └── article/[id].tsx # Article detail
├── lib/api.ts           # API client + types
└── package.json

extension/
├── entrypoints/
│   ├── popup/main.js    # Popup controller
│   └── editor/main.js   # Editor page
├── utils/
│   ├── api.ts           # API client
│   └── articleExtractor.ts
└── wxt.config.ts
```

---

## Adding Features

1. **Model:** `backend/models.py` - Add SQLAlchemy model
2. **Routes:** `backend/main.py` - Add Pydantic schemas + endpoints
3. **Logic:** `backend/article_service.py` - Add business logic
4. **Types:** `frontend/lib/api.ts` - Add TypeScript interfaces
5. **UI:** `frontend/pages/` - Add React components

---

## Environment Variables

| Variable | Location | Default |
|----------|----------|---------|
| `OPENAI_API_KEY` | Backend | Required for AI |
| `DATABASE_URL` | Backend | `sqlite:///./data/articles.db` |
| `NEXT_PUBLIC_API_URL` | Frontend | `http://localhost:8000` |
| API Host | Extension | `chrome.storage.local` |

---

## Important Notes

- **UI Language:** All user-facing text in Chinese (e.g., "删除成功", "操作失败")
- **Database:** SQLite at `data/articles.db`, auto-created on startup, no migrations
- **Extension Loading:** Chrome `chrome://extensions/` → Load `.output/chrome-mv3`
- **Ruff:** Backend uses ruff for linting (`.ruff_cache/` present)

## Warnings

- ⚠️ No test suite configured yet - add before critical changes
- ⚠️ No Prettier/Black formatters - consider adding
- ⚠️ Extension requires manual browser testing
- ⚠️ Docker volumes persist data - use `docker-compose down -v` to reset
