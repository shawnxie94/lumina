import type { GetServerSideProps } from "next";

import type { Article, Category, Tag } from "@/lib/api";
import { buildCanonicalUrl, buildSitemapXml } from "@/lib/seo";
import {
	fetchAllServerArticles,
	fetchServerAuthors,
	fetchServerCategories,
	fetchServerTags,
	resolveRequestOrigin,
} from "@/lib/serverApi";

const SitemapPage = () => null;

const buildArticleEntries = (origin: string, articles: Article[]) =>
	articles.map((article) => ({
		loc: buildCanonicalUrl(origin, `/article/${article.slug}`),
		lastmod: article.published_at || article.created_at,
		changefreq: "weekly" as const,
		priority: 0.8,
	}));

const buildCategoryEntries = (origin: string, categories: Category[]) =>
	categories.map((category) => ({
		loc: buildCanonicalUrl(origin, "/list", { category_id: category.id }),
		changefreq: "daily" as const,
		priority: 0.7,
	}));

const buildTagEntries = (origin: string, tags: Tag[]) =>
	tags.map((tag) => ({
		loc: buildCanonicalUrl(origin, "/list", { tag_ids: tag.id }),
		changefreq: "weekly" as const,
		priority: 0.6,
	}));

const buildAuthorEntries = (origin: string, authors: string[]) =>
	authors
		.filter(Boolean)
		.map((author) => ({
			loc: buildCanonicalUrl(origin, "/list", { author }),
			changefreq: "weekly" as const,
			priority: 0.6,
		}));

export const getServerSideProps: GetServerSideProps = async ({ req, res }) => {
	const origin = resolveRequestOrigin(req);

	try {
		const [articles, categories, tags, authors] = await Promise.all([
			fetchAllServerArticles(req, {
				size: 500,
				sort_by: "published_at_desc",
			}),
			fetchServerCategories(req),
			fetchServerTags(req),
			fetchServerAuthors(req),
		]);

		const xml = buildSitemapXml([
			{
				loc: buildCanonicalUrl(origin, "/"),
				changefreq: "daily",
				priority: 1,
			},
				{
					loc: buildCanonicalUrl(origin, "/list"),
					changefreq: "daily",
					priority: 0.9,
				},
				...buildArticleEntries(origin, articles),
				...buildCategoryEntries(origin, categories),
				...buildTagEntries(origin, tags),
				...buildAuthorEntries(origin, authors),
			]);

		res.setHeader("Content-Type", "application/xml; charset=utf-8");
		res.write(xml);
		res.end();
		return { props: {} };
	} catch {
		res.setHeader("Content-Type", "application/xml; charset=utf-8");
		res.write(
			buildSitemapXml([
				{
					loc: buildCanonicalUrl(origin, "/"),
					changefreq: "daily",
					priority: 1,
				},
				{
					loc: buildCanonicalUrl(origin, "/list"),
					changefreq: "daily",
					priority: 0.9,
				},
			]),
		);
		res.end();
		return { props: {} };
	}
};

export default SitemapPage;
