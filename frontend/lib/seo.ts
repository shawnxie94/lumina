export interface RobotsDirectiveOptions {
	index: boolean;
	follow?: boolean;
	noarchive?: boolean;
}

export interface SitemapEntry {
	loc: string;
	lastmod?: string | null;
	changefreq?:
		| "always"
		| "hourly"
		| "daily"
		| "weekly"
		| "monthly"
		| "yearly"
		| "never";
	priority?: number | null;
}

export interface ListSeoQuery {
	category_id?: string;
	tag_ids?: string;
	search?: string;
	source_domain?: string;
	author?: string;
	visibility?: string;
	quick_date?: string;
	sort_by?: string;
	published_at_start?: string;
	published_at_end?: string;
	created_at_start?: string;
	created_at_end?: string;
	page?: string;
	size?: string;
}

export interface ListSeoOptions {
	siteName?: string;
	siteDescription?: string;
	categoryName?: string | null;
	tagNames?: string[] | null;
	authorName?: string | null;
}

export interface ListSeoResult {
	indexable: boolean;
	robots: string;
	title: string;
	description: string;
	canonicalQuery: Record<string, string>;
}

const DEFAULT_SITE_NAME = "Lumina";
const DEFAULT_SITE_DESCRIPTION = "信息灯塔";
const DEFAULT_DESCRIPTION_LENGTH = 160;

const escapeXml = (value: string): string =>
	(value || "").replace(/[<>&'"]/g, (char) => {
		switch (char) {
			case "<":
				return "&lt;";
			case ">":
				return "&gt;";
			case "&":
				return "&amp;";
			case "'":
				return "&apos;";
			case '"':
				return "&quot;";
			default:
				return char;
		}
	});

export const stripHtmlTags = (value: string): string =>
	(value || "")
		.replace(/<style[\s\S]*?<\/style>/gi, " ")
		.replace(/<script[\s\S]*?<\/script>/gi, " ")
		.replace(/<[^>]+>/g, " ")
		.replace(/\s+/g, " ")
		.trim();

export const buildMetaDescription = (
	value: string,
	maxLength = DEFAULT_DESCRIPTION_LENGTH,
): string => {
	const plainText = stripHtmlTags(value);
	if (!plainText) return "";
	if (plainText.length <= maxLength) return plainText;
	return `${plainText.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
};

export const buildRobotsDirectives = ({
	index,
	follow = true,
	noarchive = false,
}: RobotsDirectiveOptions): string => {
	const directives = [index ? "index" : "noindex", follow ? "follow" : "nofollow"];
	if (noarchive) {
		directives.push("noarchive");
	}
	return directives.join(",");
};

const pickFirst = (value?: string | string[] | null): string => {
	if (Array.isArray(value)) return value[0] || "";
	return value || "";
};

const normalizeIdList = (value?: string): string[] =>
	(value || "")
		.split(",")
		.map((item) => item.trim())
		.filter(Boolean);

const hasAnyLowValueFilter = (query: ListSeoQuery): boolean =>
	Boolean(
		query.search ||
			query.source_domain ||
			query.visibility ||
			query.quick_date ||
			query.published_at_start ||
			query.published_at_end ||
			query.created_at_start ||
			query.created_at_end ||
			query.size,
	);

const countPrimaryFacets = (query: ListSeoQuery): number => {
	let count = 0;
	if (query.category_id) count += 1;
	if (normalizeIdList(query.tag_ids).length > 0) count += 1;
	if (query.author) count += 1;
	return count;
};

export const buildCanonicalListQuery = (query: ListSeoQuery): Record<string, string> => {
	const nextQuery: Record<string, string> = {};
	const shouldKeepPage =
		!hasAnyLowValueFilter(query) &&
		countPrimaryFacets(query) <= 1 &&
		(!query.sort_by || query.sort_by === "published_at_desc");
	if (query.category_id) nextQuery.category_id = query.category_id;
	if (query.tag_ids && !query.author && !query.category_id) {
		nextQuery.tag_ids = normalizeIdList(query.tag_ids).join(",");
	}
	if (query.author && !query.tag_ids && !query.category_id) {
		nextQuery.author = query.author;
	}
	if (shouldKeepPage && query.page && query.page !== "1") {
		nextQuery.page = query.page;
	}
	return nextQuery;
};

const buildListTitle = (
	query: ListSeoQuery,
	options: ListSeoOptions,
): string => {
	const siteName = options.siteName || DEFAULT_SITE_NAME;
	const page = Number.parseInt(query.page || "1", 10);
	const pageLabel = Number.isFinite(page) && page > 1 ? ` - 第 ${page} 页` : "";
	if (options.categoryName || query.category_id) {
		return `${options.categoryName || query.category_id} - 文章列表${pageLabel} - ${siteName}`;
	}
	if ((options.tagNames && options.tagNames.length > 0) || normalizeIdList(query.tag_ids).length > 0) {
		const tagLabel =
			options.tagNames?.filter(Boolean).join(" / ") ||
			normalizeIdList(query.tag_ids).join(" / ");
		return `${tagLabel} - 标签文章${pageLabel} - ${siteName}`;
	}
	if (options.authorName || query.author) {
		return `${options.authorName || query.author} - 作者文章${pageLabel} - ${siteName}`;
	}
	return `文章列表${pageLabel} - ${siteName}`;
};

const buildListDescription = (
	query: ListSeoQuery,
	options: ListSeoOptions,
): string => {
	const siteDescription = options.siteDescription || DEFAULT_SITE_DESCRIPTION;
	if (options.categoryName || query.category_id) {
		return `浏览 ${(options.categoryName || query.category_id) as string} 分类下的公开文章、摘要与延伸阅读。${siteDescription}`;
	}
	if ((options.tagNames && options.tagNames.length > 0) || normalizeIdList(query.tag_ids).length > 0) {
		const tagLabel =
			options.tagNames?.filter(Boolean).join("、") ||
			normalizeIdList(query.tag_ids).join("、");
		return `浏览标签 ${tagLabel} 下的公开文章、摘要与延伸阅读。${siteDescription}`;
	}
	if (options.authorName || query.author) {
		return `浏览作者 ${(options.authorName || query.author) as string} 的公开文章、摘要与延伸阅读。${siteDescription}`;
	}
	return `浏览最新公开文章、摘要与延伸阅读。${siteDescription}`;
};

export const getListPageSeo = (
	rawQuery: Record<string, string | string[] | undefined>,
	options: ListSeoOptions = {},
): ListSeoResult => {
	const query: ListSeoQuery = {
		category_id: pickFirst(rawQuery.category_id),
		tag_ids: pickFirst(rawQuery.tag_ids),
		search: pickFirst(rawQuery.search),
		source_domain: pickFirst(rawQuery.source_domain),
		author: pickFirst(rawQuery.author),
		visibility: pickFirst(rawQuery.visibility),
		quick_date: pickFirst(rawQuery.quick_date),
		sort_by: pickFirst(rawQuery.sort_by),
		published_at_start: pickFirst(rawQuery.published_at_start),
		published_at_end: pickFirst(rawQuery.published_at_end),
		created_at_start: pickFirst(rawQuery.created_at_start),
		created_at_end: pickFirst(rawQuery.created_at_end),
		page: pickFirst(rawQuery.page),
		size: pickFirst(rawQuery.size),
	};
	const indexable =
		!hasAnyLowValueFilter(query) &&
		countPrimaryFacets(query) <= 1 &&
		(!query.sort_by || query.sort_by === "published_at_desc");
	return {
		indexable,
		robots: buildRobotsDirectives({ index: indexable, follow: true }),
		title: buildListTitle(query, options),
		description: buildListDescription(query, options),
		canonicalQuery: buildCanonicalListQuery(query),
	};
};

export const buildAbsoluteUrl = (origin: string, path: string): string => {
	const normalizedOrigin = (origin || "").trim().replace(/\/+$/, "");
	const normalizedPath = path.startsWith("/") ? path : `/${path}`;
	return `${normalizedOrigin}${normalizedPath}`;
};

export const buildPathWithQuery = (
	pathname: string,
	query: Record<string, string | undefined>,
): string => {
	const searchParams = new URLSearchParams();
	Object.entries(query)
		.filter(([, value]) => Boolean(value))
		.sort(([left], [right]) => left.localeCompare(right))
		.forEach(([key, value]) => {
			if (value) {
				searchParams.set(key, value);
			}
		});
	const queryString = searchParams.toString();
	return queryString ? `${pathname}?${queryString}` : pathname;
};

export const buildCanonicalUrl = (
	origin: string,
	pathname: string,
	query: Record<string, string | undefined> = {},
): string => buildAbsoluteUrl(origin, buildPathWithQuery(pathname, query));

export const resolveSeoAssetUrl = (
	origin: string,
	assetUrl?: string | null,
): string => {
	const normalized = (assetUrl || "").trim();
	if (!normalized) return "";
	if (/^https?:\/\//i.test(normalized)) {
		return normalized;
	}
	if (normalized.startsWith("/media/")) {
		return buildAbsoluteUrl(origin, `/backend${normalized}`);
	}
	if (normalized.startsWith("/backend/")) {
		return buildAbsoluteUrl(origin, normalized);
	}
	return buildAbsoluteUrl(origin, normalized.startsWith("/") ? normalized : `/${normalized}`);
};

const normalizeSitemapLastmod = (value?: string | null): string | null => {
	const normalized = (value || "").trim();
	if (!normalized) return null;

	const parsedTimestamp = Date.parse(normalized);
	if (Number.isNaN(parsedTimestamp)) {
		return null;
	}
	return new Date(parsedTimestamp).toISOString().replace(/\.\d{3}Z$/, "+00:00");
};

export const buildSitemapXml = (entries: SitemapEntry[]): string => {
	const body = entries
		.map((entry) => {
			const parts = [`<loc>${escapeXml(entry.loc)}</loc>`];
			const lastmod = normalizeSitemapLastmod(entry.lastmod);
			if (lastmod) {
				parts.push(`<lastmod>${escapeXml(lastmod)}</lastmod>`);
			}
			if (entry.changefreq) {
				parts.push(`<changefreq>${entry.changefreq}</changefreq>`);
			}
			if (typeof entry.priority === "number") {
				parts.push(`<priority>${entry.priority.toFixed(1)}</priority>`);
			}
			return `<url>${parts.join("")}</url>`;
		})
		.join("");
	return `<?xml version="1.0" encoding="UTF-8"?>` +
		`<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${body}</urlset>`;
};
