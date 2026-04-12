# AI 解读续写与 API 类型设计

## 目标

为后台任务详情中的 AI 调用节点增加“提交修改意见”能力，使管理员可以基于已有上下文继续生成文章 AI 解读。同时为模型配置新增 `api_type`，支持 `chat_completions` 与 `responses` 两种调用模式，并分别提供可兼容的续写方案。

## 范围

- 第一阶段入口仅放在 `后台管理 -> 任务详情 -> 调用链 -> AI 调用节点`。
- 第一阶段仅支持 `process_ai_content` 任务。
- 支持的 AI 解读类型为 `summary`、`key_points`、`outline`、`quotes`、`infographic`。
- 现有“信息图修复”弹窗并入新的“提交修改意见”弹窗，不再维持独立主流程。
- 不在本期扩展到文章详情页，也不扩展到翻译、清洗、分类、标签等其他任务类型。

## 用户体验

- 在符合条件的 AI 调用节点右上角展示“提交修改意见”按钮。
- 点击后弹出统一弹窗，展示当前节点的模型、内容类型、时间、状态等摘要信息。
- 管理员填写本次修改意见，可选覆盖模型配置；提示词配置默认沿用原调用配置，本期不开放覆盖。
- 对 `infographic` 节点，弹窗占位文案偏“修复/调整布局与视觉”；对其他 AI 解读节点，文案偏“调整表达、结构、重点或风格”。
- 提交后不做同步覆盖，而是入队新的后台任务；任务时间线刷新后可看到新的调用节点与版本结果。

## API 类型

`ModelAPIConfig` 新增 `api_type` 字段，枚举值为：

- `chat_completions`
- `responses`

迁移规则：

- 已有模型配置在迁移后默认填充为 `chat_completions`。
- 新建模型配置时必须显式选择 API 类型。
- 不根据 provider 或 model name 自动推断 API 类型。

## 续写能力模型

新增统一的 AI 调用适配层，业务层不直接依赖 OpenAI SDK 的具体接口。能力入口统一为：

- `invoke_generation(...)`
- `invoke_continuation(...)`

统一结果对象至少包含：

- `content`
- `usage`
- `request_payload`
- `response_payload`
- `session_info`

其中 `session_info` 统一描述为：

```json
{
  "api_type": "chat_completions | responses",
  "continuation_mode": "provider | snapshot",
  "provider_response_id": "...",
  "provider_request_id": "...",
  "provider_conversation_id": "...",
  "input_snapshot": {},
  "output_snapshot": {},
  "source_usage_log_id": "..."
}
```

### `chat_completions`

- 首次调用时保存原始请求/响应，以及应用侧上下文快照。
- 续写时由后端重建消息历史：
  - 原系统提示词
  - 原用户提示词或业务输入摘要
  - 上一次输出摘要或完整输出
  - 本次修改意见
- `chat_completions` 不依赖平台侧会话状态，续写能力完全由应用侧快照实现。

### `responses`

- 首次调用时保存原始请求/响应，并额外保存可用于续写的模型侧标识，例如 `previous_response_id` 所需的响应 id。
- 续写时优先使用模型侧续写能力。
- 如果模型侧续写不可用、调用失败或供应商兼容层不返回稳定标识，则自动回退到应用侧上下文快照重建模式。

## 持久化设计

新增独立表 `ai_call_sessions`，与 `ai_usage_logs` 分工明确：

- `ai_usage_logs` 负责调用成本、状态、原始请求/响应。
- `ai_call_sessions` 负责记录续写所需的模型侧状态与应用侧快照。

建议字段：

- `id`
- `usage_log_id`
- `task_id`
- `article_id`
- `task_type`
- `content_type`
- `api_type`
- `continuation_mode`
- `provider_response_id`
- `provider_request_id`
- `provider_conversation_id`
- `input_snapshot`
- `output_snapshot`
- `source_usage_log_id`
- `created_at`
- `updated_at`

任务时间线接口需要在 usage 节点中补充会话信息，以便前端判断该节点是否支持继续提交修改意见。

## 接口设计

新增以 usage 节点为中心的 continuation 接口：

- `POST /api/ai-usage/{usage_id}/continue`

请求体包含：

- `feedback`
- `model_config_id`（可选）

处理流程：

1. 校验 usage 归属的任务类型为 `process_ai_content`。
2. 读取 usage 对应的 `session_info`。
3. 按 `api_type` 选择 continuation 策略。
4. 新建 continuation 任务入队。
5. 任务完成后写回目标 AI 解读字段，并记录 usage、session、version 与 task event。

## 与现有信息图修复流程的关系

- 旧的 `repair-infographic` 接口先保留为兼容壳。
- 兼容壳内部转发到新的 continuation 能力，默认将 `error_message` 视为 `feedback`。
- 前端不再使用独立“信息图修复”弹窗，而统一走“提交修改意见”弹窗。

## 版本与审计

- continuation 结果继续沿用现有 AI 解读版本记录体系。
- 每次 continuation 成功生成新结果后，写入当前 AI 解读字段并生成新版本。
- 版本与任务元数据中保留：
  - `source_usage_log_id`
  - `continuation_feedback`

这样既能保留回滚能力，也能保留管理后台的链路审计能力。

## 兼容与迁移

- 后端需要为 `responses` 适配器补充支持，当前 `openai==1.3.7` 主要面向 `chat.completions`，实现本设计时需要同步升级 OpenAI Python SDK。
- `chat_completions` 路径保持现有行为兼容，仅新增快照记录和 continuation 组装逻辑。
- 没有 `session_info` 但存在 `request_payload/response_payload` 的旧 usage 节点，可以尽量基于原始 payload 推导快照，继续开放按钮。
- 两者都缺失的旧节点不开放 continuation 操作。

## 验证

后端：

- 迁移后旧模型配置默认 `api_type=chat_completions`。
- `chat_completions` 首次调用会记录快照会话。
- `chat_completions` continuation 会正确重建历史消息。
- `responses` 首次调用会记录模型侧续写标识。
- `responses` continuation 优先使用模型侧续写，失败后回退快照模式。
- `POST /api/ai-usage/{usage_id}/continue` 仅允许 `process_ai_content`。
- `repair-infographic` 兼容接口会转发到 continuation 流程。

前端：

- 模型配置表单可选择 API 类型。
- 后台任务详情中的 AI 调用节点可显示“提交修改意见”按钮。
- `infographic` 节点原修复入口并入统一弹窗。
- 提交成功后时间线可刷新并展示新的调用节点。
- 无有效 session/快照的旧节点不展示 continuation 按钮或展示禁用态说明。
