import { buildAbsoluteUrl } from "./seo";

export type DetailExportKind = "article" | "review";

interface ArticleDetailExportInput {
	origin?: string | null;
	title?: string | null;
	topImage?: string | null;
	contentTrans?: string | null;
	contentMd?: string | null;
}

interface ReviewDetailExportInput {
	origin?: string | null;
	title?: string | null;
	topImage?: string | null;
	renderedMarkdown?: string | null;
	markdownContent?: string | null;
}

const normalizeBlock = (value?: string | null): string => (value || "").trim();

const resolveExportAssetUrl = (origin: string, url?: string | null): string => {
	const normalized = normalizeBlock(url);
	if (!normalized) return "";
	if (
		/^(?:https?:)?\/\//i.test(normalized) ||
		normalized.startsWith("data:") ||
		normalized.startsWith("blob:")
	) {
		return normalized;
	}
	if (normalized.startsWith("/media/")) {
		return buildAbsoluteUrl(origin, `/backend${normalized}`);
	}
	if (normalized.startsWith("/backend/")) {
		return buildAbsoluteUrl(origin, normalized);
	}
	if (normalized.startsWith("/")) {
		return buildAbsoluteUrl(origin, normalized);
	}
	return normalized;
};

const absolutizeMarkdownMediaUrls = (origin: string, markdown: string): string =>
	(markdown || "")
		.replace(/!\[([^\]]*)\]\((\S+?)(\s+"[^"]*")?\)/g, (_match, alt, url, titlePart = "") => {
			const resolved = resolveExportAssetUrl(origin, url);
			return `![${alt}](${resolved}${titlePart})`;
		})
		.replace(
			/<(img|video|audio|source|embed|iframe)\b([^>]*?)\ssrc=(["'])([^"']+)\3([^>]*)>/gi,
			(_match, tagName, beforeSrc, quote, src, afterSrc) => {
				const resolved = resolveExportAssetUrl(origin, src);
				return `<${tagName}${beforeSrc} src=${quote}${resolved}${quote}${afterSrc}>`;
			},
		);

const buildMarkdownDocument = (input: {
	origin?: string | null;
	title?: string | null;
	topImage?: string | null;
	body?: string | null;
}): string => {
	const sections = [`# ${normalizeBlock(input.title)}`];
	const origin = normalizeBlock(input.origin);
	const topImage = origin
		? resolveExportAssetUrl(origin, input.topImage)
		: normalizeBlock(input.topImage);
	const bodyRaw = normalizeBlock(input.body);
	const body = origin ? absolutizeMarkdownMediaUrls(origin, bodyRaw) : bodyRaw;

	if (topImage) {
		sections.push(`![](${topImage})`);
	}

	if (body) {
		sections.push(body);
	}

	return sections.join("\n\n").trim();
};

export function resolveArticleDetailExportMarkdown(
	input: ArticleDetailExportInput,
): string {
	return buildMarkdownDocument({
		origin: input.origin,
		title: input.title,
		topImage: input.topImage,
		body: normalizeBlock(input.contentTrans) || normalizeBlock(input.contentMd),
	});
}

export function resolveReviewDetailExportMarkdown(
	input: ReviewDetailExportInput,
): string {
	return buildMarkdownDocument({
		origin: input.origin,
		title: input.title,
		topImage: input.topImage,
		body:
			normalizeBlock(input.renderedMarkdown) ||
			normalizeBlock(input.markdownContent),
	});
}

export function resolveDetailExportFilename(
	kind: DetailExportKind,
	slug?: string | null,
): string {
	const normalizedSlug = (slug || "")
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9-_]+/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-|-$/g, "");

	return normalizedSlug ? `${kind}-${normalizedSlug}.md` : `${kind}-export.md`;
}

export function downloadMarkdownFile(filename: string, content: string): void {
	const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
	const url = URL.createObjectURL(blob);
	const link = document.createElement("a");
	link.href = url;
	link.download = filename;
	link.click();
	URL.revokeObjectURL(url);
}
