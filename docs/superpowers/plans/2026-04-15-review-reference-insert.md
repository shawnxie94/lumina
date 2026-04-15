# Review Reference List-To-Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将回顾引用弹窗重构为“默认列表态 + 行内双操作按钮 + 全宽正文预览态”的两段式交互，同时保留现有文章占位符插入和自由选区内容引用能力。

**Architecture:** `ReviewReferenceInsertPanel` 从“双栏混合视图”改成显式的 `list` / `preview` 两态状态机：列表态负责搜索与结果项动作，预览态负责单篇文章全宽阅读与返回。`ReviewReferenceSelectionPreview` 保留正文选区与浮动插入能力，但改为服务全宽预览页态，不再背负列表或切换逻辑。

**Tech Stack:** Next.js pages router, React 18, TypeScript, node:test, Tailwind, `articleApi`, `renderSafeMarkdown`

---

### Task 1: 用失败测试锁定新的两段式交互

**Files:**
- Modify: `frontend/tests/reviewReference.test.ts`
- Test: `frontend/tests/reviewReference.test.ts`

- [ ] **Step 1: 写失败测试，约束列表态采用结果项双 icon 动作**

```ts
test("review reference insert panel renders row actions for article and content references", () => {
  const source = readFileSync(
    join(process.cwd(), "components/ReviewReferenceInsertPanel.tsx"),
    "utf8",
  );

  assert.match(source, /viewMode/);
  assert.match(source, /IconQuote/);
  assert.match(source, /IconLink/);
  assert.match(source, /aria-label=\{t\("插入文章引用"\)\}/);
  assert.match(source, /aria-label=\{t\("插入内容引用"\)\}/);
});
```

- [ ] **Step 2: 写失败测试，约束内容引用切到全宽预览态并提供返回列表**

```ts
test("review reference insert panel switches to full-width preview mode", () => {
  const source = readFileSync(
    join(process.cwd(), "components/ReviewReferenceInsertPanel.tsx"),
    "utf8",
  );

  assert.match(source, /viewMode === "preview"/);
  assert.match(source, /返回列表/);
  assert.doesNotMatch(source, /lg:grid-cols-\[320px_minmax\(0,1fr\)\]/);
});
```

- [ ] **Step 3: 运行测试，确认 RED**

Run: `cd frontend && node --test --import tsx tests/reviewReference.test.ts`
Expected: FAIL，因为当前仍是选中文章后右侧预览的双栏模式

### Task 2: 重构 ReviewReferenceInsertPanel 为列表态 + 预览态

**Files:**
- Modify: `frontend/components/ReviewReferenceInsertPanel.tsx`
- Modify: `frontend/lib/i18n.ts`
- Test: `frontend/tests/reviewReference.test.ts`

- [ ] **Step 1: 引入显式视图状态和当前预览文章状态**

```tsx
const [viewMode, setViewMode] = useState<"list" | "preview">("list");
const [previewArticle, setPreviewArticle] = useState<ReviewReferenceArticleOption | null>(null);
```

- [ ] **Step 2: 列表态改为纯搜索结果列表，每行提供两个 icon 操作按钮**

```tsx
<button
  type="button"
  aria-label={t("插入文章引用")}
  onClick={() => handleInsertArticleReference(article)}
>
  <IconLink className="h-4 w-4" />
</button>

<button
  type="button"
  aria-label={t("插入内容引用")}
  onClick={() => handleOpenContentReference(article)}
>
  <IconQuote className="h-4 w-4" />
</button>
```

- [ ] **Step 3: 删除“选中文章后右侧模式区”的中间态，文章引用改为直接插入**

```tsx
const handleInsertArticleReference = (article: ReviewReferenceArticleOption) => {
  onInsert(buildReviewArticlePlaceholder(article.slug));
};
```

- [ ] **Step 4: 内容引用改为加载正文后切换到全宽预览态**

```tsx
const handleOpenContentReference = async (article: ReviewReferenceArticleOption) => {
  setPreviewArticle(article);
  setViewMode("preview");
  const detail = await articleApi.getArticle(article.slug);
  setPreviewMarkdown(resolveReviewReferenceSource(detail.content_trans, detail.content_md));
};
```

- [ ] **Step 5: 预览态顶部只保留返回列表、标题与来源提示**

```tsx
<Button variant="ghost" size="sm" onClick={handleReturnToList}>
  {t("返回列表")}
</Button>
```

- [ ] **Step 6: 补齐或调整相关文案**

```ts
返回列表: "Back to list",
"搜索文章后，直接选择插入文章引用，或进入正文预览挑选内容引用":
  "Search an article, then either insert the article reference directly or enter preview mode to select a content quote.",
```

- [ ] **Step 7: 运行测试，确认 GREEN**

Run: `cd frontend && node --test --import tsx tests/reviewReference.test.ts`
Expected: PASS

### Task 3: 调整正文预览组件以适配全宽预览态

**Files:**
- Modify: `frontend/components/ReviewReferenceSelectionPreview.tsx`
- Test: `frontend/tests/reviewReference.test.ts`

- [ ] **Step 1: 写失败测试，约束预览组件不再携带列表态提示语，保留正文选区与浮动插入**

```ts
test("review reference selection preview focuses on full-width article content selection", () => {
  const source = readFileSync(
    join(process.cwd(), "components/ReviewReferenceSelectionPreview.tsx"),
    "utf8",
  );

  assert.match(source, /max-h-\[72vh\]/);
  assert.match(source, /selectionchange/);
  assert.doesNotMatch(source, /在正文预览中拖动鼠标选择一段文字，然后点击浮动按钮插入引用/);
});
```

- [ ] **Step 2: 运行测试，确认 RED**

Run: `cd frontend && node --test --import tsx tests/reviewReference.test.ts`
Expected: FAIL，因为当前组件仍携带旧提示文案和旧高度

- [ ] **Step 3: 调整预览组件为更专注的全宽阅读容器**

```tsx
<div
  ref={containerRef}
  className="review-reference-preview prose prose-sm min-h-[480px] max-h-[72vh] ..."
  dangerouslySetInnerHTML={{ __html: previewHtml }}
/>
```

- [ ] **Step 4: 如需提示，改为更轻的顶部说明条，由 panel 决定是否展示**

```tsx
<p className="text-xs text-text-3">{t("拖动鼠标选择正文后插入引用")}</p>
```

- [ ] **Step 5: 运行测试，确认 GREEN**

Run: `cd frontend && node --test --import tsx tests/reviewReference.test.ts`
Expected: PASS

### Task 4: 回顾页接线回归验证

**Files:**
- Modify: `frontend/pages/reviews/[slug].tsx`
- Test: `frontend/tests/reviewReference.test.ts`

- [ ] **Step 1: 保留页面接线测试，确保面板调用不被交互重构打断**

```ts
test("review detail page wires review reference panel into the markdown editor", () => {
  const source = readFileSync(
    join(process.cwd(), "pages/reviews/[slug].tsx"),
    "utf8",
  );

  assert.match(source, /<ReviewReferenceInsertPanel/);
  assert.match(source, /handleInsertReference/);
});
```

- [ ] **Step 2: 运行目标测试**

Run: `cd frontend && node --test --import tsx tests/reviewReference.test.ts tests/reviewTemplate.test.ts`
Expected: PASS

### Task 5: 最终验证

**Files:**
- Verify only

- [ ] **Step 1: 运行前端测试**

Run: `cd frontend && node --test --import tsx tests/reviewReference.test.ts tests/reviewTemplate.test.ts`
Expected: PASS

- [ ] **Step 2: 运行前端 lint**

Run: `cd frontend && npm run lint`
Expected: exit 0

- [ ] **Step 3: 运行前端构建**

Run: `cd frontend && npm run build`
Expected: exit 0

- [ ] **Step 4: 重建前端容器**

Run: `docker compose build web && docker compose up -d web`
Expected: `lumina-web-1` 使用最新前端启动

- [ ] **Step 5: 手动核对 spec 覆盖**

Checklist:
- 默认弹窗只显示搜索框与结果列表
- 结果项提供“文章引用”和“内容引用”两个 icon 按钮
- 文章引用点击后直接插入 `{{article_slug}}`
- 内容引用点击后进入全宽预览态
- 预览态顶部存在“返回列表”
- 正文预览仍使用 `content_trans -> content_md` 回退
- 正文预览仍支持自由选区与浮动插入按钮
