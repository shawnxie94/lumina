---
id: trd-browser-article-extraction-sample-checklist
type: checklist
status: draft
related:
  - docs/trd/browser-article-extraction-simplification.md
created_at: 2026-07-22
---

# 浏览器采集简化：真实页样本对照清单

在 Chrome 加载 `extension/.output/chrome-mv3`（或 `npm run dev`）后，对下列类型各测 **≥2** 个真实页。

对比维度：正文完整度、噪声、图片、标题、作者、时间、是否可接受入库。  
可在 DevTools 看消息返回的 `extract_debug.strategy_final` / `retries`。

| # | 类型 | URL | 策略(final) | 正文 | 噪声 | 图 | 标题 | 作者 | 时间 | 可入库 | 备注 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 微信公众号 | | | | | | | | | | |
| 2 | 微信公众号 | | | | | | | | | | |
| 3 | 知乎 | | | | | | | | | | |
| 4 | 知乎 | | | | | | | | | | |
| 5 | 掘金/CSDN | | | | | | | | | | |
| 6 | 掘金/CSDN | | | | | | | | | | |
| 7 | 英文博客/Substack/Medium | | | | | | | | | | |
| 8 | 英文博客/Substack/Medium | | | | | | | | | | |
| 9 | 公式/代码重技术文 | | | | | | | | | | |
| 10 | 公式/代码重技术文 | | | | | | | | | | |
| 11 | 长尾资讯站 | | | | | | | | | | |
| 12 | 长尾资讯站 | | | | | | | | | | |

## 通过线（本阶段）

- 公众号与长尾站正文 **不明显劣于** 旧 adapter/Readability 路径（允许 meta 略差）
- 无大面积抽空 / 只剩壳
- soft 降级可接受；真正失败仅限空正文等硬错误

## 自动化补充

```bash
cd extension
npm run verify:extraction
```

覆盖 Defuddle 核心 HTML fixture，不替代上表真实页验收。
