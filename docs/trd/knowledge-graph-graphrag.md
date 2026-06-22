---
id: trd-knowledge-graph-graphrag
type: trd
status: draft
created_at: 2026-06-22
updated_at: 2026-06-22
sources:
  - https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f
  - https://microsoft.github.io/graphrag/
  - https://neo4j.com/docs/neo4j-graphrag-python/current/
  - https://neo4j.com/docs/graph-data-science/current/
related:
  - docs/trd/article-ai-interpretation-bundle.md
  - docs/api/knowledge-base-api.md
---

# TRD: Lumina 全库知识图谱与 GraphRAG

## 背景和目标

Lumina 当前以文章采集、清洗、AI 解读、分类、标签、相似文章推荐为核心能力。用户希望进一步将全库图谱分析变成核心能力，让用户能从繁杂文章和信息中发现潜在联系，而不是只在单篇文章或简单列表中检索。

本设计参考 Karpathy 的 LLM Wiki 思路：原始资料保持不可变，LLM 增量维护一个持久、可链接、可审计的知识层。与传统 RAG 的区别是，系统不是每次查询时从原始文档重新拼接答案，而是持续将新增资料编译为知识节点、关系、声明、社区摘要和可追溯证据。

### 技术目标

- 建立与文章索引并列的全库知识图谱索引。
- 支持从文章自动抽取实体、概念、声明、关系和证据片段。
- 支持全库主题社区发现、社区摘要和跨主题潜在联系发现。
- 支持局部图谱、路径解释、全局问答、潜在关联推荐。
- 保留来源引用、证据链、索引运行日志和可回滚能力。
- 将图谱索引接入现有 AI 任务队列和管理后台，避免同步长请求。

### 非目标

- 第一阶段不替换现有文章列表、标签、分类、RSS、相似文章能力。
- 第一阶段不要求把所有历史文章一次性强制索引完成。
- 不把 Lumina 的文章权限、任务状态、证据链和业务审计完全交给 GraphRAG 或 Neo4j 黑盒。
- 不在第一阶段开放多人协作编辑知识节点，先以系统生成和管理员审核为主。

## 系统上下文

### 当前 Lumina 能力

- `articles` 保存原始文章正文、来源、分类、标签、可见性、清洗状态。
- `ai_analyses` 保存文章级摘要、提纲、引用、分类和打标状态。
- `ai_tasks` / worker 支持异步 AI 任务、状态、事件、失败记录。
- `article_embeddings` 支持文章相似推荐，当前以文章标题和摘要作为向量源。
- 前端已有文章列表、详情页、AI 面板、设置页和任务状态轮询。

### 新增外部组件

| 组件 | 责任 | 部署关系 |
|---|---|---|
| Neo4j | 长期图存储、多跳路径、图算法、局部/全局图查询 | 新增独立服务，可由 Docker Compose 管理 |
| Microsoft GraphRAG | 全库索引范式、实体关系抽取、社区发现、community reports、global/local/drift query 参考或执行器 | 后端 worker 调用的离线索引/查询组件 |
| Lumina Backend | 任务编排、文章权限、source hash、证据链、API、审计、失败重试 | 现有 FastAPI backend 扩展 |
| Lumina Frontend | 图谱搜索、节点详情、路径解释、证据侧栏、潜在联系工作台 | 现有 Next.js frontend 扩展 |

## 架构决策

### 组件选型

选择 Neo4j + Microsoft GraphRAG + Lumina 控制层。

Neo4j 负责长期图存储和图查询。它适合表达实体、概念、声明、文章、文本片段、社区之间的多跳关系，并可通过 Graph Data Science 做中心性、社区发现、相似度和路径分析。

Microsoft GraphRAG 负责全库级知识组织方法。它的索引流程强调从文本单元抽取实体和关系、构建图、生成社区报告，并支持 Local Search、Global Search 和 DRIFT Search 等查询范式。Lumina 可以先把它作为离线索引和查询组件使用，也可以先只复用其流程设计，逐步替换内部实现。

Lumina 必须控制业务层：文章可见性、删除传播、索引运行状态、证据来源、用户审核、模型配置、成本记录、错误重试和 API 合约。

### 存储分层

```text
Lumina SQLite/Postgres
  articles
  ai_analyses
  ai_tasks
  knowledge_index_runs
  knowledge_source_units
  vector_embeddings
  graph_sync_status

Neo4j
  Article
  TextUnit
  Entity
  Concept
  Claim
  Community
  CommunityReport
  QueryInsight

Object/local files, optional
  GraphRAG artifacts
  export snapshots
  debug reports
```

Lumina 关系数据库记录系统状态和审计信息。Neo4j 记录图谱事实和可查询关系。GraphRAG 运行产物可以作为可重建缓存，不作为唯一事实来源。

## 数据模型

### Lumina 关系数据库

#### `knowledge_index_runs`

记录每次文章级或全库级知识索引任务。

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string | 主键 |
| `run_type` | string | `article_ingest` / `batch_rebuild` / `community_refresh` / `lint` / `query_save` |
| `scope` | string | `article` / `category` / `all` / `manual_selection` |
| `article_id` | string nullable | 单篇索引时关联文章 |
| `status` | string | `pending` / `processing` / `completed` / `failed` / `cancelled` |
| `source_hash` | string nullable | 输入源 hash，用于幂等和跳过 |
| `model_api_config_id` | string nullable | 使用的模型配置 |
| `graphrag_config_hash` | string nullable | GraphRAG 配置 hash |
| `stats_json` | text nullable | 节点、边、claim、token、耗时统计 |
| `error_message` | text nullable | 失败原因 |
| `started_at` | string nullable | 开始时间 |
| `finished_at` | string nullable | 结束时间 |
| `created_at` | string | 创建时间 |
| `updated_at` | string | 更新时间 |

#### `knowledge_source_units`

将文章切分为可追溯文本单元。它是 GraphRAG TextUnit 和 Lumina 文章正文之间的桥。

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string | 主键 |
| `article_id` | string | 关联文章 |
| `unit_index` | integer | 文章内顺序 |
| `content_text` | text | 切块文本 |
| `content_hash` | string | 切块 hash |
| `token_count` | integer nullable | 估算 token 数 |
| `heading_path` | text nullable | 来源标题路径 |
| `char_start` | integer nullable | 原文起始位置 |
| `char_end` | integer nullable | 原文结束位置 |
| `neo4j_node_id` | string nullable | Neo4j TextUnit ID |
| `created_at` | string | 创建时间 |
| `updated_at` | string | 更新时间 |

#### `vector_embeddings`

统一向量层，逐步替代硬编码的单一 `article_embeddings` 逻辑。

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string | 主键 |
| `target_type` | string | `article` / `text_unit` / `knowledge_node` / `claim` / `community_report` |
| `target_id` | string | 目标对象 ID |
| `model` | string | 向量模型名 |
| `embedding` | text | JSON 编码向量 |
| `source_hash` | string | 向量源 hash |
| `created_at` | string | 创建时间 |
| `updated_at` | string | 更新时间 |

迁移策略：第一阶段保留 `article_embeddings`，新增通用 `EmbeddingService`，图谱能力使用 `vector_embeddings`。第二阶段在兼容窗口内将文章向量迁移到 `vector_embeddings`，再决定是否废弃 `article_embeddings`。

#### `graph_sync_status`

记录 Lumina 对 Neo4j 的同步状态。

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string | 主键 |
| `target_type` | string | `article` / `text_unit` / `entity` / `claim` / `community` |
| `target_id` | string | Lumina 侧 ID |
| `neo4j_node_id` | string nullable | Neo4j ID |
| `source_hash` | string nullable | 最近同步源 hash |
| `status` | string | `synced` / `pending` / `failed` / `deleted` |
| `last_error` | text nullable | 最近错误 |
| `synced_at` | string nullable | 最近成功同步时间 |

### Neo4j 属性图 Schema

#### 节点类型

| Label | 说明 | 关键属性 |
|---|---|---|
| `Article` | Lumina 文章镜像 | `article_id`, `slug`, `title`, `source_url`, `source_domain`, `is_visible`, `created_at`, `updated_at` |
| `TextUnit` | 可追溯文本单元 | `unit_id`, `article_id`, `unit_index`, `content_hash`, `preview`, `heading_path` |
| `Entity` | 人、组织、产品、地点、标准、项目等实体 | `name`, `canonical_name`, `entity_type`, `confidence` |
| `Concept` | 抽象概念、方法、主题、问题 | `name`, `canonical_name`, `concept_type`, `summary` |
| `Claim` | 可引用事实、观点或判断 | `claim_id`, `text`, `stance`, `confidence`, `created_at` |
| `Community` | 图算法或 GraphRAG 社区 | `community_id`, `level`, `title`, `rank`, `period` |
| `CommunityReport` | 社区摘要和主题报告 | `report_id`, `title`, `summary`, `body_md`, `created_at` |
| `QueryInsight` | 用户查询沉淀出的洞察 | `insight_id`, `question`, `answer_md`, `created_at` |

#### 关系类型

| Relationship | 起点 -> 终点 | 说明 |
|---|---|---|
| `HAS_TEXT_UNIT` | `Article -> TextUnit` | 文章包含文本单元 |
| `MENTIONS` | `TextUnit -> Entity/Concept` | 文本单元提及实体或概念 |
| `SUPPORTS` | `TextUnit/Claim -> Claim` | 证据支持声明 |
| `CONTRADICTS` | `Claim -> Claim` | 声明互相矛盾 |
| `RELATES_TO` | `Entity/Concept -> Entity/Concept` | 一般相关关系 |
| `CAUSES` | `Entity/Concept/Claim -> Entity/Concept/Claim` | 因果关系 |
| `PART_OF` | `Entity/Concept -> Entity/Concept` | 层级包含 |
| `DERIVED_FROM` | `Claim/CommunityReport/QueryInsight -> TextUnit/Article` | 派生来源 |
| `IN_COMMUNITY` | `Entity/Concept/Claim -> Community` | 社区归属 |
| `HAS_REPORT` | `Community -> CommunityReport` | 社区报告 |
| `CONNECTS` | `Entity/Concept -> Entity/Concept` | 系统发现的潜在连接 |

所有关系都应尽量包含：

- `weight`
- `confidence`
- `source_run_id`
- `evidence_unit_ids`
- `created_at`
- `updated_at`

## 索引和状态流

### 单篇文章增量索引

```text
Article created or updated
  -> existing cleaning task completes and content_md is ready
  -> enqueue process_knowledge_index(article_id, mode=base)
  -> build source units
  -> skip if article source hash unchanged
  -> extract entities, concepts, claims, relationships
  -> upsert Neo4j Article/TextUnit/Entity/Concept/Claim
  -> write DERIVED_FROM / MENTIONS / relation edges
  -> update vector_embeddings for selected targets
  -> mark knowledge_index_runs completed

Article interpretation completes
  -> enqueue process_knowledge_index(article_id, mode=enrichment)
  -> use category, tags, summary, outline, and quotes as auxiliary signals
  -> do not block graph indexing if interpretation fails
```

单篇索引必须幂等。相同 `article_id + source_hash + graph_config_hash + mode` 的成功运行不重复写入。重新清洗正文或手动编辑正文后，应产生新的 source hash，并触发基础重索引。文章解读包变化后，可触发增强索引，但不应成为基础图谱索引的强依赖。

### 全库 GraphRAG 索引

```text
Admin triggers batch rebuild
  -> select visible/admin-scoped articles
  -> create batch knowledge_index_run
  -> export source units to GraphRAG-compatible workspace
  -> run GraphRAG indexing pipeline
  -> import entities/relationships/community reports
  -> reconcile with existing Neo4j graph
  -> refresh vector embeddings for reports and high-value nodes
  -> persist stats and artifacts metadata
```

全库索引适合生成社区、跨主题摘要和全局洞察。它不应阻塞单篇文章入库。运行期间前端显示 `processing` 状态，并允许用户继续使用已有图谱。

### 图谱健康检查

周期性或手动执行 `knowledge_lint`：

- 孤立节点。
- 重复实体。
- 缺少证据的 claim。
- 高冲突但未标记 `CONTRADICTS` 的声明。
- 长期未更新的社区报告。
- 文章存在但未同步到 Neo4j 的 source units。
- Neo4j 中存在但 Lumina 已删除的文章镜像。

## 后端模块设计

### 新增模块

| 模块 | 责任 |
|---|---|
| `backend/app/domain/knowledge_source_service.py` | 文章切块、source hash、source unit 生命周期 |
| `backend/app/domain/knowledge_extraction_service.py` | schema-guided 抽取实体、概念、claim、关系 |
| `backend/app/domain/knowledge_graph_service.py` | Neo4j upsert、删除传播、路径查询、局部图查询 |
| `backend/app/domain/knowledge_graphrag_service.py` | GraphRAG workspace、批量索引、community reports 导入 |
| `backend/app/domain/vector_embedding_service.py` | 通用向量生成、hash 判断、相似度、usage log |
| `backend/app/api/routers/knowledge_router.py` | 知识图谱 API |
| `backend/app/core/neo4j.py` | Neo4j 连接、健康检查、配置加载 |

### 任务类型

| `task_type` | `content_type` | 说明 |
|---|---|---|
| `process_knowledge_index` | `knowledge_index` | 单篇文章增量索引 |
| `process_knowledge_batch_rebuild` | `knowledge_graph` | 批量全库重建 |
| `process_knowledge_community_refresh` | `community_report` | 社区发现和报告刷新 |
| `process_knowledge_lint` | `knowledge_lint` | 图谱健康检查 |
| `process_vector_embedding` | `embedding` | 通用向量生成 |

任务 payload 应包含：

```json
{
  "article_id": "optional",
  "scope": "article|all|category|manual_selection",
  "category_id": "optional",
  "article_ids": ["optional"],
  "force": false,
  "model_config_id": "optional",
  "graph_config_hash": "optional"
}
```

## API 设计

所有 API 挂载在 `/backend/api/*` 下。

### 查询和浏览

`GET /api/knowledge/search`

查询文章、实体、概念、claim、社区报告的混合结果。

请求参数：

- `query`
- `types`
- `limit`
- `include_private`

响应：

```json
{
  "items": [
    {
      "type": "concept",
      "id": "kg-node-id",
      "title": "GraphRAG",
      "summary": "用于全库图谱增强检索的索引和查询范式",
      "score": 0.92,
      "evidence_count": 8
    }
  ]
}
```

`GET /api/knowledge/nodes/{node_id}`

返回节点详情、摘要、来源、邻接关系、claim 列表。

`GET /api/knowledge/graph`

请求参数：

- `node_id`
- `depth`
- `relation_types`
- `limit`

返回局部图：

```json
{
  "nodes": [
    {"id": "n1", "label": "Concept", "title": "GraphRAG"}
  ],
  "edges": [
    {"id": "e1", "source": "n1", "target": "n2", "type": "RELATES_TO", "weight": 0.78}
  ]
}
```

`GET /api/knowledge/path`

请求参数：

- `source_node_id`
- `target_node_id`
- `max_depth`

返回两点之间路径和解释。

`GET /api/knowledge/discover`

返回潜在联系：

- 弱连接但有高质量证据的跨社区关系。
- 共同桥接节点。
- 最近新增资料带来的新连接。
- 与当前文章或节点相关的反直觉关系。

### 全库问答和报告

`POST /api/knowledge/query`

请求：

```json
{
  "question": "过去三个月 AI coding 相关内容中，哪些观点正在发生变化？",
  "mode": "local|global|drift",
  "save_as_insight": false
}
```

响应：

```json
{
  "answer_md": "...",
  "mode": "global",
  "citations": [
    {
      "article_id": "article-id",
      "text_unit_id": "unit-id",
      "quote": "evidence text",
      "source_url": "https://example.com"
    }
  ],
  "related_nodes": [],
  "related_reports": []
}
```

`GET /api/knowledge/communities`

返回社区列表、级别、报告更新时间、代表节点。

`GET /api/knowledge/communities/{community_id}/report`

返回社区报告和来源证据。

### 管理和索引

`POST /api/knowledge/index/article/{article_slug}`

触发单篇重索引。

`POST /api/knowledge/index/rebuild`

触发全库或范围重建。

`GET /api/knowledge/index/runs`

查看索引任务历史。

`GET /api/knowledge/health`

返回 Neo4j 连接状态、最近索引状态、待同步数量、失败数量。

## 前端设计

### 新增页面

| 页面 | 路径 | 说明 |
|---|---|---|
| 知识搜索 | `/knowledge` | 混合搜索、类型筛选、最近洞察 |
| 节点详情 | `/knowledge/node/[id]` | 节点摘要、来源、claim、邻接图、相关文章 |
| 图谱探索 | `/knowledge/graph` | 局部图谱、多跳路径、关系筛选 |
| 全库洞察 | `/knowledge/insights` | Global/DRIFT 查询、社区报告、潜在联系 |
| 管理设置 | `/admin` 扩展 tab | Neo4j/GraphRAG 配置、索引任务、健康检查 |

### 关键交互

- 搜索结果按 `Article`、`Concept`、`Entity`、`Claim`、`CommunityReport` 分组。
- 图谱页默认展示局部图，不一次性渲染全库。
- 点击边时展示关系解释和证据片段。
- 路径查询支持选择两个节点，返回路径和自然语言解释。
- 潜在联系卡片必须包含“为什么相关”和“证据来自哪里”。
- 所有 AI 生成报告和洞察应显示生成时间、模型、来源数量。

### 图谱组件

优先使用 Cytoscape.js 做网络图展示。原因：

- 更适合实体关系图和网络布局。
- 支持节点/边样式、布局、选择、过滤。
- 与 React 页面集成成本可控。

React Flow 更适合流程编辑器，不作为第一选择。

## 配置

新增后端运行配置：

| 环境变量 | 默认 | 说明 |
|---|---|---|
| `NEO4J_ENABLED` | `false` | 是否启用 Neo4j 图谱能力 |
| `NEO4J_URI` | `bolt://neo4j:7687` | Neo4j URI |
| `NEO4J_USERNAME` | `neo4j` | 用户名 |
| `NEO4J_PASSWORD` | empty | 密码，启用时必填 |
| `KNOWLEDGE_GRAPH_ENABLED` | `false` | 是否启用知识图谱索引 |
| `KNOWLEDGE_GRAPH_AUTO_INDEX` | `false` | 新文章是否自动进入知识索引 |
| `KNOWLEDGE_GRAPH_BATCH_LIMIT` | `200` | 单次批量索引上限 |
| `GRAPHRAG_ENABLED` | `false` | 是否启用 GraphRAG 批处理 |
| `GRAPHRAG_WORKSPACE_DIR` | `data/graphrag` | GraphRAG 工作目录 |

管理后台应提供只读健康状态和可编辑开关。密钥类配置仍从环境变量读取，不在前端明文展示。

## 权限和隐私

- 匿名用户只能看到 `is_visible=true` 文章派生出的图谱内容。
- 管理员可以查看全部文章派生的图谱内容。
- Neo4j 节点必须携带 `is_visible` 或可从关联 Article 推导可见性。
- 删除文章时必须删除或失效相关 `Article`、`TextUnit`、只由该文章支持的 claim，以及缺少证据的关系。
- claim 和 community report 返回给前端时必须过滤不可见来源。
- 所有证据片段应避免泄露隐藏文章内容给匿名用户。

## 可靠性和失败处理

- Neo4j 不可用时，文章创建和普通阅读不应失败。
- 图谱 API 在 Neo4j 不可用时返回 `503` 和明确错误码。
- 单篇索引失败只标记 `knowledge_index_runs.failed`，不影响文章 AI 解读。
- 批量索引应分批提交，避免单次失败回滚全库。
- GraphRAG 产物应可删除并重建，不能成为唯一不可恢复状态。
- 所有外部模型调用继续记录到 `ai_usage_logs`。
- 大批量任务需要支持断点续跑和 force rebuild。

## 观测性

### 日志

- 每次索引运行的 `run_id`、范围、模型、source hash。
- Neo4j 写入节点数、边数、claim 数、耗时。
- GraphRAG 阶段耗时和失败阶段。
- 被跳过的文章及原因。

### 指标

- 待索引文章数。
- 索引成功率。
- 平均单篇索引耗时。
- Neo4j 节点/边总数。
- 孤立节点数量。
- 无证据 claim 数量。
- GraphRAG community report 更新时间。

### 管理后台

应展示：

- Neo4j 连接状态。
- 最近一次全库索引结果。
- 失败任务列表。
- 图谱规模统计。
- 一键重建和单篇重索引入口。

## 兼容、迁移和回滚

### 迁移顺序

1. 增加关系数据库表，不改变现有文章 API。
2. 增加 Neo4j 配置和健康检查，默认关闭。
3. 增加 `vector_embedding_service`，保持 `article_embeddings` 现有行为。
4. 增加单篇知识索引任务，默认手动触发。
5. 增加知识查询 API 和前端只读页面。
6. 增加全库 GraphRAG 批量索引，默认管理员手动触发。
7. 稳定后开启新文章自动索引。
8. 评估将 `article_embeddings` 迁入 `vector_embeddings`。

### 回滚策略

- 关闭 `KNOWLEDGE_GRAPH_ENABLED` 后，文章核心功能继续可用。
- Neo4j 数据可删除重建。
- `knowledge_index_runs` 和 `knowledge_source_units` 可保留作为审计，不影响旧功能。
- 如果 `vector_embeddings` 迁移失败，继续使用原 `article_embeddings` 相似文章接口。

## 测试和验证

### 单元测试

- source unit 切分和 hash 稳定性。
- schema-guided extraction 输出解析和校验。
- Neo4j upsert payload 构造。
- 权限过滤逻辑。
- 删除文章后的图谱失效策略。
- `vector_embeddings` source hash 跳过逻辑。

### 集成测试

- 创建文章后手动触发知识索引。
- Neo4j 不可用时 API 降级。
- 同一文章重复索引不重复创建节点。
- 修改文章正文后重新索引能更新 TextUnit 和派生关系。
- 匿名用户无法看到隐藏文章派生的证据。

### 手动验证

- 本地 Docker Compose 启动 backend、frontend、worker、Neo4j。
- 管理后台通过健康检查。
- 单篇文章索引后，在 `/knowledge` 搜到实体和概念。
- 节点详情能展示证据来源。
- 图谱页能展示局部关系。
- 全库 rebuild 后能生成社区报告。

### 性能验证

- 100 篇文章批量索引耗时和失败率。
- 1,000 个节点局部图查询响应时间。
- 常见路径查询响应时间。
- 前端图谱渲染在 200 节点以内保持可交互。

## 取舍和备选方案

### 只用 SQLite 关系表

优点是部署简单、和现有架构一致。缺点是多跳路径、社区发现和图算法会很快变复杂。由于本功能目标是全库图谱分析，SQLite 只适合作为控制层，不适合作为长期图分析引擎。

### 只用 Microsoft GraphRAG 默认产物

优点是启动快。缺点是业务状态、权限、删除传播、证据过滤和 UI 交互难以完全贴合 Lumina。GraphRAG 适合作为索引和全局查询组件，不适合作为 Lumina 的唯一业务数据库。

### 只用 Neo4j GraphRAG

Neo4j GraphRAG Python 适合 Neo4j 侧 RAG 集成，但全库社区摘要和 GraphRAG 查询范式仍需要额外设计。可作为 Neo4j 集成工具评估，但不替代 Microsoft GraphRAG 的全库分析思路。

### 自研全部抽取和社区算法

可控性最高，但开发成本和评估成本过高。建议先复用成熟 GraphRAG 思路和 Neo4j 图算法，把自研集中在 Lumina schema、证据链、权限和用户体验。

## 开放问题

- 第一版 ontology 的实体类型和关系类型是否需要按用户自定义扩展。
- GraphRAG 是作为库内调用、CLI 调用，还是独立 worker 服务。
- 是否要从 SQLite 迁移到 Postgres，以便更好管理大规模运行记录和向量索引。
- Neo4j 是否作为可选高级功能，还是成为生产部署必需组件。
- 社区报告更新频率：每次批量索引后、定时、还是手动触发。
- 用户是否可以手动合并实体、删除错误关系、固定重要 claim。
- 是否需要为每个用户维护独立图谱，还是全站共享一张图。

## Execution Plan Inputs

后续执行计划应按风险递增拆分：

0. 先完成 `docs/trd/article-ai-interpretation-bundle.md` 中的文章 AI 解读合并，提供稳定的 interpretation 完成事件。
1. 图谱能力配置和 Neo4j 健康检查。
2. 关系数据库迁移：`knowledge_index_runs`、`knowledge_source_units`、`vector_embeddings`、`graph_sync_status`。
3. 通用 `vector_embedding_service`，不破坏现有 `article_embeddings`。
4. 单篇 source unit 切分和手动知识索引任务。
5. Neo4j upsert 和局部图查询 API。
6. `/knowledge` 搜索和节点详情 MVP。
7. GraphRAG 批量索引 workspace 和导入流程。
8. 社区报告、全局查询、潜在联系发现。
9. 权限过滤、删除传播、lint、管理后台完善。

每个阶段都应有可回滚开关，并保持现有文章采集、阅读、AI 解读、相似文章推荐可用。
