# Export Prefer Translated Title Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make article export markdown prefer `title_trans` over `title` when a translated title is available.

**Architecture:** Reuse the existing `_get_preferred_article_title(article)` helper inside the export markdown renderer so export behavior matches RSS and other title-selection call sites. Guard the change with a focused unit test that proves markdown export uses the translated title and still links to the same slug.

**Tech Stack:** Python 3.11, FastAPI service layer, SQLAlchemy ORM, pytest

---

### Task 1: Lock Export Title Behavior with a Failing Test

**Files:**
- Modify: `backend/tests/unit/domain/test_article_query_service.py`
- Test: `backend/tests/unit/domain/test_article_query_service.py::test_export_articles_by_filters_prefers_translated_title`

- [ ] **Step 1: Write the failing test**

```python
def test_export_articles_by_filters_prefers_translated_title(db_session):
    service = ArticleQueryService()
    article = make_article(
        db_session,
        title="Original Export Title",
        title_trans="  导出译文标题  ",
        published_at="2026-03-01",
        created_at="2026-03-01T08:00:00+00:00",
        is_visible=True,
    )

    markdown = service.export_articles_by_filters(
        db=db_session,
        is_admin=True,
        public_base_url="https://lumina.example.com",
    )

    assert f"### [导出译文标题](https://lumina.example.com/article/{article.slug})" in markdown
    assert "### [Original Export Title]" not in markdown
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/unit/domain/test_article_query_service.py::test_export_articles_by_filters_prefers_translated_title -q`
Expected: FAIL because export markdown still renders `article.title`.

- [ ] **Step 3: Write minimal implementation**

```python
preferred_title = _get_preferred_article_title(article)
lines.append(f"### [{preferred_title}]({article_url})")
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/unit/domain/test_article_query_service.py::test_export_articles_by_filters_prefers_translated_title -q`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/domain/article_query_service.py backend/tests/unit/domain/test_article_query_service.py docs/superpowers/plans/2026-03-29-export-prefer-translated-title.md
git commit -m "fix: prefer translated titles in article export"
```

### Task 2: Verify Nearby Export Behavior Still Holds

**Files:**
- Modify: `backend/app/domain/article_query_service.py`
- Test: `backend/tests/unit/domain/test_article_query_service.py`

- [ ] **Step 1: Run nearby export query tests**

Run: `uv run pytest tests/unit/domain/test_article_query_service.py -q`
Expected: PASS for export ordering, visibility, translated-title, and existing RSS coverage.

- [ ] **Step 2: Confirm no unrelated behavior changed**

```python
# No code change expected in this step; verify helper reuse is limited to export title selection.
```

- [ ] **Step 3: Commit**

```bash
git add backend/app/domain/article_query_service.py backend/tests/unit/domain/test_article_query_service.py docs/superpowers/plans/2026-03-29-export-prefer-translated-title.md
git commit -m "test: cover translated title preference in article export"
```
