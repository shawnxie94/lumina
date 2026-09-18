import assert from "node:assert/strict";
import test from "node:test";

import {
	buildMarkdownFromMediaLink,
	cleanupPastedUrl,
	detectMediaKindFromUrl,
	extractMarkdownImageUrls,
	extractMediaLinkFromText,
	replaceMarkdownImageUrl,
} from "@/lib/articleMedia";
import {
	DEFAULT_NOTE_RECOMMENDATION_LEVEL,
	NOTE_RECOMMENDATION_LEVEL_OPTIONS,
	createAnnotationId,
	normalizeNoteRecommendationLevel,
	renderMarkdown,
} from "@/lib/articleAnnotations";
import {
	buildDefaultOutlineExpandedPaths,
	collectOutlineExpandablePaths,
	countOutlineDescendants,
	normalizeMindMapNode,
	parseMindMapOutline,
} from "@/lib/mindMap";
import {
	canManuallyGenerateAIContent,
	createEmptyAiAnalysis,
	decodeQueryValue,
	getPreferredNeighborTitle,
	getQueryValue,
	hasPendingArticleJob,
	sortAiTabsByContent,
	splitArticleAuthors,
	toDateInputValue,
	type AITabConfig,
} from "@/lib/aiTaskStatus";
import type { ArticleDetail } from "@/lib/api";

const identity = (key: string) => key;

const makeArticle = (
	overrides: Partial<ArticleDetail> = {},
): ArticleDetail =>
	({
		status: "completed",
		translation_status: null,
		ai_analysis: null,
		...overrides,
	} as unknown as ArticleDetail);

test("cleanupPastedUrl strips angle brackets, whitespace and trailing punctuation", () => {
	assert.equal(cleanupPastedUrl("  https://example.com/a.png  "), "https://example.com/a.png");
	assert.equal(cleanupPastedUrl("<https://example.com/a>"), "https://example.com/a");
	assert.equal(cleanupPastedUrl("https://example.com/a."), "https://example.com/a");
	assert.equal(cleanupPastedUrl(""), "");
});

test("detectMediaKindFromUrl classifies links and rejects non-http input", () => {
	assert.equal(detectMediaKindFromUrl("https://cdn.example.com/pic.JPG?w=10"), "image");
	assert.equal(detectMediaKindFromUrl("https://youtu.be/abc"), "video");
	assert.equal(detectMediaKindFromUrl("https://cdn.example.com/song.mp3"), "audio");
	assert.equal(detectMediaKindFromUrl("https://cdn.example.com/book.pdf"), "book");
	assert.equal(detectMediaKindFromUrl("ftp://cdn.example.com/pic.png"), null);
	assert.equal(detectMediaKindFromUrl("https://cdn.example.com/page"), null);
});

test("buildMarkdownFromMediaLink renders per kind with translated label", () => {
	assert.equal(
		buildMarkdownFromMediaLink({ kind: "image", url: "https://a.com/x.png" }, identity),
		"![](https://a.com/x.png)",
	);
	assert.equal(
		buildMarkdownFromMediaLink({ kind: "video", url: "https://a.com/v" }, identity),
		"[▶ 视频](https://a.com/v)",
	);
	assert.equal(
		buildMarkdownFromMediaLink({ kind: "audio", url: "https://a.com/a" }, identity),
		"[🎧 音频](https://a.com/a)",
	);
	assert.equal(
		buildMarkdownFromMediaLink({ kind: "book", url: "https://a.com/b.pdf" }, identity),
		"[📚 书籍](https://a.com/b.pdf)",
	);
});

test("extractMediaLinkFromText extracts bare urls and skips markdown links", () => {
	assert.deepEqual(extractMediaLinkFromText("看看这个 https://a.com/x.png"), {
		kind: "image",
		url: "https://a.com/x.png",
	});
	assert.equal(extractMediaLinkFromText("![图](https://a.com/x.png)"), null);
	assert.equal(extractMediaLinkFromText("[文字](https://a.com/x.png)"), null);
	assert.equal(extractMediaLinkFromText("纯文本没有链接"), null);
	assert.equal(extractMediaLinkFromText(""), null);
});

test("extractMarkdownImageUrls collects unique http image urls", () => {
	const markdown = [
		"![a](https://a.com/1.png)",
		"![b](https://a.com/2.png \"title\")",
		"![dup](https://a.com/1.png)",
		"![local](/local/3.png)",
	].join("\n");
	assert.deepEqual(extractMarkdownImageUrls(markdown), [
		"https://a.com/1.png",
		"https://a.com/2.png",
	]);
	assert.deepEqual(extractMarkdownImageUrls(""), []);
});

test("replaceMarkdownImageUrl swaps url and keeps alt/title", () => {
	const markdown = '![封面](https://old.com/a.png "cover")\n![b](https://old.com/a.png)';
	const next = replaceMarkdownImageUrl(
		markdown,
		"https://old.com/a.png",
		"https://new.com/b.webp",
	);
	assert.equal(
		next,
		'![封面](https://new.com/b.webp "cover")\n![b](https://new.com/b.webp)',
	);
	assert.equal(
		replaceMarkdownImageUrl("![x](https://keep.com/c.png)", "https://none.com/d.png", "y"),
		"![x](https://keep.com/c.png)",
	);
});

test("parseMindMapOutline parses objects, arrays and rejects invalid json", () => {
	const tree = parseMindMapOutline(
		JSON.stringify({ title: "根", children: ["叶子", { title: "子", children: [] }] }),
	);
	assert.ok(tree);
	assert.equal(tree.title, "根");
	assert.equal(tree.children?.length, 2);
	assert.deepEqual(parseMindMapOutline(JSON.stringify(["a", { title: "b" }])), {
		title: "",
		children: [
			{ title: "a" },
			{ title: "b", children: [] },
		],
	});
	assert.equal(parseMindMapOutline("not-json{"), null);
	assert.equal(parseMindMapOutline("42"), null);
});

test("countOutlineDescendants sums nested descendants", () => {
	const node = normalizeMindMapNode({
		title: "root",
		children: [
			{ title: "a", children: ["a1", "a2"] },
			{ title: "b" },
		],
	});
	assert.ok(node);
	assert.equal(countOutlineDescendants(node), 4);
	assert.equal(countOutlineDescendants({ title: "leaf" }), 0);
});

test("collectOutlineExpandablePaths returns every branch path", () => {
	const node = {
		title: "",
		children: [
			{ title: "a", children: [{ title: "a1" }] },
			{ title: "b" },
		],
	};
	assert.deepEqual(collectOutlineExpandablePaths(node), ["root", "root.0"]);
});

test("buildDefaultOutlineExpandedPaths keeps branches through the given depth", () => {
	const node = {
		title: "root",
		children: [
			{
				title: "a",
				children: [{ title: "a1", children: [{ title: "deep" }] }],
			},
		],
	};
	const expanded = buildDefaultOutlineExpandedPaths(node, 2);
	assert.ok(expanded.has("root"));
	assert.ok(expanded.has("root.0"));
	assert.ok(!expanded.has("root.0.0"));
	assert.equal(expanded.size, 2);
});

test("hasPendingArticleJob detects pending statuses across article and ai analysis", () => {
	assert.equal(hasPendingArticleJob(null), false);
	assert.equal(hasPendingArticleJob(makeArticle({ status: "pending" })), true);
	assert.equal(hasPendingArticleJob(makeArticle({ translation_status: "processing" })), true);
	assert.equal(
		hasPendingArticleJob(
			makeArticle({
				ai_analysis: {
					...createEmptyAiAnalysis(),
					quotes_status: "processing",
				} as ArticleDetail["ai_analysis"],
			}),
		),
		true,
	);
	assert.equal(
		hasPendingArticleJob(
			makeArticle({
				ai_analysis: {
					...createEmptyAiAnalysis(),
					quotes_status: "completed",
				} as ArticleDetail["ai_analysis"],
			}),
		),
		false,
	);
});

test("splitArticleAuthors splits, trims and dedupes", () => {
	assert.deepEqual(splitArticleAuthors("张三, 李四 ,张三"), ["张三", "李四"]);
	assert.deepEqual(splitArticleAuthors(""), []);
	assert.deepEqual(splitArticleAuthors(null), []);
	assert.deepEqual(splitArticleAuthors("单人"), ["单人"]);
});

test("aiTaskStatus helpers handle query values, dates and generation gating", () => {
	assert.equal(getQueryValue("abc"), "abc");
	assert.equal(getQueryValue(["first", "second"]), "first");
	assert.equal(getQueryValue(undefined), "");
	assert.equal(decodeQueryValue(encodeURIComponent("/list?tab=a")), "/list?tab=a");
	assert.equal(decodeQueryValue("%zz"), "%zz");
	assert.equal(toDateInputValue("2024-03-05T10:00:00Z"), "2024-03-05");
	assert.equal(toDateInputValue(""), "");
	assert.equal(canManuallyGenerateAIContent("processing", null), false);
	assert.equal(canManuallyGenerateAIContent("completed", "内容"), true);
	assert.equal(canManuallyGenerateAIContent("failed", null), true);
});

test("sortAiTabsByContent puts tabs with content first and keeps order stable", () => {
	const tab = (key: "outline" | "quotes", content: string | null): AITabConfig => ({
		key,
		label: key,
		enabled: true,
		content,
		status: null,
		onGenerate: () => {},
		onCopy: () => {},
	});
	const sorted = sortAiTabsByContent([
		tab("outline", null),
		tab("quotes", "金句内容"),
	]);
	assert.deepEqual(
		sorted.map((item) => item.key),
		["quotes", "outline"],
	);
	const emptyTabs = sortAiTabsByContent([tab("outline", null), tab("quotes", "  ")]);
	assert.deepEqual(
		emptyTabs.map((item) => item.key),
		["outline", "quotes"],
	);
});

test("getPreferredNeighborTitle prefers translated title", () => {
	assert.equal(
		getPreferredNeighborTitle({ id: "1", slug: "s", title: "原题", title_trans: "译题" }),
		"译题",
	);
	assert.equal(
		getPreferredNeighborTitle({ id: "1", slug: "s", title: "原题", title_trans: "  " }),
		"原题",
	);
	assert.equal(getPreferredNeighborTitle({ id: "1", slug: "s", title: "原题" }), "原题");
});

test("createEmptyAiAnalysis returns blank analysis fields", () => {
	const analysis = createEmptyAiAnalysis();
	assert.equal(analysis.summary, null);
	assert.equal(analysis.outline_status, null);
	assert.equal(analysis.quotes_has_history, false);
	assert.equal(analysis.interpretation_status, null);
	assert.equal(analysis.updated_at, null);
	assert.equal(analysis.summary_current_version_id, null);
});

test("normalizeNoteRecommendationLevel falls back to default on unknown values", () => {
	assert.equal(normalizeNoteRecommendationLevel("recommended"), "recommended");
	assert.equal(
		normalizeNoteRecommendationLevel("unknown-level"),
		DEFAULT_NOTE_RECOMMENDATION_LEVEL,
	);
	assert.equal(
		normalizeNoteRecommendationLevel(null),
		DEFAULT_NOTE_RECOMMENDATION_LEVEL,
	);
	assert.deepEqual(NOTE_RECOMMENDATION_LEVEL_OPTIONS.map((item) => item.value), [
		"strongly_recommended",
		"recommended",
		"neutral",
		"not_recommended",
	]);
});

test("createAnnotationId returns unique string ids", () => {
	const first = createAnnotationId();
	const second = createAnnotationId();
	assert.equal(typeof first, "string");
	assert.ok(first.length > 0);
	assert.notEqual(first, second);
});

test("renderMarkdown renders markdown to sanitized html", () => {
	const html = renderMarkdown("# 标题\n\n正文 **加粗**");
	assert.match(html, /<h1[^>]*>/);
	assert.match(html, /标题/);
	assert.match(html, /<strong>加粗<\/strong>/);
	const unsafe = renderMarkdown('<script>alert(1)</script>文本');
	assert.ok(!unsafe.includes("<script"));
	assert.match(unsafe, /文本/);
});
