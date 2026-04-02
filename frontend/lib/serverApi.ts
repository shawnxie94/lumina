import type { IncomingMessage } from "http";

import type { Article, ArticleDetail, BasicSettings, Tag } from "@/lib/api";
import { buildAbsoluteUrl } from "@/lib/seo";

interface ArticleListResponse {
	data: Article[];
	pagination: {
		page: number;
		size: number;
		total: number;
		total_pages: number;
	};
}

interface CategorySummary {
	id: string;
	name: string;
	description: string;
	color: string;
	article_count: number;
}

interface CategoryStatSummary {
	id: string;
	name: string;
	color: string | null;
	article_count: number;
}

const normalizeBaseUrl = (value?: string | null): string =>
	(value || "").trim().replace(/\/+$/, "");

const pickForwardedValue = (value?: string | string[]): string => {
	if (Array.isArray(value)) return value[0] || "";
	return (value || "").split(",")[0]?.trim() || "";
};

export const resolveRequestOrigin = (req?: IncomingMessage): string => {
	const configuredOrigin =
		normalizeBaseUrl(process.env.APP_PUBLIC_BASE_URL) ||
		normalizeBaseUrl(process.env.NEXT_PUBLIC_SITE_URL) ||
		normalizeBaseUrl(process.env.SITE_URL);
	if (configuredOrigin) {
		return configuredOrigin;
	}

	const headers = req?.headers || {};
	const forwardedProto = pickForwardedValue(headers["x-forwarded-proto"]);
	const forwardedHost = pickForwardedValue(headers["x-forwarded-host"]);
	if (forwardedProto && forwardedHost) {
		return `${forwardedProto}://${forwardedHost}`;
	}

	const host = pickForwardedValue(headers.host);
	const protocol = forwardedProto || (host.includes("localhost") ? "http" : "https");
	if (host) {
		return `${protocol}://${host}`;
	}
	return "http://localhost:3000";
};

const resolveBackendBaseUrl = (req?: IncomingMessage): string =>
	normalizeBaseUrl(process.env.BACKEND_API_URL) ||
	buildAbsoluteUrl(resolveRequestOrigin(req), "/backend");

export const fetchServerJson = async <T>(
	req: IncomingMessage | undefined,
	path: string,
): Promise<T> => {
	const baseUrl = resolveBackendBaseUrl(req);
	const response = await fetch(`${baseUrl}${path}`, {
		headers: {
			Accept: "application/json",
		},
	});
	if (!response.ok) {
		throw new Error(`Failed to fetch ${path}: ${response.status}`);
	}
	return (await response.json()) as T;
};

export const fetchServerBasicSettings = (req?: IncomingMessage) =>
	fetchServerJson<BasicSettings>(req, "/api/settings/basic/public");

export const fetchServerArticles = (
	req: IncomingMessage | undefined,
	params: Record<string, string | number | undefined>,
) => {
	const query = new URLSearchParams();
	Object.entries(params).forEach(([key, value]) => {
		if (value !== undefined && value !== null && value !== "") {
			query.set(key, String(value));
		}
	});
	const suffix = query.toString() ? `?${query.toString()}` : "";
	return fetchServerJson<ArticleListResponse>(req, `/api/articles${suffix}`);
};

export const fetchAllServerArticles = async (
	req: IncomingMessage | undefined,
	params: Record<string, string | number | undefined>,
): Promise<Article[]> => {
	const firstPage = await fetchServerArticles(req, {
		...params,
		page: 1,
	});
	const articles = [...(firstPage.data || [])];
	const totalPages = Math.max(1, firstPage.pagination.total_pages || 1);

	for (let page = 2; page <= totalPages; page += 1) {
		const response = await fetchServerArticles(req, {
			...params,
			page,
		});
		articles.push(...(response.data || []));
	}

	return articles;
};

export const fetchServerArticle = (req: IncomingMessage | undefined, slug: string) =>
	fetchServerJson<ArticleDetail>(req, `/api/articles/${encodeURIComponent(slug)}`);

export const fetchServerCategories = (req?: IncomingMessage) =>
	fetchServerJson<CategorySummary[]>(req, "/api/categories");

export const fetchServerCategoryStats = (
	req: IncomingMessage | undefined,
	params: Record<string, string | undefined>,
) => {
	const query = new URLSearchParams();
	Object.entries(params).forEach(([key, value]) => {
		if (value) {
			query.set(key, value);
		}
	});
	const suffix = query.toString() ? `?${query.toString()}` : "";
	return fetchServerJson<CategoryStatSummary[]>(req, `/api/categories/stats${suffix}`);
};

export const fetchServerTags = (req?: IncomingMessage) =>
	fetchServerJson<Tag[]>(req, "/api/tags");

export const fetchServerAuthors = (req?: IncomingMessage) =>
	fetchServerJson<string[]>(req, "/api/authors");
