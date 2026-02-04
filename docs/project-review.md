# 项目深度审查与优化方案

审查范围覆盖前端（Next.js）、后端（FastAPI）、浏览器扩展（WXT），重点评估功能流程/UX、架构合理性、实现逻辑质量，并给出分阶段优化方案。

## 1. 功能流程与 UI/UX 审查

### 1.1 核心流程梳理
- 文章采集：扩展弹窗/右键菜单采集 -> 内容提取与清洗 -> API 入库 -> AI 异步处理 -> 前端列表/详情展示。
  - 相关代码：`extension/entrypoints/popup/main.js`、`extension/entrypoints/background.ts`、`extension/entrypoints/content.ts`、`backend/main.py`、`backend/article_service.py`、`frontend/pages/index.tsx`、`frontend/pages/article/[id].tsx`。
- 管理员认证：首次设置管理员密码 -> 登录 -> Token 存储 -> 前端/扩展鉴权。
  - 相关代码：`frontend/pages/login.tsx`、`frontend/pages/auth/extension.tsx`、`frontend/contexts/AuthContext.tsx`、`backend/auth.py`。
- 管理配置：分类管理 + 模型/提示词配置（仅管理员）。
  - 相关代码：`frontend/pages/settings.tsx`、`backend/main.py`。

### 1.2 UI/UX 优点
- 列表页信息密度高且筛选手段完整（分类、作者、来源、时间范围、排序）。`frontend/pages/index.tsx`。
- 详情页阅读体验完整：目录、沉浸模式、阅读进度、AI 解读侧栏、图片灯箱。`frontend/pages/article/[id].tsx`。
- 扩展采集体验细节完整：提取状态提示、质量告警、历史记录、自动分类、失败重试。`extension/entrypoints/popup/main.js`、`extension/entrypoints/content.ts`。

### 1.3 主要 UX 问题与改进方向
- 列表页筛选交互负担偏高，且多数筛选会触发即时请求；缺少“筛选条件汇总/保存方案”。
  - 影响：频繁触发请求，用户难以回到“上次组合条件”。
  - 优化：提供“条件摘要条 + 一键清除 + 保存筛选组合”，并对搜索/筛选输入做防抖。
- 详情页“上一篇/下一篇”仅在前 100 篇中寻找，超出后出现断链体验。`frontend/pages/article/[id].tsx`。
- 扩展采集强制作者必填，否则无法提交。`extension/entrypoints/popup/main.js`。
  - 影响：部分站点无作者信息时阻断流程。
  - 优化：允许作者为空，但提醒“可选”；或者提供“跳过作者”按钮并记录为空。
- 设置页信息密度高，缺少“分组说明/建议值示例”与“风险提示”。`frontend/pages/settings.tsx`。

## 2. 系统架构审查

### 2.1 当前架构
- 前端：Next.js CSR + API 客户端直连后端。`frontend/lib/api.ts`。
- 后端：单体 FastAPI + SQLAlchemy + SQLite。`backend/main.py`、`backend/models.py`。
- AI 处理：请求线程内 `asyncio.create_task` 触发异步任务，无持久任务队列。`backend/article_service.py`。
- 扩展：内容脚本 + Readability + 站点适配器 + 采集工具链。`extension/entrypoints/content.ts`。

### 2.2 架构风险
- AI 任务不可持久化：进程重启/多 worker 可能导致任务丢失，且无任务追踪。`backend/article_service.py`。
- SQLite 以字符串存时间，过滤靠 `substr`，数据量大时性能退化。`backend/models.py`、`backend/article_service.py`。
- CORS 全开放，且部分配置接口未鉴权，存在安全隐患。`backend/main.py`。

### 2.3 架构优化方向
- 引入任务队列（RQ/Celery/Arq）+ 任务表持久化状态，取代 `asyncio.create_task`。
- 时间字段使用 DateTime 类型，查询与索引更可靠。
- 配置接口、导出接口强化鉴权；限制 CORS 来源。

## 3. 实现逻辑审查（重点风险）

### 3.1 后端逻辑
- 分类统计存在 N+1：每个分类单独 count。`backend/main.py` -> `/api/categories/stats`。
  - 影响：分类多时查询成本线性增长。
  - 优化：一次性 GROUP BY 统计。
- 模型/提示词配置 GET 接口未鉴权。`backend/main.py`。
  - 影响：任何人可读取敏感配置（包含 API Key）。
- 导出接口无鉴权。`backend/main.py` -> `/api/export`。
- 密码哈希使用 SHA-256 无盐，抗攻击性弱。`backend/auth.py`。
- `get_ai_config` 选择 prompt 配置未按 `is_default` 或时间排序，`first()` 不确定。`backend/article_service.py`。

### 3.2 前端逻辑
- 列表页请求策略混杂：`handleSearch` 触发立即请求，同时 `useEffect` 也会在依赖变化触发请求，可能重复。`frontend/pages/index.tsx`。
- 详情页邻接文章仅取前 100 条，规模变大后失效。`frontend/pages/article/[id].tsx`。

### 3.3 扩展逻辑
- Token 与 API Host 明文保存在本地存储。`extension/utils/api.ts`。
  - 风险可接受但建议提供“清除数据”入口与提示。

## 4. 优化方案（分阶段）

### P0 - 安全与数据完整性（1-2 周）
- 配置/导出接口增加管理员鉴权：`/api/export`、`/api/model-api-configs*`、`/api/prompt-configs*`。
- 密码哈希替换为 bcrypt/argon2，并引入盐与版本化迁移。
- 限制 CORS 允许来源（至少本地/部署域名）。

### P1 - 性能与可用性（2-4 周）
- 分类统计改为单次 GROUP BY 统计，避免 N+1。
- 列表页搜索/筛选引入防抖并提供“条件摘要 + 一键清除 + 保存筛选”。
- 详情页邻接文章改为基于 `created_at` 的单条查询（上一条/下一条）。
- AI 任务结果状态增加“最后更新时间”，并显示到详情页。

### P2 - 架构与可维护性（1-2 个月）
- 引入任务队列与任务表，确保 AI 任务可追踪、可重试、可恢复。
- 时间字段迁移为 DateTime；新增索引与迁移工具（Alembic）。
- 增加统一日志（结构化日志 + 请求 ID），便于排障。

### P3 - 体验强化（长期）
- 增加筛选条件保存/分享、批量管理（批量隐藏/删除/改分类）。
- 详情页 AI 解读支持版本管理与差异对比。
- 扩展增加“采集来源配置模板”，对不同站点适配策略可视化。

## 5. 快速落地清单（可直接执行）

1. 后端鉴权补齐（导出/配置接口）
2. 分类统计性能优化（GROUP BY）
3. 详情页邻接文章查询优化
4. 搜索/筛选防抖与筛选条件摘要
5. 密码哈希升级

## 6. 文件引用（关键证据）

- `frontend/pages/index.tsx`
- `frontend/pages/article/[id].tsx`
- `frontend/pages/settings.tsx`
- `frontend/pages/login.tsx`
- `frontend/pages/auth/extension.tsx`
- `frontend/contexts/AuthContext.tsx`
- `frontend/lib/api.ts`
- `backend/main.py`
- `backend/models.py`
- `backend/article_service.py`
- `backend/ai_client.py`
- `backend/auth.py`
- `extension/entrypoints/popup/main.js`
- `extension/entrypoints/editor/main.js`
- `extension/entrypoints/history/main.js`
- `extension/entrypoints/settings/main.js`
- `extension/entrypoints/background.ts`
- `extension/entrypoints/content.ts`
- `extension/utils/api.ts`
