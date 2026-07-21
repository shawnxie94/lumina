import test from "node:test";
import assert from "node:assert/strict";

import {
  buildArticleEditorDraftKey,
  buildColumnEditorDraftKey,
  clearEditorDraft,
  isArticleEditorDraftDirty,
  isColumnEditorDraftDirty,
  isEditorDraftFresh,
  readEditorDraft,
  writeEditorDraft,
  type ArticleEditorDraftPayload,
  type ColumnEditorDraftPayload,
} from "@/lib/editorDraft";

const baseArticle = (): ArticleEditorDraftPayload => ({
  mode: "original",
  title: "Title",
  author: "Author",
  publishedAt: "2026-07-21",
  categoryId: "c1",
  tagNames: ["a", "b"],
  topImage: "https://example.com/a.png",
  content: "# Hello",
});

const baseColumn = (): ColumnEditorDraftPayload => ({
  title: "Column",
  publishedAt: "2026-07-21",
  topImage: "",
  markdownContent: "body",
});

class MemoryStorage {
  private store = new Map<string, string>();
  getItem(key: string) {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  setItem(key: string, value: string) {
    this.store.set(key, String(value));
  }
  removeItem(key: string) {
    this.store.delete(key);
  }
}

test("builds stable draft keys", () => {
  assert.equal(
    buildArticleEditorDraftKey("article-1", "translation"),
    "lumina_editor_draft_v1:article:article-1:translation",
  );
  assert.equal(
    buildColumnEditorDraftKey("issue-1"),
    "lumina_editor_draft_v1:column:issue-1",
  );
});

test("detects dirty article and column drafts", () => {
  const article = baseArticle();
  assert.equal(isArticleEditorDraftDirty(article, article), false);
  assert.equal(
    isArticleEditorDraftDirty({ ...article, content: "# Hello\n" }, article),
    true,
  );

  const column = baseColumn();
  assert.equal(isColumnEditorDraftDirty(column, column), false);
  assert.equal(
    isColumnEditorDraftDirty({ ...column, title: "Changed" }, column),
    true,
  );
});

test("freshness checks age and source revision", () => {
  const now = Date.now();
  assert.equal(
    isEditorDraftFresh(
      { updatedAt: now, sourceUpdatedAt: "v1" },
      { sourceUpdatedAt: "v1" },
    ),
    true,
  );
  assert.equal(
    isEditorDraftFresh(
      { updatedAt: now, sourceUpdatedAt: "v1" },
      { sourceUpdatedAt: "v2" },
    ),
    false,
  );
  assert.equal(
    isEditorDraftFresh(
      { updatedAt: now - 8 * 24 * 60 * 60 * 1000, sourceUpdatedAt: "v1" },
      { sourceUpdatedAt: "v1" },
    ),
    false,
  );
});

test("writes and clears browser drafts", () => {
  const storage = new MemoryStorage();
  (globalThis as any).window = { localStorage: storage };

  const key = buildArticleEditorDraftKey("a1", "original");
  const payload = baseArticle();
  const written = writeEditorDraft(key, payload, { sourceUpdatedAt: "u1" });
  assert.ok(written);
  assert.equal(written?.payload.title, "Title");

  const read = readEditorDraft<ArticleEditorDraftPayload>(key);
  assert.equal(read?.payload.content, "# Hello");
  assert.equal(read?.sourceUpdatedAt, "u1");

  clearEditorDraft(key);
  assert.equal(readEditorDraft(key), null);

  delete (globalThis as any).window;
});
