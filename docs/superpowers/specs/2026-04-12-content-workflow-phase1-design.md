# Content Workflow Phase 1 Design

## 背景

本期只处理内容工作流增强的第一阶段，聚焦两个已经影响日常使用的问题：

1. 手动创建文章时，正文里的待转储媒体会在创建后补写为本地媒体地址，但头图仍可能保留预占或原始外链，导致详情页、列表页和后续引用里使用了不一致的图片地址。
2. 备份导出当前走同步流式下载。数据量较大时，用户需要一直保持请求连接，失败重试成本高，也不方便在后台管理中展示“生成中 / 已完成 / 可下载”的明确状态。

本设计把这两个问题作为一个独立阶段处理，不和第二期的“回顾编辑器文章引用”和“详情导出 Markdown”混在一起。

## 目标

- 创建文章时，若头图是可转储的外部资源，则最终保存和展示的应是转储后的 URL，而不是预占或原始外链。
- 备份导出改为后台生成后下载，用户不再依赖长连接等待。
- 备份产物和状态只保留最近一份，避免引入历史管理和复杂清理逻辑。
- 优先复用现有前端创建流程和后台管理交互模式，不引入新的大规模基础设施。

## 非目标

- 不重构成“先转储全部媒体再创建文章”的全新创建链路。
- 不新增数据库表来记录备份导出历史。
- 不支持多实例共享备份状态。
- 不实现备份历史列表、下载审计、按用户区分任务。
- 不处理第二期需求：回顾编辑器搜索插入文章 / 内容引用、文章与回顾详情导出 Markdown。

## 当前实现概览

### 文章创建

- 前端 [list.tsx](/Users/shawn/Documents/GitHub/lumina/frontend/pages/list.tsx) 的创建弹窗会先调用 `createArticle`。
- 创建成功后，正文中的 `createPendingMedia` 会逐个转储，再通过 `updateArticle` 回写 `content_md`。
- 头图字段 `createTopImage` 只是原样传给 `createArticle`，后续不会参与“创建后补写”。
- 后端 [article_command_service.py](/Users/shawn/Documents/GitHub/lumina/backend/app/domain/article_command_service.py) 会在创建时调用 `resolve_top_image(...)` 选定头图，并尝试 `maybe_ingest_top_image(...)`，但这条链路无法感知前端创建后才真正完成的待转储媒体补写逻辑。

### 备份导出

- 后端 [backup_router.py](/Users/shawn/Documents/GitHub/lumina/backend/app/api/routers/backup_router.py) 通过 `StreamingResponse` 直接返回 `export_backup_stream(...)`。
- 后端 [backup_service.py](/Users/shawn/Documents/GitHub/lumina/backend/app/domain/backup_service.py) 会在临时目录生成 `snapshot.db`、`manifest.json` 和 zip，然后边读边流给前端。
- 前端 [admin.tsx](/Users/shawn/Documents/GitHub/lumina/frontend/pages/admin.tsx) 的 `handleExportBackup` 直接拿 `Blob` 触发浏览器下载。

## 方案选择

本期采用：

- 文章创建：**前端补偿式回写**
- 备份导出：**内存状态 + 单文件落盘 + 启动自恢复**

没有采用的方案：

- “先转储后创建文章”
  - 需要在文章 ID 尚不存在时解决媒体归属问题，链路更长，失败处理更复杂。
- “备份任务写数据库”
  - 由于本期明确只保留最近一份导出结果，没有历史、审计、多实例诉求，数据库方案收益不高。
- “纯内存备份状态且不落盘”
  - 无法可靠支持大文件下载，也无法在重启后恢复最新导出结果。

## 详细设计

### 一、文章创建头图修正

#### 交互原则

- 继续沿用现有“先创建文章，再转储媒体，再补写内容”的用户体验。
- 头图修正不阻塞文章创建本身成功。
- 若头图转储失败，保留用户输入的原始地址，并给出“部分媒体转存失败”的提示。

#### 前端改动

修改文件：

- [frontend/pages/list.tsx](/Users/shawn/Documents/GitHub/lumina/frontend/pages/list.tsx)

行为变化：

1. `handleCreateArticle` 中，在 `createArticle` 返回 `createdArticleId` 和 `createdArticleSlug` 后，除现有正文 `pendingMedia` 转储外，再单独处理 `createTopImage`。
2. 当满足以下条件时，尝试转储头图：
   - `createTopImage.trim()` 非空
   - 本地媒体存储开关开启
   - 已成功创建文章并拿到 `createdArticleId`
3. 头图转储调用沿用现有 `mediaApi.ingest(createdArticleId, createTopImage.trim())`。
4. 若头图转储成功，则设置 `patchedTopImage = result.url`。
5. 若头图转储失败：
   - 记录错误日志
   - `patchedTopImage` 退回原始 `createTopImage`
   - 计入“部分媒体转存失败”
6. 最终执行 `updateArticle(createdArticleSlug, { content_md: patchedContent, top_image: patchedTopImage })`。

补充说明：

- 正文媒体仍保持当前逐项转储策略，不改变 token 替换逻辑。
- 如果正文没有发生变化，但头图发生了变化，也需要执行一次 `updateArticle(...)`。
- 如果正文和头图都没有变化，则跳过补写请求。

#### 后端改动

本期不新增文章创建相关接口。

依赖现有接口：

- `POST /api/articles`
- `PUT /api/articles/{slug}`
- `POST /api/media/ingest`

这样可以把本期风险限制在前端创建补偿流程，不改动已有后端文章创建契约。

### 二、备份异步导出

#### 核心原则

- 只保留最近一份备份文件。
- 状态存内存，产物落磁盘。
- 后端进程重启后，自动识别最近备份文件并恢复“可下载”状态。
- 同一时间只允许一个导出执行。

#### 文件布局

建议新增目录：

- `data/backups/`

建议固定只保留一个目标文件：

- `data/backups/lumina-backup-latest.zip`

也可以在生成阶段使用临时文件名，例如：

- `data/backups/lumina-backup-latest.zip.tmp`

生成完成后再原子替换为正式文件。

#### 状态模型

后端进程内维护一个单例状态对象，例如：

```json
{
  "status": "idle | processing | completed | failed",
  "filename": "lumina-backup-latest.zip",
  "file_path": "/app/data/backups/lumina-backup-latest.zip",
  "file_size": 123456,
  "error_message": null,
  "created_at": "...",
  "started_at": "...",
  "finished_at": "..."
}
```

状态不落库、不写额外 JSON 文件。

应用启动时执行一次恢复逻辑：

- 若 `data/backups/lumina-backup-latest.zip` 存在，则将内存状态恢复为 `completed`
- 否则恢复为 `idle`

如果重启前正处于 `processing`，不尝试恢复执行，直接以磁盘文件存在性为准。

#### 并发控制

需要一个单独的“备份导出锁”：

- 与现有 restore lock 分开
- 目标是防止重复点击时并发生成多个 zip

行为约定：

- 若当前状态是 `processing`，`POST` 创建导出请求直接返回当前状态，不重复启动新任务
- 若当前状态是 `completed` 或 `failed`，创建新任务前先清理旧文件，再启动新的导出线程

#### 后端接口

建议替换为三条接口：

1. `POST /api/backup/export-jobs/latest`
   - 作用：启动最新导出任务
   - 返回：当前状态对象
   - 行为：
     - 若已有运行中任务，直接返回 `processing`
     - 否则清理旧文件并启动后台导出

2. `GET /api/backup/export-jobs/latest`
   - 作用：获取最近导出状态
   - 返回：状态对象

3. `GET /api/backup/export-jobs/latest/download`
   - 作用：下载最近导出文件
   - 仅当状态为 `completed` 且文件存在时可下载
   - 否则返回 404/400，并给出“请重新生成”的明确错误信息

现有同步接口：

- `GET /api/backup/export`

本期可直接废弃前端使用，也可以暂时保留作兼容，但后台管理入口必须切到新接口。

#### 后端实现结构

主要改动文件：

- [backend/app/domain/backup_service.py](/Users/shawn/Documents/GitHub/lumina/backend/app/domain/backup_service.py)
- [backend/app/api/routers/backup_router.py](/Users/shawn/Documents/GitHub/lumina/backend/app/api/routers/backup_router.py)

建议在 `BackupService` 中新增职责：

- 初始化和恢复最近导出状态
- 启动后台导出线程
- 清理旧备份文件
- 返回最近状态
- 返回最近备份下载路径

而原有 `export_backup_stream(...)` 可保留为底层 zip 构建能力，供新的“生成到文件”流程复用，避免重复实现 snapshot 和 archive 打包逻辑。

#### 前端 admin 交互

修改文件：

- [frontend/pages/admin.tsx](/Users/shawn/Documents/GitHub/lumina/frontend/pages/admin.tsx)
- [frontend/lib/api.ts](/Users/shawn/Documents/GitHub/lumina/frontend/lib/api.ts)

交互调整：

1. 页面加载时拉取一次 `latest export job`
2. 点击“导出备份”时不再直接下载，而是调用 `POST /api/backup/export-jobs/latest`
3. 返回 `processing` 后开始轮询 `GET /api/backup/export-jobs/latest`
4. 轮询到 `completed` 时，按钮变为“下载最新备份”
5. 点击下载按钮时访问 `GET /api/backup/export-jobs/latest/download`

UI 文案建议：

- `未生成`
- `生成中...`
- `下载最新备份`
- `生成失败`

附加信息建议展示：

- 最近生成时间
- 文件大小
- 错误信息（失败时）

#### 失败与恢复

导出失败时：

- 删除临时文件
- 状态置为 `failed`
- 保存错误信息

下载失败时：

- 如果状态是 `completed` 但磁盘文件不存在，则返回“备份文件不可用，请重新生成”
- 同时将内存状态重置为 `idle` 或更新为 `failed`

### 三、测试方案

#### 后端测试

新增或扩展单测覆盖：

- 启动导出任务后状态变为 `processing`
- 导出完成后状态变为 `completed`，且磁盘只保留一个 zip
- 新任务启动前会删除旧备份文件
- 导出失败后状态为 `failed`，且无残留半成品文件
- 下载接口在文件缺失时返回明确错误
- 启动恢复逻辑在检测到现有 `latest zip` 时恢复为 `completed`

#### 前端测试

新增或扩展测试覆盖：

- 创建文章时，若头图转储成功，会在补写请求里带上新的 `top_image`
- 创建文章时，若头图转储失败，不影响最终成功提示，但会进入“部分媒体转存失败”
- admin 备份导出按钮状态切换：
  - 初始未生成
  - 生成中
  - 已完成可下载
  - 失败

#### 手动验证

1. 创建文章，输入外链头图和带外链图片的正文，确认最终文章头图是转储后的地址。
2. 在后台管理点击导出备份，确认不会立刻下载，而是先进入“生成中”。
3. 导出完成后点击下载，确认拿到 zip。
4. 再次生成时，确认旧备份已被替换。

## 风险与权衡

- 由于文章头图修正放在前端补偿阶段，如果创建成功后浏览器中断，可能保留原始头图地址。
  - 这是本期接受的折中，因为它避免了大改创建链路。
- 备份状态只在内存里，天然不支持多实例。
  - 本期接受，后续若出现多实例需求，再升级为持久化状态。
- 只保留一份备份文件，意味着用户需要自行及时下载和外部保存。
  - 这是当前需求明确选择的结果，不在本期扩展历史列表。

## 实施边界

本期只实现：

- 手动创建文章时的头图转储回写
- 后台管理的异步备份生成与下载

本期不实现：

- 第二期所有功能
- 导出历史管理
- 多实例协调
- 备份状态数据库化
