---
id: trd-article-ai-interpretation-bundle
type: trd
status: draft
created_at: 2026-06-22
updated_at: 2026-06-22
sources:
  - backend/app/domain/article_ai_pipeline_service.py
  - backend/app/domain/ai_task_service.py
  - backend/models.py
  - frontend/pages/article/[id].tsx
  - frontend/lib/api.ts
related:
  - docs/trd/knowledge-graph-graphrag.md
  - docs/api/knowledge-base-api.md
---

# TRD: 文章 AI 解读合并调用

## 背景和目标

当前 Lumina 文章入库后的 AI 后处理粒度较细：分类、标签、摘要、大纲、金句分别通过独立任务或独立内容类型生成。这个设计便于单项重试，但会带来多次模型调用、任务链路较长、状态组合复杂、完成时机不清晰等问题。

用户希望先于知识图谱改造，将文章级 AI 解读合并成一次 AI 调用，由一次结构化输出同时产生：

- 分类
- 标签
- 摘要
- 大纲
- 金句

本改造的目标是降低文章入库后的 AI 调用次数和任务复杂度，并为后续知识图谱索引提供一个更稳定的文章解读完成事件。

### 技术目标

- 新增统一文章解读任务 `process_article_interpretation`。
- 用一次模型调用生成分类、标签、摘要、大纲、金句的结构化结果。
- 继续写回现有 `Article`、`AIAnalysis`、`Tag`、`AIAnalysisVersion` 等模型，保持前端和 API 兼容。
- 保留单项重新生成能力，避免一次合并后丢失手动修复入口。
- 调整文章 embedding 和未来知识索引触发点，使其不再依赖 `process_ai_content(summary)` 这个细粒度任务名。
- 与后续知识图谱改造解耦：文章解读包面向阅读体验，知识图谱抽取仍独立处理实体、关系、claim 和证据。

### 非目标

- 不在本阶段合并翻译、正文清洗、媒体入库、配图、评论、Review 功能。
- 不删除现有 `process_ai_content`、`process_article_tagging`、`process_article_classification` 能力。
- 不改变文章详情 API 的现有主要字段。
- 不把知识图谱的实体/关系/claim 抽取放入文章解读 prompt。
- 不要求一次性迁移所有历史任务记录。

## 当前系统上下文

### 当前任务链路

文章清洗或校验完成后，`ArticleAIPipelineService._enqueue_post_validation_tasks` 会按配置排队后处理任务：

```text
process_article_classification
  -> process_article_tagging
  -> process_ai_content(summary)
  -> process_ai_content(outline)
  -> process_ai_content(quotes)
  -> process_article_translation
```

其中分类任务完成后会继续根据配置排队标签、摘要、大纲、金句和翻译任务。摘要完成后会触发 `process_article_embedding`。

### 当前数据结构

`AIAnalysis` 已有以下字段：

- `summary` / `summary_status`
- `outline` / `outline_status`
- `quotes` / `quotes_status`
- `classification_status`
- `tagging_status`
- `tagging_source_hash`
- `tagging_manual_override`
- 当前版本字段：`current_summary_version_id`、`current_outline_version_id`、`current_quotes_version_id`

`Article` 保存：

- `category_id`
- `status`
- `translation_status`

标签通过 `article_tags` 关联表和 `tags` 表维护。

### 当前前端和 API 依赖

文章详情 API 返回 `ai_analysis.summary_status`、`outline_status`、`quotes_status`、`classification_status`、`tagging_status` 等字段。前端详情页基于这些字段展示加载、失败、完成、历史版本和重新生成入口。

因此，本改造应保持这些字段语义可用，即使底层生成方式从多任务变为单任务。

## Proposed Design

### 任务模型

新增任务类型：

| task_type | content_type | 说明 |
|---|---|---|
| `process_article_interpretation` | `interpretation` | 一次调用生成分类、标签、摘要、大纲、金句 |

保留旧任务：

| task_type | 保留原因 |
|---|---|
| `process_article_classification` | 单独重跑分类、兼容旧任务 |
| `process_article_tagging` | 单独重跑标签、保留手动覆盖逻辑 |
| `process_ai_content` | 单独重跑摘要、大纲、金句和历史版本 |

`AITaskService.run_task_async` 新增 handler：

```text
process_article_interpretation
  -> ArticleAIPipelineService.process_article_interpretation(...)
```

### 后处理排队策略

新文章后处理默认使用合并解读任务。系统不提供“是否走合并”的用户配置；只有详情页的单项重试继续走旧单项任务。

```text
article cleaning completed
  -> enqueue process_article_interpretation
  -> optional enqueue translation
```

### 结构化输出协议

统一解读 prompt 必须要求 JSON object 输出：

```json
{
  "category_id": "string",
  "tags": ["string"],
  "summary": "string",
  "outline": null,
  "quotes": ["string"]
}
```

字段规则：

- `category_id` 必须为空字符串或候选分类 ID 中的一个。
- `tags` 必须是字符串数组，后端继续复用现有标签清洗、去重和数量限制。
- `summary` 为纯文本或 Markdown 文本。
- `outline` 启用时沿用现有大纲 JSON 树协议，只允许 `title` 和 `children`；未启用时返回 `null`。
- `quotes` 为字符串数组，落库时可转为当前前端兼容的换行文本。

整包输出采用本次启用字段对应的固定 schema。未启用字段不拼接对应任务要求，也禁止出现在响应 JSON 中；后端直接将未启用字段标记为 `skipped`：

| 字段 | 未启用时状态 |
|---|---|---|
| `category_id` | `classification_status=skipped` |
| `tags` | `tagging_status=skipped` |
| `summary` | `summary_status=skipped` |
| `outline` | `outline_status=skipped` |
| `quotes` | `quotes_status=skipped` |

按启用字段裁剪 schema 可以减少无关提示词对生成质量的干扰，并降低上下文占用。

后端必须对输出做 schema 校验和局部容错。不能因为一个字段非法就丢弃所有合法字段。

### 部分成功策略

合并调用会扩大失败半径，因此落库必须支持部分成功：

| 字段 | 成功时 | 失败或缺失时 |
|---|---|---|
| 分类 | 更新 `Article.category_id`，`classification_status=completed` | `classification_status=failed` 或 `skipped` |
| 标签 | 更新 tags，`tagging_status=completed` | `tagging_status=failed` 或保留手动标签 |
| 摘要 | 更新 `summary`，记录版本，`summary_status=completed` | `summary_status=failed` |
| 大纲 | 更新 `outline`，记录版本，`outline_status=completed` | `outline_status=failed` |
| 金句 | 更新 `quotes`，记录版本，`quotes_status=completed` | `quotes_status=failed` |

如果模型调用整体失败，所有启用字段标记为 `failed`，并记录统一错误。若模型调用成功但某些字段解析失败，则已解析字段落库，失败字段单独标记错误。

### 手动覆盖和单项重试

必须保留当前能力：

- 手动编辑标签后，`tagging_manual_override=true` 时合并任务不得覆盖标签，除非 payload 带 `force_tagging=true`。
- 文章详情页仍可单独重新生成摘要、大纲、金句。
- 文章详情页仍可单独重新自动打标。
- 单项重新生成继续使用旧任务，不强制走整包重跑。
- 整包重跑作为新增入口，可用于“重新生成 AI 解读”。

### 版本记录

摘要、大纲、金句仍需写入 `AIAnalysisVersion`，以保持历史版本、回滚和前端展示兼容。

统一任务可为每个成功字段记录一个版本：

```text
content_type=summary, source_task_id=<interpretation_task_id>
content_type=outline, source_task_id=<interpretation_task_id>
content_type=quotes, source_task_id=<interpretation_task_id>
```

`created_by_mode` 可继续使用 `generation`。如需区分来源，可后续扩展为 `bundle_generation`，但第一阶段不强制。

### Usage Log 和调用会话

一次模型调用只应记录一条主 `AIUsageLog`：

```text
task_type=process_article_interpretation
content_type=interpretation
```

如果需要统计到字段层面，可在 `request_payload` 或 `response_payload` 里记录启用字段和字段结果状态。不要为了统计拆成多条伪 usage log，以免误导成本计算。

### 文章 embedding 触发

当前摘要生成完成后会触发文章 embedding。合并后应抽出统一 hook：

```text
on_article_summary_completed(article_id)
  -> enqueue process_article_embedding if recommendations enabled
```

这个 hook 可被 `process_article_interpretation` 和旧的 `process_ai_content(summary)` 共用。不要继续把 embedding 触发硬编码在 `process_ai_content` 内部。

### 知识图谱衔接

本改造先于知识图谱实施。为后续图谱设计预留两个事件：

```text
on_article_content_ready(article_id)
  -> 可触发基础知识索引，强依赖 content_md

on_article_interpretation_completed(article_id)
  -> 可触发知识索引增强或重索引，使用 category/tags/summary/outline/quotes 作为辅助信号
```

知识图谱抽取不应依赖文章解读一定成功。正文清洗完成后即可进行基础图谱索引；文章解读完成后再做增强。

## 接口和契约

### 后端内部方法

新增：

```python
async def process_article_interpretation(
    self,
    article_id: str,
    category_id: str | None,
    model_config_id: str | None = None,
    prompt_config_id: str | None = None,
    post_process_options: dict | None = None,
    force_tagging: bool = False,
) -> None:
    ...
```

新增辅助方法：

- `build_interpretation_prompt_context`
- `parse_interpretation_result`
- `apply_interpretation_result`
- `mark_interpretation_fields_processing`
- `mark_interpretation_fields_failed`
- `enqueue_after_interpretation_hooks`

### API 行为

现有文章详情 API 不改变响应字段。

新增或调整管理 API：

| API | 说明 |
|---|---|
| `POST /api/articles/{article_slug}/interpretation/regenerate` | 重新生成整包 AI 解读 |

现有单项接口继续保留：

- `POST /api/articles/{slug}/generate/{content_type}`
- `PUT /api/articles/{slug}/ai-content/{content_type}`
- `DELETE /api/articles/{slug}/ai-content/{content_type}`
- `POST /api/articles/{slug}/tags/regenerate`

### Prompt 配置

不新增用户可配置的 `interpretation` prompt type。合并解读的编排模板由后端内置，运行时按启用字段拼接各单项 prompt 的任务要求，并注入文章正文、分类列表、参考分类和固定输出协议。

旧 prompt type 继续保留：

- `classification`
- `tagging`
- `summary`
- `outline`
- `quotes`

### Admin 设置

保留现有字段级开关：

- `auto_ai_classification_enabled`
- `auto_ai_summary_enabled`
- `auto_ai_outline_enabled`
- `auto_ai_quotes_enabled`
- `auto_ai_tagging_enabled`

整包任务应尊重这些开关。比如关闭 `auto_ai_quotes_enabled` 时，整包 prompt 不拼接金句任务要求，输出 schema 不包含 `quotes`，后端将 `quotes_status` 标记为 `skipped`，不算失败。关闭 `auto_ai_outline_enabled` 时同理。

## 数据和迁移

### 数据库迁移

需要新增：

- `ai_analyses.interpretation_status`
- `ai_analyses.interpretation_error`

建议第一阶段新增 `interpretation_status`，用于前端整体状态和任务可观测性。但现有字段仍作为单项状态来源。

`interpretation_status` 状态：

```text
pending
processing
completed
partial_completed
failed
skipped
```

### 历史数据

历史文章不需要批量迁移。已有 `summary`、`outline`、`quotes`、分类和标签继续可用。

历史任务记录不需要改写。新任务类型只影响新增或重试流程。

## 前端设计

### 文章详情页

保留现有单项展示：

- 摘要状态。
- 大纲状态。
- 金句状态。
- 标签状态。
- 版本历史。
- 单项重新生成。

新增或调整：

- “重新生成 AI 解读”按钮，触发整包重跑。
- 若 `interpretation_status=processing`，可显示整体处理中状态，同时保留单项状态。
- 若 `partial_completed`，显示已完成字段，并允许单项补跑失败字段。

### 管理后台

在 AI 后处理设置中新增：

- 字段级开关继续控制分类、标签、摘要、大纲、金句是否进入整包任务。
- 不展示“合并文章 AI 解读调用”开关。
- 不展示 interpretation 编排 prompt 配置入口。

## 可靠性和失败处理

- 整包任务失败不应影响文章阅读和正文清洗结果。
- JSON 解析失败时应记录原始响应片段，便于排查，但避免在前端暴露敏感 prompt 或密钥。
- 分类 ID 不存在时只标记分类失败，不影响摘要、标签、大纲、金句落库。
- 标签手动覆盖时不覆盖标签，但其他字段仍可更新。
- 大纲结构非法时可尝试规范化；仍失败则只标记大纲失败。
- 部分字段失败后，用户可单项重试。
- 旧细粒度流程仅作为详情页单项重试和历史任务兼容路径。

## 性能和成本

合并调用会减少请求次数，但单次 prompt 和输出更长。需要控制：

- 输入正文长度。
- 分类候选数量。
- 大纲层级和节点数量。
- 金句数量。
- max tokens。

如果文章过长，沿用现有 chunk/continuation 能力或先只对清洗后的压缩正文生成解读包。不要在第一阶段让整包任务承担长文多轮综合的全部复杂度。

## 安全和权限

- 整包重跑接口只允许管理员。
- Prompt 和模型配置仍走现有 admin 配置。
- 不在前端暴露模型密钥、系统 prompt 或完整 request payload。
- 生成内容写回前继续做结构校验和必要清洗。

## 兼容、迁移和回滚

### 部署顺序

1. 新增 DB 字段。
2. 新增 `process_article_interpretation` 服务方法和解析器。
3. 新增任务 handler，并作为新文章后处理默认路径。
4. 新增整包重跑 API。
5. 后处理排队逻辑固定排队整包任务。
6. 前端增加整体重跑入口和整体状态展示。

### 回滚

- 旧单项任务和 API 保留，已生成数据仍使用现有字段；如需紧急回滚自动路径，应通过代码回滚或临时补丁处理。
- 新增 `interpretation_status` 可忽略，不影响旧前端字段。

## 测试和验证

### 单元测试

- interpretation JSON 解析成功。
- 缺字段、非法字段、非法分类 ID 的部分成功。
- 标签手动覆盖不被整包任务覆盖。
- 摘要成功后触发 embedding。
- 整包成功后为 summary/outline/quotes 分别记录版本。
- 整包失败时各启用字段状态正确。
- 未启用大纲或金句时，prompt/schema 不包含对应字段，并落为 `skipped`。

### API 测试

- `POST /api/articles/{slug}/interpretation/regenerate` 创建任务。
- 文章详情响应保持原字段兼容。

### 前端手动验证

- 新文章入库后只出现一个整包解读任务。
- 摘要、分类、标签、大纲、金句正常展示。
- 部分失败时能单项补跑。
- 手动标签不会被自动整包任务覆盖。
- 文章 embedding 和相似推荐仍能在摘要完成后触发。

### 回归测试

推荐至少运行：

```bash
cd backend
uv run pytest tests/unit/domain/test_article_ai_pipeline_service.py
uv run pytest tests/unit/domain/test_article_command_service.py
uv run pytest tests/unit/api/test_article_router.py
uv run pytest tests/unit/core/test_db_migrations.py
```

改动完成后再跑：

```bash
uv run pytest tests/unit
```

## 取舍和替代方案

### 保持现有细粒度任务

优点是单项失败隔离好，提示词简单。缺点是调用次数多、状态复杂、后续知识索引难以判断文章级解读何时完成。

### 完全删除细粒度任务

短期不建议。前端单项重试、历史版本、手动修复和旧任务兼容都会受影响。应先新增整包任务作为主路径，旧任务作为手动修复和历史兼容路径。

### 将知识图谱抽取并入整包任务

不建议。文章解读包面向阅读体验，知识图谱抽取面向实体、关系、claim 和证据链。两者输出目标不同，合并会导致 prompt 过大、失败半径过大、证据质量下降。

## 开放问题

- `interpretation_status` 是否必须落表，还是只通过任务状态和单项状态推导。
- 默认是否启用大纲和金句，还是继续尊重当前默认关闭策略。
- 长文整包任务是否需要先做 chunk 压缩，还是沿用当前 prompt token 限制。
- 单项重跑后是否需要更新 `interpretation_status`。

## Execution Plan Inputs

建议后续执行计划按以下切片展开：

1. 增加 migration：`interpretation_status`、`interpretation_error`。
2. 增加 interpretation 输出 schema、解析器和部分成功落库逻辑。
3. 增加 `process_article_interpretation` 任务 handler。
4. 调整 `_enqueue_post_validation_tasks`，默认排队整包任务。
5. 抽出摘要完成 hook，统一触发文章 embedding。
6. 增加整包重跑 API，并保留旧单项 API。
7. 前端增加整体状态和整包重跑入口。
8. 补充单元测试、API 测试和手动验证。
9. 更新知识图谱 TRD 中的文章索引触发描述：正文清洗完成即可基础索引，文章解读完成后用于增强索引。
