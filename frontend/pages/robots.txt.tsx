import type { GetServerSideProps } from "next";

import { fetchServerBasicSettings, resolveRequestOrigin } from "@/lib/serverApi";

const RobotsPage = () => null;

export const getServerSideProps: GetServerSideProps = async ({ req, res }) => {
	const origin = resolveRequestOrigin(req);
	let sitemapUrl = `${origin}/sitemap.xml`;

	try {
		await fetchServerBasicSettings(req);
	} catch {
		// Keep a deterministic robots.txt even if settings fetch fails.
	}

	res.setHeader("Content-Type", "text/plain; charset=utf-8");
	res.write(
		[
			"User-agent: *",
			"Allow: /",
			"Disallow: /admin",
			"Disallow: /login",
			"Disallow: /auth/",
			"Disallow: /_offline",
			`Sitemap: ${sitemapUrl}`,
			"",
		].join("\n"),
	);
	res.end();

	return { props: {} };
};

export default RobotsPage;
