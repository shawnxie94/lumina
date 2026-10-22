import assert from "node:assert/strict";
import test from "node:test";
import {
	createPublicXmlCache,
	fetchPublicSitemapItems,
	SITEMAP_TTL_MS,
	SITEMAP_TIMEOUT_MS,
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

function deadlineClock() {
	let next = 0;
	const callbacks = new Map<number, () => void>();
	return {
		setTimer: (callback: () => void, delay: number) => {
			assert.equal(delay, SITEMAP_TIMEOUT_MS);
			callbacks.set(++next, callback);
			return next as unknown as ReturnType<typeof setTimeout>;
		},
		clearTimer: (timer: ReturnType<typeof setTimeout>) => {
			callbacks.delete(timer as unknown as number);
		},
		expire: () => {
			const first = callbacks.entries().next().value;
			assert.ok(first);
			callbacks.delete(first[0]);
			first[1]();
		},
		count: () => callbacks.size,
	};
}
const settle = async () => {
	for (let i = 0; i < 10; i++) await Promise.resolve();
};

test("shared total deadline aborts hung loads, releases queue, ignores late success and recovers", async () => {
	const clock = deadlineClock();
	const cache = createPublicXmlCache(1, Date.now, clock);
	let late: (xml: string) => void = () => {};
	let signal: AbortSignal | undefined;
	let loads = 0;
	const hung = (abort: AbortSignal) => {
		loads++;
		signal = abort;
		return new Promise<string>((resolve) => {
			late = resolve;
		});
	};
	const first = cache.get("A", hung);
	const shared = cache.get("A", hung);
	const failures = [
		assert.rejects(first, /Sitemap generation timed out/),
		assert.rejects(shared, /Sitemap generation timed out/),
	];
	let queuedStarted = false;
	const queued = cache.get("B", async () => {
		queuedStarted = true;
		return "B";
	});
	await settle();
	assert.equal(loads, 1);
	assert.equal(queuedStarted, false);
	clock.expire();
	await Promise.all(failures);
	assert.equal(signal?.aborted, true);
	assert.equal(await queued, "B");
	assert.equal(clock.count(), 0);
	late("stale A");
	await settle();
	assert.equal(await cache.get("A", async () => "recovered A"), "recovered A");
	assert.equal(await cache.get("A", async () => "wrong"), "recovered A");
});

test("one deadline spans all pages and aborts response-body waiting", async () => {
	const clock = deadlineClock();
	const cache = createPublicXmlCache(1, Date.now, clock);
	let pages = 0;
	let bodyResolve: (body: unknown) => void = () => {};
	let signal: AbortSignal | null | undefined;
	const request: typeof fetch = async (_url, options) => {
		pages++;
		signal = options?.signal;
		if (pages === 1)
			return new Response(JSON.stringify({ items: [], next_cursor: "next" }));
		// Ignore transport cancellation to prove the outer deadline still releases admission.
		return {
			ok: true,
			json: () =>
				new Promise((resolve) => {
					bodyResolve = resolve;
				}),
		} as Response;
	};
	const result = cache.get("pages", async (abort) =>
		JSON.stringify(
			await fetchPublicSitemapItems("https://unit", "articles", request, abort),
		),
	);
	const failure = assert.rejects(result, /Sitemap generation timed out/);
	await settle();
	assert.equal(pages, 2);
	assert.equal(clock.count(), 1);
	clock.expire();
	await failure;
	assert.equal(signal?.aborted, true);
	bodyResolve({ items: [], next_cursor: "would-continue" });
	await settle();
	assert.equal(pages, 2);
	assert.equal(await cache.get("pages", async () => "recovered"), "recovered");
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
