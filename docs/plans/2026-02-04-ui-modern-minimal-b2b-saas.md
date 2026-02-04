# Modern Minimal B2B/SaaS UI Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Unify frontend and extension UI into a high-end minimal B2B/SaaS style with shared design tokens, updated typography, and emoji replaced by line icons.

**Architecture:** Establish a shared token system via CSS variables, map tokens into Tailwind for frontend, and refit extension CSS to those tokens. Replace emoji UI affordances with inline SVG line icons (no new dependencies) while preserving existing layouts and Chinese copy.

**Tech Stack:** Next.js (pages router), Tailwind CSS 3.x, WXT extension with vanilla CSS/JS.

---

## Notes & Constraints

- Global background: `#F7F7F8`.
- Accent color: `#3B82F6`.
- Radius: small (2–4px).
- Shadow: soft/low-contrast.
- Typeface: user is already switching to **LXGW WenKai Mono**; keep tokens consistent.
- Replace **all UI emoji** (headers, buttons, labels, tags) but do **not** touch article content.

---

## Task 0 (Optional, if enforcing TDD): Add minimal visual regression tests

**Files:**
- Create: `frontend/tests/ui-smoke.spec.ts`
- Create: `extension/tests/ui-smoke.spec.ts`
- Modify: `frontend/package.json` (add test script)
- Modify: `extension/package.json` (add test script)

**Step 1: Write failing visual test (frontend)**

```ts
test('home page renders stable layout', async () => {
  await page.goto('http://localhost:3000/');
  await expect(page).toHaveScreenshot('home.png');
});
```

**Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL because baseline screenshot is missing.

**Step 3: Add baseline snapshot**

Run: `npm test -- --update-snapshots`
Expected: PASS and snapshot created.

**Step 4: Repeat for extension entrypoints**

Add pages for popup/settings/history/editor and capture screenshots.

**Step 5: Commit**

```bash
git add frontend/tests extension/tests frontend/package.json extension/package.json
git commit -m "test: add minimal UI smoke snapshots"
```

> If you do not want to set up tests, skip Task 0 and rely on manual visual QA.

---

## Task 1: Add shared design tokens and base styles (frontend)

**Files:**
- Modify: `frontend/styles/globals.css`
- Modify: `frontend/tailwind.config.js`

**Step 1: Write failing test (if Task 0 enabled)**

Add a snapshot assertion that checks body background and primary button color.

**Step 2: Run test to verify it fails**

Run: `npm test` → Expect snapshot mismatch.

**Step 3: Implement tokens in globals.css**

```css
:root {
  --bg-app: #f7f7f8;
  --bg-surface: #ffffff;
  --bg-muted: #f1f1f3;
  --text-1: #111111;
  --text-2: #434343;
  --text-3: #7a7a7a;
  --border: #e6e6e8;
  --border-strong: #d4d4d8;
  --accent: #3b82f6;
  --accent-soft: #e8f0ff;
  --accent-ink: #1e3a8a;
  --shadow-sm: 0 1px 3px rgba(0,0,0,0.06);
  --shadow-md: 0 6px 18px rgba(0,0,0,0.08);
  --radius-xs: 2px;
  --radius-sm: 4px;
  --radius-md: 6px;
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 20px;
  --space-6: 24px;
  --font-sans: 'LXGW WenKai Mono', system-ui, -apple-system, 'Segoe UI', sans-serif;
  --font-mono: 'LXGW WenKai Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
}

body {
  background: var(--bg-app);
  color: var(--text-1);
  font-family: var(--font-sans);
}
```

**Step 4: Map tokens into Tailwind**

Add `theme.extend` entries for colors, boxShadow, borderRadius, fontFamily.

**Step 5: Run tests / lint**

Run: `npm run lint` (if tests exist, run `npm test`)

---

## Task 2: Add shared tokens to extension base CSS

**Files:**
- Modify: `extension/styles/popup.css`
- Modify: `extension/entrypoints/settings/settings.css`
- Modify: `extension/entrypoints/history/history.css`
- Modify: `extension/entrypoints/editor/editor.css`

**Step 1: Write failing test (if Task 0 enabled)**

Add snapshot checks for body background and card border.

**Step 2: Implement CSS variables**

Insert the same `:root` token block and update `body` background, text color, and font.

**Step 3: Run tests / manual QA**

Open each extension entrypoint to confirm visuals.

---

## Task 3: Standardize base components in frontend (cards, buttons, inputs)

**Files:**
- Modify: `frontend/pages/index.tsx`
- Modify: `frontend/pages/article/[id].tsx`
- Modify: `frontend/pages/settings.tsx`
- Modify: `frontend/components/Toast.tsx`
- Modify: `frontend/components/BackToTop.tsx`

**Step 1: Write failing test (if Task 0 enabled)**

Add snapshots for main pages to catch tokenized card/button changes.

**Step 2: Implement minimal class changes**

Update Tailwind classes to prefer new token colors and shadows, for example:
- `bg-white` → `bg-[color:var(--bg-surface)]`
- `shadow-sm` → `shadow-[var(--shadow-sm)]`
- `rounded-lg` → `rounded-[var(--radius-sm)]`
- Buttons: standardize primary/secondary styles.

**Step 3: Run tests / lint**

Run: `npm run lint` (and `npm test` if Task 0 is used).

---

## Task 4: Standardize base components in extension CSS

**Files:**
- Modify: `extension/styles/popup.css`
- Modify: `extension/entrypoints/settings/settings.css`
- Modify: `extension/entrypoints/history/history.css`
- Modify: `extension/entrypoints/editor/editor.css`

**Step 1: Write failing test (if Task 0 enabled)**

Add snapshots for popup/settings/history/editor.

**Step 2: Implement minimal CSS adjustments**

Use variables for:
- `border`, `background`, `text`, `radius`, `shadow`.
- Button variants (primary, secondary, subtle).
- Input focus states (soft glow).

**Step 3: Manual QA**

Open each entrypoint; verify layout and spacing unchanged.

---

## Task 5: Replace emoji UI icons with inline SVG line icons

**Files (Frontend):**
- Create: `frontend/components/icons.tsx`
- Modify: `frontend/pages/index.tsx`
- Modify: `frontend/pages/article/[id].tsx`
- Modify: `frontend/pages/settings.tsx`
- Modify: `frontend/pages/auth/extension.tsx`

**Files (Extension):**
- Create: `extension/utils/icons.js`
- Modify: `extension/entrypoints/popup/index.html`
- Modify: `extension/entrypoints/settings/index.html`
- Modify: `extension/entrypoints/history/index.html`
- Modify: `extension/entrypoints/editor/index.html`
- Modify: `extension/entrypoints/popup/main.js`

**Step 1: Write failing test (if Task 0 enabled)**

Add snapshot checks to assert emoji characters are not present in UI text.

**Step 2: Create icon set (line, 2px stroke)**

Expose a small set of SVGs (e.g., `iconTag`, `iconDoc`, `iconRobot`, `iconChevron`, `iconSettings`, `iconCheck`, `iconWarning`).

**Step 3: Replace emoji usage**

- Frontend: swap emoji headers/tags with `<Icon ... />`.
- Extension: inject inline SVG via HTML templates or DOM creation.

**Step 4: Run tests / manual QA**

Confirm no emoji remain in UI elements. Content emojis remain untouched.

---

## Task 6: Final visual QA and cleanup

**Files:**
- Modify as needed (only if defects found)

**Step 1: Run lint/build**

- Frontend: `npm run lint` and `npm run build` (optional)
- Extension: `npm run build`

**Step 2: Visual checks**

- Desktop and mobile widths
- Card hierarchy, spacing, contrast, hover states
- No emoji in UI chrome

**Step 3: Commit**

```bash
git add frontend extension docs/plans/2026-02-04-ui-modern-minimal-b2b-saas.md
git commit -m "feat: modern minimal B2B UI tokens and icons"
```

---

## Manual QA Checklist

- Background is `#F7F7F8`
- Primary action uses `#3B82F6`
- Small radius across cards and buttons
- Shadows are soft/low-contrast
- No emoji in UI chrome (headers, labels, buttons)
- Font is LXGW WenKai Mono
- Extension popup/settings/history/editor match frontend tone
