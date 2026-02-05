# AI Usage & Billing Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add AI调用记录与计量计费（按模型API配置维度）到后端与设置页。

**Architecture:** 在后端新增 AI 使用记录表并在 AI 调用完成时写入 usage + 费用，提供查询与汇总 API；前端在设置页“模型API配置”标题右侧新增入口，展示调用记录与计量汇总。计价由 `ModelAPIConfig` 维护单价字段（输入/输出每 1K tokens）。

**Tech Stack:** FastAPI + SQLAlchemy + SQLite, Next.js pages router + Tailwind.

---

### Task 1: DB Schema & ModelAPIConfig pricing

**Files:**
- Modify: `backend/models.py`

**Step 1: Write the failing test**

No test framework configured; skip automated tests.

**Step 2: Run test to verify it fails**

Skipped.

**Step 3: Write minimal implementation**

- Add new SQLAlchemy model `AIUsageLog` with fields:
  - `id`, `model_api_config_id`, `task_id`, `article_id`, `task_type`, `content_type`, `status`,
    `prompt_tokens`, `completion_tokens`, `total_tokens`, `cost_input`, `cost_output`, `cost_total`,
    `currency`, `latency_ms`, `error_message`, `created_at`.
- Add pricing columns to `ModelAPIConfig`: `price_input_per_1k`, `price_output_per_1k`, `currency`.
- Update `init_db()` to `ensure_columns` for new `ModelAPIConfig` columns in SQLite and to create `ai_usage_logs` table if missing.
- Add indexes in `init_db` for `ai_usage_logs` on `model_api_config_id`, `created_at`, `status`.

**Step 4: Run test to verify it passes**

Skipped.

**Step 5: Commit**

Skip commit unless user requests.

---

### Task 2: AI call usage capture & logging

**Files:**
- Modify: `backend/ai_client.py`
- Modify: `backend/article_service.py`

**Step 1: Write the failing test**

No tests configured; skip.

**Step 2: Run test to verify it fails**

Skipped.

**Step 3: Write minimal implementation**

- Update `ConfigurableAIClient.generate_summary` and `.translate_to_chinese` to return `{ content, usage, model, latency_ms }` (or a tuple), capturing `response.usage` when available and timing with `time.monotonic()`.
- In `ArticleService.process_article_ai`, `process_article_translation`, and `process_ai_content`, log a new `AIUsageLog` record after success/failure:
  - Link `model_api_config_id` (from explicit model_config_id, prompt config, or default config resolution) and `task_id` if available.
  - Save tokens + computed costs using `price_input_per_1k`/`price_output_per_1k` from `ModelAPIConfig`.
  - On failure, store `status='failed'` and `error_message`.
- Ensure `ai_config` includes `model_api_config_id` and pricing fields so logging can compute costs.

**Step 4: Run test to verify it passes**

Skipped.

**Step 5: Commit**

Skip commit unless user requests.

---

### Task 3: Usage APIs (list + summary)

**Files:**
- Modify: `backend/main.py`

**Step 1: Write the failing test**

No tests configured; skip.

**Step 2: Run test to verify it fails**

Skipped.

**Step 3: Write minimal implementation**

- Add endpoints:
  - `GET /api/ai-usage`: supports `model_api_config_id`, `status`, `task_type`, `content_type`, `start`, `end`, `page`, `size`.
  - `GET /api/ai-usage/summary`: returns per-model totals (calls, tokens, cost) and overall totals for the time window.
- Join `ModelAPIConfig` to include `model_api_config_name` in responses.
- Use ISO string range filtering for `created_at`.

**Step 4: Run test to verify it passes**

Skipped.

**Step 5: Commit**

Skip commit unless user requests.

---

### Task 4: Extend Model API config CRUD for pricing

**Files:**
- Modify: `backend/main.py`

**Step 1: Write the failing test**

No tests configured; skip.

**Step 2: Run test to verify it fails**

Skipped.

**Step 3: Write minimal implementation**

- Update `ModelAPIConfigBase` to include `price_input_per_1k`, `price_output_per_1k`, `currency`.
- Update create/update/get responses to include pricing fields.

**Step 4: Run test to verify it passes**

Skipped.

**Step 5: Commit**

Skip commit unless user requests.

---

### Task 5: Frontend API client & settings UI

**Files:**
- Modify: `frontend/lib/api.ts`
- Modify: `frontend/pages/settings.tsx`

**Step 1: Write the failing test**

No tests configured; skip.

**Step 2: Run test to verify it fails**

Skipped.

**Step 3: Write minimal implementation**

- Add API methods for `aiUsage.list` and `aiUsage.summary`.
- Add pricing fields to Model API config form (输入/输出每 1K tokens 价格 + 币种) and render in list card.
- In settings AI section, add header-right entry next to “模型API配置列表” to switch to “调用记录/计量” view.
- Add new AI subview with summary cards + per-model table + detail list (filters: model/time/status/type) using existing table styles and tokens.

**Step 4: Run test to verify it passes**

Manual UI check in Task 6.

**Step 5: Commit**

Skip commit unless user requests.

---

### Task 6: Manual verification

**Files:**
- None

**Step 1: Run backend + frontend build**

Run: `docker-compose build` (or at least `docker-compose build web api`).

**Step 2: Visual check**

- 设置页 → 模型API配置标题右侧可切换到“调用记录/计量”.
- 新视图展示汇总、按模型汇总、调用明细；筛选可用。
- 新增/编辑模型配置可保存价格字段。

**Step 3: Commit**

Skip commit unless user requests.
