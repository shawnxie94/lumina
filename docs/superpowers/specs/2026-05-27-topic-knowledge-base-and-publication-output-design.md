# Topic Knowledge Base and Publication Output Design

## 背景

Lumina 当前主要承载信息收集、文章 AI 解读、周期回顾和 Markdown 导出能力。已有能力已经覆盖了“输入”和“回顾”：

- 浏览器扩展、RSS、手动创建文章负责内容采集。
- 文章详情页提供摘要、要点、提纲、引文、信息图等 AI 解读。
- 回顾功能基于时间窗口和模板生成周期性内容。
- 回顾编辑器已经支持文章引用插入和内容片段引用。
- 文章列表和详情页已经支持 Markdown 导出。

但当前链路仍然缺少两个关键环节：

1. 缺少围绕一个长期问题、项目或选题持续整理知识的中间层。
2. 输出类型主要是 Review，适合周期性汇总，但不适合自由表达观点、沉淀研究结论或创作博客文章。

本设计将新增 Topic 与 Publication 两个方向：

- Topic 不是简单的文章集合，而是一个由人工和 LLM 共同维护的主题知识库。
- Publication 是统一输出层，既可以承载现有 Review，也可以承载基于 Topic 知识整理结果进行观点表达的自由文档。

## 思路来源

本设计借鉴 Karpathy 的 LLM Wiki 思想：

- 原始资料保持不可变。
- LLM 维护一层可读、可编辑、可交叉引用的 wiki。
- 通过 schema 约束 wiki 的组织方式和 LLM 的修改行为。
- 系统提供 ingest、query、lint 等操作，让知识库可以持续更新和自检。
- `index.md` 和 `log.md` 这类导航与审计内容是知识系统的一部分，而不是附属产物。

参考：

- [karpathy/442a6bf555914893e9891c11519de94f](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f)

Lumina 不应把这个思想直接实现为纯文件夹系统，而应该产品化为数据库对象、可审计操作、可引用片段和面向输出的编辑体验。

## 目标

- 新增 Topic，作为文章、笔记、问题、知识页和输出物之间的长期组织单位。
- Topic 下支持持续维护 wiki 风格的结构化知识页。
- Topic 能记录来源、引用、claims、问题、操作日志和健康检查结果。
- 新增 Publication 作为统一输出层，用于承载 Review、自由文档和后续更多发布类型。
- 新增自由文档类型，用于观点表达和长期内容创作。
- 自由文档能从 Topic 中引用知识页、来源文章、claims 和正文片段。
- 打通“输入 -> 整理 -> 写作 -> 发布 -> 反馈 -> 再整理”的闭环。

## 非目标

- 不把 Topic 做成简单收藏夹或标签替代品。
- 不在第一期引入复杂知识图谱可视化。
- 不在第一期强行重构 Review 的生成、模板和占位符链路。
- 不要求 LLM 自动修改内容后直接落库，核心知识更新应支持 diff 审阅。
- 不把 Publication 做成完整 CMS 或多用户协作编辑器。
- 不在第一期实现跨实例实时同步、权限矩阵或多人审稿流。

## 当前约束

### 一、Article 是主要输入对象

现有文章模型已经承载标题、正文、译文、AI 解读、标签、分类、评论、媒体和向量索引等能力。Topic 第一阶段应优先复用 Article，不应重新实现一套独立 source 存储。

主要相关位置：

- [backend/models.py](/Users/shawn/Documents/GitHub/lumina/backend/models.py)
- [frontend/pages/article/[id].tsx](/Users/shawn/Documents/GitHub/lumina/frontend/pages/article/[id].tsx)
- [frontend/pages/list.tsx](/Users/shawn/Documents/GitHub/lumina/frontend/pages/list.tsx)

### 二、Review 已经承担周期性输出

Review 当前与模板、时间窗口、文章占位符、自动生成和发布状态强绑定。它适合继续承担周期性汇总，不适合作为自由写作模型直接扩展。

主要相关位置：

- [backend/app/domain/review_service.py](/Users/shawn/Documents/GitHub/lumina/backend/app/domain/review_service.py)
- [frontend/pages/reviews/index.tsx](/Users/shawn/Documents/GitHub/lumina/frontend/pages/reviews/index.tsx)
- [frontend/pages/reviews/[slug].tsx](/Users/shawn/Documents/GitHub/lumina/frontend/pages/reviews/[slug].tsx)

### 三、已有引用插入能力可以复用

回顾编辑器已经引入文章搜索、预览、片段选择和 Markdown 插入能力。自由文档的 Topic 引用可以复用这类交互思路，但引用对象会从单篇文章扩展到 Topic wiki page、claim 和 source snippet。

主要相关位置：

- [frontend/components/ReviewReferenceInsertPanel.tsx](/Users/shawn/Documents/GitHub/lumina/frontend/components/ReviewReferenceInsertPanel.tsx)
- [frontend/components/ReviewReferenceSelectionPreview.tsx](/Users/shawn/Documents/GitHub/lumina/frontend/components/ReviewReferenceSelectionPreview.tsx)
- [frontend/lib/reviewReference.ts](/Users/shawn/Documents/GitHub/lumina/frontend/lib/reviewReference.ts)

## 产品定义

### 一、Topic

Topic 是围绕一个长期问题、项目、研究方向或选题形成的知识整理空间。

典型例子：

- AI IDE 演进
- 某行业政策跟踪
- 某产品竞品研究
- 某技术方案选型
- 某公众号长期选题

Topic 不等同于 Category 或 Tag：

- Category 更适合做全局内容分类。
- Tag 更适合标记文章属性。
- Topic 更适合承载一个持续推进的问题空间。

Topic 内部至少包含：

- 来源资料
- wiki 知识页
- claims
- 待解决问题
- 操作日志
- lint 结果
- 关联输出物

### 二、Publication 与自由文档

Publication 是 Lumina 的统一输出层，用来承接可发布、可导出、可评论、可进入 RSS/sitemap 的内容对象。

第一阶段建议支持两类 Publication：

- `review`: 现有周期性回顾。
- `free_document`: 自由文档，覆盖博客文章、研究札记、技术文章、决策备忘录等。

自由文档与 Review 的核心区别：

| 维度 | Review | 自由文档 |
| --- | --- | --- |
| 驱动方式 | 周期、模板、文章窗口 | 作者观点、主题、写作目标 |
| 内容结构 | 回顾模板 + 文章占位符 | 自由 Markdown |
| 主要用途 | 周报、月报、周期汇总 | 观点文章、研究札记、技术博客、决策备忘录 |
| 来源约束 | 通常来自某个时间窗口 | 可来自一个或多个 Topic |
| 生成方式 | 模板化生成后人工润色 | 人工写作 + AI 辅助 + Topic 引用 |

自由文档应支持直接写作，也应支持从 Topic 创建草稿。

### 三、Review 与 Publication 的关系

从产品概念上看，Review 应该是 Publication 的一种，因为它和自由文档一样需要公开详情页、发布状态、SEO、RSS、评论、导出和媒体处理。

但从实现上，不建议第一期直接把现有 ReviewIssue 改造成继承式子类。Review 当前与模板、时间窗口、文章占位符、自动生成、文章分组和发布状态耦合较深，直接迁移风险较高。

推荐采用组合式演进：

1. 新增 `Publication` 作为公共发布外壳。
2. 保留 `ReviewIssue` 的领域字段和生成链路。
3. 让 `ReviewIssue` 可选关联一个 `publication_id`，或通过 `Publication.source_type = review` / `source_id = review_issue_id` 指回 Review。
4. 新增 `FreeDocument` 承载自由文档领域字段，并同样关联 `Publication`。
5. 后续在 Review 新建、发布、撤回时同步维护对应 Publication。

这样可以先统一前台展示、RSS、SEO、评论和导出能力，同时避免把 Review 的复杂生成逻辑塞进一个过早抽象的通用文档模型。

### 四、输入展示策略

输入侧不建议改成纯 Topic 视角。Lumina 应保留信息流，但把现有信息流升级为 Inbox；Topic 则作为知识整理和深度工作的主视角。

推荐关系：

```text
Inbox / 信息流 = 输入入口
Topic = 知识整理工作区
Publication = 输出与发布
```

Inbox 适合处理：

- 新进入的文章。
- 未读、未处理、未归类内容。
- RSS 或浏览器扩展采集后的分拣。
- LLM 推荐 Topic 的确认、忽略和调整。
- 需要快速浏览但未确定价值的信息。

Topic 适合处理：

- 一个长期问题或选题。
- 已筛选过的来源资料。
- wiki 知识页、claims、questions 和 lint。
- 深度阅读、整理入库和写作前准备。
- 追踪某个选题的演进和输出结果。

因此，首页和输入入口应采用信息流与 Topic 结合的方式，而不是让 Topic 替代信息流。信息流负责发现和分拣，Topic 负责沉淀和组织，Publication 负责表达和发布。

## 信息架构

### 一、核心对象关系

```text
Article
  -> TopicSource
      -> Topic
          -> TopicWikiPage
          -> TopicClaim
          -> TopicQuestion
          -> TopicOperationLog
          -> TopicLintIssue
          -> Publication
              -> FreeDocument

Review
  -> Publication(review)
  -> 可选引用 Article 或 Topic

FreeDocument
  -> Publication(free_document)
  -> 可引用 TopicWikiPage / TopicClaim / Article / SourceSnippet
```

### 二、建议新增模型

#### Topic

字段建议：

- `id`
- `slug`
- `title`
- `description`
- `status`: active / archived
- `default_schema_id`
- `created_at`
- `updated_at`

#### TopicSource

连接 Topic 和 Article。

字段建议：

- `id`
- `topic_id`
- `article_id`
- `role`: core / background / counterpoint / reference / pending
- `status`: unread / reading / digested / cited / ignored
- `relevance_score`
- `user_note`
- `routing_decision`: manual / suggested / auto_attached / rejected
- `routing_confidence`
- `routing_reason`
- `routing_evidence`
- `routing_model`
- `routing_decided_at`
- `ingested_at`
- `last_processed_at`
- `created_at`
- `updated_at`

#### TopicWikiPage

字段建议：

- `id`
- `topic_id`
- `slug`
- `title`
- `page_type`: overview / concept / entity / timeline / comparison / faq / synthesis / index / log
- `markdown_content`
- `source_count`
- `is_system_page`
- `last_generated_at`
- `manual_edited_at`
- `created_at`
- `updated_at`

#### TopicClaim

TopicClaim 是可引用的事实、判断或观点单元。

字段建议：

- `id`
- `topic_id`
- `claim_text`
- `claim_type`: fact / opinion / prediction / decision / risk
- `confidence`: high / medium / low
- `status`: active / disputed / deprecated
- `source_refs`
- `contradicts_claim_ids`
- `created_at`
- `updated_at`

#### TopicQuestion

字段建议：

- `id`
- `topic_id`
- `question`
- `status`: open / answered / dismissed
- `answer_page_id`
- `created_from`: manual / lint / output_feedback / ai_query
- `created_at`
- `updated_at`

#### TopicOperationLog

记录 Topic 内所有重要操作。

字段建议：

- `id`
- `topic_id`
- `operation_type`: add_source / ingest / query / lint / apply_diff / manual_edit / create_output
- `actor`: user / ai / system
- `summary`
- `input_snapshot`
- `output_snapshot`
- `created_at`

#### TopicLintIssue

字段建议：

- `id`
- `topic_id`
- `issue_type`: uncited_page / contradiction / stale_source / orphan_claim / missing_page / weak_evidence
- `severity`: info / warning / error
- `message`
- `target_type`
- `target_id`
- `status`: open / resolved / dismissed
- `created_at`
- `resolved_at`

#### Publication

用于承载所有可发布输出的公共字段。

字段建议：

- `id`
- `publication_type`: review / free_document
- `source_type`: review_issue / free_document
- `source_id`
- `slug`
- `title`
- `summary`
- `status`: draft / published / archived
- `visibility`: public / private
- `top_image`
- `seo_title`
- `seo_description`
- `published_at`
- `created_at`
- `updated_at`

#### FreeDocument

用于承载自由文档领域字段。

字段建议：

- `id`
- `publication_id`
- `document_type`: blog_post / research_note / memo / essay / guide
- `markdown_content`
- `rendered_markdown`
- `created_at`
- `updated_at`

可以另建 `PublicationSourceRef` 记录引用关系：

- `publication_id`
- `target_type`: topic / topic_page / topic_claim / article / source_snippet
- `target_id`
- `quote`
- `note`

## Topic 工作流

### 一、加入来源

入口：

- 文章详情页：加入 Topic
- 文章列表页：批量加入 Topic
- 浏览器扩展：采集时选择 Topic
- Topic 页面：搜索并添加已有文章

加入时允许设置：

- 来源角色
- 初始状态
- 用户备注

### 二、LLM 自动推荐与自动加入

Topic 来源归属建议引入 LLM 判断，但不应在第一期做成静默自动加入。Topic 是长期知识库，错误归类会污染后续 wiki、claims 和自由文档引用链。

推荐采用三阶段策略：

1. 自动推荐，不自动加入。
2. 高置信自动加入，低置信待确认。
3. Topic 自定义收录标准，由 LLM 按标准判断来源角色和是否收录。

#### 第一阶段：自动推荐

文章进入系统后，后台自动判断它可能属于哪些 Topic，并在文章详情、文章列表或 Topic 推荐队列里展示：

```text
推荐加入：
- AI IDE 演进  92%  原因：多次提到 Cursor、agentic coding、上下文工程
- 开源模型生态  71%  原因：涉及模型能力和本地部署
```

用户可以执行：

- 确认加入。
- 忽略推荐。
- 修改来源角色后加入。
- 加入其他 Topic。

推荐结果应可审计，至少记录：

- 推荐 Topic。
- 置信度。
- 判断理由。
- 命中的关键词、片段或语义证据。
- 使用的模型。
- 判断时间。

#### 第二阶段：高置信自动加入

当 Topic 显式开启自动收录后，系统可以对高置信结果自动加入。

Topic 可配置：

```json
{
  "auto_attach_enabled": true,
  "min_confidence": 0.88,
  "max_topics_per_article": 3,
  "require_reason": true,
  "allow_auto_ingest": false
}
```

行为约束：

- 只有超过阈值的判断才能自动加入。
- 自动加入必须可撤销。
- 自动加入必须写入 TopicOperationLog。
- 自动加入不等于自动整理入库，是否触发 ingest 应单独配置。
- 一个 Article 自动加入多个 Topic 时必须有上限，避免泛化污染。

#### 第三阶段：Topic 收录标准

每个 Topic 应能定义自己的 intake schema，而不是只依赖全局分类。

示例：

```text
这个 Topic 收录：
- AI IDE 产品演进
- 代码代理架构
- 上下文管理
- 开发者工作流变化

不收录：
- 泛 AI 新闻
- 单纯模型 benchmark
- 与编程无关的 AI 应用
```

LLM 判断时应回答：

- 这篇文章是否符合该 Topic 的收录标准？
- 如果收录，应作为 core / background / counterpoint / reference / pending 哪种来源？
- 是否需要进入整理入库队列？
- 判断依据是什么？

#### 推荐实现策略

不要对每篇文章和所有 Topic 直接跑 LLM。推荐两段式：

1. 用 embedding、关键词、分类、标签或历史引用关系筛出候选 Topic。
2. 只对候选 Topic 调用 LLM 做最终判断和解释。

推荐输出协议：

```json
{
  "topic_id": "topic-id",
  "decision": "suggest|auto_attach|reject",
  "role": "core|background|counterpoint|reference|pending",
  "confidence": 0.91,
  "reason": "文章讨论了 AI 编程代理中的上下文管理，与 Topic 收录标准高度匹配。",
  "evidence": ["agentic coding", "context window", "IDE workflow"],
  "should_ingest": true
}
```

### 三、整理入库

整理入库是 Topic 的核心动作。

流程：

1. 读取新增或变更的 TopicSource。
2. 读取对应 Article 的正文、译文、AI 解读、标签和元数据。
3. LLM 生成一组 proposed changes，而不是直接改库。
4. 前端展示 diff。
5. 用户确认后写入 TopicWikiPage、TopicClaim、TopicQuestion 和 TopicOperationLog。

整理动作应能更新：

- overview
- index
- concept pages
- comparison pages
- timeline pages
- claims
- open questions
- log

### 四、查询与沉淀

用户可以在 Topic 内提问。

查询结果不应只作为聊天消息存在。系统应提供“沉淀为知识”的动作：

- 保存为 FAQ
- 保存为新的 wiki page
- 追加到已有 wiki page
- 转为 TopicQuestion 的答案
- 转为自由文档草稿片段

### 五、健康检查

lint 检查建议包括：

- wiki 页面没有来源支撑。
- claim 没有引用或引用过弱。
- 新来源与旧 claim 冲突。
- 关键概念多次出现但没有独立页面。
- Topic 长期未处理新的来源。
- 自由文档引用了已废弃或 disputed 的 claim。

lint 结果进入 TopicLintIssue，用户可以逐项处理。

## Publication 工作流

### 一、创建方式

自由文档支持三种创建方式：

1. 空白创建。
2. 从 Topic 创建。
3. 从 Topic 查询结果创建。

从 Topic 创建时，用户可以选择：

- 使用哪些 wiki pages
- 使用哪些 claims
- 使用哪些 source snippets
- 输出类型：观点文章 / 研究札记 / 技术博客 / 决策备忘录
- 写作语气和读者对象

### 二、编辑器能力

自由文档编辑器应支持：

- Markdown 写作。
- 插入 Topic 引用。
- 插入 TopicClaim。
- 插入 Article 引用。
- 插入 source snippet。
- 生成带来源的段落。
- 基于选中文本继续写、改写、压缩或扩展。

推荐提供右侧 Topic 侧栏：

- Topic overview
- Wiki page 列表
- Claims
- Sources
- Open questions

用户可以从侧栏插入内容。

### 三、发布能力

Publication 发布能力应统一承载 Review 和自由文档的公共发布需求：

- SEO 元信息。
- 顶图。
- 评论。
- RSS。
- sitemap。
- Markdown 导出。

但自由文档不需要 Review 的模板周期、文章窗口和占位符校验。

### 四、反馈回写

自由文档发布后应回写 Topic：

- 标记被引用的 TopicSource 为 cited。
- 标记被使用的 TopicClaim。
- 写入 TopicOperationLog。
- 允许从自由文档评论或人工反馈创建新的 TopicQuestion。

这一步是输入输出闭环的关键。

## 前端页面建议

### Inbox / 信息流页面

路径建议：

- `/`
- `/list`

能力：

- 最新输入文章。
- 未读、未处理、未归类筛选。
- 推荐加入的 Topic。
- 文章已加入的 Topic 状态。
- 快捷操作：加入 Topic、忽略推荐、稍后读、标记有价值。
- 是否已整理入库。
- 是否已被 Publication 使用。

信息流页面不应只是文章列表，而应升级为输入分拣台。它负责承接新输入和 Topic 推荐确认，但不承担深度知识整理。

### 首页 Dashboard

如果后续要重构首页，建议使用混合 Dashboard，而不是纯 Topic 首页。

建议模块：

- 今日新增 / 待处理输入。
- 推荐加入 Topic 的文章。
- 最近活跃 Topic。
- 有 lint 问题的 Topic。
- 最近草稿 Publication。
- 最近发布内容。

### Topic 列表页

路径建议：

- `/topics`

能力：

- Topic 卡片或列表。
- 搜索。
- 状态筛选。
- 最近更新。
- source 数量、page 数量、open question 数量、lint issue 数量。

### Topic 详情页

路径建议：

- `/topics/[slug]`

主要区域：

- 概览。
- Sources。
- Wiki。
- Claims。
- Questions。
- Outputs。
- Activity Log。
- Lint。

第一期可以用 tabs，不必做复杂图谱。

### Publication 列表页

路径建议：

- `/publications`

能力：

- 已发布 Publication 列表。
- 管理员可见草稿。
- 按 publication_type 筛选 Review / 自由文档。
- 按 Topic、标签、发布时间筛选。

### 自由文档编辑页

路径建议：

- `/publications/[slug]`
- `/admin/publications/[id]` 或在详情页内区分管理态。

能力：

- Markdown 编辑。
- 预览。
- Topic 侧栏。
- 引用插入。
- 发布设置。
- 导出。

## 后端服务建议

### TopicService

职责：

- Topic CRUD。
- TopicSource 管理。
- Topic dashboard 聚合。
- Topic 操作日志写入。

### TopicIngestionService

职责：

- 从 TopicSource 读取文章内容。
- 调用 AI 生成 proposed changes。
- 解析并校验变更。
- 写入待确认结果或直接返回前端 diff。

### TopicRoutingService

职责：

- 根据新文章内容筛选候选 Topic。
- 调用 LLM 判断候选 Topic 是否匹配。
- 生成推荐加入、自动加入或拒绝的 routing decision。
- 写入 TopicSource routing 字段和 TopicOperationLog。
- 管理 Topic 自动收录阈值、候选数量上限和 intake schema。

### TopicWikiService

职责：

- TopicWikiPage CRUD。
- page tree/index 维护。
- page slug 生成。
- markdown 渲染。

### TopicClaimService

职责：

- claims 抽取、更新、废弃。
- claim 与 source refs 维护。
- contradiction 标记。

### TopicLintService

职责：

- 执行 Topic 健康检查。
- 生成 TopicLintIssue。
- 处理 resolved/dismissed 状态。

### PublicationService

职责：

- Publication 公共发布字段维护。
- 发布/撤回。
- RSS/sitemap/SEO 支撑。
- 评论、导出、公开详情页所需的公共查询。

### FreeDocumentService

职责：

- 自由文档 CRUD。
- Markdown 渲染。
- 来源引用关系维护。
- 从 Topic 创建自由文档草稿。

## AI 输出协议建议

Topic 整理入库和 lint 不应依赖自由文本解析，应使用固定 JSON contract。

整理入库输出建议结构：

```json
{
  "summary": "本次整理说明",
  "page_changes": [
    {
      "operation": "create|update",
      "page_slug": "overview",
      "title": "Overview",
      "page_type": "overview",
      "markdown_content": "..."
    }
  ],
  "claims": [
    {
      "claim_text": "...",
      "claim_type": "fact",
      "confidence": "medium",
      "source_refs": []
    }
  ],
  "questions": [
    {
      "question": "...",
      "reason": "..."
    }
  ],
  "lint_hints": [
    {
      "issue_type": "contradiction",
      "message": "..."
    }
  ]
}
```

前端展示时应以 diff 为主，避免 LLM 静默覆盖人工编辑内容。

## 分期计划

文档的产品能力可以分成 Topic、LLM Wiki、Publication 和闭环质量控制四层，但实际工程落地建议拆成六期。这样可以避免同时改动 Topic 模型、AI 整理协议、Review 发布链路和自由文档编辑器导致范围失控。

### Phase 1：Topic v0 手动知识容器

目标：先建立 Topic 作为长期知识容器。

范围：

- Topic CRUD。
- Article 加入/移出 Topic。
- 信息流展示文章的 Topic 状态和快捷加入入口。
- TopicSource 状态和角色。
- Topic 详情页基础 tabs。
- 手动创建和编辑 TopicWikiPage。
- 自动维护 index/log 的最小版本。

验收：

- 用户可以围绕一个选题聚合文章。
- 用户仍然可以从信息流处理新输入，而不必先进入 Topic。
- 用户可以在 Topic 内维护概览页和若干知识页。
- Topic 可以看到来源、页面和活动记录。

### Phase 2：Topic 自动推荐归属

目标：减少手动加入成本，但不污染 Topic 知识库。

范围：

- Topic intake schema。
- 候选 Topic 筛选。
- LLM 推荐加入。
- Topic 推荐队列。
- 高置信自动加入配置，但默认关闭。
- routing 审计字段。
- TopicRoutingService。

验收：

- 新文章进入系统后，可以看到推荐加入的 Topic。
- 用户可以确认、忽略或调整来源角色后加入。
- 高置信自动加入只在 Topic 显式开启后生效。
- 每条推荐或自动加入都有置信度、理由、证据和操作日志。

### Phase 3：LLM Wiki 整理入库

目标：引入 LLM 驱动的整理入库能力。

范围：

- TopicIngestionService。
- proposed changes JSON contract。
- 前端 diff 审阅。
- TopicClaim。
- TopicQuestion。
- TopicOperationLog。

验收：

- 新文章加入 Topic 后，可以生成待确认的 wiki 更新。
- 用户确认后，wiki page、claims、questions 和 log 被更新。
- 每个关键 claim 能追溯到来源。

### Phase 4：Publication 公共发布层

目标：先统一输出底座，再新增自由文档。

范围：

- Publication 基础模型。
- Review 与 Publication 建立组合式关联。
- 公共发布状态、slug、SEO、RSS、评论、导出能力抽象。
- Review 新建、发布、撤回时同步维护 Publication。
- 保留 Review 原有模板、周期、占位符和生成链路。

验收：

- Review 可以被统一映射为 Publication 输出。
- Review 原有生成链路不被强制重构。
- 前台展示、RSS、SEO、评论和导出可以逐步走 Publication 公共能力。

### Phase 5：FreeDocument 自由文档

目标：实现类似博客、研究札记、备忘录的自由输出。

范围：

- FreeDocument 基础模型。
- PublicationSourceRef。
- 自由文档列表、详情、编辑、发布。
- 自由文档 Markdown 渲染和导出。
- 从 Topic 创建自由文档。
- 插入 Topic page、claim、article snippet。
- 发布后回写 TopicSource / TopicClaim 使用状态。

验收：

- 用户可以从 Topic 创建一篇自由文档草稿。
- 自由文档可以引用 Topic 知识和来源片段。
- 自由文档发布后具备公开详情页、SEO 和 RSS 基础能力。
- Topic 能显示哪些来源和 claims 已被自由文档使用。

### Phase 6：闭环增强与质量控制

目标：让输出反哺输入和整理，并让 Topic 越用越准。

范围：

- source/claim 使用记录。
- Topic lint。
- 从自由文档评论或反馈创建 TopicQuestion。
- 来源质量评分。
- Topic 缺口分析。
- 自动推荐规则优化。

验收：

- Topic 能显示哪些来源被输出使用过。
- lint 能发现未引用、冲突、过时、缺页等问题。
- 输出后的反馈能变成新的整理问题。
- 来源质量和推荐规则能根据使用结果迭代。

## 风险与取舍

### 一、不要让 Topic 退化成收藏夹

如果第一期只做“文章加入 Topic”，但没有 wiki page、log 和整理状态，Topic 的价值会接近标签。即使第一期不做完整 AI ingest，也应至少支持手动 wiki page 和活动日志。

### 二、LLM 不能静默覆盖知识库

Topic 是长期知识对象。LLM 修改 wiki 时必须支持 diff 审阅，尤其是 overview、claims 和人工编辑过的页面。

### 三、Review 不应在第一期强行继承 Publication

Review 与周期、模板和占位符耦合较深。长期看 Review 是 Publication 的一种，但第一期应采用组合式关联：Publication 统一发布外壳，ReviewIssue 保留原有领域模型，自由文档使用 FreeDocument 承载领域字段。

### 四、先做 tabs，不做图谱

知识图谱可视化容易消耗大量前端复杂度，但不一定提升第一阶段可用性。更务实的顺序是先做好 Sources、Wiki、Claims、Questions、Outputs、Log、Lint 这些可操作页面。

### 五、引用链是核心质量线

Topic 和自由文档的差异化不在于能生成文字，而在于能回答“这个判断从哪里来”。claims、source refs 和 Publication 引用关系应尽早进入模型，而不是后期补丁。

## 推荐结论

建议将 Lumina 下一阶段定位为：

> 面向长期选题的知识整理与观点输出工作台。

落地上优先做：

1. Topic 作为长期知识容器。
2. Topic wiki 作为 LLM 和人工共同维护的知识层。
3. Publication 作为统一输出层，自由文档作为自由观点输出类型。
4. 引用、claims、日志和 lint 作为质量控制机制。

这条路线能自然连接现有文章采集、AI 解读、回顾、引用插入和 Markdown 导出能力，同时把产品从“信息收集和周期回顾”推进到“知识整理和观点生产”。
