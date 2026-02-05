# Unified Header/Footer Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Unify the header across main pages and add a consistent footer in the frontend.

**Architecture:** Create a shared header/footer component pair and wire them into the three main pages to ensure consistent layout and navigation. Keep styling aligned with the existing minimal B2B/SaaS tokens and Tailwind conventions in `frontend/styles/globals.css` and `frontend/tailwind.config.js`.

**Tech Stack:** Next.js pages router, React, Tailwind CSS, Ant Design (already in use).

---

### Task 1: Create shared Header component

**Files:**
- Create: `frontend/components/AppHeader.tsx`
- Modify: `frontend/components/icons.tsx` (only if a GitHub line icon is missing)

**Step 1: Write the failing test**

No automated test framework configured. Skip tests; verify via manual UI check in Task 4.

**Step 2: Run test to verify it fails**

Skipped (no tests).

**Step 3: Write minimal implementation**

Create `AppHeader` that renders:
- Left: clickable logo + text `Lumina` linking to `/`.
- Right: GitHub icon button linking to `https://github.com/shawnxie94/lumina` (new tab), then `设置` link (if admin), then `登录/登出` (based on auth state).

Notes:
- Use existing auth state from `frontend/contexts/AuthContext.tsx` in pages (pass props to header or move auth hook into header).
- Use existing icons or add a simple GitHub line icon in `frontend/components/icons.tsx` if missing.
- Keep typography and colors consistent with `bg-surface`, `border-border`, `shadow-sm`, `text-text-*` tokens.

**Step 4: Run test to verify it passes**

Manual check in Task 4.

**Step 5: Commit**

Skip commit unless user requests.

---

### Task 2: Create shared Footer component

**Files:**
- Create: `frontend/components/AppFooter.tsx`

**Step 1: Write the failing test**

No tests configured; skip.

**Step 2: Run test to verify it fails**

Skipped.

**Step 3: Write minimal implementation**

Create a footer with:
- Minimal layout (centered) on `bg-surface` or subtle `bg-muted`.
- Text like `© {year} Lumina` (confirm with product if additional links needed).
- Ensure responsive spacing and consistent tokens.

**Step 4: Run test to verify it passes**

Manual check in Task 4.

**Step 5: Commit**

Skip commit unless user requests.

---

### Task 3: Wire header/footer into main pages

**Files:**
- Modify: `frontend/pages/index.tsx`
- Modify: `frontend/pages/article/[id].tsx`
- Modify: `frontend/pages/settings.tsx`

**Step 1: Write the failing test**

No tests; skip.

**Step 2: Run test to verify it fails**

Skipped.

**Step 3: Write minimal implementation**

Replace existing page-specific nav sections with `<AppHeader />` and append `<AppFooter />` near page root for consistent layout. Preserve page-specific sub-headers (e.g., article title area) below the header.

**Step 4: Run test to verify it passes**

Manual check in Task 4.

**Step 5: Commit**

Skip commit unless user requests.

---

### Task 4: Manual verification

**Files:**
- None

**Step 1: Run frontend dev server**

Run: `cd frontend && npm run dev`
Expected: Server starts without errors.

**Step 2: Visual check**

- `/`: Header matches spec, GitHub icon links, settings/login/logout present; footer visible.
- `/article/[id]`: Header matches spec, content still renders; footer visible.
- `/settings`: Header matches spec; footer visible; layout stable.

**Step 3: Accessibility quick check**

Verify links have visible focus/hover styles and icon-only GitHub button has `aria-label`.

**Step 4: Stop dev server**

Stop: Ctrl+C

**Step 5: Commit**

Skip commit unless user requests.
