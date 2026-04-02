import test from "node:test";
import assert from "node:assert/strict";

import {
	ADMIN_PREVIEW_QUERY_KEY,
	buildArticleHref,
	buildAdminPreviewArticleHref,
	isAdminPreviewEnabled,
} from "@/lib/articlePreview";

test("buildAdminPreviewArticleHref appends admin preview flag and from query", () => {
	const href = buildAdminPreviewArticleHref("example-slug", {
		from: "/list#article-example-slug",
	});

	assert.equal(
		href,
		"/article/example-slug?from=%2Flist%23article-example-slug&admin_preview=1",
	);
});

test("isAdminPreviewEnabled only accepts explicit admin preview flag", () => {
	assert.equal(isAdminPreviewEnabled("1"), true);
	assert.equal(isAdminPreviewEnabled(["1", "0"]), true);
	assert.equal(isAdminPreviewEnabled("0"), false);
	assert.equal(isAdminPreviewEnabled(undefined), false);
	assert.equal(ADMIN_PREVIEW_QUERY_KEY, "admin_preview");
});

test("buildArticleHref omits from by default and keeps admin preview marker for hidden articles", () => {
	const publicHref = buildArticleHref("public-slug", {
		from: "/list#article-public-slug",
		adminPreview: false,
	});
	const hiddenAdminHref = buildArticleHref("hidden-slug", {
		from: "/list#article-hidden-slug",
		adminPreview: true,
	});

	assert.equal(publicHref, "/article/public-slug");
	assert.equal(hiddenAdminHref, "/article/hidden-slug?admin_preview=1");
});

test("buildArticleHref keeps from only when explicitly requested", () => {
	const publicHref = buildArticleHref("public-slug", {
		from: "/list#article-public-slug",
		adminPreview: false,
		preserveFrom: true,
	});
	const hiddenAdminHref = buildArticleHref("hidden-slug", {
		from: "/list#article-hidden-slug",
		adminPreview: true,
		preserveFrom: true,
	});

	assert.equal(
		publicHref,
		"/article/public-slug?from=%2Flist%23article-public-slug",
	);
	assert.equal(
		hiddenAdminHref,
		"/article/hidden-slug?from=%2Flist%23article-hidden-slug&admin_preview=1",
	);
});
