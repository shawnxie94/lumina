# AI Task Chain Continuation Design

## 背景

当前“AI 调用续写 / 提交修改意见”已经支持复用上一次调用的 session 信息继续生成，但系统行为仍然把每一次续写视为一个全新的独立任务：

- 前端在任务详情里提交修改意见后，会拿到一个新的 `task_id`，并直接跳到新的任务详情。
- 后端续写接口会重新入队一个新的 `process_ai_content` 任务。
- 任务列表按 `AITask` 一条条展示，因此一次初始生成、一次续写、二次续写会在列表里表现成多条并列任务。

技术上这能工作，但用户感知是不连续的。对于用户来说，续写不是“又发起了一个无关的新任务”，而是“对同一次任务结果继续调整”。这会导致两个体验问题：

1. 任务列表被同一条工作流拆成多个并列任务，难以理解哪一个才是“这次任务”。
2. 任务详情和调用链上下文被切断，像是离开了原任务重新开了一个页面。

本设计要解决的核心问题不是“后端还能不能用新 task 执行”，而是“系统应该如何把同一次 AI 工作流展示为一条连续任务链”。

## 目标

- 把初始生成和后续续写统一纳入同一条“任务链”。
- 任务列表默认只展示链主任务，而不是把续写拆成多条并列项。
- 任务详情展示整条链的事件、调用、续写轮次，形成连续调用链。
- 保留当前队列 / worker / 重试机制，不强行把续写塞回原 `task_id`。
- 前端提交续写后停留在同一任务详情上下文中，只刷新调用链并定位到最新节点。

## 非目标

- 不重写现有 `AITask` 状态机为“一个 task 多次 execution”模型。
- 不在本期引入独立的 `task_chains` 新表。
- 不把所有任务类型都改造成任务链；本期只覆盖 AI 内容生成及其续写场景。
- 不改变 AI 调用 session 复用策略本身，仍沿用当前 `provider` / `snapshot` continuation 机制。
- 不重做任务监控页面的全部筛选和统计口径，只做与“链视角”相关的必要收敛。

## 当前实现概览

### 续写入口

- 前端 [admin.tsx](/Users/shawn/Documents/GitHub/lumina/frontend/pages/admin.tsx) 在任务详情调用链节点上提交修改意见。
- 提交后调用 `articleApi.continueAIUsage(...)`。
- 成功后前端直接 `handleOpenTaskTimeline(result.task_id)`，切到新的任务详情。

### 后端任务创建

- 接口 [ai_usage_router.py](/Users/shawn/Documents/GitHub/lumina/backend/app/api/routers/ai_usage_router.py) 的 `POST /api/ai-usage/{usage_id}/continue` 返回新的 `task_id`。
- 领域逻辑 [article_command_service.py](/Users/shawn/Documents/GitHub/lumina/backend/app/domain/article_command_service.py) 的 `enqueue_ai_continuation(...)` 会调用 `ai_task_service.enqueue_task(...)` 新建一条 `process_ai_content` 任务。
- 新任务 payload 中带有：
  - `continuation_feedback`
  - `continuation_source_usage_id`

### 执行与上下文复用

- 处理器 [article_ai_pipeline_service.py](/Users/shawn/Documents/GitHub/lumina/backend/app/domain/article_ai_pipeline_service.py) 会读取 `continuation_source_usage_id`。
- 若存在来源 usage，则解析对应 `session_info`，再通过 `invoke_continuation(...)` 完成续写。

这意味着系统当前已经区分了两层概念：

- 执行层：续写会新建 task
- 调用层：续写依赖原调用上下文

缺失的是第三层：

- 展示层：没有把这些 task 归并为同一条任务链

## 方案选择

本期比较两种方案：

### 方案 A：给 `ai_tasks` 增加轻量链路字段

新增字段：

- `parent_task_id`
- `root_task_id`

规则：

- 初始任务：`parent_task_id = null`，`root_task_id = 自己`
- 续写任务：`parent_task_id = 来源 task_id`，`root_task_id = 来源 root_task_id`

优点：

- 改造范围可控，贴合现有 `AITask` 模型
- worker 仍按“一次 execution 对应一条 task”处理
- 列表与详情都能用 `root_task_id` 聚合

缺点：

- 链级元数据仍分散在 task 表字段和聚合查询中

### 方案 B：新增独立 `task_chains` 表

优点：

- 链级状态、标题、统计语义更清晰
- 后续可扩展更多链级属性

缺点：

- 需要额外表、外键、迁移、接口层适配
- 对当前问题来说偏重

### 结论

采用 **方案 A：轻量链路字段**。

原因：

- 当前问题是“同一次任务被裂成多个任务视角”，不是“缺少复杂的链级业务实体”。
- 现有队列和任务状态机制已经稳定，没必要为了解决展示语义去重构执行模型。
- `root_task_id` 足以支持“列表按链展示、详情按链聚合、续写继续挂链”。

## 详细设计

### 一、数据模型

修改 [models.py](/Users/shawn/Documents/GitHub/lumina/backend/models.py) 中 `AITask`：

- 新增 `parent_task_id: Column(String, nullable=True)`
- 新增 `root_task_id: Column(String, nullable=True, index=True)`

字段语义：

- `parent_task_id`
  - 指向直接来源任务
  - 仅用于表示“这次续写是基于哪一次任务发起的”
- `root_task_id`
  - 指向整条链的主任务
  - 用于列表聚合、详情聚合、统计与前端打开统一详情

初始化规则：

1. 普通 AI 生成任务创建时：
   - 先生成 task id
   - `parent_task_id = null`
   - `root_task_id = task.id`
2. 续写任务创建时：
   - `parent_task_id = source_task_id`
   - `root_task_id = source_task.root_task_id or source_task.id`

兼容旧数据：

- 历史任务没有这两个字段时，迁移后默认为 `null`
- 读取时如果 `root_task_id` 为空，则视为 `task.id`

本期不要求做历史全量回填脚本，只要求读取逻辑具备回退能力。

## 二、任务创建与续写入队

### 普通任务

在 [ai_task_service.py](/Users/shawn/Documents/GitHub/lumina/backend/app/domain/ai_task_service.py) 的 `enqueue_task(...)` 增加可选参数：

- `parent_task_id: str | None = None`
- `root_task_id: str | None = None`

默认行为：

- 若未传入，则创建新链：
  - `parent_task_id = null`
  - `root_task_id = task.id`

### 续写任务

在 [article_command_service.py](/Users/shawn/Documents/GitHub/lumina/backend/app/domain/article_command_service.py) 的 `enqueue_ai_continuation(...)` 中：

1. 通过来源 `usage.task_id` 找到源任务。
2. 计算：
   - `parent_task_id = source_task.id`
   - `root_task_id = source_task.root_task_id or source_task.id`
3. 调用 `enqueue_task(...)` 时把这两个字段一起带上。

注意：

- 执行层仍然是“新建 task”
- 只是这个新 task 归属到原链下，不再作为独立任务视角暴露给用户

## 三、任务列表

修改 [ai_tasks_router.py](/Users/shawn/Documents/GitHub/lumina/backend/app/api/routers/ai_tasks_router.py) 的任务列表接口。

### 当前问题

现在列表直接返回 `ai_tasks` 明细，因此一条链会显示成多条记录。

### 目标行为

任务列表默认按链返回，只展示“链主任务视角”。

建议返回结构增加：

- `root_task_id`
- `latest_task_id`
- `chain_length`
- `has_continuations`

链主展示规则：

1. 按 `root_task_id` 聚合，若为空则回退为自身 `id`
2. 每条链只展示一条记录
3. 展示内容以“最新任务”为准：
   - `status`
   - `last_error`
   - `updated_at`
   - `finished_at`
4. 展示目标资源仍沿用链主任务对应文章 / 回顾目标

筛选策略：

- 现有按 `status` / `task_type` / `content_type` 筛选，应用于链内任务后再聚合
- 这样用户筛“失败”时，能看到“最新一次续写失败”的整条链

## 四、任务详情与调用链

### 详情打开规则

新增统一规则：

- 打开任意任务详情时，如果该任务属于某条链，则实际读取 `root_task_id` 对应的链详情

这样即使前端拿到的是续写任务 id，也会回到同一条主链详情。

### Timeline 聚合

修改任务 timeline 接口，让它返回“整条链”的聚合数据，而不是单个 task。

聚合范围：

- 链内全部 `AITask`
- 链内全部 `AITaskEvent`
- 链内全部 `AIUsageLog`
- 链内全部 `AICallSession`

展示顺序：

- 先按任务创建时间排序
- 每个任务内再按事件 / usage 时间排序

节点标识：

- 首次任务标记为 `初始生成`
- 后续任务按链内顺序标记为：
  - `续写 #1`
  - `续写 #2`
  - `续写 #3`

如果内容类型是信息图修复，可在相同链节点上显示为：

- `修复 #1`
- `修复 #2`

但链路语义一致，不单独拆模型。

### 调用节点上的“继续调整”

“提交修改意见 / 提交修复说明”的触发位置保持不变：

- 仍然放在任务详情 -> 调用链 -> AI 调用节点上

变化点：

- 提交后不跳到新的独立任务详情
- 只刷新当前链详情
- 并自动定位到最新生成中的节点

## 五、前端行为

修改文件：

- [frontend/pages/admin.tsx](/Users/shawn/Documents/GitHub/lumina/frontend/pages/admin.tsx)
- [frontend/lib/api.ts](/Users/shawn/Documents/GitHub/lumina/frontend/lib/api.ts)

### 列表页

- 任务列表只显示链主视角
- 对有续写的任务显示“已调整 N 次”或等价轻量提示

### 详情页

- 打开某个任务时，读取链详情
- 调用链是整条链的节点，而不是当前 execution 的局部节点

### 续写提交后

当前行为：

- 拿到新 `task_id`
- 打开新任务详情

新行为：

- 拿到返回的 `task_id` 后，先查询其 `root_task_id`
- 若已有当前链详情上下文，则直接刷新当前详情
- 将调用链滚动到最新节点

理想情况下，接口直接返回：

```json
{
  "task_id": "new-task",
  "root_task_id": "root-task",
  "status": "pending"
}
```

这样前端无需二次解析。

## 六、接口调整

### 续写接口

`POST /api/ai-usage/{usage_id}/continue`

返回从：

```json
{
  "usage_id": "...",
  "task_id": "...",
  "status": "pending"
}
```

扩展为：

```json
{
  "usage_id": "...",
  "task_id": "...",
  "root_task_id": "...",
  "status": "pending"
}
```

### 任务详情接口

两种可选方式：

1. 保持 `/api/ai-tasks/{task_id}` 不变，但内部自动解析到 root task 再返回链视图
2. 新增 `/api/ai-task-chains/{task_id}` 专门返回链视图

本期推荐 **方式 1**：

- 对前端改动最小
- 能兼容现在“拿一个 task id 打开详情”的调用方式

### Timeline 接口

保持路径不变：

- `/api/ai-tasks/{task_id}/timeline`

但内部改为：

- 先解析 `root_task_id`
- 再返回整条链 timeline

## 七、错误处理

- 如果续写来源 task 已丢失，但 usage 仍存在：
  - 返回明确错误，不创建续写任务
- 如果历史任务没有 `root_task_id`：
  - 回退为自身链主
- 如果链内某个续写任务失败：
  - 链主状态应反映最新任务状态
  - 历史成功节点仍保留，不覆盖
- 如果用户从旧链接打开一个续写任务：
  - 前端 / 后端应自动重定向到同链详情视角

## 八、测试策略

### 后端

- 迁移测试：
  - 新字段存在
  - 历史数据兼容读取
- `enqueue_task(...)` 测试：
  - 默认新链
  - 显式 parent/root 透传
- `enqueue_ai_continuation(...)` 测试：
  - 正确挂载到原链
- 任务列表 API 测试：
  - 多个续写任务仅展示一条链主记录
  - `chain_length` / `latest_task_id` 正确
- timeline API 测试：
  - 同链多个 task 的 event / usage 被合并返回

### 前端

- 任务列表测试：
  - 同链只渲染一条任务
- 任务详情测试：
  - 续写后仍停留在同一详情链
  - 调用链新增 `续写 #N` 节点
- 续写弹窗测试：
  - 提交成功后刷新当前链，而不是切独立任务视图

## 九、风险与取舍

### 风险

- 任务列表从“单 task 明细”变为“链聚合”，需要确认现有筛选与排序口径不会让管理员误解。
- timeline 聚合后，前端渲染逻辑要注意节点去重与排序，否则容易出现顺序错乱。
- 历史任务没有链字段，需要保证回退逻辑稳定。

### 取舍

- 不做独立 `task_chains` 表，换取更低改造成本
- 不改 worker 执行模型，换取更低状态机风险
- 把复杂度集中在“链字段 + 聚合查询 + 前端展示”上，优先修正用户感知

## 验收标准

- 从任意 AI 调用节点发起续写后，任务列表中不会新增一条并列独立任务。
- 原任务在任务列表中仍然只占一条记录，并能反映最新续写状态。
- 进入任务详情时，调用链可看到初始生成与后续续写节点。
- 续写提交成功后，页面保持在同一任务详情上下文，并滚动 / 刷新到最新节点。
- 历史未带链字段的任务仍可正常查看，不报错。
