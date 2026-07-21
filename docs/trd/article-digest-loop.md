---
id: trd-article-digest-loop
type: trd
status: draft
created_at: 2026-07-21
updated_at: 2026-07-21
sources:
  - 会话 PRD：单篇吃透 P0/P1（prd-article-digest-loop）
  - 飞书文档：知识图谱 / 文章解读（如何快速吃透一篇文章）
  - docs/trd/article-ai-interpretation-bundle.md
  - backend/app/domain/article_ai_pipeline_service.py
  - backend/app/domain/ai_task_service.py
  - backend/app/domain/article_ai_version_service.py
  - backend/app/api/routers/article_router.py
  - backend/app/api/routers/settings_router.py
  - backend/models.py
  - backend/alembic/versions/20260211_0003_seed_default_prompts.py
  - frontend/pages/article/[id].tsx
  - frontend/lib/api.ts
related:
  - docs/trd/article-ai-interpretation-bundle.md
  - docs/trd/knowledge-graph-graphrag.md
---

# TRD: 单篇吃透闭环（P0 客观契约 + P1 笔记六句预填）

## 实现状态（代码为准）

> 迭代落地后与早期 TRD 草案差异（以当前代码为准）：
> - 批注 AI 生成 **完整六句**（不再只预填前三句）；JSON 线协议 `line1..line6` 由代码注入，不进可配置提示词。
> - 笔记区文案/入口统一为「批注」；去掉「已完成主观闭环」标签与硬字数截断。
> - 关闭生成弹窗不丢草稿；打开编辑且已存批注为空时，恢复最近一次已完成 `digest_prefill` 任务结果。
> - 大纲 L1 固定三分区写在提示词里；解析器只校验 `title/children` 树。
> - 迁移已合并为单条 `20260721_0028_article_digest_loop`（未上生产前的 0029–0034 切片已废弃）。

## 1. Technical Goal

把「机器代读」升级为「单篇吃透闭环」：

1. **P0**：摘要/大纲 prompt 契约对齐三问（主题或问题、核心观点、结构与证明）；大纲进入默认自动解读交付。
2. **P1**：在文章笔记区提供固定六句模板；前三句通过 **现有 AI worker + PromptConfig** 小调用按需预填；后三句强制留白给人填；结果只写入个人 `note_content`，不进入公开 `ai_analysis`。

本 TRD 是实现契约，不拆任务排期。

### Non-Goals

- 知识图谱 / claim / 社区 / 回顾与主题报告
- 新 AI 主 Tab（mindmap、`key_points` 主路径）
- 入库自动跑预填
- 主观三句写入公开 AI 字段或版本表
- 自定义六句文案（本期固定模板）
- 列表级「未完成吃透」筛选与统计看板

## 2. System Context

### 现有链路（复用）

```text
文章校验完成
  -> ArticleAIPipelineService._enqueue_post_validation_tasks
  -> process_article_interpretation（优先）
     或旧路径 process_ai_content(summary|outline|quotes) + classification/tagging
  -> AIAnalysis.summary / outline / quotes
  -> 详情页 AI 区展示

笔记：
  PUT /api/articles/{slug}/notes  -> Article.note_content / note_annotations / note_recommendation_level

Prompt：
  PromptConfig(type=summary|outline|quotes|...)
  管理端可配置 is_default / is_enabled / model 绑定

任务：
  AITaskService.enqueue_task + worker 轮询
  process_ai_content / process_article_interpretation 已在 AITaskService 分发表中
```

### 本期触及面

| 层 | 触及点 |
|----|--------|
| 设置 | `AdminSettings.auto_ai_outline_enabled` 默认与迁移 |
| Prompt 种子/文案 | 默认 summary、outline；新增 `digest_prefill` |
| 解读包 | 合并调用时 outline instruction 与单项 outline 语义一致 |
| Worker / pipeline | 新 content_type 或任务处理分支：`digest_prefill` |
| API | 触发预填、查询任务结果；笔记仍走既有 PUT |
| 前端详情页 | 大纲默认可见；笔记区模板/预填/合并 UX |
| 版本表 | **不**把 `digest_prefill` 纳入 `AIAnalysisVersion` 的 summary/outline/quotes 版本体系 |

### 边界

- **公开解读**：`AIAnalysis` 的 summary/outline/quotes（+ 分类标签）
- **个人消化**：`Article.note_content`（六句模板落点）
- **预填任务产物**：挂在 `AITask` 结果上供前端合并，默认 **不** 自动写笔记（避免与用户正在编辑冲突）

## 3. Component Reuse

| 能力 | 决策 | 说明 |
|------|------|------|
| `process_article_interpretation` / `process_ai_content` | **extend** | P0 改 instruction 与默认 options，不换任务总线 |
| `PromptConfig` + admin prompt UI | **extend** | 新增 type=`digest_prefill`；支持选模型与改提示词 |
| `AITaskService` + worker | **extend** | 预填走同一队列、状态机、锁与超时 |
| `PUT .../notes` | **reuse** | 合并后的笔记由前端（或可选二次确认）写入 |
| `AIAnalysisVersion` | **not_applicable** | 预填不是可回滚的公开 AI 内容版本 |
| 新建 digest 实体表 | **不采用** | 首期复用 note 文本；无强查询需求不建表 |
| 前端规则拼接替代模型 | **不采用** | 产品确认质量优先小模型调用；规则仅作模板骨架与合并 |

### 对 Open Question 2 的技术结论

**预填应走现有 worker，并支持 PromptConfig。**

理由：

1. 与 summary/outline 一致的鉴权、限流、超时、失败重试、任务中心可观测
2. 管理员可调提示词/模型，无需发版改文案
3. 详情页已有 task 轮询模式（interpretation / generate），UX 可对齐
4. 避免在 API 请求线程内同步打模型导致超时与双路径

不建议：纯前端拼装作为正式方案（仅可作无模型/无摘要时的降级骨架）。

## 4. Settled Product Decisions（写入实现约束）

| # | 决策 |
|---|------|
| Q1 大纲默认 | 默认开启；现有库迁移统一置 true；发布说明提示成本变化；设置页可一键关闭 |
| Q2 预填实现 | 小模型调用 + worker + PromptConfig |
| Q3 自由笔记 | 默认 **追加** 模板到末尾；**替换** 需二次确认 |
| Q4 模板文案 | 本期固定六句，不可配置 |

固定模板真源：

```text
这篇文章讲的是 ____
作者最核心的观点是 ____
作者用了 ____ 来证明
我认为最有价值的是 ____
我不完全认同的是 ____
我准备采取的一个行动是 ____
```

- 前 3 句：可 AI 预填  
- 后 3 句：模型必须输出空槽 `____` 或等价空白，禁止代写实质内容  

## 5. Proposed Design

### 5.1 P0 — 客观契约

#### 5.1.1 默认 prompt 语义（summary）

更新内置「默认-快读摘要」及解读包内 summary instruction，必须覆盖：

1. 主题，或技术文语境下「解决了什么问题」
2. 核心结论/结果  

约束保持短、客观、中文优先；禁止开场套话与列表堆砌。允许在现网字数带内略放宽语义密度，但不得膨胀成长文总结。

#### 5.1.2 默认 prompt 语义（outline）

更新内置「默认-大纲」及解读包 outline instruction。语义层级约定写在**提示词**中，解析层不写死分区名：

1. 根：主题概括  
2. L1 固定三分区（title 原文一致、顺序固定）：**核心观点** / **关键概念** / **结论与启示**  
3. 「核心观点」下 2–3 个立论；每个立论下最多再嵌一层证明/展开（数据/案例/步骤/对比；不足写“证明链不清晰”，禁止编造）  
4. 「关键概念」：术语/机制，叶子「概念：极简释义」；无则空 children  
5. 「结论与启示」：结论与启示；可含「行动：...」  
6. 禁止把正文小标题提升为 L1；全树建议 ≤25 节点  

**传输协议**仍由代码薄约束：JSON 树，节点仅 `title` + `children`；不校验 L1 必须等于上述三分区（兼容自定义 prompt 与历史数据）。

#### 5.1.3 金句

- 默认自动仍关闭：`auto_ai_quotes_enabled = false`
- 不参与吃透验收主路径

#### 5.1.4 `auto_ai_outline_enabled`

| 项 | 行为 |
|----|------|
| ORM / 新建 AdminSettings | default `True` |
| 读取 fallback | 凡 `getattr(..., False)` 的 outline 默认改为 **True**（与 summary/tagging「未设置当开」一致，或显式 `is not False`） |
| 迁移 | 现有 `admin_settings` 行统一 `auto_ai_outline_enabled = 1` |
| 再生解读 options | `article_router` / `article_command_service` 组装 options 时 outline 跟新默认 |
| 回滚 | 设置关；或迁移 down 恢复旧 default false（不强制改回用户已关的值以外的历史） |

#### 5.1.5 详情页 IA（P0）

- 摘要区保持可见  
- AI Tab 默认 `outline`（现网已有默认 outline 倾向则保持并强化空态文案）  
- 无大纲：空态说明用途（拆结构/核心观点）+ 一键 `generateAIContent(outline)`  

不在本期改信息架构为新「吃透」Tab。

### 5.2 P1 — 预填任务与 Prompt

#### 5.2.1 新 PromptConfig type

- `type = "digest_prefill"`
- 种子名建议：`默认-吃透前三句预填`
- `response_format`：按现网 prompt 体系（若已去掉 response_format 列，则靠 prompt + pipeline 解析约定）
- 绑定可选通用模型；解析失败走默认模型选择逻辑（与 `process_ai_content` 一致）

**输出契约（结构化，推荐 JSON）：**

```json
{
  "line1": "这篇文章讲的是 ...",
  "line2": "作者最核心的观点是 ...",
  "line3": "作者用了 ... 来证明",
  "line4": "我认为最有价值的是 ____",
  "line5": "我不完全认同的是 ____",
  "line6": "我准备采取的一个行动是 ____"
}
```

校验规则：

- 六键齐全；值为字符串  
- `line4`–`line6` 不得包含除前缀与 `____`/空白外的实质评价/行动（实现可用：去掉固定前缀后 trim，只允许空或 `____`）  
- `line1`–`line3` 非空；禁止编造文中不存在的数据/案例  

**输入材料（服务端组装，不靠模型自己找库）：**

优先级：

1. `AIAnalysis.outline`（若 completed 且非空）  
2. `AIAnalysis.summary`  
3. 降级：`content_md` 截断（token 预算内）  

Prompt 中明确标注材料来源段落，并写死「后三句禁止代写」。

#### 5.2.2 任务模型

**推荐方案（与现网 generate 对齐）：**

```text
task_type = process_ai_content
content_type = digest_prefill
```

- 在 `ArticleAIPipelineService.process_ai_content` 增加 `digest_prefill` 分支  
- **不** 写入 `AIAnalysis.summary/outline/quotes`  
- **不** 调用 `AIAnalysisVersion`  
- 结果写入任务完成 payload / `AITask` 结果字段（与现网 task 结果可读性对齐；若现网 generate 只改 analysis 字段，则为 prefill 单独把 `result` JSON 挂到 task 完成数据，供 `GET task` 读取）  

备选（仅当 process_ai_content 分支过重时）：

```text
task_type = process_article_digest_prefill
content_type = digest_prefill
```

需在 `AITaskService` 分发表与 `ai_tasks_router` 白名单登记。优先扩展 `process_ai_content` 以减少新 task_type 面。

**幂等：**

- 同一文章允许重复预填；`enqueue_task` 对 pending 同 `(task_type, content_type, article_id)` 去重策略与现网一致  
- 新触发若已有 processing，返回已有 `task_id` 或 409（与 generate 行为对齐，实现时选一种并在 API 文档写清）

**不入自动后处理：**

- `_enqueue_post_validation_tasks` **不得** 自动 enqueue `digest_prefill`

#### 5.2.3 API

**触发预填**

```http
POST /backend/api/articles/{article_slug}/digest/prefill
```

Auth：管理员（与 notes / generate 一致）

Query/body 可选：

- `model_config_id`
- `prompt_config_id`

行为：

1. 校验文章存在且有可读材料（summary 或 outline 或 content_md）  
2. 若三者皆空 → 409  
3. enqueue 任务，返回：

```json
{
  "success": true,
  "task_id": "...",
  "content_type": "digest_prefill",
  "status": "pending"
}
```

**读取结果**

- 复用现有 AI 任务查询 API（详情页已有轮询）  
- 完成时 `result` 至少包含：

```json
{
  "lines": {
    "line1": "...",
    "line2": "...",
    "line3": "...",
    "line4": "我认为最有价值的是 ____",
    "line5": "我不完全认同的是 ____",
    "line6": "我准备采取的一个行动是 ____"
  },
  "note_markdown": "六行拼接文本"
}
```

**明确不做**

- 服务端直接 `UPDATE note_content` 作为默认完成副作用  
- 预填结果进入 public article payload 的 `ai_analysis`

**笔记写入**

- 仍 `PUT /api/articles/{slug}/notes`  
- 前端合并后再保存；用户可编辑后保存  

### 5.3 笔记合并算法（前端主责，后端可提供纯函数供测）

#### 5.3.1 模板识别

六行固定前缀：

```text
这篇文章讲的是
作者最核心的观点是
作者用了
我认为最有价值的是
我不完全认同的是
我准备采取的一个行动是
```

判定 `is_digest_template(note)`：

- 笔记 trim 后按行解析  
- 连续 6 行（允许中间空行策略：实现选「严格 6 行」或「按前缀提取 6 行」；推荐 **按前缀顺序提取**，更抗轻微空行）  
- 六前缀均出现且顺序正确 → 模板笔记  

#### 5.3.2 操作与状态机

| 用户动作 | 笔记状态 | 行为 |
|----------|----------|------|
| 填入吃透模板 | 空 | 写入六句骨架（全 `____`） |
| 填入吃透模板 | 已是模板 | no-op 或仅补全缺失行；不 Cleared 用户后三句 |
| 填入吃透模板 | 自由笔记 | **默认追加** 一块模板到末尾（前空一行分隔） |
| 替换为吃透模板 | 任意非空 | 二次确认后整段替换为骨架 |
| AI 预填前三句 | 空 | 先骨架，再写入预填 line1–3 |
| AI 预填前三句 | 模板 | 只替换 line1–3 对应行；**保留** line4–6 用户正文 |
| AI 预填前三句 | 自由笔记 | 默认 **追加** 预填后的完整六句块到末尾；若用户选「替换」则确认后整替 |
| 重新预填 | 模板 | 同「只更新前三句」 |

合并伪代码：

```text
apply_prefill(note, lines, mode):
  if mode == replace_confirmed:
    return join(lines)
  if is_empty(note):
    return join(lines)
  if is_digest_template(note):
    return replace_first_three_lines(note, lines)
  # free note
  if mode == append (default):
    return note + "\n\n" + join(lines)
  if mode == replace_confirmed:
    return join(lines)
```

#### 5.3.3 完成态（轻量）

- 不落库新字段（本期）

### 5.4 前端交互要点

笔记区新增（文案走 i18n）：

1. **填入吃透模板**  
2. **AI 预填前三句**（触发 API → 轮询 task → 本地合并 → 用户可再点保存笔记）  
3. 自由笔记场景下，若用户点「替换」类操作 → confirm dialog  

文案约束：

- 标明「仅预填客观三句，请补全主观三句」  
- 预填失败 toast；笔记草稿不丢  

AI 区：

- 大纲空态与默认 Tab 按 5.1.5  

权限：

- 预填/改笔记：管理员（与现网 notes 一致）  
- 不扩展访客写笔记  

### 5.5 状态流

```text
[P0 入库]
post_validation
  -> interpretation options: classification/tagging/summary/outline(默认 true)/quotes(false)
  -> process_article_interpretation
  -> AIAnalysis.* completed/failed

[P1 按需]
用户点预填
  -> POST digest/prefill
  -> AITask pending/processing
  -> worker: load summary/outline/content, PromptConfig(digest_prefill), model call
  -> validate JSON lines
  -> task completed + result.lines
  -> 前端 merge note draft
  -> 用户 PUT notes
```

失败：

| 失败 | 处理 |
|------|------|
| 无材料 | 409，提示先生成摘要/大纲 |
| 无 prompt/模型 | 与 process_ai_content 一致 TaskConfigError → failed |
| 模型输出非法 / 后三句被代写 | 校验失败，任务 failed，错误信息可读 |
| 超时 | 现网 AI 超时路径 |
| 用户编辑中 | 不自动写库；合并仅改前端 draft |

## 6. Data Model

### 无新表（MVP）

| 字段 | 变更 |
|------|------|
| `admin_settings.auto_ai_outline_enabled` | 默认 true + 数据迁移置 1 |
| `prompt_configs` | 新增 type=`digest_prefill` 默认行（Alembic seed upsert） |
| `ai_tasks` | 复用；content_type 新增值 `digest_prefill` |
| `ai_analyses` | 不新增 digest 列 |
| `articles.note_content` | 继续存最终六句/自由笔记文本 |

### 可选后续（非本期）

- `note_digest_completed_at` 或结构化 note JSON — 仅当列表筛选有强需求时再开  

## 7. Compatibility

- 文章���情 API 主字段不 breaking  
- 大纲 JSON 协议不 breaking  
- 旧文章不强制重跑 interpretation；仅新生成/用户手动再生吃到新 prompt  
- `route_contract_baseline` / `response_contract_baseline`：新增 prefill 路由需更新 baseline  
- 解读包 TRD 语义：summary/outline instruction 变更后，bundle 与单字段路径必须共用同一 instruction 源（避免双源漂移）  

## 8. Security & Privacy

- 预填 API：admin only  
- 任务结果仅认证管理员可读（与现网 task API 一致）  
- 主观笔记不进 RSS/公开 AI 字段  
- Prompt 注入：材料来自己库文章，仍按现网 content 拼接方式；不把 note 历史送进预填除非未来明确要  

## 9. Observability

- Task：`content_type=digest_prefill` 可在任务列表筛选  
- 日志：article_id、model_config_id、prompt_config_id、材料来源 flags（has_outline/has_summary/content_fallback）、校验失败原因  
- 指标（若已有任务计数）：prefill enqueued / succeeded / failed / validation_failed  
- 设置变更：outline 默认开后的 interpretation 调用耗时与 token（依赖现网 usage 字段）  

## 10. Migration & Rollout

1. Alembic：  
   - `auto_ai_outline_enabled` 默认与全表置 1  
   - seed/upsert `digest_prefill` 默认 prompt  
   - 可选：更新内置 summary/outline 默认 prompt 文本（按 id/name 匹配 is_default 内置项；勿覆盖用户自定义非 default）  
2. 后端：pipeline + router + task 分发 + 校验  
3. 前端：笔记区 + i18n + 大纲空态  
4. 更新 route/response contract baseline  
5. 单元测试 + 手动详情页验收  
6. 发布说明：大纲默认开、成本与关闭路径  

**Rollback：**

- 设置关闭 auto outline  
- 禁用 `digest_prefill` prompt / 隐藏前端按钮  
- 迁移 down 仅回滚 default 与 seed；已写入的 note 文本保留  

## 11. Testing Strategy

### 单元

- outline/summary prompt 不测文采，测 pipeline 对 `digest_prefill` JSON 校验：后三句代写应 fail  
- 合并纯函数：empty / template / free × append / replace  
- options 组装：新默认 outline true  

### API

- prefill 无材料 409  
- prefill 入队 200 + task_id  
- 非 admin 401/403  

### 集成 / 手动

- 新文章默认产生 outline（配置开）  
- 预填不改 `ai_analysis.summary`  
- 模板笔记重新预填保留后三句  
- 自由笔记默认追加不静默覆盖  

### 回归

- `pytest tests/unit`  
- `check_route_coverage` / `check_response_contract`  
- 解读包生成 summary+outline 仍触发 embedding hook（摘要完成 hook 不因 prefill 改变）  

## 12. Risks & Mitigations

| 风险 | 缓解 |
|------|------|
| 大纲默认开导致成本/时长上升 | 金句默认关；设置可关；发布说明 |
| 双路径 prompt 漂移（bundle vs single） | 共用 field instruction 解析；seed 单次更新 |
| 模型无视后三句约束 | 服务端硬校验 + 失败可重试 |
| 预填与用户编辑冲突 | 不自动写 note；只更新 draft |
| 模板识别误判自由笔记 | 前缀顺序严格；自由笔记默认 append |
| `process_ai_content` 膨胀 | 预填分支短小；复杂校验抽纯函数 |

## 13. Open Implementation Notes（非产品未决）

- task 结果字段具体落在 `AITask` 哪一列/JSON 键：实现时对齐现网 `finish_task` 成功 payload 读法，并在 frontend poll 使用同一字段  
- 内置 prompt 更新策略：只更新 `is_default=1` 且 name 匹配种子的行，或按 migration 固定 id  
- i18n：按钮与确认框中英对照  

## 14. Design Inputs for Execution Plan

建议实现切片（供 `write-execution-plan`，非本 TRD 任务）：

1. 迁移：outline 默认 true + digest_prefill seed + summary/outline 内置文案  
2. pipeline：`digest_prefill` 处理、校验、任务结果  
3. API：`POST .../digest/prefill` + contract baseline  
4. 前端：合并工具函数 + 笔记区 UX + 轮询  
5. 详情页大纲空态/默认 Tab 文案  
6. 测试与手动验收清单  

## 15. Acceptance Mapping（对 PRD）

| PRD | TRD 落点 |
|-----|----------|
| R1 摘要/大纲契约 | §5.1.1–5.1.2 prompt |
| R2 大纲默认交付 | §5.1.4–5.1.5 设置+IA |
| R3 六句模板与预填 | §5.2–5.3 |
| R4 权限与公开边界 | §5.2.3 §8 |
| R5 失败空态 | §5.5 |
| Q2 worker+配置 | §3 §5.2 |
