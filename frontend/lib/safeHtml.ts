import { marked } from "marked";
import sanitizeHtml, { type IOptions } from "sanitize-html";

const LINK_REL_TOKENS = ["noopener", "noreferrer", "nofollow"];

const SANITIZE_OPTIONS: IOptions = {
	allowedTags: [
		"p",
		"br",
		"strong",
		"em",
		"u",
		"del",
		"blockquote",
		"code",
		"pre",
		"ul",
		"ol",
		"li",
		"h1",
		"h2",
		"h3",
		"h4",
		"h5",
		"h6",
		"hr",
		"a",
		"img",
		"table",
		"thead",
		"tbody",
		"tr",
		"th",
		"td",
		"mark",
	],
	allowedAttributes: {
		a: ["href", "title", "target", "rel"],
		img: ["src", "alt", "title", "width", "height", "loading", "decoding"],
		"*": ["class"],
	},
	allowedSchemes: ["http", "https", "mailto"],
	allowProtocolRelative: false,
	transformTags: {
		a: (tagName, attribs) => {
			const nextAttribs: Record<string, string> = { ...attribs };
			if (nextAttribs.target !== "_blank") {
				delete nextAttribs.target;
				delete nextAttribs.rel;
				return { tagName, attribs: nextAttribs };
			}

			const relSet = new Set(
				(nextAttribs.rel || "")
					.split(/\s+/)
					.map((item) => item.trim())
					.filter(Boolean),
			);
			for (const token of LINK_REL_TOKENS) {
				relSet.add(token);
			}
			nextAttribs.rel = Array.from(relSet).join(" ");
			return { tagName, attribs: nextAttribs };
		},
	},
};

export function sanitizeRichHtml(html: string): string {
	return sanitizeHtml(html || "", SANITIZE_OPTIONS);
}

export function renderSafeMarkdown(markdown: string): string {
	const rendered = marked.parse(markdown || "");
	const html = typeof rendered === "string" ? rendered : "";
	return sanitizeRichHtml(html);
}
