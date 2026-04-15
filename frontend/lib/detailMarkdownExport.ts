export type DetailExportKind = "article" | "review";

interface ArticleDetailExportInput {
	title?: string | null;
	topImage?: string | null;
	contentTrans?: string | null;
	contentMd?: string | null;
}

interface ReviewDetailExportInput {
	title?: string | null;
	topImage?: string | null;
	renderedMarkdown?: string | null;
	markdownContent?: string | null;
}

const normalizeBlock = (value?: string | null): string => (value || "").trim();

const buildMarkdownDocument = (input: {
	title?: string | null;
	topImage?: string | null;
	body?: string | null;
}): string => {
	const sections = [`# ${normalizeBlock(input.title)}`];
	const topImage = normalizeBlock(input.topImage);
	const body = normalizeBlock(input.body);

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
		title: input.title,
		topImage: input.topImage,
		body: normalizeBlock(input.contentTrans) || normalizeBlock(input.contentMd),
	});
}

export function resolveReviewDetailExportMarkdown(
	input: ReviewDetailExportInput,
): string {
	return buildMarkdownDocument({
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
