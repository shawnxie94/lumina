import test from "node:test";
import assert from "node:assert/strict";

import {
	resolveArticleDetailExportMarkdown,
	resolveDetailExportFilename,
	resolveReviewDetailExportMarkdown,
} from "../lib/detailMarkdownExport";

test("resolveArticleDetailExportMarkdown prefers translated body and includes top image", () => {
	assert.equal(
		resolveArticleDetailExportMarkdown({
			title: "Gemini Export",
			topImage: "https://example.com/cover.png",
			contentTrans: "译文正文",
			contentMd: "raw markdown",
		}),
		"# Gemini Export\n\n![](https://example.com/cover.png)\n\n译文正文",
	);
});

test("resolveArticleDetailExportMarkdown falls back to raw markdown and omits empty cover", () => {
	assert.equal(
		resolveArticleDetailExportMarkdown({
			title: "Raw Article",
			topImage: "",
			contentTrans: "",
			contentMd: "raw markdown body",
		}),
		"# Raw Article\n\nraw markdown body",
	);
});

test("resolveReviewDetailExportMarkdown prefers rendered markdown before draft content", () => {
	assert.equal(
		resolveReviewDetailExportMarkdown({
			title: "Weekly Review",
			topImage: "https://example.com/review-cover.png",
			renderedMarkdown: "## 已渲染正文",
			markdownContent: "## 草稿正文",
		}),
		"# Weekly Review\n\n![](https://example.com/review-cover.png)\n\n## 已渲染正文",
	);
});

test("resolveReviewDetailExportMarkdown falls back to markdown_content when rendered body is empty", () => {
	assert.equal(
		resolveReviewDetailExportMarkdown({
			title: "Draft Review",
			topImage: null,
			renderedMarkdown: "",
			markdownContent: "## 草稿正文",
		}),
		"# Draft Review\n\n## 草稿正文",
	);
});

test("resolveDetailExportFilename uses resource kind and slug", () => {
	assert.equal(
		resolveDetailExportFilename("article", "make-the-switch"),
		"article-make-the-switch.md",
	);
	assert.equal(
		resolveDetailExportFilename("review", "shawn-weekly-2026-04-05"),
		"review-shawn-weekly-2026-04-05.md",
	);
	assert.equal(resolveDetailExportFilename("article", ""), "article-export.md");
});
