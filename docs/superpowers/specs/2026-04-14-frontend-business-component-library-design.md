# Frontend Business Component Library Design

## 背景

Lumina 前端已经具备一层基础 UI 组件和主题变量，但页面层仍然存在明显的“页面内拼装”现象：

- 基础输入、弹层、状态标签等原子组件已经在 [frontend/components/ui](/Users/shawn/Documents/GitHub/lumina/frontend/components/ui) 下沉淀。
- 全局样式中已经存在 `panel-raised`、`panel-subtle`、`filter-chip`、`language-tag`、`skeleton-shimmer` 等语义化 class，见 [globals.css](/Users/shawn/Documents/GitHub/lumina/frontend/styles/globals.css)。
- 但列表页、回顾页、管理页、详情页中仍然重复实现了筛选区、工具条、面板容器、空状态、卡片列表、设置导航等组合结构，典型位置见：
  - [frontend/pages/list.tsx](/Users/shawn/Documents/GitHub/lumina/frontend/pages/list.tsx)
  - [frontend/pages/reviews/index.tsx](/Users/shawn/Documents/GitHub/lumina/frontend/pages/reviews/index.tsx)
  - [frontend/pages/admin.tsx](/Users/shawn/Documents/GitHub/lumina/frontend/pages/admin.tsx)
  - [frontend/pages/article/[id].tsx](/Users/shawn/Documents/GitHub/lumina/frontend/pages/article/[id].tsx)

当前问题不是“完全没有组件”，而是“基础 UI 已有，但可迁移的业务组合层还未系统建立”。这会带来两个后果：

1. Lumina 内部新增页面时，仍需要重复拼装大量布局和样式。
2. 如果未来想把这套前端能力迁移到别的内容管理项目，现有组件命名、依赖和数据结构都偏向项目内实现，不利于直接复用。

本设计面向的目标不是只优化 Lumina 当前目录，而是从 Lumina 中提炼一套可独立发布的 React 内容管理组件库。

## 目标

- 建立一套适合内容管理 / 中后台项目的前端业务组件分层方案。
- 优先沉淀中后台界面层组件，再保留少量高价值的内容业务组件。
- 从一开始按独立包标准约束依赖、命名、主题与 API 设计。
- 给出适合在 Lumina 仓库内先验证、后续再独立发包的落地路线。

## 非目标

- 不在本期直接重写 Lumina 全部前端目录结构。
- 不把所有页面都强行拆成组件。
- 不把评论区、文章详情等深耦合业务逻辑立即迁入独立包。
- 不要求首期就完成多包拆分或 npm 发布流程。

## 现状观察

### 已具备的基础能力

Lumina 已有一层相对稳定的 primitives：

- [frontend/components/Button.tsx](/Users/shawn/Documents/GitHub/lumina/frontend/components/Button.tsx)
- [frontend/components/IconButton.tsx](/Users/shawn/Documents/GitHub/lumina/frontend/components/IconButton.tsx)
- [frontend/components/ui/TextInput.tsx](/Users/shawn/Documents/GitHub/lumina/frontend/components/ui/TextInput.tsx)
- [frontend/components/ui/TextArea.tsx](/Users/shawn/Documents/GitHub/lumina/frontend/components/ui/TextArea.tsx)
- [frontend/components/ui/FormField.tsx](/Users/shawn/Documents/GitHub/lumina/frontend/components/ui/FormField.tsx)
- [frontend/components/ui/ModalShell.tsx](/Users/shawn/Documents/GitHub/lumina/frontend/components/ui/ModalShell.tsx)
- [frontend/components/ui/StatusTag.tsx](/Users/shawn/Documents/GitHub/lumina/frontend/components/ui/StatusTag.tsx)
- [frontend/components/ui/SelectField.tsx](/Users/shawn/Documents/GitHub/lumina/frontend/components/ui/SelectField.tsx)

### 重复最明显的页面模式

当前重复最明显的不是单个按钮或输入框，而是组合结构：

- 列表页筛选区与结果区：
  - [frontend/pages/list.tsx](/Users/shawn/Documents/GitHub/lumina/frontend/pages/list.tsx)
  - [frontend/pages/reviews/index.tsx](/Users/shawn/Documents/GitHub/lumina/frontend/pages/reviews/index.tsx)
- 设置页导航、子区块和操作区：
  - [frontend/pages/admin.tsx](/Users/shawn/Documents/GitHub/lumina/frontend/pages/admin.tsx)
- 详情页的元信息条、标签条、编辑预览分栏：
  - [frontend/components/article/ArticleMetaRow.tsx](/Users/shawn/Documents/GitHub/lumina/frontend/components/article/ArticleMetaRow.tsx)
  - [frontend/components/article/ArticleTagBar.tsx](/Users/shawn/Documents/GitHub/lumina/frontend/components/article/ArticleTagBar.tsx)
  - [frontend/components/article/ArticleSplitEditorModal.tsx](/Users/shawn/Documents/GitHub/lumina/frontend/components/article/ArticleSplitEditorModal.tsx)

### 新增逻辑带来的新信号

在首版 spec 之后，前端又新增了一批值得纳入抽象判断的逻辑，说明复用面已经不只停留在“列表 / 设置 / 卡片”层：

- 管理页新增了任务链时间线、AI 续写反馈弹窗、备份导出轮询与下载状态：
  - [frontend/pages/admin.tsx](/Users/shawn/Documents/GitHub/lumina/frontend/pages/admin.tsx)
  - [frontend/lib/aiContinuation.ts](/Users/shawn/Documents/GitHub/lumina/frontend/lib/aiContinuation.ts)
  - [frontend/lib/backupExport.ts](/Users/shawn/Documents/GitHub/lumina/frontend/lib/backupExport.ts)
  - [frontend/lib/useLatestBackupExportJob.ts](/Users/shawn/Documents/GitHub/lumina/frontend/lib/useLatestBackupExportJob.ts)
- 文章详情新增了 Markdown 导出和固定高度的版本历史主从预览弹窗：
  - [frontend/pages/article/[id].tsx](/Users/shawn/Documents/GitHub/lumina/frontend/pages/article/[id].tsx)
  - [frontend/lib/detailMarkdownExport.ts](/Users/shawn/Documents/GitHub/lumina/frontend/lib/detailMarkdownExport.ts)
- 回顾详情新增了 Markdown 导出、`/ref` 命令触发的引用插入，以及引用内容预览面板：
  - [frontend/pages/reviews/[slug].tsx](/Users/shawn/Documents/GitHub/lumina/frontend/pages/reviews/[slug].tsx)
  - [frontend/components/ReviewReferenceInsertPanel.tsx](/Users/shawn/Documents/GitHub/lumina/frontend/components/ReviewReferenceInsertPanel.tsx)
  - [frontend/lib/reviewReference.ts](/Users/shawn/Documents/GitHub/lumina/frontend/lib/reviewReference.ts)

这组新增逻辑说明两个新结论：

1. 组件库除了视觉组件，还需要承载一批“无界面但可复用”的 headless hooks / utils。
2. 后台工作流型 UI 已经成为独立包的重要组成，而不是只有列表页和设置页值得抽象。

### 当前抽象的主要问题

1. 组件命名偏项目内语义，例如 `ArticleSplitEditorModal`，不利于跨项目复用。
2. 页面中存在大量重复的容器样式组合，说明语义容器尚未真正组件化。
3. 某些组件直接依赖项目上下文或第三方库实现细节，典型如：
   - `useI18n`
   - `next/link`
   - `antd`
4. 内容展示组件常直接吃 Lumina 的实体类型，难以迁移到其它数据模型。

## 方案比较

### 方案 A：只整理样式 token 和基础 UI

优点：

- 风险低
- 改造成本小

缺点：

- 只能减少底层重复，无法明显提升新页面搭建效率
- 别的项目仍需要自己拼列表页、设置页、管理页

### 方案 B：直接抽页面模板

优点：

- Lumina 内部见效快
- 能快速得到“列表页模板”“设置页模板”

缺点：

- 很容易把 Lumina 当前页面结构固化到组件库里
- 模板一旦写死，跨项目适配成本反而更高

### 方案 C：构建分层组件库

分为：

- primitives
- patterns
- domains

优点：

- 兼顾独立包可用性和业务复用效率
- 最适合内容管理 / 中后台项目
- 可以先在 Lumina 内验证，再逐步外放

缺点：

- 需要前期更严格地管理命名、依赖和边界

### 结论

采用 **方案 C：分层组件库**。

## 总体设计

### 一、分层结构

建议组件库采用三层结构：

#### 1. `primitives`

职责：

- 提供无业务语义的基础交互和展示能力

候选组件：

- `Button`
- `IconButton`
- `TextInput`
- `TextArea`
- `Checkbox`
- `Modal`
- `Tag`
- `Field`
- `Tabs`

约束：

- 不出现 `Article`、`Review`、`Comment`、`Admin` 等业务命名
- 不直接依赖 Lumina API、Auth、i18n、Route

#### 2. `patterns`

职责：

- 提供中后台高频的业务组合模式

候选组件：

- `SurfaceCard`
- `EmptyStatePanel`
- `FilterPanel`
- `ActiveFilterChips`
- `PageToolbar`
- `ResourceListLayout`
- `SettingsShell`
- `SplitEditorModal`
- `ActionToolbar`
- `RecordTable`

约束：

- 可以有“后台模式”语义
- 不能出现具体资源类型绑定
- 不直接发请求，不直接持有路由状态

#### 3. `domains`

职责：

- 提供少量跨内容产品仍成立的内容域组件

候选组件：

- `ContentMetaRow`
- `ContentTagList`
- `ContentLanguageTag`
- `ContentCard`
- `ReviewIssueCard`

约束：

- 只保留跨项目也成立的内容语义
- 不能绑定 Lumina 的实体类型和上下文

### 一点五、组件层之外的 supporting modules

三层结构适用于“组件本身”，但从最近新增逻辑看，独立包还应明确保留两类 supporting modules：

#### `hooks`

职责：

- 提供无界面、可复用的状态机和交互流程

候选能力：

- `useAsyncJobPolling`
- `useTaskTimelineViewer`
- `useReferenceInsertion`
- `useContentExport`

约束：

- 不直接依赖项目 API client
- 通过回调或 service adapter 注入异步行为

#### `utils`

职责：

- 提供格式化、命令解析、导出拼接、选择区替换等纯函数能力

候选能力：

- markdown 导出文档拼装
- 引用命令检测与格式化
- 工作流文案 copy resolver
- 状态文本解析

约束：

- 保持无副作用或把副作用限制在极薄适配层
- 不直接读取浏览器全局对象，除非在明确的 adapter 中

### 二、首批抽象优先级

#### P0：应最先沉淀

1. `SurfaceCard`
2. `EmptyStatePanel`
3. `FilterPanel`
4. `ActiveFilterChips`
5. `ResourceListLayout`
6. `SettingsShell`

原因：

- 在现有页面中重复最明显
- 抽出来后能同时服务 Lumina 新页面和其它中后台项目
- 相比内容卡片，这批更不容易被业务模型绑死

#### P1：第二批

1. `SplitEditorModal`
2. `ConfirmActionModal`
3. `ActionToolbar`
4. `AsyncJobStatusPanel`
5. `TaskTimelineViewer`
6. `VersionHistoryBrowser`
7. `ReferenceInsertPanel`
8. `ContentMetaRow`
9. `ContentTagList`

#### P2：暂缓进入独立包核心

1. `ArticleCard`
2. `ReviewCard`
3. `CommentSection`
4. `RecordTable`

原因：

- 当前与 Lumina 数据结构、权限和流程耦合较深
- 容易导致库 API 被项目现状反向绑架

补充说明：

- `RecordTable` 仍然有价值，但最近新增逻辑表明“固定高度工作流弹窗 / 主从预览 / 异步任务状态”比通用表格更早进入复用区。
- `ReferenceInsertPanel` 有较强的内容场景属性，但它体现的是“搜索 -> 预览 -> 插入”工作流模式，可保留在 P1，前提是拆掉直接依赖 `articleApi` 和 `useI18n` 的部分。

### 三、命名策略

采用“能力命名”，避免项目专属命名。

推荐：

- `ResourceListLayout`
- `SettingsShell`
- `ContentMetaRow`
- `ActiveFilterChips`
- `SplitEditorModal`

不推荐：

- `LuminaAdminSection`
- `ArticleListPanel`
- `ReviewTopCard`
- `ArticleSplitEditorModal`

### 四、包结构与导出策略

建议先采用“一个主包 + 少量子入口”，而不是过早拆成多个 npm 包。

建议目录：

```txt
packages/
  cms-ui/
    src/
      primitives/
      patterns/
      domains/
      utils/
      theme/
      hooks/
      types/
      index.ts
      patterns.ts
      domains.ts
```

建议导出：

- `@scope/cms-ui`
- `@scope/cms-ui/patterns`
- `@scope/cms-ui/domains`
- `@scope/cms-ui/hooks`
- `@scope/cms-ui/utils`
- `@scope/cms-ui/theme`

### 五、主题与样式管理

当前 [globals.css](/Users/shawn/Documents/GitHub/lumina/frontend/styles/globals.css) 中的主题变量方向是正确的，但为了独立包可迁移，建议演进为双层 token：

#### 设计 token

- `--color-neutral-0`
- `--color-neutral-900`
- `--space-4`
- `--radius-2`
- `--shadow-1`

#### 语义 token

- `--cms-bg-page`
- `--cms-bg-surface`
- `--cms-text-primary`
- `--cms-text-secondary`
- `--cms-border-default`
- `--cms-accent`
- `--cms-danger`

约束：

- 组件内部只依赖语义 token
- 独立包统一使用 `--cms-*` 前缀，避免污染宿主项目
- `panel-raised`、`panel-subtle`、`filter-chip` 等现有语义 class 可以在迁移阶段作为包内语义样式过渡层

### 六、依赖约束

#### `peerDependencies`

- `react`
- `react-dom`

#### 允许少量运行时依赖

- class 合并工具
- 少量 headless 交互库
- 轻量工具库

#### 禁止进入核心层的依赖

- `next/link`
- `next/router`
- `axios`
- `next-auth`
- Lumina 的 `useI18n`
- Lumina 的 `useAuth`
- Lumina 的 API client

同样的约束也适用于 `hooks` 和 `utils`：

- `hooks` 不能直接写死后端接口实现
- `utils` 不能直接绑定项目实体类型
- 浏览器下载、剪贴板、轮询等副作用应尽量压缩到 adapter 层

对 `antd` 的处理建议：

- 短期内允许留在适配层
- 不要让核心 patterns 和 domains 直接以 `antd` 为前置约束
- 后续逐步向 headless 或可替换适配层过渡

### 七、数据、文案、路由解耦

组件库必须遵守三项解耦原则：

1. 不在组件内发业务请求
2. 不在组件内直接处理项目路由
3. 不在组件内直接依赖项目级文案系统

建议做法：

- 文案通过 props 或 locale object 注入
- 跳转通过 `href`、`onNavigate`、`renderLink` 注入
- 数据通过轻量 view-model props 注入
- 异步行为通过 service adapter 或 action callback 注入

例如：

- `ContentCard` 接收 `title`、`coverUrl`、`metaItems`、`actions`
- `FilterPanel` 接收 `filters`、`values`、`onChange`
- `SettingsShell` 接收 `sections`、`activeKey`、`onSectionChange`
- `TaskTimelineViewer` 接收 `timeline`、`selectedNodeId`、`onSelectNode`
- `useAsyncJobPolling` 接收 `loadJob`、`onCompleted`、`onFailed`

最近新增逻辑对应的拆分建议：

- [frontend/lib/useLatestBackupExportJob.ts](/Users/shawn/Documents/GitHub/lumina/frontend/lib/useLatestBackupExportJob.ts) 说明“异步任务轮询”适合成为通用 hook，而不是页面私有逻辑。
- [frontend/lib/detailMarkdownExport.ts](/Users/shawn/Documents/GitHub/lumina/frontend/lib/detailMarkdownExport.ts) 说明“详情导出”适合拆成 utils + action adapter，而不是只做一个按钮组件。
- [frontend/components/ReviewReferenceInsertPanel.tsx](/Users/shawn/Documents/GitHub/lumina/frontend/components/ReviewReferenceInsertPanel.tsx) 说明“搜索 + 预览 + 插入”型工作流要拆成 pattern 外壳和宿主数据适配层。

## 落地路线图

### 第一阶段：在当前仓库内包化验证

目标：

- 不急着独立仓库
- 先在 Lumina 内建立 `packages/cms-ui`

动作：

1. 创建 `packages/cms-ui`
2. 迁移 P0 组件骨架
3. Lumina 前端改为优先消费包内组件
4. 保留必要 adapter，避免一次性大迁移

退出标准：

- `list.tsx`
- `reviews/index.tsx`
- `admin.tsx`

这三类页面至少各有一处开始使用包内 patterns

### 第二阶段：先替换模式组件，再替换内容组件

目标：

- 优先收敛后台模式层

建议顺序：

1. `SurfaceCard`
2. `EmptyStatePanel`
3. `ActiveFilterChips`
4. `FilterPanel`
5. `ResourceListLayout`
6. `SettingsShell`
7. `AsyncJobStatusPanel`
8. `TaskTimelineViewer`

原因：

- 这些组件的输入输出最稳定
- 不会过早触碰详情页深层业务逻辑
- 最近新增的后台工作流已经证明 `AsyncJobStatusPanel` 和 `TaskTimelineViewer` 有独立抽象价值

### 第三阶段：引入内容域组件

目标：

- 在模式层稳定后，再迁移内容域展示

建议顺序：

1. `ContentMetaRow`
2. `ContentTagList`
3. `SplitEditorModal`
4. `ContentCard`
5. `VersionHistoryBrowser`
6. `ReferenceInsertPanel`
7. `content export utils`

### 第四阶段：评估是否独立仓库 / 私有包发布

仅在以下条件满足时推进：

- Lumina 内已有多个页面稳定使用
- 包 API 两轮以上没有大改
- 宿主项目依赖与框架耦合已基本拆开

## 验证与质量门槛

### 设计验证

每新增一个 pattern，都要回答四个问题：

1. 它是否解决了两个以上页面的重复问题？
2. 它是否不依赖 Lumina 项目上下文也能成立？
3. 它是否能通过 props 接收数据和行为，而非读取全局状态？
4. 它的名字是否换一个内容项目也依然自然？

如果任一问题答案是否定，应回退为项目内组件，而不是进入独立包。

### 实现验证

每迁移一个候选组件，应至少完成：

1. 一处 Lumina 页面替换
2. 一处不同页面或不同资源类型复用
3. 样式与交互未因迁移产生回归

### 测试建议

由于前端目前没有完整的统一测试脚本，建议后续落地时采用：

- 组件级单测，覆盖 API 约束和关键交互
- 页面级手工回归，优先检查：
  - `/list`
  - `/reviews`
  - `/admin`
  - `/article/[id]`
- 视觉回归可后续补充 story 或快照，但不作为首阶段前置条件

## 风险与规避

### 风险 1：抽象过早，API 被当前页面结构绑死

规避：

- 先抽 patterns，不先抽页面模板
- 先做一个组件，两处页面验证后再推广

### 风险 2：把项目上下文偷偷带进包里

规避：

- 禁止直接依赖 `useI18n`、`useAuth`、`router`
- 统一通过 props / adapter 注入
- 对 `articleApi.searchArticles()`、`backupApi.getLatestExportJob()` 这类数据能力，一律先抽成 service interface，再由宿主项目接入实现

### 风险 3：核心层被第三方 UI 框架锁死

规避：

- 对 `antd` 采用适配层过渡
- 核心层保持 headless 倾向

### 风险 4：内容业务组件抽象过快

规避：

- `ArticleCard`、`ReviewCard`、`CommentSection` 暂不进入首批核心包
- 优先抽容器、布局、筛选、设置类模式组件

### 风险 5：把“有状态工作流”误判成普通组件

规避：

- 对任务链、备份轮询、历史版本预览、引用插入等场景，优先拆成 `hook + pattern + adapter`
- 不把搜索请求、轮询请求、下载请求直接糊进组件内部

## 结论

本次前端样式与业务组件抽象的推荐方向是：

1. 采用 **primitives / patterns / domains** 三层结构。
2. 在三层组件之外，明确保留 **hooks / utils / adapters** 这类 supporting modules。
3. 目标定位为 **可独立发布的内容管理组件库**，但先在 Lumina 仓库内包化验证。
4. 首批只做最通用的中后台模式组件，同时开始关注任务链、备份状态、历史预览这类工作流型 pattern。
5. 所有组件与 hooks 从一开始就遵守“去项目上下文、去实体绑定、去路由耦合”的独立包约束。

后续如果进入实现阶段，应先基于本设计再写一份按文件和迁移顺序展开的 implementation plan。
