# Comment 线程嵌套折叠 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 `CommentSection` 增加逐层嵌套折叠能力，同时保持深层评论定位与新回复可见性不退化。

**Architecture:** 继续沿用 `CommentSection` 当前的递归回复树渲染，只把 `expandedReplies` 从“顶层开关”扩展为“任意评论的子回复开关”。通过抽出祖先链解析辅助函数，把 hash 定位、原评论跳转和新建嵌套回复后的自动展开统一到同一条路径展开逻辑里。

**Tech Stack:** React, Next.js pages router, TypeScript, node:test, react-dom/server

---

### Task 1: 补齐祖先展开路径测试与辅助函数

**Files:**
- Modify: `frontend/components/comment/CommentSection.tsx`
- Modify: `frontend/tests/commentSection.test.tsx`
- Reference: `docs/superpowers/specs/2026-04-09-comment-thread-collapse-design.md`

- [ ] **Step 1: 写失败测试，锁定深层回复的祖先展开路径**

```ts
assert.deepEqual(collectReplyAncestorIds("reply-2", comments as any), [
  "top-1",
  "reply-1",
]);
```

- [ ] **Step 2: 运行单测确认失败**

Run: `cd /Users/shawn/Documents/GitHub/lumina/frontend && npm test -- tests/commentSection.test.tsx`
Expected: FAIL，提示 `collectReplyAncestorIds` 未导出或返回不符合预期。

- [ ] **Step 3: 实现最小辅助函数**

```ts
export function collectReplyAncestorIds(commentId: string, items: CommentType[]): string[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  const ancestors: string[] = [];
  let current = byId.get(commentId);
  const visited = new Set<string>();

  while (current?.reply_to_id) {
    if (visited.has(current.id)) break;
    visited.add(current.id);
    const parent = byId.get(current.reply_to_id);
    if (!parent) break;
    ancestors.unshift(parent.id);
    current = parent;
  }

  return ancestors;
}
```

- [ ] **Step 4: 运行单测确认通过**

Run: `cd /Users/shawn/Documents/GitHub/lumina/frontend && npm test -- tests/commentSection.test.tsx`
Expected: PASS 当前新增断言。

### Task 2: 为每层回复增加独立折叠开关并验证构建

**Files:**
- Modify: `frontend/components/comment/CommentSection.tsx`
- Modify: `frontend/tests/commentSection.test.tsx`

- [ ] **Step 1: 写失败测试，确认嵌套层也有自己的回复开关计数**

```ts
assert.equal(countDirectReplies("reply-1", groupedReplies), 1);
assert.equal(html.includes("查看回复 (1)"), true);
```

- [ ] **Step 2: 运行单测确认失败**

Run: `cd /Users/shawn/Documents/GitHub/lumina/frontend && npm test -- tests/commentSection.test.tsx`
Expected: FAIL，说明当前实现缺少嵌套层独立开关或对应计数。

- [ ] **Step 3: 实现逐层折叠与路径展开**

```ts
const childReplyCount = countDirectReplies(reply.id);
const isExpanded = expandedReplies[reply.id] ?? false;

repliesList={
  childReplyCount > 0 ? (
    <div className="mt-3">
      <button ...>{isExpanded ? t("收起回复") : t("查看回复")} ({childReplyCount})</button>
      {isExpanded ? renderReplyThread(reply.id, depth + 1, nextVisited) : null}
    </div>
  ) : undefined
}
```

并在定位与新回复提交成功后调用统一的祖先展开逻辑。

- [ ] **Step 4: 跑测试和生产构建**

Run: `cd /Users/shawn/Documents/GitHub/lumina/frontend && npm test -- tests/commentSection.test.tsx && npm run build`
Expected: 全部 PASS，Next.js 生产构建成功。
