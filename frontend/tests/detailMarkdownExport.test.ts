import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
	resolveArticleDetailExportMarkdown,
	resolveDetailExportFilename,
	resolveReviewDetailExportMarkdown,
} from "../lib/detailMarkdownExport";

test("resolveArticleDetailExportMarkdown prefers translated body and includes top image", () => {
	assert.equal(
		resolveArticleDetailExportMarkdown({
			origin: "http://localhost:3000",
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
			origin: "http://localhost:3000",
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
			origin: "http://localhost:3000",
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
			origin: "http://localhost:3000",
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

test("resolveArticleDetailExportMarkdown converts relative cover and body image urls to absolute urls", () => {
	assert.equal(
		resolveArticleDetailExportMarkdown({
			origin: "http://localhost:3000",
			title: "Relative Media",
			topImage: "/media/covers/export-cover.png",
			contentTrans: "![插图](/backend/media/body/export-inline.png)",
			contentMd: "",
		}),
		"# Relative Media\n\n![](http://localhost:3000/backend/media/covers/export-cover.png)\n\n![插图](http://localhost:3000/backend/media/body/export-inline.png)",
	);
});

test("resolveReviewDetailExportMarkdown converts relative markdown image urls to absolute urls", () => {
	assert.equal(
		resolveReviewDetailExportMarkdown({
			origin: "http://localhost:3000",
			title: "Review With Relative Media",
			topImage: "/backend/media/reviews/review-cover.png",
			renderedMarkdown: "![回顾插图](/media/reviews/review-inline.png)",
			markdownContent: "",
		}),
		"# Review With Relative Media\n\n![](http://localhost:3000/backend/media/reviews/review-cover.png)\n\n![回顾插图](http://localhost:3000/backend/media/reviews/review-inline.png)",
	);
});

test("article detail page wires markdown export into the content toolbar", () => {
	const source = readFileSync(
		join(process.cwd(), "pages/article/[id].tsx"),
		"utf8",
	);

	assert.match(source, /resolveArticleDetailExportMarkdown/);
	assert.match(source, /resolveDetailExportFilename/);
	assert.match(source, /downloadMarkdownFile/);
	assert.match(source, /origin: siteOrigin/);
	assert.match(source, /<IconArrowDown className="h-4 w-4" \/>/);
	assert.match(source, /title=\{t\("导出 Markdown"\)\}/);
	assert.match(source, /showToast\(t\("导出成功"\)/);
	assert.match(source, /showToast\(t\("导出失败"\), "error"\)/);
});

test("review detail page wires markdown export into the content toolbar", () => {
	const source = readFileSync(
		join(process.cwd(), "pages/reviews/[slug].tsx"),
		"utf8",
	);

	assert.match(source, /resolveReviewDetailExportMarkdown/);
	assert.match(source, /resolveDetailExportFilename/);
	assert.match(source, /downloadMarkdownFile/);
	assert.match(source, /origin: siteOrigin/);
	assert.match(source, /<IconArrowDown className="h-4 w-4" \/>/);
	assert.match(source, /renderedMarkdown: review\.rendered_markdown/);
	assert.match(source, /markdownContent: review\.markdown_content/);
	assert.match(source, /title=\{t\("导出 Markdown"\)\}/);
	assert.match(source, /showToast\(t\("导出成功"\), "success"\)/);
	assert.match(source, /showToast\(t\("导出失败"\), "error"\)/);
});
