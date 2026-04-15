# Review Reference Dialog Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 调整回顾引用弹窗布局，让正文预览区域显著更宽、更高，提升自由选区引用时的可读性。

**Architecture:** 保持现有搜索、文章选择与插入逻辑不变，只调整 `ReviewReferenceInsertPanel` 的弹窗宽度和桌面端两栏比例，并扩大 `ReviewReferenceSelectionPreview` 的预览高度。测试继续使用源码断言，确保这次只改布局边界。

**Tech Stack:** React, Next.js pages router, TypeScript, node:test, Tailwind

---

### Task 1: 用测试锁定新的弹窗布局

**Files:**
- Modify: `frontend/tests/reviewReference.test.ts`
- Test: `frontend/tests/reviewReference.test.ts`

- [ ] **Step 1: 写失败测试，约束弹窗宽度、两栏比例和预览高度**

```ts
test("review reference dialog uses a wider preview-first desktop layout", () => {
  const panelSource = readFileSync(
    join(process.cwd(), "components/ReviewReferenceInsertPanel.tsx"),
    "utf8",
  );
  const previewSource = readFileSync(
    join(process.cwd(), "components/ReviewReferenceSelectionPreview.tsx"),
    "utf8",
  );

  assert.match(panelSource, /max-w-6xl/);
  assert.match(panelSource, /lg:grid-cols-\[320px_minmax\(0,1fr\)\]/);
  assert.match(previewSource, /max-h-\[68vh\]/);
});
```

- [ ] **Step 2: 运行测试，确认 RED**

Run: `cd frontend && node --test --import tsx tests/reviewReference.test.ts`
Expected: FAIL，因为当前仍是 `max-w-3xl` 和较窄布局

### Task 2: 实现预览优先布局

**Files:**
- Modify: `frontend/components/ReviewReferenceInsertPanel.tsx`
- Modify: `frontend/components/ReviewReferenceSelectionPreview.tsx`
- Test: `frontend/tests/reviewReference.test.ts`

- [ ] **Step 1: 放大弹窗并调整两栏比例**

```tsx
<ModalShell
  widthClassName="max-w-6xl"
  bodyClassName="space-y-4 p-4 lg:p-5"
/>

<div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)] xl:grid-cols-[340px_minmax(0,1fr)]">
```

- [ ] **Step 2: 提升正文预览高度，并给右侧容器更稳定的阅读空间**

```tsx
<div className="review-reference-preview prose prose-sm mt-3 min-h-[420px] max-h-[68vh] ...">
```

- [ ] **Step 3: 运行测试，确认 GREEN**

Run: `cd frontend && node --test --import tsx tests/reviewReference.test.ts`
Expected: PASS

### Task 3: 最终验证

**Files:**
- Verify only

- [ ] **Step 1: 运行回顾引用相关测试**

Run: `cd frontend && node --test --import tsx tests/reviewReference.test.ts tests/reviewTemplate.test.ts`
Expected: PASS

- [ ] **Step 2: 运行 lint**

Run: `cd frontend && npm run lint`
Expected: exit 0

- [ ] **Step 3: 运行构建**

Run: `cd frontend && npm run build`
Expected: exit 0

- [ ] **Step 4: 重建前端容器**

Run: `docker compose build web && docker compose up -d web`
Expected: `lumina-web-1` 使用新前端启动
