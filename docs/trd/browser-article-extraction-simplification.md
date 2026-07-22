---
id: trd-browser-article-extraction-simplification
type: trd
status: implemented-pending-live-sample-qa
created_at: 2026-07-22
updated_at: 2026-07-22
implemented_at: 2026-07-22
decision_confirmed_at: 2026-07-22
sources:
  - extension/entrypoints/content.ts
  - extension/utils/siteAdapters.ts
  - extension/utils/articleExtractor.ts
  - extension/utils/htmlCleaningRules.ts
  - backend/app/domain/article_extraction_service.py
  - https://github.com/obsidianmd/obsidian-clipper
  - https://github.com/kepano/defuddle
related:
  - docs/trd/article-ai-interpretation-bundle.md
---

# TRD: 浏览器正文抓取链路简化

**副标题：** Defuddle 默认内核 · 去掉中文难站特殊处理 · 短 cascade + soft 质量门

## 实现状态（代码为准）

### Phase 1 — 已落地

- 依赖：`defuddle@0.19.1`；已移除 `@mozilla/readability`
- 默认路径：`选区(P0)` → `flattenShadowDom` → Defuddle → soft fallback（空图/公式/过短）
- `siteAdapters` 已删除（默认路径不再引用）
- 构建：`extension` 下 `npm run build` 已通过

### Phase 2.1 — 插件入库体验补丁（P0/P2/P3）

- **P0** `createArticle` 与 `report-url` 对齐：HTTP 409 `source_url_exists` 打开已有文章，不再失败通知
- **P2** DOM 入库写入 `extraction_metadata`（JSON）：`quality` + `extract_debug` + `is_selection`（仅观测）
- **P3** 去掉 popup 的 `__selection__` 哨兵；改为 `preferSelection: boolean`，右键仍传真实 `selectionText`

### Phase 2.2 — Defuddle first-party Markdown

- `content_md` 使用 Defuddle `createMarkdownContent` / `separateMarkdown`（`defuddle/full`）
- 删除扩展自研全文 `markdownConverter`（turndown + turndown-plugin-gfm）
- 选区与媒体改写后的最终 HTML 再跑一次 Defuddle markdown，保证 MD/HTML 一致
- 依赖：移除直接依赖 `turndown` / `turndown-plugin-gfm` / `marked`（未使用）


### Phase 2.3 — P4 死代码与版本面

- 删除 `extension/utils/siteAdapters.ts`（默认路径早已不引用）
- 插件 / 后端 `defuddle` **精确钉死** `0.19.1`；`scripts/defuddle-version.txt` + `scripts/check_defuddle_version_sync.py`
- 后端 `is_defuddle_local_available` 需 Node + script + `node_modules/defuddle` 齐全
- Docker `npm ci` 后校验 `defuddle` 包存在，避免静默 regex 回退


### Phase 2 — 部分落地

- `extract_debug`：`strategy_final` / `retries` / `parse_time_ms` / `engine_version`
- 黄金 fixture + 脚本：`extension/scripts/verify-extraction-fixtures.mjs`（`npm run verify:extraction`）
- 真实页勾选表：`docs/trd/browser-article-extraction-sample-checklist.md`
- 仍待：**真人浏览器**完成第 7.2 / checklist 对照（无法在 CI 替代）

### Phase 3

- 默认不做；仅证据驱动薄补丁

## 1. 背景和目标

### 1.1 问题

Lumina 浏览器扩展「当前页采集」现状大致为：

```text
站点 adapter（含大量中文站硬编码）
  → @mozilla/readability
  → 启发式 fallback
  → 公式 / 空图等局部护栏
  → content_structured + quality
```

问题不在于「有没有抽到内容」，而在于链路过重、难演进：

| 问题 | 表现 |
|---|---|
| 分叉多 | adapter / Readability / fallback 三套行为，难对比、难回归 |
| 双轨维护 | 中文 adapter 与通用路径升级不同步；换内核要改两套 |
| 通用核落后 | 默认仍是 Readability，未吸收 Defuddle 的通用正文进步 |
| 边界模糊 | 「难站特殊处理」与默认路径缠在一起，简化成本高 |

### 1.2 外部对照（决策输入，非照搬）

对照 [Obsidian Web Clipper](https://github.com/obsidianmd/obsidian-clipper) 与 [Defuddle](https://github.com/kepano/defuddle)：

| 点 | 事实 |
|---|---|
| Clipper 插件层正文 | 默认几乎只走 **Defuddle**（+ 选区 / 模板产品层） |
| 站点分流位置 | 在 **Defuddle 内部 extractor**，不在 Clipper 业务层维护长 adapter 表 |
| 微信专用代码 | Defuddle / Clipper 源码中 **无** `mp.weixin` / `#js_content` 等硬编码 |
| 公众号体感 | 在已打开的公众号 **live DOM** 上，Defuddle 通用路径对**正文完整度**往往已经很好 |
| 中文内容站专用器 | 基本没有（Bilibili 等除外）；微信 / 知乎 / 掘金等不在内置表 |

结论：应 **借 Defuddle 引擎与 npm 升级**，不借 Clipper 产品壳；也 **不必** 为了「中文」先验地保留整张 adapter 表。

### 1.3 已确认决策

> **先去掉中文难站特殊处理，让整个抓取链路更简单。**  
> 默认统一走通用链路；仅在后续样本证明系统性失败时，才允许「薄补丁」，禁止恢复大而全中文 adapter 主路径。

### 1.4 技术目标

1. 默认正文内核：`@mozilla/readability` → **`defuddle`**（npm 依赖，不 vendoring 源码）。
2. **移除** `siteAdapters` 作为默认正文主路径（含微信 / 知乎 / 掘金 / CSDN 等硬编码）。
3. 建立更短流水线：

   ```text
   预处理 → 选区 / Defuddle / fallback → 通用元数据 → 标准化 → soft 质量门 → Lumina 契约
   ```

4. 保持入库与前端字段兼容：`title`、`content_html`、`author`、`published_at`、`top_image`、`content_structured`、`quality` 等。
5. 增加可观测性（可选但推荐）：`extract_debug.strategy` / `retries` / `quality.warnings`。

### 1.5 非目标（原始草案）

- ~~不改造后端 URL 粘贴入库主链路~~ **已追加**：local HTML 正文引擎对齐 Defuddle（Node `defuddle/node`），Jina 策略保留。
- 不引入 Clipper 的模板引擎、Highlighter、Interpreter、Reader Mode。
- 不把 LLM 作为默认全文抽取引擎。
- 不追求「所有中文站元数据 100% 对齐旧 adapter」。
- 不做 popup / 采集入口 UI 大改。
- 不删除后端已有 HTML metadata fallback（与插件简化正交）。

## 2. 决策摘要

| 议题 | 决策 |
|---|---|
| 默认正文引擎 | **Defuddle**（npm，`^` 锁定小版本；升级跑黄金样本） |
| 中文难站 adapter | **去掉默认主路径**（本 TRD 主决策） |
| 业务层路由 | **短 cascade 仅 3 档**：选区 → Defuddle → fallback；**无**站点表 |
| 选区采集 | **保留**，优先级最高 |
| 质量门 | **soft**：重试 / 降级 / warning；**不因分数直接失败** |
| 输出 | 继续映射 `ExtractedArticle`；可选 `extract_debug` |
| 后端 URL 抓取 | **本期不动** |
| 后续补丁 | 仅证据驱动的「薄补丁」；禁止恢复大表 adapter 主路径 |
| 源码策略 | **依赖 defuddle 包**，禁止长期拷贝 Clipper/Defuddle 源码 |

## 3. 当前系统上下文

### 3.1 插件现状（简化前）

| 模块 | 职责 |
|---|---|
| `extension/entrypoints/content.ts` | `extractArticle`：adapter / Readability / fallback、公式护栏、structured、quality |
| `extension/utils/siteAdapters.ts` | 约 19 个站点 adapter（微信、知乎、掘金、CSDN、少数派…） |
| `extension/utils/articleExtractor.ts` | 较薄的 Readability + turndown（若仍引用需一并收敛） |
| popup / background | 触发采集、提交后端 |

关键现状顺序：

1. `getSiteAdapter(url)` 命中 → `extractWithAdapter`（CSS selector 正文 + 站点 meta）。
2. 未命中 → `Readability.parse()`。
3. 空图 / 公式信号异常 → 可能改用 `extractFallbackContent()`。
4. 产出 `content_structured`（`lumina.dom.v1`）与 `quality`。

### 3.2 与 Clipper 的差异（避免误解）

| | Obsidian Clipper | 本 TRD 目标 |
|---|---|---|
| 默认引擎 | Defuddle | Defuddle |
| 业务层站点 adapter 表 | 无 | **去掉**（与 Clipper 对齐简化方向） |
| 质量门 | 基本无产品级 soft 门 | **保留 soft**（文章库需要可观测与自愈） |
| 输出 | 笔记模板变量 / Markdown | Lumina 文章契约 + structured |
| 后端辅链路 | 无 | 仍存在，但本期不改 |

## 4. 目标架构

### 4.1 简化后流水线（插件当前页）

```text
触发采集（popup / 快捷操作 / 选区）
  │
  ├─ 0. 上下文
  │     url、forceRefresh、hasSelection
  │
  ├─ 1. DOM 预处理（薄、通用）
  │     · 懒加载图属性回填（通用属性列表，非站点表）
  │     · Shadow DOM flatten（超时保护，如 3s）
  │
  ├─ 2. 正文策略（短 cascade，无中文 adapter）
  │     P0 有效选区 → selection HTML
  │     P1 Defuddle(document, { url })
  │     P2 启发式 fallback（article / main / … → body 粗清理）
  │
  ├─ 3. 元数据（与正文解耦，仅通用源）
  │     Defuddle 字段 / JSON-LD / OG / meta / time / document.title
  │
  ├─ 4. 标准化
  │     相对 URL 绝对化、媒体整理
  │     content_html + content_structured（复用既有 block 遍历）
  │
  ├─ 5. Soft 质量门
  │     过短 / 空图 / 公式丢失 → 换策略或放宽重试
  │     耗尽 → best effort + warnings（仍返回）
  │
  └─ 6. 输出契约 → ExtractedArticle（+ 可选 extract_debug）
```

### 4.2 明确删除 / 降级（本阶段）

| 能力 | 处理 |
|---|---|
| `siteAdapters.ts` 默认主路径 | **移出默认链路** |
| 微信 `#js_content` 等 selector 覆盖 | **不做** |
| 知乎多 path selector | **不做** |
| 站点级 author/time（`#js_author_name`、`var ct` 等） | **不做**；改走通用 meta / JSON-LD / Defuddle |
| 站点 preProcess（如 X 引用转 blockquote） | **不做**；若 Defuddle 内置 X extractor 覆盖则跟随库版本 |

实现约定：

- 默认 **先停用引用、保留文件一版**（便于对照与紧急回滚），样本通过后再删文件。
- 以「默认抽取不再进入 adapter 分支」为完成标准，而不是以「文件是否物理删除」为标准。

### 4.3 明确保留

| 能力 | 原因 |
|---|---|
| 选区采集 | 用户意图最高优先 |
| 通用懒图预处理 | 跨站收益，不是中文表 |
| Shadow flatten | 现代站通用 |
| 公式信号对比（soft） | 防数学页误伤；只触发重试 |
| `content_structured` | 下游 / AI / 渲染契约 |
| `quality` | 可观测与 soft 重试 |
| 同 URL 缓存 + `forceRefresh` | 现有 UX |

### 4.4 各步职责（给实现者）

| 步骤 | 输入 | 输出 | 失败策略 |
|---|---|---|---|
| 预处理 | live `document` | 更适合抽取的 DOM | flatten 超时则继续 |
| 选区 | Selection | `content_html` | 无有效选区则跳过 |
| Defuddle | Document + url | 正文 HTML + 引擎侧 meta | 抛错 / 空 → 走 fallback |
| Fallback | Document | 粗正文 HTML | 仍空 → 空 HTML + 低 quality |
| 元数据 | Document + 引擎结果 | title/author/time/image… | 字段可空；时间兼容策略见下 |
| 标准化 | 原始 HTML | 绝对 URL + structured | 块为空不阻断 |
| 质量门 | 候选结果 | 最终结果 + warnings | **不**因分数拒绝返回 |
| 契约映射 | 内部结果 | `ExtractedArticle` | 与现网字段兼容 |

## 5. 模块设计

### 5.1 依赖

- 运行时新增：`defuddle`（建议锁定 `^0.19.x` 或实现时的当前稳定版）。
- **禁止**将 Clipper / Defuddle 源码长期 vendoring 进仓；通过 npm 获取通用能力与内置 extractor 更新。
- 浏览器主路径使用 `defuddle` core；若需 Markdown 可用 `defuddle/full`，但 **入库主字段以 `content_html` + `content_structured` 为准**，避免双源真相。
- 移除默认路径后，若 `@mozilla/readability` 无其它引用，应从 `package.json` / lockfile 删除。

### 5.2 抽取入口

概念上保持单一入口：

```ts
extractArticle(options?: { forceRefresh?: boolean }): Promise<ExtractedArticle>
```

必须删除的主路径分支：

```ts
// REMOVE from default path
const adapter = getSiteAdapter(baseUrl)
if (adapter) extractWithAdapter(adapter)
```

### 5.3 Defuddle 适配层

建议新增薄封装（文件名实现期可调，例如 `extension/utils/defuddleExtract.ts`）：

```ts
type EngineExtractResult = {
  contentHtml: string
  title?: string
  author?: string
  published?: string
  image?: string
  description?: string
  wordCount?: number
  schemaOrgData?: unknown
  parseTime?: number
  engine: 'defuddle' | 'selection' | 'fallback'
}
```

调用约定：

- 默认 `new Defuddle(doc, { url }).parse()`。
- 仅在确有异步需求时用 `parseAsync()`，且必须 **超时回退** 同步 `parse()`（可参考 Clipper 的 8s 量级，实现期自定合理上限）。
- 不在适配层做站点 if/else。

### 5.4 元数据合并（仅通用源）

| 字段 | 优先级（高 → 低） |
|---|---|
| title | Defuddle.title → og:title → JSON-LD headline → document.title |
| author | Defuddle.author → JSON-LD author → meta author / article:author → 轻量 byline 启发式 |
| published_at | Defuddle.published → article:published_time → time[datetime] → JSON-LD datePublished → 现有 `parseDate`；**空值是否 fallback 到「当天」保持与现网兼容**（实现注释标明） |
| top_image | Defuddle.image → og:image / twitter:image → 正文首图 |
| excerpt | Defuddle.description → og:description → meta description |

**禁止**作为本阶段主路径：`#js_author_name`、`#publish_time`、`var ct`、知乎 `.AuthorInfo-name` 等站点专用读取。

### 5.5 Soft 质量门

#### 信号

| 信号 | 用途 |
|---|---|
| 文本长度 / wordCount | 过短 |
| img 数 vs 占位图比例 | 空图 |
| 源页公式信号 vs 结果公式信号 | 公式丢失 |
| script/style 残留 | 噪声 warning |

#### 行为（必须 soft）

```text
IF 过短 AND 当前为 defuddle
  → 尝试 fallback（或 Defuddle 少删选项，若 API 可用）
IF 公式丢失 AND fallback 公式更多 AND 文本不太短
  → 采用 fallback
IF 无图 AND fallback 有图
  → 采用 fallback 内容
IF 策略耗尽
  → 返回当前最佳结果
  → quality.score 下调 + warnings[]
  → 不抛「质量不合格」类业务失败
```

**真正失败**仅限：

- 无法访问 `document`
- 超时且无任何可用 HTML
- 扩展上下文失效等运行时错误

> 质量门是验收与自愈，不是严卡拦截。宁可变差带 warning，不要因分数导致「抓取失败」。

### 5.6 输出契约

与现有 `ExtractedArticle` 兼容；推荐增量可选字段：

```ts
type ExtractDebug = {
  strategy_final: 'selection' | 'defuddle' | 'fallback'
  retries: Array<{ strategy: string; reason: string }>
  engine_version?: string
  parse_time_ms?: number
}

// ExtractedArticle 可选：
extract_debug?: ExtractDebug
```

入库提交字段保持现网兼容；`extract_debug` 可不传后端，或仅 debug 模式附带（实现期定，默认不强制后端改 schema）。

### 5.7 涉及文件（预期）

| 路径 | 变更 |
|---|---|
| `extension/package.json` / lockfile | 加 `defuddle`；视情况移除 `@mozilla/readability` |
| `extension/entrypoints/content.ts` | 重写 `extractArticle` 主路径；删除 adapter 分支 |
| `extension/utils/siteAdapters.ts` | 停止引用；先废弃后删（默认） |
| `extension/utils/articleExtractor.ts` | 收敛到新封装或删除重复实现 |
| 新建 `extension/utils/defuddleExtract.ts`（名可调） | Defuddle 调用与结果映射 |
| 新建/扩展 shadow flatten 工具 | 参考 Clipper 的最小实现 |
| 验收 | 样本对照表（见第 7 节）；有测试基建则补 fixture |

## 6. 分阶段落地

### Phase 1 — 主交付（本 TRD 必做）

1. 接入 `defuddle`。
2. `extractArticle` 改为：选区 → Defuddle → fallback。
3. 停用 `getSiteAdapter` / `extractWithAdapter` 默认调用。
4. 保留 soft 质量门与 `content_structured`。
5. 按第 7 节样本清单做前后对照并记录。
6. 扩展可构建、可加载验证。

### Phase 2 — 可观测与回归（可同 PR 或紧随）

1. ✅ 填充 `extract_debug`（含 `engine_version`）。
2. ✅ 固定 HTML fixture：`extension/scripts/fixtures/extraction/` + `npm run verify:extraction`。
3. ✅ 升级步骤：见本文「Defuddle 升级 Runbook」。
4. ⏳ 真实页 checklist：`docs/trd/browser-article-extraction-sample-checklist.md`（人工）。

### Phase 3 — 证据驱动薄补丁（明确不在默认范围）

仅当 Phase 1/2 样本显示 **系统性** 问题（如某高频站正文稳定残缺、图稳定全丢）时，才允许：

- **单字段** meta 补丁，或  
- **单站** content selector 覆盖（例外列表，数量受控），

并满足：

- 有失败样本与复现步骤；
- 不恢复「大而全中文 adapter 表」为主路径；
- 补丁优先挂在「通用失败后的可选 override」，且可关闭。

## 7. 验收标准

### 7.1 功能

- [ ] 默认采集路径 **不再** 调用 `siteAdapters` / `extractWithAdapter`。
- [ ] 无选区时主引擎为 Defuddle；有有效选区时选区优先。
- [ ] 仍输出可用的 `content_html`、`title`、`source_url`、`content_structured`、`quality`。
- [ ] 质量门 soft：过短 / 公式 / 空图会重试或降级，**不因分数直接采集失败**。
- [ ] 提交入库字段与现网兼容（无强制后端 schema 变更）。

### 7.2 效果样本（最低集）

对下列类型 **至少各 2 个真实页** 做前后对照（旧 adapter/Readability vs 新 Defuddle 链路）：

1. 微信公众号  
2. 知乎（专栏或回答）  
3. 技术中文站（掘金或 CSDN）  
4. 英文博客 / Substack 或 Medium  
5. 含公式或大量代码的技术文  
6. 普通资讯 / 长尾站  

记录维度：

- 正文完整度  
- 噪声（导航 / 推荐 / 评论）  
- 图片  
- 标题 / 作者 / 时间  
- 是否可接受入库  

**本阶段通过线：**

- 公众号与长尾站正文完整度 **不明显劣于** 旧路径（允许 meta 略差）。
- 无大面积「抽空 / 只剩壳」。
- 代码主路径可被审阅读懂：**单 cascade，无中文站表分支**。

### 7.3 工程

- [ ] `extension` 可构建（`npm run build` 或项目既有命令）。
- [ ] 死依赖清理（Readability 若无引用则移除）。
- [ ] TRD 与代码行为一致；偏离时先改 TRD 或在 PR 注明。

## 8. 风险与缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| 微信作者 / 时间不如旧 adapter | 元数据变差 | 本阶段 soft 接受；样本记录；Phase 3 仅允许 meta 薄补丁 |
| 知乎回答混入推荐 | 噪声 | quality warning；用户选区兜底 |
| Defuddle 包体变大 | 扩展体积 | 优先 core bundle；构建后检查 |
| 个别站去掉 Readability 后回退 | 正文变差 | fallback + 样本；可选 `legacy` flag 短时回滚 |
| 许可证 | 合规 | 仅用 npm 正式包，遵循上游许可 |
| 与后端 Jina 同 URL 结果不一致 | 观感差 | 文档标明「当前页插件 vs URL 入库」差异；后端另案 |

## 9. 回滚策略

1. **代码回滚**：revert 恢复 `content.ts` adapter + Readability 路径。  
2. **可选 feature flag**（不强制，低成本则可加）：

   ```text
   extraction_engine = defuddle | legacy
   默认 defuddle
   ```

3. `siteAdapters.ts` 在「先停用后删」窗口内可用于对照，降低回滚时重写成本。

## 10. 实现备注

- 大文件 `content.ts` 只做任务范围内收敛，避免无关重构。
- 不要把后端 Jina / `article_extraction_service` 改动塞进本交付。
- 「去掉中文难站」是 **已确认的产品/架构选择**：优先简单与可演进；用样本而不是体感决定 Phase 3。
- 用户可见文案保持现有 i18n；本文件为工程 TRD。

## 11. 开放问题（实现期关闭）

| # | 问题 | 默认建议 |
|---|---|---|
| 1 | `siteAdapters.ts` 立即删还是先停用？ | **先停用引用，样本通过后再删** |
| 2 | 是否保留 Twitter/X 站点 preProcess？ | **不保留**；跟 Defuddle 内置能力 |
| 3 | `published_at` 空是否继续「当天」？ | **保持现网兼容**，注释标明 |
| 4 | 是否做 `extraction_engine` flag？ | 同 PR 低成本则加，否则靠 git 回滚 |


## 12. Defuddle 升级 Runbook

目标：通过 npm 获取上游通用能力，而不是拷贝源码。

### 步骤

1. 查看 [kepano/defuddle releases](https://github.com/kepano/defuddle/releases) changelog（破坏性变更、extractor 增减、输出形态变化）。
2. 在 `extension/` 升级依赖：

```bash
cd extension
npm install defuddle@<version>
```

3. 同步版本常量：`extension/utils/defuddleExtract.ts` 中 `DEFUDDLE_ENGINE_VERSION` 与 `package.json` 对齐。
4. 跑自动化：

```bash
npm run verify:extraction
npm run build
```

5. 若 fixture 出现 **hard fail**：先判断是回归还是断言过严；必要时更新 soft 断言并记入 TRD/changelog。
6. 抽 2–4 个真实页（至少含 1 个微信 + 1 个技术文）做冒烟，填 `browser-article-extraction-sample-checklist.md`。
7. 合并前确认：默认路径仍无站点 adapter 表；无 vendoring 上游源码。

### 回滚

```bash
cd extension
npm install defuddle@0.19.1   # 或上一个已知良好版本
# 同步 DEFUDDLE_ENGINE_VERSION
npm run verify:extraction && npm run build
```

紧急时可整体 revert 提取相关 commit；`siteAdapters.ts` 在删除前仍可用于对照。


---

## 一句话范围

> **插件当前页采集：Defuddle 默认 + 短 cascade（选区 / Defuddle / fallback）+ soft 质量门 + Lumina 契约；去掉中文难站 adapter 主路径；不拷贝 Clipper 源码；后端 URL 抓取与 Clipper 产品壳不在范围。**
