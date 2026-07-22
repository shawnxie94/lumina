// Browser full build: Defuddle + first-party HTML->Markdown (Clipper-aligned).
// Default `defuddle` entry omits markdown.
import DefuddleFull from "defuddle/full";

/** Keep in sync with extension/package.json, backend/package.json, scripts/defuddle-version.txt */
export const DEFUDDLE_ENGINE_VERSION = "0.19.1";

type DefuddleParseResult = {
	content?: string;
	contentMarkdown?: string;
	title?: string;
	author?: string;
	published?: string;
	image?: string;
	description?: string;
	wordCount?: number;
	schemaOrgData?: unknown;
	parseTime?: number;
};

type DefuddleInstance = { parse: () => DefuddleParseResult };
type DefuddleCtor = new (
	doc: Document,
	options?: { url?: string;  },
) => DefuddleInstance;

// defuddle/full is CJS; Vite may expose either default export or module namespace.
const mod = DefuddleFull as unknown as DefuddleCtor & {
	default?: DefuddleCtor;
	createMarkdownContent?: (content: string, url: string) => string;
};

const Defuddle: DefuddleCtor = mod.default ?? mod;
const createMarkdownContent =
	mod.createMarkdownContent ??
	(mod as unknown as { default?: { createMarkdownContent?: typeof mod.createMarkdownContent } })
		.default?.createMarkdownContent;

export type DefuddleEngineResult = {
	contentHtml: string;
	contentMarkdown: string;
	title: string;
	author: string;
	published: string;
	image: string;
	description: string;
	wordCount: number;
	schemaOrgData?: unknown;
	parseTime: number;
	engine: "defuddle";
	engineVersion: string;
};

/**
 * Parse the live document with Defuddle.
 * After any post-processing of HTML, re-run {@link htmlToDefuddleMarkdown}.
 */
export function extractWithDefuddle(
	doc: Document = document,
	url: string = doc.URL || window.location.href,
): DefuddleEngineResult {
	// HTML only here; content_md is built from the final HTML after post-processing.
	const parsed = new Defuddle(doc, { url }).parse();
	const contentHtml = parsed.content || "";
	const contentMarkdown = htmlToDefuddleMarkdown(contentHtml, url);

	return {
		contentHtml,
		contentMarkdown,
		title: parsed.title || "",
		author: parsed.author || "",
		published: parsed.published || "",
		image: parsed.image || "",
		description: parsed.description || "",
		wordCount: parsed.wordCount || 0,
		schemaOrgData: parsed.schemaOrgData,
		parseTime: parsed.parseTime || 0,
		engine: "defuddle",
		engineVersion: DEFUDDLE_ENGINE_VERSION,
	};
}

/** Defuddle first-party markdown for a final HTML snapshot. */
export function htmlToDefuddleMarkdown(html: string, url: string): string {
	const source = (html || "").trim();
	if (!source) return "";
	if (typeof createMarkdownContent !== "function") {
		console.warn("defuddle createMarkdownContent unavailable");
		return "";
	}
	try {
		return (createMarkdownContent(source, url || "about:blank") || "").trim();
	} catch (error) {
		console.warn("defuddle markdown conversion failed:", error);
		return "";
	}
}
