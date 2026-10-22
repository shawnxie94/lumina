import type { IncomingMessage } from "node:http";
import { buildCanonicalUrl, buildSitemapXml } from "./seo";
import { resolveRequestOrigin } from "./serverApi";

export interface SitemapItem {
	id: string;
	slug: string | null;
	lastmod: string | null;
}
interface SitemapPage {
	items: SitemapItem[];
	next_cursor: string | null;
}
export const SITEMAP_TTL_MS = 30_000;
export const SITEMAP_TIMEOUT_MS = 15_000;

interface DeadlineOptions {
	timeoutMs?: number;
	setTimer?: (
		callback: () => void,
		delay: number,
	) => ReturnType<typeof setTimeout>;
	clearTimer?: (timer: ReturnType<typeof setTimeout>) => void;
}

/** Bounded cache and single-flight admission. Rejections are never cached. */
export function createPublicXmlCache(
	maxEntries = 32,
	now = Date.now,
	deadline: DeadlineOptions = {},
) {
	const setTimer = deadline.setTimer || setTimeout;
	const clearTimer = deadline.clearTimer || clearTimeout;
	const entries = new Map<string, { expires: number; xml: string }>();
	const inflight = new Map<string, Promise<string>>();
	const get = async (
		key: string,
		loader: (signal: AbortSignal) => Promise<string>,
	): Promise<string> => {
		const cached = entries.get(key);
		if (cached && cached.expires > now()) return cached.xml;
		entries.delete(key);
		const pending = inflight.get(key);
		if (pending) return pending;
		if (inflight.size >= maxEntries) {
			await Promise.race(inflight.values()).catch(() => {});
			return get(key, loader);
		}
		const controller = new AbortController();
		let timer: ReturnType<typeof setTimeout>;
		const expired = new Promise<never>((_resolve, reject) => {
			timer = setTimer(() => {
				// Deliberately generic: never put origin/backend URLs in errors.
				const error = new Error("Sitemap generation timed out");
				controller.abort(error);
				reject(error);
			}, deadline.timeoutMs ?? SITEMAP_TIMEOUT_MS);
		});
		const request = Promise.race([
			Promise.resolve().then(() => loader(controller.signal)),
			expired,
		])
			.then((xml) => {
				controller.signal.throwIfAborted();
				if (entries.size >= maxEntries)
					entries.delete(entries.keys().next().value as string);
				entries.set(key, { xml, expires: now() + SITEMAP_TTL_MS });
				return xml;
			})
			.finally(() => {
				clearTimer(timer);
				controller.abort(); // Also cancel sibling page fetches after any loader failure.
				inflight.delete(key);
			});
		inflight.set(key, request);
		return request;
	};
	return { get };
}

export async function fetchPublicSitemapItems(
	base: string,
	kind: string,
	request = fetch,
	signal?: AbortSignal,
): Promise<SitemapItem[]> {
	const items: SitemapItem[] = [];
	let cursor: string | null = null;
	do {
		signal?.throwIfAborted();
		const query = new URLSearchParams({
			size: "500",
			...(cursor ? { cursor } : {}),
		});
		// Never forward admin cookies, Authorization or internal tokens.
		const response = await request(`${base}/api/sitemap/${kind}?${query}`, {
			headers: { Accept: "application/json" },
			signal,
		});
		if (!response.ok)
			throw new Error(`Sitemap projection failed: ${response.status}`);
		const page = (await response.json()) as SitemapPage;
		signal?.throwIfAborted();
		items.push(...page.items);
		if (page.next_cursor && cursor && page.next_cursor <= cursor)
			throw new Error("Non-advancing sitemap cursor");
		cursor = page.next_cursor;
	} while (cursor);
	return items;
}

const cache = createPublicXmlCache();
export function getPublicSitemapXml(req: IncomingMessage) {
	const origin = resolveRequestOrigin(req);
	const base = (process.env.BACKEND_API_URL || `${origin}/backend`).replace(
		/\/+$/,
		"",
	);
	return cache.get(JSON.stringify([origin, base]), async (signal) => {
		const [articles, categories, columns] = await Promise.all(
			["articles", "categories", "columns"].map((kind) =>
				fetchPublicSitemapItems(base, kind, fetch, signal),
			),
		);
		return buildSitemapXml([
			{ loc: buildCanonicalUrl(origin, "/"), changefreq: "daily", priority: 1 },
			{
				loc: buildCanonicalUrl(origin, "/list"),
				changefreq: "daily",
				priority: 0.9,
			},
			{
				loc: buildCanonicalUrl(origin, "/columns"),
				changefreq: "weekly",
				priority: 0.8,
			},
			...articles.map((item) => ({
				loc: buildCanonicalUrl(origin, `/article/${item.slug}`),
				lastmod: item.lastmod,
				changefreq: "weekly" as const,
				priority: 0.8,
			})),
			...categories.map((item) => ({
				loc: buildCanonicalUrl(origin, "/list", { category_id: item.id }),
				changefreq: "daily" as const,
				priority: 0.7,
			})),
			...columns.map((item) => ({
				loc: buildCanonicalUrl(origin, `/columns/${item.slug}`),
				lastmod: item.lastmod,
				changefreq: "weekly" as const,
				priority: 0.7,
			})),
		]);
	});
}
