import type { GetServerSideProps } from "next";
import { getPublicSitemapXml } from "@/lib/publicSitemap";

const SitemapPage = () => null;

export const getServerSideProps: GetServerSideProps = async ({ req, res }) => {
	try {
		const xml = await getPublicSitemapXml(req);
		res.setHeader("Content-Type", "application/xml; charset=utf-8");
		res.setHeader("Cache-Control", "public, max-age=30, stale-while-revalidate=30");
		res.write(xml);
	} catch {
		// Do not turn an upstream failure into a cached, truncated sitemap.
		res.statusCode = 503;
		res.setHeader("Cache-Control", "no-store");
		res.setHeader("Content-Type", "application/xml; charset=utf-8");
		res.write('<?xml version="1.0" encoding="UTF-8"?><error>Sitemap temporarily unavailable</error>');
	}
	res.end();
	return { props: {} };
};

export default SitemapPage;
