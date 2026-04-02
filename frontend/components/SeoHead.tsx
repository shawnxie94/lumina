import Head from "next/head";

export interface SeoHeadProps {
	title: string;
	description?: string;
	canonicalUrl?: string;
	robots?: string;
	imageUrl?: string;
	type?: "website" | "article";
	siteName?: string;
	publishedTime?: string | null;
	modifiedTime?: string | null;
	structuredData?: Array<Record<string, unknown>>;
}

export default function SeoHead({
	title,
	description,
	canonicalUrl,
	robots = "index,follow",
	imageUrl,
	type = "website",
	siteName = "Lumina",
	publishedTime,
	modifiedTime,
	structuredData = [],
}: SeoHeadProps) {
	const twitterCard = imageUrl ? "summary_large_image" : "summary";

	return (
		<Head>
			<title>{title}</title>
			{description ? <meta name="description" content={description} /> : null}
			<meta name="robots" content={robots} />
			{canonicalUrl ? <link rel="canonical" href={canonicalUrl} /> : null}
			<meta property="og:type" content={type} />
			<meta property="og:title" content={title} />
			{description ? <meta property="og:description" content={description} /> : null}
			{canonicalUrl ? <meta property="og:url" content={canonicalUrl} /> : null}
			<meta property="og:site_name" content={siteName} />
			{imageUrl ? <meta property="og:image" content={imageUrl} /> : null}
			<meta name="twitter:card" content={twitterCard} />
			<meta name="twitter:title" content={title} />
			{description ? <meta name="twitter:description" content={description} /> : null}
			{imageUrl ? <meta name="twitter:image" content={imageUrl} /> : null}
			{type === "article" && publishedTime ? (
				<meta property="article:published_time" content={publishedTime} />
			) : null}
			{type === "article" && modifiedTime ? (
				<meta property="article:modified_time" content={modifiedTime} />
			) : null}
			{structuredData.map((item, index) => (
				<script
					key={`structured-data-${index}`}
					type="application/ld+json"
					dangerouslySetInnerHTML={{ __html: JSON.stringify(item) }}
				/>
			))}
		</Head>
	);
}
