# List Title Search Original And Translated Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make list-page article title fuzzy search and `/api/articles/search` both match original titles and translated titles.

**Architecture:** Add one small shared title-search helper in the backend query layer that applies a `title OR title_trans` contains filter. Reuse that helper in the list filter query builder and expose the same behavior through the admin title search endpoint, with focused unit tests locking both call paths.

**Tech Stack:** Python 3.11, FastAPI, SQLAlchemy ORM, pytest

---

### Task 1: Lock List Query Title Search Behavior with Failing Tests

**Files:**
- Modify: `backend/tests/unit/domain/test_article_query_service.py`
- Test: `backend/tests/unit/domain/test_article_query_service.py::test_get_articles_search_matches_translated_title`

- [ ] **Step 1: Write the failing test**

```python
def test_get_articles_search_matches_translated_title(db_session):
    service = ArticleQueryService()
    make_article(
        db_session,
        title="Original Search Title",
        title_trans="译文可搜索标题",
        published_at="2026-03-20",
        created_at="2026-03-20T08:00:00+00:00",
        is_visible=True,
    )

    articles, total = service.get_articles(
        db=db_session,
        page=1,
        size=10,
        search="可搜索",
        is_admin=True,
    )

    assert total == 1
    assert [item.title for item in articles] == ["Original Search Title"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/unit/domain/test_article_query_service.py::test_get_articles_search_matches_translated_title -q`
Expected: FAIL because list filtering only checks `Article.title`.

- [ ] **Step 3: Write minimal implementation**

```python
def _apply_title_search_filter(query, keyword: str):
    normalized = (keyword or "").strip()
    if not normalized:
        return query
    return query.filter(
        or_(
            Article.title.contains(normalized),
            Article.title_trans.contains(normalized),
        )
    )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/unit/domain/test_article_query_service.py::test_get_articles_search_matches_translated_title -q`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/domain/article_query_service.py backend/tests/unit/domain/test_article_query_service.py docs/superpowers/plans/2026-03-29-list-title-search-original-and-translated.md
git commit -m "fix: support translated title list search"
```

### Task 2: Lock `/api/articles/search` Behavior with a Failing Test

**Files:**
- Modify: `backend/tests/unit/api/test_article_router.py`
- Test: `backend/tests/unit/api/test_article_router.py::test_search_articles_matches_translated_title`

- [ ] **Step 1: Write the failing test**

```python
@pytest.mark.anyio
async def test_search_articles_matches_translated_title(db_session):
    article = Article(
        title="Original Search API Title",
        title_trans="接口译文标题",
        slug="search-api-title",
        content_md="content",
        content_trans="",
        top_image="",
        author="Tester",
        published_at=now_str(),
        source_domain="example.com",
        status="completed",
        is_visible=True,
        created_at=now_str(),
        updated_at=now_str(),
    )
    db_session.add(article)
    db_session.commit()

    response = await article_router.search_articles(
        query="接口译文",
        limit=20,
        db=db_session,
        _=True,
    )

    assert len(response) == 1
    assert response[0]["slug"] == "search-api-title"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/unit/api/test_article_router.py::test_search_articles_matches_translated_title -q`
Expected: FAIL because the endpoint only filters `Article.title`.

- [ ] **Step 3: Write minimal implementation**

```python
def search_articles_by_title(self, db: Session, query_text: str, limit: int = 20):
    return (
        _apply_title_search_filter(
            db.query(Article.id, Article.title, Article.slug),
            query_text,
        )
        .order_by(Article.created_at.desc())
        .limit(limit)
        .all()
    )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/unit/api/test_article_router.py::test_search_articles_matches_translated_title -q`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/api/routers/article_router.py backend/app/domain/article_query_service.py backend/tests/unit/api/test_article_router.py docs/superpowers/plans/2026-03-29-list-title-search-original-and-translated.md
git commit -m "test: cover translated title search endpoint"
```

### Task 3: Verify Related Search Coverage Stays Green

**Files:**
- Modify: `backend/app/domain/article_query_service.py`
- Test: `backend/tests/unit/domain/test_article_query_service.py`
- Test: `backend/tests/unit/api/test_article_router.py`

- [ ] **Step 1: Run targeted backend tests**

Run: `uv run pytest tests/unit/domain/test_article_query_service.py tests/unit/api/test_article_router.py -q`
Expected: PASS

- [ ] **Step 2: Confirm no frontend API contract changes are needed**

```python
# No code change expected in this step; list page already passes `search` to the backend.
```

- [ ] **Step 3: Commit**

```bash
git add backend/app/api/routers/article_router.py backend/app/domain/article_query_service.py backend/tests/unit/api/test_article_router.py backend/tests/unit/domain/test_article_query_service.py docs/superpowers/plans/2026-03-29-list-title-search-original-and-translated.md
git commit -m "fix: support translated title fuzzy search"
```
