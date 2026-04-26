import assert from "node:assert/strict";
import test from "node:test";

import { stripMarkdownStyles } from "@/lib/markdownText";

test("stripMarkdownStyles keeps link text and removes markdown urls", () => {
	assert.equal(
		stripMarkdownStyles(
			"本周推荐 [OpenAI 新闻](https://example.com/news?from=card)，更多见 https://example.com/raw。",
		),
		"本周推荐 OpenAI 新闻，更多见",
	);
});

test("stripMarkdownStyles removes common markdown decorations for card summaries", () => {
	assert.equal(
		stripMarkdownStyles(`
## 回顾摘要

> **重点**：发布了 \`模型\` 更新

- 支持 ~~旧入口~~ 新入口
- 图片 ![封面](https://example.com/cover.png)
`),
		"回顾摘要 重点：发布了 模型 更新 支持 旧入口 新入口 图片 封面",
	);
});
