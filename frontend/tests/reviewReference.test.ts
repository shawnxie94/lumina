import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
	buildReviewArticlePlaceholder,
	buildReviewContentReferenceMarkdown,
	detectReviewReferenceCommand,
	formatReviewReferenceInsertion,
	normalizeReviewReferenceSelectionText,
	resolveReviewReferenceSource,
	splitReviewReferenceParagraphs,
} from "../lib/reviewReference";

test("detectReviewReferenceCommand matches a full-line /ref command", () => {
	const markdown = "第一段\n/ref\n尾段";
	const cursor = markdown.indexOf("/ref") + "/ref".length;

	assert.deepEqual(detectReviewReferenceCommand(markdown, cursor), {
		command: "/ref",
		start: markdown.indexOf("/ref"),
		end: markdown.indexOf("/ref") + "/ref".length,
		lineStart: markdown.indexOf("/ref"),
		lineEnd: markdown.indexOf("/ref") + "/ref".length,
	});
});

test("detectReviewReferenceCommand ignores slash text embedded in body text", () => {
	const markdown = "这里有 /ref 但不是独占一行";
	const cursor = markdown.length;

	assert.equal(detectReviewReferenceCommand(markdown, cursor), null);
});

test("resolveReviewReferenceSource prefers translated content before raw markdown", () => {
	assert.equal(
		resolveReviewReferenceSource("这是译文", "This is raw markdown"),
		"这是译文",
	);
	assert.equal(resolveReviewReferenceSource("", "This is raw markdown"), "This is raw markdown");
});

test("splitReviewReferenceParagraphs keeps readable body paragraphs only", () => {
	const paragraphs = splitReviewReferenceParagraphs(`
# 标题

这是一段足够长的正文片段，包含完整的语义信息，适合直接插入到回顾引用中。

![cover](https://example.com/cover.png)

https://example.com/source

- 列表项 A
- 列表项 B

另一段也足够长的正文内容，会作为第二个候选片段保留下来，方便手动挑选。
`);

	assert.deepEqual(paragraphs, [
		"这是一段足够长的正文片段，包含完整的语义信息，适合直接插入到回顾引用中。",
		"列表项 A\n列表项 B",
		"另一段也足够长的正文内容，会作为第二个候选片段保留下来，方便手动挑选。",
	]);
});

test("buildReviewArticlePlaceholder wraps slug as review placeholder", () => {
	assert.equal(buildReviewArticlePlaceholder("openai-news"), "{{openai-news}}");
});

test("buildReviewContentReferenceMarkdown emits quote followed by source line", () => {
	assert.equal(
		buildReviewContentReferenceMarkdown({
			title: "OpenAI News",
			slug: "openai-news",
			excerpt: "这里是你手动选中的正文片段……",
		}),
		"> 这里是你手动选中的正文片段……\n\n—— [OpenAI News](/article/openai-news)",
	);
});

test("normalizeReviewReferenceSelectionText keeps paragraph breaks but collapses noisy whitespace", () => {
	assert.equal(
		normalizeReviewReferenceSelectionText(" 第一段   文字 \n\n\n第二段\t文字 "),
		"第一段 文字\n\n第二段 文字",
	);
});

test("buildReviewContentReferenceMarkdown prefixes every selected line as quote", () => {
	assert.equal(
		buildReviewContentReferenceMarkdown({
			title: "OpenAI News",
			slug: "openai-news",
			excerpt: "第一段\n\n第二段",
		}),
		"> 第一段\n>\n> 第二段\n\n—— [OpenAI News](/article/openai-news)",
	);
});

test("formatReviewReferenceInsertion adds blank lines around inserted blocks when needed", () => {
	assert.equal(
		formatReviewReferenceInsertion("前文", 2, 2, "{{openai-news}}"),
		"\n\n{{openai-news}}",
	);
	assert.equal(
		formatReviewReferenceInsertion("前文\n", 3, 3, "{{openai-news}}"),
		"\n{{openai-news}}",
	);
	assert.equal(
		formatReviewReferenceInsertion("", 0, 0, "{{openai-news}}"),
		"{{openai-news}}",
	);
});

test("review reference insert panel supports article and content reference modes", () => {
	const source = readFileSync(
		join(process.cwd(), "components/ReviewReferenceInsertPanel.tsx"),
		"utf8",
	);

	assert.match(source, /articleApi\.searchArticles/);
	assert.match(source, /插入文章引用/);
	assert.match(source, /插入内容引用/);
	assert.match(source, /selectedArticleIds/);
	assert.match(source, /已选入本期/);
});

test("review reference insert panel renders row actions for article and content references", () => {
	const source = readFileSync(
		join(process.cwd(), "components/ReviewReferenceInsertPanel.tsx"),
		"utf8",
	);

	assert.match(source, /viewMode/);
	assert.match(source, /aria-label=\{t\("插入文章引用"\)\}/);
	assert.match(source, /aria-label=\{t\("插入内容引用"\)\}/);
	assert.match(source, /articleApi\.getArticle/);
});

test("review reference selection preview renders safe markdown and selection toolbar", () => {
	const source = readFileSync(
		join(process.cwd(), "components/ReviewReferenceSelectionPreview.tsx"),
		"utf8",
	);

	assert.match(source, /renderSafeMarkdown/);
	assert.match(source, /selectionchange/);
	assert.match(source, /window\.getSelection/);
	assert.match(source, /插入引用/);
});

test("review reference insert panel switches to full-width preview mode", () => {
	const source = readFileSync(
		join(process.cwd(), "components/ReviewReferenceInsertPanel.tsx"),
		"utf8",
	);

	assert.match(source, /viewMode === "preview"/);
	assert.match(source, /返回列表/);
	assert.doesNotMatch(source, /优先使用译文，为空时回退原文/);
	assert.doesNotMatch(source, /border-b border-border\/70 pb-4/);
	assert.doesNotMatch(source, /lg:grid-cols-\[320px_minmax\(0,1fr\)\]/);
});

test("review reference selection preview focuses on full-width article content selection", () => {
	const source = readFileSync(
		join(process.cwd(), "components/ReviewReferenceSelectionPreview.tsx"),
		"utf8",
	);
	const styles = readFileSync(join(process.cwd(), "styles/globals.css"), "utf8");

	assert.match(source, /max-h-\[72vh\]/);
	assert.match(source, /max-w-none/);
	assert.match(source, /review-reference-preview--text-only/);
	assert.match(source, /IconCheck/);
	assert.match(source, /aria-label=\{t\("插入引用"\)\}/);
	assert.match(source, /selectionchange/);
	assert.match(styles, /\.review-reference-preview--text-only img/);
	assert.match(styles, /\.review-reference-preview--text-only video/);
	assert.match(styles, /\.review-reference-preview--text-only audio/);
	assert.match(styles, /\.review-reference-preview--text-only iframe/);
	assert.match(styles, /\.review-reference-preview--text-only \.media-embed/);
	assert.doesNotMatch(
		source,
		/在正文预览中拖动鼠标选择一段文字，然后点击浮动按钮插入引用/,
	);
});

test("review detail page wires review reference panel into the markdown editor", () => {
	const source = readFileSync(
		join(process.cwd(), "pages/reviews/[slug].tsx"),
		"utf8",
	);

	assert.match(source, /detectReviewReferenceCommand/);
	assert.match(source, /<ReviewReferenceInsertPanel/);
	assert.match(source, /selectedArticleIds=\{review\.selected_article_ids \|\| \[\]\}/);
	assert.doesNotMatch(source, /onClick=\{handleOpenReferenceInsertPanel\}/);
	assert.match(source, /\/ref/);
});
