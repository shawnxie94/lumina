import assert from "node:assert/strict";
import test from "node:test";
import {
	createPublicXmlCache,
	fetchPublicSitemapItems,
	SITEMAP_TTL_MS,
} from "../lib/publicSitemap";

test("sitemap cache shares inflight, expires, bounds origins and never caches failures", async () => {
	let now = 0;
	const cache = createPublicXmlCache(1, () => now);
	let resolve: (xml: string) => void = () => {};
	let calls = 0;
	const loader = () => {
		calls++;
		return new Promise<string>((yes) => {
			resolve = yes;
		});
	};
	const first = cache.get("origin-A", loader);
	const same = cache.get("origin-A", loader);
	await Promise.resolve();
	assert.equal(calls, 1);
	resolve("A");
	assert.deepEqual(await Promise.all([first, same]), ["A", "A"]);
	assert.equal(await cache.get("origin-A", async () => "wrong"), "A");
	assert.equal(await cache.get("origin-B", async () => "B"), "B");
	assert.equal(await cache.get("origin-A", async () => "A2"), "A2");
	now += SITEMAP_TTL_MS + 1;
	assert.equal(await cache.get("origin-A", async () => "A3"), "A3");
	await assert.rejects(
		cache.get("failure", async () => {
			throw Error("upstream");
		}),
	);
	assert.equal(
		await cache.get("failure", async () => "recovered"),
		"recovered",
	);
});

test("sitemap minimal pages collect all rows without credentials", async () => {
	const urls: string[] = [];
	const request: typeof fetch = async (input, options) => {
		const url = String(input);
		urls.push(url);
		assert.deepEqual(options?.headers, { Accept: "application/json" });
		return new Response(
			JSON.stringify({
				items: [{ id: String(urls.length), slug: "public", lastmod: null }],
				next_cursor: urls.length < 3 ? String(urls.length) : null,
			}),
		);
	};
	const rows = await fetchPublicSitemapItems(
		"https://backend",
		"articles",
		request,
	);
	assert.equal(rows.length, 3);
	assert.match(urls[1], /cursor=1/);
	assert.match(urls[2], /cursor=2/);
	await assert.rejects(
		fetchPublicSitemapItems(
			"https://backend",
			"columns",
			async () => new Response("error", { status: 500 }),
		),
	);
});

test("sitemap cache bounds simultaneous loaders across origins", async () => {
	const cache = createPublicXmlCache(1);
	let release: (value: string) => void = () => {};
	let secondStarted = false;
	const first = cache.get(
		"one",
		() =>
			new Promise<string>((resolve) => {
				release = resolve;
			}),
	);
	const second = cache.get("two", async () => {
		secondStarted = true;
		return "two";
	});
	await Promise.resolve();
	assert.equal(secondStarted, false);
	release("one");
	await first;
	assert.equal(await second, "two");
});
