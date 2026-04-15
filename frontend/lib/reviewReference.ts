export interface ReviewReferenceCommandMatch {
	command: "/ref" | "/reference";
	start: number;
	end: number;
	lineStart: number;
	lineEnd: number;
}

interface ReviewContentReferenceInput {
	title: string;
	slug: string;
	excerpt: string;
}

const REVIEW_REFERENCE_COMMANDS = new Set(["/ref", "/reference"]);
const FENCED_CODE_BLOCK_PATTERN = /```[\s\S]*?```/g;
const IMAGE_ONLY_PATTERN = /^!\[[^\]]*\]\([^)]+\)$/;
const URL_ONLY_PATTERN = /^https?:\/\/\S+$/i;
const LIST_PREFIX_PATTERN = /^\s*[-*+]\s+/gm;
const HEADING_PREFIX_PATTERN = /^\s{0,3}#{1,6}\s+/gm;
const BLOCKQUOTE_PREFIX_PATTERN = /^\s{0,3}>\s?/gm;

function getLineRange(markdown: string, cursor: number): { lineStart: number; lineEnd: number } {
	const safeCursor = Math.max(0, Math.min(cursor, markdown.length));
	const previousBreak = markdown.lastIndexOf("\n", Math.max(0, safeCursor - 1));
	const nextBreak = markdown.indexOf("\n", safeCursor);
	return {
		lineStart: previousBreak === -1 ? 0 : previousBreak + 1,
		lineEnd: nextBreak === -1 ? markdown.length : nextBreak,
	};
}

export function detectReviewReferenceCommand(
	markdown: string,
	cursor: number,
): ReviewReferenceCommandMatch | null {
	const { lineStart, lineEnd } = getLineRange(markdown, cursor);
	const line = markdown.slice(lineStart, lineEnd).trim();
	if (!REVIEW_REFERENCE_COMMANDS.has(line)) {
		return null;
	}
	return {
		command: line as "/ref" | "/reference",
		start: lineStart,
		end: lineEnd,
		lineStart,
		lineEnd,
	};
}

export function resolveReviewReferenceSource(
	contentTrans?: string | null,
	contentMd?: string | null,
): string {
	return (contentTrans || "").trim() || (contentMd || "").trim();
}

function normalizeReferenceParagraph(paragraph: string): string {
	return paragraph
		.replace(HEADING_PREFIX_PATTERN, "")
		.replace(BLOCKQUOTE_PREFIX_PATTERN, "")
		.replace(LIST_PREFIX_PATTERN, "")
		.trim();
}

function isSkippableParagraph(paragraph: string): boolean {
	if (!paragraph) return true;
	if (IMAGE_ONLY_PATTERN.test(paragraph)) return true;
	if (URL_ONLY_PATTERN.test(paragraph)) return true;
	return paragraph.length < 8;
}

export function splitReviewReferenceParagraphs(markdown: string): string[] {
	return (markdown || "")
		.replace(FENCED_CODE_BLOCK_PATTERN, "\n")
		.split(/\n\s*\n/)
		.map((item) => normalizeReferenceParagraph(item))
		.filter((item) => !isSkippableParagraph(item));
}

export function buildReviewArticlePlaceholder(slug: string): string {
	return `{{${(slug || "").trim()}}}`;
}

export function normalizeReviewReferenceSelectionText(text: string): string {
	return (text || "")
		.replace(/\r\n?/g, "\n")
		.split("\n")
		.map((line) => line.replace(/[ \t]+/g, " ").trim())
		.join("\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

export function buildReviewContentReferenceMarkdown(
	input: ReviewContentReferenceInput,
): string {
	const excerpt = normalizeReviewReferenceSelectionText(input.excerpt);
	const quoted = excerpt
		.split("\n")
		.map((line) => (line ? `> ${line}` : ">"))
		.join("\n");
	return `${quoted}\n\n—— [${input.title}](/article/${input.slug})`;
}

export function formatReviewReferenceInsertion(
	markdown: string,
	start: number,
	end: number,
	insertedMarkdown: string,
): string {
	const before = markdown.slice(0, start);
	const after = markdown.slice(end);
	const trimmedInserted = insertedMarkdown.trim();
	const leading =
		before.length === 0 ? "" : before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n";
	const trailing =
		after.length === 0 ? "" : after.startsWith("\n\n") ? "" : after.startsWith("\n") ? "\n" : "\n\n";
	return `${leading}${trimmedInserted}${trailing}`;
}

export function replaceReviewReferenceRange(
	markdown: string,
	range: ReviewReferenceCommandMatch | null,
	insertedMarkdown: string,
): string {
	if (!range) return markdown;
	return `${markdown.slice(0, range.lineStart)}${insertedMarkdown}${markdown.slice(range.lineEnd)}`;
}
