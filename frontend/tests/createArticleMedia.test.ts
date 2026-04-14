import assert from "node:assert/strict";
import test from "node:test";

import { resolveCreateArticlePatch } from "@/lib/createArticleMedia";

test("resolveCreateArticlePatch updates top image with ingested url", async () => {
	const result = await resolveCreateArticlePatch({
		originalContent: "hello",
		pendingMedia: [],
		topImage: "https://cdn.example.com/original-cover.png",
		articleId: "article-1",
		mediaStorageEnabled: true,
		ingestUrl: async (_articleId, url) => ({
			url: `/backend/media/${encodeURIComponent(url)}`,
		}),
		uploadFile: async () => {
			throw new Error("not used");
		},
	});

	assert.equal(result.patch.content_md, "hello");
	assert.equal(
		result.patch.top_image,
		"/backend/media/https%3A%2F%2Fcdn.example.com%2Foriginal-cover.png",
	);
	assert.equal(result.transferFailedCount, 0);
});

test("resolveCreateArticlePatch keeps original top image when ingest fails", async () => {
	const result = await resolveCreateArticlePatch({
		originalContent: "hello",
		pendingMedia: [],
		topImage: "https://cdn.example.com/original-cover.png",
		articleId: "article-1",
		mediaStorageEnabled: true,
		ingestUrl: async () => {
			throw new Error("boom");
		},
		uploadFile: async () => {
			throw new Error("not used");
		},
	});

	assert.equal(
		result.patch.top_image,
		"https://cdn.example.com/original-cover.png",
	);
	assert.equal(result.transferFailedCount, 1);
});

test("resolveCreateArticlePatch derives top image from first transferred markdown image", async () => {
	const token = "__LUMINA_CREATE_MEDIA_demo__";
	const result = await resolveCreateArticlePatch({
		originalContent: `![封面](${token})\n\n正文内容`,
		pendingMedia: [
			{
				token,
				kind: "url",
				url: "https://cdn.example.com/original-cover.png",
				mediaKind: "image",
			},
		],
		topImage: "",
		articleId: "article-1",
		mediaStorageEnabled: true,
		ingestUrl: async () => ({
			url: "http://api:8000/backend/media/2026/04/transferred-cover.png",
		}),
		uploadFile: async () => {
			throw new Error("not used");
		},
	});

	assert.equal(
		result.patch.content_md,
		"![封面](/backend/media/2026/04/transferred-cover.png)\n\n正文内容",
	);
	assert.equal(
		result.patch.top_image,
		"/backend/media/2026/04/transferred-cover.png",
	);
	assert.equal(result.transferFailedCount, 0);
});
