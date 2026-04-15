# Detail Markdown Export Design

## 背景

当前 Lumina 已支持多种“导出”能力，但它们都不直接覆盖这次需求：

- 文章列表页已有管理员批量导出文章的能力，走的是后端 `/api/export` 接口，主要面向批处理。
- 管理后台已有配置、备份等导出能力，属于后台运维用途。
- 文章详情页和回顾详情页目前都没有“将当前页面导出为 Markdown 文档”的直接入口。

本次目标非常聚焦：

- 在文章详情页新增导出功能
- 在回顾详情页新增导出功能
- 导出内容为“标题 + 头图 + 正文”
- 导出结果为 `.md` 文档
- 导出正文按当前页面展示逻辑取值，而不是固定导出底层原始字段
- 所有用户都可以导出当前自己能看到的内容

用户已明确确认两条关键约束：

1. 正文按“页面展示版”导出
2. 所有人可见可导出，只导出当前页本来就能看到的内容

## 目标

- 在文章详情页的内容操作区新增“导出 Markdown”按钮。
- 在回顾详情页的内容操作区新增“导出 Markdown”按钮。
- 点击后直接下载一个 `.md` 文件，无需跳转页面或打开新弹窗。
- 导出的 Markdown 至少包含：
  - 一级标题
  - 头图（如果存在）
  - 页面展示版正文
- 文章和回顾导出体验保持一致，包括按钮风格、成功失败反馈和文件命名规则。

## 非目标

- 不新增服务端公开导出接口。
- 不复用当前管理员批量导出接口来做详情页导出。
- 不导出评论、标签、作者、时间、AI 解读、划线批注或其它辅助信息。
- 不导出页面当前渲染后的 HTML。
- 不新增“复制到剪贴板”“导出 zip”“导出 HTML/PDF”等变体。

## 方案比较

### 方案 A：前端本地导出，详情页直接组装 Markdown

由前端直接从当前详情页已有数据中组装 Markdown 字符串，创建 `Blob` 后触发浏览器下载。

优点：

- 与“导出当前用户眼前所见内容”的语义完全一致
- 不需要新增后端接口和权限逻辑
- 改动范围集中在前端详情页和共享 helper
- 更容易保证文章与回顾的交互一致

缺点：

- 导出格式规则需要在前端维护

### 方案 B：新增后端详情导出接口

文章详情和回顾详情各新增一个公开导出接口，前端点击按钮后再请求服务端返回 Markdown。

优点：

- 导出格式统一由后端控制

缺点：

- 需要新增接口、schema 和权限边界
- 与“当前页面展示版内容”之间会出现映射和重复拼装
- 对本次小范围需求来说实现过重

### 方案 C：沿用现有 `/api/export`，继续扩展后端接口

尝试把现有文章批量导出接口扩展成详情页可复用能力。

优点：

- 可以复用一部分导出相关代码

缺点：

- 现有接口是管理员批量导出语义，与公开详情页导出不匹配
- 回顾详情并不适合挂在当前文章批量导出接口之下
- 会让接口职责进一步混杂

## 结论

采用 **方案 A：前端本地导出，详情页直接组装 Markdown**。

原因：

- 最符合“导出当前页面可见内容”的产品语义
- 不额外引入公开后端接口
- 变更范围清晰、实现成本低、后续维护简单
- 可以把文章和回顾的导出规则收敛进同一个前端 helper，保证一致性

## 详细设计

### 一、正文来源规则

正文统一按“页面展示版”规则导出。

文章详情：

1. 优先使用 `content_trans`
2. 为空时回退到 `content_md`

回顾详情：

1. 优先使用 `rendered_markdown`
2. 为空时回退到 `markdown_content`

这样导出的正文与当前详情页主要展示内容保持一致。

### 二、导出 Markdown 格式

导出文本统一按如下结构组装：

```md
# 标题

![](头图 URL)

正文内容
```

具体规则：

- 第一行始终是 `# 标题`
- 标题与后续内容之间保留一个空行
- 如果头图存在，则输出 `![](url)`，并在头图和正文之间保留一个空行
- 如果头图不存在，则整段头图块省略
- 正文原样拼接，不额外改写内部 Markdown 结构
- 最终输出会做首尾 `trim`，避免多余空白

### 三、文件命名规则

建议文件名按资源类型和 slug 生成：

- 文章详情：`article-{slug}.md`
- 回顾详情：`review-{slug}.md`

回退规则：

- 如果 slug 不可用，则降级为 `article-export.md` 或 `review-export.md`

文件名会在导出 helper 中统一做基础清洗，避免空格或非法字符带来下载问题。

### 四、前端 helper 设计

新增一个共享工具模块：

- [frontend/lib/detailMarkdownExport.ts](/Users/shawn/Documents/GitHub/lumina/frontend/lib/detailMarkdownExport.ts)

该模块负责三类职责：

1. 根据输入数据构建 Markdown 文本
2. 根据资源类型和 slug 生成文件名
3. 触发浏览器下载

建议暴露的能力包括：

- `resolveArticleDetailExportMarkdown(...)`
- `resolveReviewDetailExportMarkdown(...)`
- `downloadMarkdownFile(...)`

设计原则：

- 文本拼装与下载触发分离，方便测试
- 文章与回顾各自有清晰的输入函数，避免调用处充满条件分支

### 五、文章详情页接入

在 [frontend/pages/article/[id].tsx](/Users/shawn/Documents/GitHub/lumina/frontend/pages/article/[id].tsx) 的“内容”标题栏右侧操作区新增一个 `IconButton`：

- 图标沿用 `IconDoc`
- 标题文案使用 `t("导出 Markdown")`
- 所有用户可见

点击后流程：

1. 从当前 `article` 数据生成 Markdown
2. 生成文件名
3. 触发下载
4. 成功时 toast `导出成功`
5. 失败时 toast `导出失败`

这次导出按钮不依赖管理员态，因此不应放进 `isAdmin` 条件里。

### 六、回顾详情页接入

在 [frontend/pages/reviews/[slug].tsx](/Users/shawn/Documents/GitHub/lumina/frontend/pages/reviews/[slug].tsx) 的“内容”标题栏右侧操作区新增一个 `IconButton`：

- 图标沿用 `IconDoc`
- 标题文案使用 `t("导出 Markdown")`
- 所有用户可见

点击后流程与文章保持一致：

1. 从当前 `review` 数据生成 Markdown
2. 生成文件名
3. 触发下载
4. 成功时 toast `导出成功`
5. 失败时 toast `导出失败`

特别注意：

- 回顾正文应优先取 `rendered_markdown`，以反映公开详情页实际展示结果
- 如果没有渲染版内容，再回退到 `markdown_content`

### 七、文案与国际化

需要在 [frontend/lib/i18n.ts](/Users/shawn/Documents/GitHub/lumina/frontend/lib/i18n.ts) 中补充或复用以下文案：

- `导出 Markdown`
- `导出成功`
- `导出失败`

若现有 `导出成功` / `导出失败` 已存在，则直接复用，只新增按钮标题文案即可。

### 八、错误处理

导出过程中需要兜底以下问题：

- 标题为空：允许导出，但文件标题可退化为空字符串或默认标题
- 正文为空：仍允许导出，至少导出标题和可选头图
- 头图为空：直接省略头图块
- 浏览器下载触发失败：catch 后 toast `导出失败`

本次不额外为“空正文”弹出阻断提示，因为用户仍可能需要一个仅含标题和头图的 Markdown 草稿。

## 测试设计

### 一、纯函数测试

新增针对共享 helper 的测试文件，重点锁定：

- 文章正文选择规则为 `content_trans -> content_md`
- 回顾正文选择规则为 `rendered_markdown -> markdown_content`
- 有头图时输出 `![](url)`
- 无头图时省略图片块
- 标题、头图、正文之间的空行格式正确
- 文件名按 slug 和类型生成

### 二、页面接线测试

继续采用当前前端已有的源码断言方式，验证：

- 文章详情页接入了导出 helper
- 文章详情页包含 `title={t("导出 Markdown")}` 或等价导出按钮线索
- 回顾详情页接入了导出 helper
- 回顾详情页包含 `title={t("导出 Markdown")}` 或等价导出按钮线索

### 三、验证命令

实现完成后至少运行：

- `cd frontend && node --test --import tsx tests/detailMarkdownExport.test.ts`
- `cd frontend && npm run lint`

如果页面接线测试并入已有测试文件，还应补跑对应测试。

## 影响范围

预计仅涉及前端：

- [frontend/lib/detailMarkdownExport.ts](/Users/shawn/Documents/GitHub/lumina/frontend/lib/detailMarkdownExport.ts)
- [frontend/lib/i18n.ts](/Users/shawn/Documents/GitHub/lumina/frontend/lib/i18n.ts)
- [frontend/pages/article/[id].tsx](/Users/shawn/Documents/GitHub/lumina/frontend/pages/article/[id].tsx)
- [frontend/pages/reviews/[slug].tsx](/Users/shawn/Documents/GitHub/lumina/frontend/pages/reviews/[slug].tsx)
- 新增测试文件

本次不涉及后端 schema、router 或数据库变更。
