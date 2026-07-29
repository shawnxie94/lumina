---
id: trd-article-topic-bridge-integration
type: trd
status: active
created_at: 2026-07-27
updated_at: 2026-07-27
sources:
  - conversation: lumina-llm-wiki-integration-2026-07-27
related:
  - docs/api/knowledge-base-api.md
  - README.zh-CN.md
  - backend/app/api/routers/settings_router.py
  - frontend/pages/article
  - frontend/pages/list.tsx
  - frontend/pages/columns
  - frontend/pages/admin.tsx
assumptions:
  - Lumina remains the article source of truth and public/content workspace.
  - llm_wiki remains the personal knowledge compilation engine on the local desktop.
  - Bridge runs on the same machine as llm_wiki, not inside Lumina server runtime.
  - First phase keeps Lumina light: no graph explorer, no wiki editor, no deep research UI.
  - Knowledge-base ingest prefers Chinese semantics: English articles use completed Chinese translation when available.
---

# TRD: 文章主题增强 + 本机 Bridge / llm_wiki 集成

## Background and Goals

### 背景

Lumina 当前擅长内容采集、阅读、单篇 AI 解读、专栏/回顾与内容运营，但缺少跨文章、可复利的知识编译层。  
[llm_wiki](https://github.com/nashsu/llm_wiki) 擅长把资料增量编译成可持续维护的 Wiki/主题知识，但不适合替代 Lumina 的 web 内容工作区。

双方应形成分工：

- **Lumina**：内容 SoT + Web 展示/运营
- **llm_wiki**：本机知识编译引擎
- **Bridge**：本机同步器，连接 Lumina API 与本地 llm_wiki

### 技术目标

在不把 Lumina 做成 second-brain / GraphRAG 重产品的前提下，落地第一阶段主题能力：

1. 文章挂主题
2. 主题详情页
3. 列表按主题筛选
4. 专栏编辑按主题取用文章
5. 管理设置中增加“主题”启用开关；开启后检测本机 Bridge 与 llm_wiki 状态，并触发同步

### 非目标

- 不在 Lumina 内重建完整 Wiki 编辑器
- 不做独立“主题列表主入口/知识库导航”
- 不做 Graph 可视化主界面
- 不做 Deep Research / 外网补采 UI
- 不做 Neo4j / 完整 GraphRAG 主路径
- 不让 Lumina 服务器直接依赖用户本机 `127.0.0.1:19828`
- 不双向修改文章正文

---

## System Context

### 参与组件

| 组件 | 运行位置 | 职责 |
|---|---|---|
| Lumina Frontend | Web | 文章/主题展示、列表筛选、专栏取用、设置页状态 |
| Lumina Backend | Server/Docker | 主题数据、文章关系、设置开关、写回接收、查询 API |
| Bridge | 用户本机 | 拉文章、送 llm_wiki、读编译结果、写回 Lumina |
| llm_wiki | 用户本机桌面 | 知识编译、关联维护、人工审核/探索 |

### 依赖边界

```text
[Lumina Server]
  Article SoT
  Topic Snapshot Store
  Settings / Query APIs
        ▲
        │ HTTPS + token
        │
[Local Machine]
  Bridge ──► llm_wiki local API / project files
             (127.0.0.1:19828 or vault FS)
```

### 现有可复用能力

- 文章模型与列表筛选：`articles` / `GET /api/articles`
- 设置模式：`AdminSettings` + `settings_router`（参考 `recommendations_enabled`）
- AI 任务队列：可用于后续“标记待同步”，第一阶段可不强制新任务类型
- 专栏页面与编辑流：`frontend/pages/columns/*`
- 文章详情页侧栏模式：`frontend/pages/article/[id].tsx`
- 列表筛选模式：`frontend/pages/list.tsx`
- 备份导入导出：后续需兼容主题快照，但第一阶段可只保证新表进入备份规划

### 关键约束

1. **原文所有权唯一**：Article 正文只在 Lumina 修改
2. **编译过程所有权唯一**：完整 wiki 演化只在 llm_wiki
3. **Web 只存展示快照**：主题摘要、关系、状态、写回元数据
4. **离线降级**：Bridge/llm_wiki 不在线时，Lumina 仍可阅读；仅主题新鲜度受影响
5. **能力默认关闭**：通过设置开关启用，避免影响未使用用户

---

## Proposed Design

### Mature Component Reuse Assessment

| 区域 | 策略 | 说明 |
|---|---|---|
| 主题编译引擎 | **reuse** | 复用本机 llm_wiki，不在 Lumina 重做 compile pipeline |
| 本机连接 | **extend** | 新增 Bridge 作为薄同步层；不把 llm_wiki 嵌进服务端 |
| 主题存储/展示 | **extend** | 在 Lumina 现有文章/列表/专栏/设置模式上扩展 |
| 图数据库/社区发现 | **not_applicable（P0）** | 第一阶段不引入 |
| 主题检索 | **extend** | 复用现有 list/search，不新做问答系统 |

自定义开发范围仅限：

- Lumina 主题数据模型与 API
- 前端 4 个消费面 + 设置开关
- Bridge 同步协议与状态探测

### Components and Responsibilities

#### 1) Lumina Backend

新增/扩展：

- `topic` 领域对象与关系表
- 主题查询 API
- 编译结果写回 API
- 主题设置（enable + bridge 探测配置）
- 文章序列化中附加 topics / compile_status

不负责：

- 调用用户本机 llm_wiki
- 生成完整 wiki 页
- 主题人工审核流

#### 2) Lumina Frontend

- 文章详情：所属主题模块
- 主题详情页：摘要 + 文章列表 + 相关主题
- 列表：`topic` 筛选
- 专栏编辑：按主题取文章
- Admin 设置：主题开关、Bridge/llm_wiki 状态、手动同步

#### 3) Bridge（本机）

- 健康检查：自身、llm_wiki API、目标项目
- 从 Lumina 按导出白名单拉增量文章
- 对英文文章优先选择已完成中文译文，保证编译语料中文语义统一
- 送入 llm_wiki `raw/sources/` 或等价导入路径
- 从 llm_wiki 读取编译快照
- 规范化后写回 Lumina
- 维护本地 cursor / 映射 / 正文 hash / 失败队列

#### 4) llm_wiki

- 继续作为编译与探索工作台
- 产出主题/实体/关联等结果
- 不直接服务公开 web 流量

### Interfaces and Contracts

#### A. 设置：主题能力

**读取**

`GET /backend/api/settings/topics`

```json
{
  "enabled": false,
  "bridge_base_url": "http://127.0.0.1:8787",
  "bridge_token_configured": false,
  "auto_sync_on_enable": true,
  "last_sync_at": null,
  "last_sync_status": "idle",
  "last_sync_error": null,
  "health": {
    "bridge": {"ok": false, "status": "unknown", "detail": null, "checked_at": null},
    "llm_wiki": {"ok": false, "status": "unknown", "detail": null, "checked_at": null},
    "project": {"ok": false, "name": null, "path": null}
  }
}
```

**更新**

`PUT /backend/api/settings/topics`

```json
{
  "enabled": true,
  "bridge_base_url": "http://127.0.0.1:8787",
  "bridge_token": "optional-if-unchanged-omit-or-null",
  "auto_sync_on_enable": true
}
```

行为：

1. `enabled=false`：隐藏/降级主题消费面（已有数据保留）
2. `enabled=true`：
   - 立即探测 Bridge 健康
   - Bridge 再探测 llm_wiki
   - 若 `auto_sync_on_enable=true` 且健康通过，触发一次同步
   - 若探测失败，设置保存成功，但返回 `enabled=true` + health 失败详情，前端明确提示“已开启但未连通”

说明：

- Lumina 服务端默认部署时，浏览器里的 `127.0.0.1` 指向用户浏览器本机，不是服务器本机。
- 因此 **健康检查与同步触发必须由“用户本机可达的 Bridge”完成**，不能假设服务端容器能访问用户电脑上的 llm_wiki。
- 推荐交互：
  1. 前端/管理页请求 Bridge 健康（本机）
  2. 同时把结果上报/缓存到 Lumina settings（便于状态展示）
  3. “触发同步”实际是请求 Bridge，而不是请求 Lumina server 去连本机

若未来存在“管理员就在宿主机本机跑 Lumina”的特殊部署，可额外支持 server-side probe，但不应作为默认前提。

#### B. Bridge 本地 API（建议）

Bridge 监听本机，例如 `http://127.0.0.1:8787`。

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `/health` | Bridge 自身健康 |
| GET | `/status` | bridge + llm_wiki + project 聚合状态 |
| POST | `/sync` | 触发增量同步 |
| POST | `/sync/article/{article_id}` | 单篇优先同步（可选 P1） |

`GET /status` 示例：

```json
{
  "ok": true,
  "bridge": {"version": "0.1.0", "ok": true},
  "llm_wiki": {
    "ok": true,
    "api": "http://127.0.0.1:19828",
    "version": "0.6.6"
  },
  "project": {
    "ok": true,
    "id": "72f8b995-45ed-4972-bb89-a2172a6c136b",
    "name": "Lumina-Knowledge",
    "path": "~/.lumina/knowledge/Lumina-Knowledge"
  },
  "cursor": {
    "last_article_sync_at": "2026-07-27T12:00:00+08:00",
    "last_writeback_at": "2026-07-27T12:05:00+08:00"
  }
}
```

`POST /sync` 示例响应：

```json
{
  "accepted": true,
  "run_id": "sync_xxx",
  "mode": "incremental",
  "exported_articles": 12,
  "writeback_topics": 5,
  "status": "completed"
}
```

#### C. 写回：编译快照

`POST /backend/api/topics/compile-results`

鉴权：管理员 Bearer 或 Internal Token。

```json
{
  "compiler": "llm_wiki",
  "compiler_project_id": "72f8b995-...",
  "compiled_at": "2026-07-27T12:05:00+08:00",
  "topics": [
    {
      "key": "knowledge-compilation",
      "title": "知识编译",
      "summary": "把资料先编译成可复用主题，再检索与聚合。",
      "status": "active",
      "article_ids": ["article-1", "article-2"],
      "claims": [
        {
          "text": "知识应先编译后检索",
          "article_ids": ["article-1"]
        }
      ],
      "related_topic_keys": ["personal-knowledge-base"],
      "compiler_ref": "wiki/concepts/knowledge-compilation.md"
    }
  ],
  "articles": [
    {
      "article_id": "article-1",
      "compile_status": "compiled",
      "compiled_at": "2026-07-27T12:05:00+08:00",
      "topic_keys": ["knowledge-compilation"]
    }
  ]
}
```

规则：

- `topic.key` 全局稳定，建议 slug
- 写回幂等：同 `key` upsert
- 使用 `compiled_at` 防止旧结果覆盖新结果
- 未知 `article_id` 记 warning，不整体失败
- 默认不删除“本次未出现的主题”，避免增量同步误删；删除/归档走显式字段（P1）

#### D. 查询 API

1. `GET /backend/api/topics/{key}`
   - 主题详情 + 文章列表（分页）
2. `GET /backend/api/topics?q=&page=&size=`
   - 给专栏取用/内部补全，不作为公开主入口
3. `GET /backend/api/articles?topic=knowledge-compilation`
   - 列表筛选扩展
4. `GET /backend/api/articles/{slug}`
   - 响应附加：
     - `topics: [{key,title,content_md?}]  # API summary is derived from content_md`
     - `compile_status`
     - `compiled_at`

#### E. 前端路由与信息架构

| 路由 | 行为 |
|---|---|
| `/article/[id]` | 展示所属主题模块 |
| `/topics/[key]` | 主题详情页（薄） |
| `/list?topic=<key>` | 按主题筛选文章 |
| `/columns/*` 编辑态 | 主题取用侧栏 |
| `/admin/settings/topics` | 开关与健康/同步 |

导航原则：

- Header 第一阶段不新增“知识库”一级入口
- 主题主要通过文章 chip、列表筛选、专栏取用触达
- `/topics` 索引页非必须；若需要“全部主题”，可后置


#### F. Lumina → llm_wiki 导出契约（文章原料）

正向同步只导出 **文章原料**，不导出主题结果、评论或权限数据。  
Bridge 将文章写入 llm_wiki 的 `raw/sources/`（或等价 import 路径），供编译引擎消费。

##### 1) 默认同步范围

第一阶段默认只同步同时满足以下条件的文章：

- `is_visible = true`
- 有可用正文（见正文选择规则）
- 增量条件任一成立：
  - `updated_at > last_article_sync_at`
  - `compile_status in {none, stale, failed}`
  - 被手动标记为“送去编译 / 单篇同步”

默认不同步：

- 隐藏文章
- 无正文文章
- 评论、账号、媒体二进制、admin 配置
- 已写回的 topics 结果（避免环）

##### 2) 字段白名单

| 字段 | 必填 | 用途 |
|---|---|---|
| `id` | 是 | Lumina 文章稳定主键；回写对齐 |
| `slug` | 是 | 可读标识 / 回链 |
| `title` | 是 | 来源标题；若走译文策略可替换为中文标题 |
| `title_trans` | 否 | 英文文章的中文标题候选 |
| `content_md` | 条件必填 | 首选正文 |
| `content_html` | 条件必填 | `content_md` 缺失时回退 |
| `content_trans` | 否 | 英文文章优先使用的中文译文正文 |
| `original_language` | 否 | 判断是否英文来源 |
| `translation_status` | 否 | 仅当 `completed` 时允许优先译文 |
| `source_url` | 否 | 原文链接、去重 |
| `source_domain` | 否 | 来源站点 |
| `author` | 否 | 作者 |
| `published_at` | 否 | 发布时间 |
| `created_at` / `updated_at` | 是 | 增量游标与 stale 判断 |
| `summary` | 否 | 辅助理解 |
| `tags[]` | 否 | 主题归类提示 |
| `category.id` / `category.name` | 否 | 分类提示 |
| `is_visible` | 是 | 过滤 |
| `status` | 否 | 文章处理状态，仅用于过滤/诊断 |

##### 3) 正文与语言策略（中文语义统一）

目标：进入 llm_wiki 的编译语料尽量保持中文语义空间一致。

**选择算法：**

1. 若文章被判定为英文，且中文译文可用：
   - 正文 = `content_trans`
   - 标题 = `title_trans`（有值）否则 `title`
   - 标记 `body_language = "zh"`，`body_source = "content_trans"`
2. 否则：
   - 正文 = `content_md`；若空则由 `content_html` 转 md/纯文本
   - 标题 = `title`
   - 标记 `body_language = original_language or "unknown"`，`body_source = "content_md"|"content_html"`

**英文判定（按序）：**

1. `original_language in {en, english, en-us, en-gb}`
2. 若缺失，可用现有后端语言启发式（如英文比例高且几乎无汉字）

**译文可用判定：**

- `translation_status = "completed"`
- 且 `content_trans` 非空

**回退：**

- 英文但译文未完成/为空：仍导出原文，并标记
  - `body_source = "content_md"|"content_html"`
  - `translation_fallback = true`
- 不阻塞同步；可在 Bridge 日志/同步报告中计数 “英文无译文回退”

**明确不做：**

- 不在 Bridge 内现场翻译
- 不把 AI 摘要/大纲/金句当作 raw 正文
- 不同时把原文+译文拼成双语文档（避免主题分裂）

##### 4) 导出到 llm_wiki 的文件形态

建议路径：

```text
raw/sources/lumina/<article_id>-<slug>.md
```

建议 frontmatter：

```yaml
---
lumina_article_id: "..."
lumina_slug: "..."
title: "..."
source_url: "..."
source_domain: "..."
author: "..."
published_at: "..."
tags: []
category: "..."
original_language: "en"
body_language: "zh"
body_source: "content_trans"   # content_trans | content_md | content_html
translation_fallback: false
synced_at: "2026-07-27T12:00:00+08:00"
---

# 标题

<选定后的正文>
```

##### 5) 增量与幂等

- Bridge 本地保存：
  - `last_article_sync_at`
  - `article_id -> source_path`
  - 正文 hash（基于最终选定正文，而非原始字段拼接）
- 同一 `article_id` 再次同步时覆盖对应 raw source，不新建重复文件
- 仅当正文 hash 或关键元数据变化时才触发 llm_wiki 重编译需求
- 英文文章在译文从缺失变为 completed 后，应重新导出并标 stale/待编译

##### 6) 非导出项（黑名单）

- 评论 / OAuth 用户数据
- admin settings、模型 key、prompt
- `ai_analysis` 全量结果（summary/outline/quotes 等）
- 批注 `note_content` / 划线
- 媒体二进制文件
- 已有 topics / article_topics 写回结果
- 备份包整体导入


### Data and State

#### 数据模型（建议）

**`topics`**

| 字段 | 类型 | 说明 |
|---|---|---|
| id | string pk | 内部 id |
| key | string unique | 稳定 slug |
| title | string | 展示名 |
| summary | text null | 短摘要 |
| status | string | `candidate/active/ignored` |
| article_count | int | 冗余计数 |
| compiler | string null | 如 `llm_wiki` |
| compiler_ref | string null | 桌面路径/页引用 |
| compiled_at | string null | 最近写回时间 |
| created_at / updated_at | string | 审计 |

**`article_topics`**

| 字段 | 类型 | 说明 |
|---|---|---|
| id | string pk | |
| article_id | fk articles | |
| topic_id | fk topics | |
| relation_reason | text null | 可选一句话 |
| confidence | float null | 可选 |
| source | string | `bridge_writeback` 等 |
| created_at / updated_at | string | |
| unique(article_id, topic_id) | | |

**`article_compile_states`**（可并入 articles 列，二选一）

推荐独立小表或直接加列到 `articles`：

- `compile_status`: `none|queued|synced|compiled|stale|failed`
- `compiled_at`
- `compile_error`

第一阶段为减少迁移复杂度，可直接给 `articles` 加列。

**`topic_claims`（P1，可第一阶段可选）**

- topic_id
- text
- sort_order
- 通过 `topic_claim_articles` 关联 article_id

**`admin_settings` 扩展**

- `topics_enabled: bool = false`
- `topics_bridge_base_url: str = "http://127.0.0.1:8787"`
- `topics_bridge_token: str null`（加密/权限按现有 secrets 习惯）
- `topics_auto_sync_on_enable: bool = true`
- `topics_last_sync_at`
- `topics_last_sync_status`
- `topics_last_sync_error`
- `topics_last_health_json`（缓存最近探测结果）

#### 状态机

**文章编译状态**

```text
none -> queued -> synced -> compiled
                 \-> failed
compiled + (export title/body changed) -> stale
stale -> queued -> ...
```

**主题状态**

```text
candidate -> active
active -> ignored   # 人工/后续规则
```

**设置开关状态**

```text
disabled
enabled_unhealthy   # 开了但 Bridge/llm_wiki 不通
enabled_healthy
syncing
sync_failed
```

#### 同步时序

1. 用户在 Admin 打开“主题”
2. 前端请求 Bridge `/status`
3. 将健康结果展示，并可选上报 Lumina settings 缓存
4. 若健康且允许自动同步：`POST Bridge /sync`
5. Bridge：
   - 按导出白名单拉 Lumina 增量文章
   - 按语言策略选择正文（英文优先 `content_trans`）
   - 写入 llm_wiki 项目 `raw/sources/lumina/`
   - 等待/读取编译结果（第一阶段可半自动：已有编译结果即写回）
   - `POST /api/topics/compile-results`
6. Lumina 更新 topics / article_topics / compile_status
7. 前端文章详情、列表筛选、主题页、专栏取用生效

第一阶段允许“编译仍在 llm_wiki 人工确认，Bridge 只同步已产出结果”，不必要求全自动 compile-on-ingest。

---

## Quality Attributes

### Security

- Bridge 默认只绑 `127.0.0.1`
- Bridge -> Lumina 使用 admin/internal token
- Lumina 不保存 llm_wiki 项目绝对路径到公开 API
- `compiler_ref` 仅管理员可见或默认不向前端公开
- 主题写回接口必须鉴权，防止伪造主题污染
- 设置页 token 只写不回显明文

### Privacy

- 文章正文（或选定中文译文）只在用户授权的 Bridge 同步链路中离开 Lumina
- 不把完整 vault 镜像进服务器
- 写回最小化：摘要/关系/状态，不传桌面 chat 记录
- 不同步评论与用户身份数据

### Reliability

- Bridge/llm_wiki 离线时：
  - 阅读与现有 AI 能力不受影响
  - 主题模块显示“待同步/未连通”
- 写回部分失败不阻断整批（按 topic/article 记错误）
- 同步需幂等与 cursor，避免重复导入爆炸

### Performance

- 主题详情与列表筛选走 DB 关系，不实时问 llm_wiki
- `article_topics` 需要索引：`topic_id`, `article_id`
- 列表 `topic=` 筛选复用现有分页
- 健康检查超时短（建议 2~3s），避免设置页卡死

### Compatibility

- `topics_enabled=false` 时：
  - API 可返回空 topics
  - 前端隐藏主题模块
  - 不影响现有文章/专栏/AI
- 老客户端忽略新字段应可兼容

### Observability

记录：

- topics enabled/disabled
- bridge health result
- sync run accepted/completed/failed
- writeback topic count / unknown article count
- stale article count

管理页展示最近一次同步与错误摘要。

---

## Compatibility, Migration, and Rollback

### Migration

1. Alembic 增加：
   - `topics`
   - `article_topics`
   - `articles.compile_status/compiled_at/compile_error`（或等价表）
   - `admin_settings` 主题相关列
2. 默认 `topics_enabled=false`
3. 路由契约/响应契约基线更新

### 部署顺序

1. DB migration
2. Backend API
3. Frontend 消费面 + 设置页
4. Bridge 本机安装/配置
5. 打开开关并做首次同步

### Rollback

- 关闭 `topics_enabled` 即可前端降级
- 数据表可保留，不强制删
- Bridge 停止运行不影响 Lumina 主链路

### 备份

- 第一阶段必须将 `topics` / `article_topics` / 文章编译状态纳入 backup export/import 范围

---

## Frontend Design Spec（第一阶段）

### 1) 文章详情

位置：现有 AI 区附近，不打断正文阅读。

模块：

- 标题：`知识沉淀` / `主题`
- 主题 chips（跳转 `/topics/[key]`）
- 编译状态文案
- 空态：
  - 未启用：不显示
  - 已启用未编译：`尚未进入主题沉淀`
  - 不健康：`主题同步未连通`

### 2) 主题详情页 `/topics/[key]`

可见性：对匿名访客公开；文章列表仅包含可见文章。

薄页结构：

1. 标题 + 短摘要
2. 元信息：文章数、最近编译时间
3. 关联文章列表（主）
4. 相关主题 chips（有则显示）
5. 可选 claims（若写回提供）

不做：

- wiki 全文编辑
- graph
- 复杂筛选

### 3) 列表页

- 增加 `topic` 筛选参数
- 从主题 chip / 详情跳转时可落到 `/list?topic=...`
- 搜索仍以文章为主；主题命中可作为辅助，不新做双列信息架构

### 4) 专栏取用

- 编辑侧栏增加“按主题取用”
- 选择主题后列出关联文章
- 插入交互复用现有回顾/专栏引用插入方式
- 占位符新增主题专用符号（避免与普通文章占位混淆）
- 不在专栏页维护主题本身

### 5) 设置页 `/admin/settings/topics`

字段/控件：

1. 启用主题能力（switch）
2. Bridge 地址（默认 `http://127.0.0.1:8787`）
3. Bridge Token（可选）
4. 开启时自动同步（switch）
5. 状态卡片：
   - Bridge：在线/离线
   - llm_wiki：在线/离线/未配置项目
   - 最近同步时间与结果
6. 按钮：
   - 重新检测
   - 立即同步

开启流程：

```text
打开开关 -> 保存配置 -> 检测 Bridge/llm_wiki
  -> 成功且 auto_sync：触发同步并提示“已开始同步”
  -> 失败：保持开启，提示“请启动 Bridge 与 llm_wiki 后重试”
```

---

## Testing and Verification

### Backend

- migration up/down
- topics upsert 幂等
- 旧 `compiled_at` 不能覆盖新结果
- `GET /articles?topic=` 过滤正确
- 文章详情带 topics
- settings enable/disable 兼容
- compile-results 鉴权与 unknown article 容错

### Frontend

- 开关关闭时各页面不展示主题模块
- 开关开启且有数据时：
  - 文章详情 chips
  - 主题详情页
  - 列表筛选
  - 专栏取用
- 设置页健康状态三态：unknown/ok/fail
- i18n zh/en

### Bridge

- `/status` 在 llm_wiki 关闭时明确失败
- `/sync` 增量 cursor 正确
- 写回成功后 Lumina 可查到主题
- 重复同步不产生重复 article_topics
- 导出字段不超过白名单
- 英文 + 译文完成：raw source 使用 `content_trans`，`body_source=content_trans`
- 英文 + 译文缺失：回退原文，并带 `translation_fallback=true`
- 译文后补完成：再次同步会覆盖 raw source，并进入待编译/stale 流

### 契约

- 更新 `route_contract_baseline.json` / `response_contract_baseline.json`
- 单元测试覆盖 topic service / writeback merge

### 手工验收清单

1. 启用主题但 Bridge 未开：设置页显示不健康，站点可正常阅读
2. 启动 Bridge + llm_wiki 后点“重新检测”变健康
3. 触发同步后，文章详情出现主题
4. 打开主题详情可见文章列表
5. `/list?topic=...` 只显示相关文章
6. 专栏编辑可按主题取文
7. 关闭开关后主题 UI 隐藏，数据仍保留

---

## Tradeoffs and Alternatives

### 方案对比

| 方案 | 描述 | 结论 |
|---|---|---|
| A. Lumina 内建编译 | 服务端做实体/主题编译 | 否：把产品做重，与目标相反 |
| B. 仅文章挂标签，无主题页 | 最轻 | 否：聚合与取用弱 |
| C. 文章挂主题 + 主题详情 + 列表筛选 + 专栏取用 + 本机 Bridge | 当前方案 | **采用** |
| D. 完整 GraphRAG 回灌 | 恢复旧 knowledge-graph 主路径 | 否：第一阶段过重 |

### 关键权衡

1. **主题详情页 vs 只 list filter**  
   保留薄主题页，换取更好的沉淀与专栏取用入口；仍不做主题站导航。

2. **自动全量 compile vs 半自动写回**  
   第一阶段允许 llm_wiki 侧人工/半自动编译，Bridge 先保证同步与写回闭环。

3. **服务端探活 vs 本机探活**  
   以本机 Bridge 探活为准，避免服务器误判用户本机状态。

---

## Resolved Decisions

1. **Bridge 形态**：第一阶段做 **最小常驻 HTTP 服务**（非纯 CLI），便于设置页健康检查与一键同步。
2. **主题 `key` 规范化**：采用“稳定 key，不直接拿中文当 URL 主依赖”的策略，详见下方 `Topic Key 规范`。
3. **stale 触发**：仅当 **最终导出正文或标题** 变更时标 `stale`；标签/分类/可见性等元数据变更不自动 stale。
4. **备份**：第一阶段 **必须包含** `topics` / `article_topics` / 文章编译状态字段。
5. **主题详情可见性**：**对访客公开**（跟随文章可见性约束：只聚合可见文章）。
6. **专栏取用插入**：插入交互复用现有回顾/专栏引用插入方式；占位符可新增主题专用符号（如 `{{topic:...}}` / `{{topic_article:...}}`），不复用文章占位语义导致混淆。
7. **英文判定**：优先 `original_language`；缺失时允许启发式兜底（与导出语言策略一致）。

### Topic Key 规范（建议落地）

目标：可稳定回写、可做 URL、中英文都可用，且不因标题微调频繁改 key。

#### 规则

1. **写回优先使用 llm_wiki 稳定标识**
   - 优先：`compiler_ref` 文件名 stem / 页面稳定 id
   - 其次：规范化后的标题 slug
2. **展示名与 key 分离**
   - `title`：可中文，可改
   - `key`：一旦生成，默认不可随标题重命名而变
3. **slug 生成算法**
   - trim
   - 小写
   - 空格/下划线/连续标点 → `-`
   - 去除除 `a-z0-9\u4e00-\u9fff-` 以外字符
   - 压缩重复 `-`
   - 截断到 80 chars
4. **中文处理**
   - **允许 key 含中文**（如 `代码仓库即模板`）以保持可读与稳定
   - URL 使用 encode后的 key：`/topics/%E4%BB%A3%E7%A0%81...`
   - 若未来要 ASCII-only，可另存 `key_ascii`，但第一阶段不强制拼音（拼音有歧义，且依赖额外库）
5. **冲突**
   - 同 key 不同语义：后缀短 hash（`标题-a1b2`）
   - 同主题多别名：别名映射到 canonical key（P1）
6. **禁止**
   - 不要每次用“当前中文标题临时 slug”覆盖已有 key
   - 不要用会随翻译变化的标题当唯一来源（英文主题若已有中文 title，key 仍保持首次生成值）

#### 示例

| title | key |
|---|---|
| Redis | `redis` |
| 代码仓库即模板 | `代码仓库即模板` |
| AI时代软件分发 | `ai时代软件分发` 或 `AI时代软件分发`（统一小写拉丁字符后） |
| Antirez | `antirez` |

#### 实现建议

- Bridge 写回时带 `key` + `title`
- Lumina upsert：按 `key` 合并
- 前端路由：`/topics/[key]`，服务端负责 decode
- 列表筛选：`/list?topic=<key>`


---

## Execution Plan Inputs

### 实现切片（供后续 write-execution-plan）

1. **数据层**
   - migration：topics / article_topics / article compile fields / admin settings
2. **写回与查询 API**
   - compile-results
   - topic detail/list
   - articles 过滤与序列化扩展
3. **设置页**
   - topics section
   - enable + health + manual sync UX
4. **文章详情主题模块**
5. **主题详情页**
6. **列表 topic 筛选**
7. **专栏主题取用**
8. **Bridge MVP**
   - status/sync/writeback
   - 导出白名单 + 英文优先译文
   - 与 `Lumina-Knowledge` 项目对接
9. **契约/测试/文档**

### 依赖顺序

```text
migration/API
  -> settings + bridge contract
  -> article/topic frontend
  -> list filter
  -> columns reuse
  -> bridge mvp e2e
```

### 风险

- 本机网络/权限导致设置页“总是不健康”
- llm_wiki 编译结果结构不稳定，需 Bridge 做适配层
- 主题 slug 冲突与中文规范化
- 增量同步误把未返回主题当删除

### 已确认决策

1. Bridge 做本机最小常驻 HTTP 服务（非纯 CLI）
2. 主题详情对访客公开；列表仅聚合可见文章
3. stale 规则：仅最终导出正文/标题变更
4. 第一阶段备份/导入导出必须包含 topics 及相关关系/编译状态
5. 不做 `/topics` 总列表主入口
6. 英文文章优先使用已完成中文译文；无译文时回退原文并标记 `translation_fallback`
7. 第一阶段不同步 AI 摘要/大纲/金句/批注，只同步原文层（或译文层）原料
8. 专栏取用复用现有插入交互，新增主题专用占位符
9. 主题 key：稳定标识优先，中文 key 允许；title 可变、key 不变

---

## Acceptance Criteria

1. 设置中可启用/关闭主题能力
2. 启用后可检测 Bridge 与 llm_wiki 状态，并手动/自动触发同步
3. 同步写回后：
   - 文章详情显示所属主题
   - 主题详情页可浏览摘要与文章
   - 列表支持按主题筛选
   - 专栏编辑可按主题取用文章
4. Bridge/llm_wiki 离线时，Lumina 主阅读链路不受影响
5. 关闭开关后主题 UI 隐藏，且不破坏现有文章/AI/专栏能力
6. Bridge 仅按导出白名单从 Lumina 拉文章原料；不导出评论、权限、AI 解读全量结果
7. 英文且 `translation_status=completed` 的文章，进入 llm_wiki 的正文优先为中文译文；无译文时回退原文并可观测
8. 备份/导入导出包含 topics 与文章主题关系及编译状态
9. 主题详情页访客可访问；仅展示可见文章
10. 仅导出正文/标题变化会将文章标为 stale


## Local Bootstrap / Guided Install (Phase 1.1)

Goal: make Topic Settings capable of guiding local setup without pretending the browser can silently install desktop software.

### Ownership
- **Lumina settings page**: detect, guide, copy commands, call Bridge setup APIs when Bridge is online
- **Bridge bootstrap (`bridge/bootstrap.sh`)**: local install/start/init entrypoint
- **LLM Wiki**: official desktop app install remains one-time manual via GitHub Releases

### Bridge APIs
| Method | Path | Purpose |
|---|---|---|
| GET | `/setup` | local diagnosis + suggested actions + commands |
| POST | `/setup/init-project` | create knowledge project skeleton |
| POST | `/setup/start-llm-wiki` | launch installed LLM Wiki app/CLI |
| POST | `/setup/install-guidance` | platform download/guidance payload |

`/status` also includes a compact `setup` object for settings cards.

### Settings UX
1. Copy bootstrap command (`./bootstrap.sh setup`)
2. Initialize knowledge directory (requires Bridge online)
3. Start LLM Wiki if installed
4. Open install page / releases when missing
5. Recheck health and continue normal sync flow

### Non-goals
- Silent remote installation from Docker/API container
- Replacing official LLM Wiki installer
- Auto-install without first local bootstrap trust boundary


### One-click installer

Preferred end-user path no longer requires cloning the full Lumina repository.

- Script: `scripts/install-topic-bridge.sh`
- Install root: `~/.lumina/topic-bridge`
- Manager: `~/.lumina/topic-bridge/bin/lumina-bridge`
- Configures: host/port/token, Lumina URL/internal token, project path
- Initializes knowledge directory and can start Bridge

Example:

```bash
curl -fsSL https://raw.githubusercontent.com/shawnxie94/lumina/main/scripts/install-topic-bridge.sh | bash -s -- --yes
```


## Knowledge full rebuild

CLI:

```bash
lumina sync full --rebuild --yes
```

Bridge `POST /sync` body:

```json
{"mode":"full","rebuild":true}
```

Semantics:

- `mode=full` alone: full source export, keep existing wiki
- `rebuild=true`: wipe local `raw/` + `wiki/` + bridge cursors, full export, best-effort llm_wiki recompile, then writeback
- if wiki is empty after wipe/compile miss: return `status=awaiting_compile` and skip empty writeback


## Automatic secondary writeback

When `/sync` exports sources but wiki entity/concept pages are not ready yet, Bridge returns:

```json
{"status":"awaiting_compile","writeback_skipped":true,"auto_writeback":{"scheduled":true}}
```

A background job then watches local llm_wiki compile state (ingest queue + `wiki/entities|concepts`) and automatically POSTs `/api/topics/compile-results` once topics appear.

Manual endpoints:

- `GET /writeback` — job + compile status
- `POST /writeback` — immediate writeback; `{"wait":true}` schedules waiter

## Rebuild residual cleanup

`rebuild=true` must clear not only `raw/` + `wiki/`, but also `.llm-wiki/` residues:

- `review.json`
- `history/`
- `lancedb/`
- `ingest-cache.json` / queues / snapshots

Otherwise llm_wiki may resume with stale review/history context and produce incomplete or confusing compile results.
