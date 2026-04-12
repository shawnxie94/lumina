import type { GetServerSideProps } from "next";

import type { Article, Category, ReviewIssue } from "@/lib/api";
import { buildCanonicalUrl, buildSitemapXml } from "@/lib/seo";
import {
	fetchAllServerArticles,
	fetchAllServerReviews,
	fetchServerCategories,
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

const buildReviewEntries = (origin: string, reviews: ReviewIssue[]) =>
	reviews
		.filter((review) => review.status === "published")
		.map((review) => ({
			loc: buildCanonicalUrl(origin, `/reviews/${review.slug}`),
			lastmod: review.updated_at || review.published_at || review.created_at,
			changefreq: "weekly" as const,
			priority: 0.7,
		}));

export const getServerSideProps: GetServerSideProps = async ({ req, res }) => {
	const origin = resolveRequestOrigin(req);

	try {
		const [articles, categories, reviews] = await Promise.all([
			fetchAllServerArticles(req, {
				size: 500,
				sort_by: "published_at_desc",
			}),
			fetchServerCategories(req),
			fetchAllServerReviews(req, {
				size: 100,
			}),
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
				{
					loc: buildCanonicalUrl(origin, "/reviews"),
					changefreq: "weekly",
					priority: 0.8,
				},
				...buildArticleEntries(origin, articles),
				...buildCategoryEntries(origin, categories),
				...buildReviewEntries(origin, reviews),
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
				{
					loc: buildCanonicalUrl(origin, "/reviews"),
					changefreq: "weekly",
					priority: 0.8,
				},
			]),
		);
		res.end();
		return { props: {} };
	}
};

export default SitemapPage;
