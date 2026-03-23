import * as beautify from "js-beautify";
import { common, createLowlight } from "lowlight";
import rehypeKatex from "rehype-katex";
import rehypeHighlight from "rehype-highlight";
import rehypeRaw from "rehype-raw";
import rehypeStringify from "rehype-stringify";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import sanitizeHtml, { type IOptions } from "sanitize-html";
import { unified } from "unified";
import { visit } from "unist-util-visit";

const LINK_REL_TOKENS = ["noopener", "noreferrer", "nofollow"];
const VIDEO_MARKER = "▶";
const AUDIO_MARKER = "🎧";
const BOOK_MARKER = "📚";
const DEFAULT_VIDEO_TITLE = "Video";
const DEFAULT_AUDIO_TITLE = "Audio";
const DEFAULT_BOOK_TITLE = "Book";
const DEFAULT_PDF_TITLE = "PDF";
const EMBED_IFRAME_HOSTNAMES = [
	"www.youtube.com",
	"youtube.com",
	"player.bilibili.com",
	"player.vimeo.com",
];
const VIDEO_EXTENSIONS = [
	".mp4",
	".webm",
	".mov",
	".m4v",
	".ogv",
	".ogg",
];
const AUDIO_EXTENSIONS = [
	".mp3",
	".wav",
	".m4a",
	".aac",
	".ogg",
	".flac",
	".opus",
];
const BOOK_EXTENSIONS = [".pdf", ".epub", ".mobi"];
const PDF_EXTENSIONS = [".pdf"];
const LANGUAGE_CLASS_PREFIX = "language-";
const CODE_BLOCK_FORMAT_MAX_LENGTH = 20000;
const CODE_BLOCK_DETECTION_SUBSET = [
	"typescript",
	"javascript",
	"json",
	"html",
	"xml",
	"css",
	"scss",
	"less",
	"bash",
	"shell",
	"python",
	"java",
	"go",
	"rust",
	"php",
	"ruby",
	"sql",
] as const;
const SCRIPT_BEAUTIFY_OPTIONS = {
	indent_size: 2,
	preserve_newlines: true,
	max_preserve_newlines: 2,
	space_in_empty_paren: false,
	end_with_newline: false,
} as const;
const MARKUP_BEAUTIFY_OPTIONS = {
	indent_size: 2,
	preserve_newlines: true,
	max_preserve_newlines: 2,
	end_with_newline: false,
	wrap_line_length: 0,
} as const;
const codeBlockLowlight = createLowlight(common);
const codeBlockFormatCache = new Map<string, { language: string; value: string }>();

type MediaEmbedType = "video" | "audio" | "book";
type MediaTargetType = "iframe" | "video" | "audio" | "pdf" | "link";

interface MediaEmbedResult {
	type: MediaEmbedType;
	title: string;
}

interface MediaTarget {
	type: MediaTargetType;
	src: string;
}

interface MarkdownRenderOptions {
	enableMediaEmbed?: boolean;
}

interface TreeNode {
	type?: string;
	tagName?: string;
	lang?: string | null;
	value?: string;
	alt?: string;
	url?: string;
	children?: TreeNode[];
	properties?: Record<string, unknown>;
}

const escapeHtml = (value: string): string =>
	(value || "").replace(/[&<>"']/g, (char) => {
		const map: Record<string, string> = {
			"&": "&amp;",
			"<": "&lt;",
			">": "&gt;",
			'"': "&quot;",
			"'": "&#39;",
		};
		return map[char] || char;
	});

const stripHtmlTags = (value: string): string =>
	(value || "").replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();

const normalizeCodeLanguage = (value?: string | null): string => {
	const normalized = (value || "").trim().toLowerCase();
	if (!normalized) return "";

	const aliasMap: Record<string, string> = {
		ts: "typescript",
		cts: "typescript",
		mts: "typescript",
		tsx: "typescript",
		javascriptreact: "javascript",
		jsx: "javascript",
		js: "javascript",
		mjs: "javascript",
		cjs: "javascript",
		node: "javascript",
		json5: "json",
		jsonc: "json",
		htm: "html",
		xhtml: "html",
		svg: "xml",
		yml: "yaml",
		sh: "bash",
		shell: "bash",
		zsh: "bash",
		console: "bash",
		md: "markdown",
		markdown: "markdown",
	};

	return aliasMap[normalized] || normalized;
};

const detectCodeLanguage = (value: string): string => {
	const source = (value || "").trim();
	if (!source) return "";
	try {
		const result = codeBlockLowlight.highlightAuto(source, {
			subset: [...CODE_BLOCK_DETECTION_SUBSET],
		});
		return normalizeCodeLanguage(result.data?.language);
	} catch {
		return "";
	}
};

const formatJavaScriptLikeCode = (value: string): string =>
	beautify.js(value, SCRIPT_BEAUTIFY_OPTIONS);

const formatCssLikeCode = (value: string): string =>
	beautify.css(value, {
		indent_size: 2,
		end_with_newline: false,
	});

const formatHtmlLikeCode = (value: string): string =>
	beautify.html(value, MARKUP_BEAUTIFY_OPTIONS);

const CODE_BLOCK_FORMATTERS: Record<string, (value: string) => string> = {
	javascript: formatJavaScriptLikeCode,
	typescript: formatJavaScriptLikeCode,
	json: formatJavaScriptLikeCode,
	css: formatCssLikeCode,
	scss: formatCssLikeCode,
	less: formatCssLikeCode,
	html: formatHtmlLikeCode,
	xml: formatHtmlLikeCode,
};

const formatCodeBlock = (
	value: string,
	explicitLanguage?: string | null,
): { language: string; value: string } => {
	const source = value || "";
	if (!source.trim() || source.length > CODE_BLOCK_FORMAT_MAX_LENGTH) {
		return {
			language: normalizeCodeLanguage(explicitLanguage),
			value: source,
		};
	}

	const normalizedExplicitLanguage = normalizeCodeLanguage(explicitLanguage);
	const language = normalizedExplicitLanguage || detectCodeLanguage(source);
	const cacheKey = `${language}\u0000${source}`;
	const cached = codeBlockFormatCache.get(cacheKey);
	if (cached) return cached;

	let nextValue = source;
	const formatter = CODE_BLOCK_FORMATTERS[language];
	try {
		if (formatter) {
			nextValue = formatter(source);
		}
	} catch {
		nextValue = source;
	}

	const result = { language, value: nextValue };
	codeBlockFormatCache.set(cacheKey, result);
	return result;
};

const normalizeMediaLabel = (text: string): MediaEmbedResult | null => {
	const plainText = stripHtmlTags(text);
	if (!plainText) return null;
	if (plainText.startsWith(VIDEO_MARKER)) {
		const title = plainText.slice(VIDEO_MARKER.length).trim() || DEFAULT_VIDEO_TITLE;
		return { type: "video", title };
	}
	if (plainText.startsWith(AUDIO_MARKER)) {
		const title = plainText.slice(AUDIO_MARKER.length).trim() || DEFAULT_AUDIO_TITLE;
		return { type: "audio", title };
	}
	if (plainText.startsWith(BOOK_MARKER)) {
		const title = plainText.slice(BOOK_MARKER.length).trim() || DEFAULT_BOOK_TITLE;
		return { type: "book", title };
	}
	return null;
};

const normalizeUrl = (value: string): string => (value || "").trim();

const getPathnameWithoutQuery = (url: string): string => {
	const trimmed = normalizeUrl(url);
	if (!trimmed) return "";
	try {
		if (trimmed.startsWith("/")) {
			const parsedRelative = new URL(trimmed, "https://example.com");
			return (parsedRelative.pathname || "").toLowerCase();
		}
		const parsed = new URL(trimmed);
		return (parsed.pathname || "").toLowerCase();
	} catch {
		return trimmed.split("?")[0].split("#")[0].toLowerCase();
	}
};

const hasAnyExtension = (url: string, extensions: string[]): boolean => {
	const pathname = getPathnameWithoutQuery(url);
	return extensions.some((ext) => pathname.endsWith(ext));
};

const parseYouTubeEmbed = (rawUrl: string): string | null => {
	try {
		const url = new URL(rawUrl);
		const host = url.hostname.toLowerCase();
		let videoId = "";
		if (host === "youtu.be") {
			videoId = url.pathname.split("/").filter(Boolean)[0] || "";
		} else if (host.endsWith("youtube.com")) {
			if (url.pathname.startsWith("/watch")) {
				videoId = url.searchParams.get("v") || "";
			} else if (url.pathname.startsWith("/embed/")) {
				videoId = url.pathname.replace("/embed/", "").split("/")[0] || "";
			} else if (url.pathname.startsWith("/shorts/")) {
				videoId = url.pathname.replace("/shorts/", "").split("/")[0] || "";
			}
		}
		if (!videoId) return null;
		return `https://www.youtube.com/embed/${videoId}`;
	} catch {
		return null;
	}
};

const parseBilibiliEmbed = (rawUrl: string): string | null => {
	try {
		const url = new URL(rawUrl);
		const host = url.hostname.toLowerCase();
		if (host === "player.bilibili.com") {
			url.protocol = "https:";
			return url.toString();
		}
		if (!host.endsWith("bilibili.com")) return null;
		const bvidMatch = url.pathname.match(/\/video\/(BV[0-9A-Za-z]+)/);
		if (bvidMatch?.[1]) {
			return `https://player.bilibili.com/player.html?bvid=${bvidMatch[1]}&high_quality=1&danmaku=0`;
		}
		const aidMatch = url.pathname.match(/\/video\/av(\d+)/i);
		if (aidMatch?.[1]) {
			return `https://player.bilibili.com/player.html?aid=${aidMatch[1]}&high_quality=1&danmaku=0`;
		}
		return null;
	} catch {
		return null;
	}
};

const parseVimeoEmbed = (rawUrl: string): string | null => {
	try {
		const url = new URL(rawUrl);
		const host = url.hostname.toLowerCase();
		if (host === "player.vimeo.com") {
			url.protocol = "https:";
			return url.toString();
		}
		if (!host.endsWith("vimeo.com")) return null;
		const idMatch = url.pathname.match(/\/(\d+)/);
		if (!idMatch?.[1]) return null;
		return `https://player.vimeo.com/video/${idMatch[1]}`;
	} catch {
		return null;
	}
};

const resolveMediaTarget = (
	mediaType: MediaEmbedType,
	rawUrl: string,
): MediaTarget => {
	const url = normalizeUrl(rawUrl);
	if (!url) return { type: "link", src: "" };

	if (mediaType === "video") {
		const iframeSrc =
			parseYouTubeEmbed(url) || parseBilibiliEmbed(url) || parseVimeoEmbed(url);
		if (iframeSrc) {
			return { type: "iframe", src: iframeSrc };
		}
		if (hasAnyExtension(url, VIDEO_EXTENSIONS)) {
			return { type: "video", src: url };
		}
		return { type: "link", src: url };
	}

	if (hasAnyExtension(url, AUDIO_EXTENSIONS)) {
		return { type: "audio", src: url };
	}
	if (mediaType === "book") {
		if (hasAnyExtension(url, PDF_EXTENSIONS)) {
			return { type: "pdf", src: url };
		}
		return { type: "link", src: url };
	}
	return { type: "link", src: url };
};

const inferStandaloneBookEmbed = (
	rawUrl: string,
	linkText: string,
): MediaEmbedResult | null => {
	const url = normalizeUrl(rawUrl);
	if (!url || !hasAnyExtension(url, BOOK_EXTENSIONS)) return null;
	const text = stripHtmlTags(linkText);
	if (text && text !== url) {
		return { type: "book", title: text };
	}
	const fallbackTitle = hasAnyExtension(url, PDF_EXTENSIONS)
		? DEFAULT_PDF_TITLE
		: DEFAULT_BOOK_TITLE;
	return { type: "book", title: fallbackTitle };
};

const renderMediaEmbed = (
	mediaType: MediaEmbedType,
	title: string,
	rawUrl: string,
): string => {
	const target = resolveMediaTarget(mediaType, rawUrl);
	const safeTitle = escapeHtml(title);
	const safeHref = escapeHtml(normalizeUrl(rawUrl));
	const safeSrc = escapeHtml(target.src);
	const marker =
		mediaType === "video"
			? VIDEO_MARKER
			: mediaType === "audio"
				? AUDIO_MARKER
				: BOOK_MARKER;
	const label = `${marker} ${title}`;
	const safeLabel = escapeHtml(label);

	if (!safeHref) return "";

	if (target.type === "iframe") {
		return `<figure class="media-embed media-embed--video"><div class="media-embed__frame"><iframe src="${safeSrc}" title="${safeTitle}" loading="lazy" frameborder="0" referrerpolicy="strict-origin-when-cross-origin" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe></div><figcaption class="media-embed__caption"><a href="${safeHref}" target="_blank" rel="noopener noreferrer nofollow">${safeLabel}</a></figcaption></figure>`;
	}

	if (target.type === "video") {
		return `<figure class="media-embed media-embed--video"><video class="media-embed__player" controls preload="metadata" src="${safeSrc}"></video><figcaption class="media-embed__caption"><a href="${safeHref}" target="_blank" rel="noopener noreferrer nofollow">${safeLabel}</a></figcaption></figure>`;
	}

	if (target.type === "audio") {
		return `<figure class="media-embed media-embed--audio"><audio class="media-embed__player" controls preload="metadata" src="${safeSrc}"></audio><figcaption class="media-embed__caption"><a href="${safeHref}" target="_blank" rel="noopener noreferrer nofollow">${safeLabel}</a></figcaption></figure>`;
	}

	if (target.type === "pdf") {
		return `<figure class="media-embed media-embed--book"><div class="media-embed__book-frame"><embed class="media-embed__book-pdf" src="${safeSrc}" type="application/pdf"></embed></div><figcaption class="media-embed__caption"><a href="${safeHref}" target="_blank" rel="noopener noreferrer nofollow">${safeLabel}</a></figcaption></figure>`;
	}

	if (mediaType === "book") {
		return `<figure class="media-embed media-embed--book media-embed--book-link"><div class="media-embed__book-note">${safeTitle}</div><figcaption class="media-embed__caption"><a href="${safeHref}" target="_blank" rel="noopener noreferrer nofollow">${safeLabel}</a></figcaption></figure>`;
	}

	return `<figure class="media-embed media-embed--link"><figcaption class="media-embed__caption"><a href="${safeHref}" target="_blank" rel="noopener noreferrer nofollow">${safeLabel}</a></figcaption></figure>`;
};

const getNodeText = (node: TreeNode | undefined): string => {
	if (!node) return "";
	if (typeof node.value === "string") return node.value;
	if (typeof node.alt === "string") return node.alt;
	if (!Array.isArray(node.children)) return "";
	return node.children.map((child) => getNodeText(child)).join("");
};

const getNodeClassNames = (node: TreeNode | undefined): string[] => {
	if (!node?.properties) return [];
	const className = node.properties.className;
	if (Array.isArray(className)) {
		return className.filter(
			(value): value is string => typeof value === "string" && value.trim().length > 0,
		);
	}
	if (typeof className === "string") {
		return className
			.split(/\s+/)
			.map((value) => value.trim())
			.filter(Boolean);
	}
	return [];
};

const setNodeClassNames = (node: TreeNode, classNames: string[]): void => {
	node.properties = {
		...(node.properties || {}),
		className: classNames,
	};
};

const setNodeProperty = (
	node: TreeNode,
	name: string,
	value: string,
): void => {
	node.properties = {
		...(node.properties || {}),
		[name]: value,
	};
};

const getCodeBlockLanguage = (node: TreeNode | undefined): string => {
	const languageClass = getNodeClassNames(node).find((className) =>
		className.startsWith(LANGUAGE_CLASS_PREFIX),
	);
	if (!languageClass) return "";
	return languageClass.slice(LANGUAGE_CLASS_PREFIX.length).trim().toLowerCase();
};

const isStandaloneParagraphLink = (
	node: TreeNode,
	index: number | undefined,
	parent: TreeNode | undefined,
): boolean => {
	if (typeof index !== "number") return false;
	if (!parent || parent.type !== "paragraph") return false;
	if (!Array.isArray(parent.children)) return false;
	const meaningfulChildren = parent.children.filter((child) => {
		if (child.type !== "text") return true;
		if (typeof child.value !== "string") return true;
		return child.value.trim().length > 0;
	});
	return meaningfulChildren.length === 1 && meaningfulChildren[0] === node;
};

const remarkMediaEmbed = (enableMediaEmbed: boolean) => {
	return () => {
		return (tree: TreeNode) => {
			if (!enableMediaEmbed) return;
			visit(tree as any, "link", (node: any, index: number | undefined, parent: any) => {
				if (typeof node.url !== "string") return;
				if (typeof index !== "number") return;
				if (!isStandaloneParagraphLink(node, index, parent)) return;
				const linkText = getNodeText(node);
				const media =
					normalizeMediaLabel(linkText) ||
					inferStandaloneBookEmbed(node.url, linkText);
				if (!media) return;
				const html = renderMediaEmbed(media.type, media.title, node.url);
				if (!html) return;
				if (!Array.isArray(parent.children)) return;
				parent.children[index] = { type: "html", value: html };
			});
		};
	};
};

const remarkFormatCodeBlocks = () => {
	return (tree: TreeNode) => {
		visit(tree as any, "code", (node: any) => {
			if (typeof node?.value !== "string") return;
			const result = formatCodeBlock(node.value, node.lang);
			if (result.language) {
				node.lang = result.language;
			}
			node.value = result.value;
		});
	};
};

const rehypeCodeBlockMeta = () => {
	return (tree: TreeNode) => {
		visit(tree as any, "element", (node: any) => {
			if (node.tagName !== "pre" || !Array.isArray(node.children)) return;
			const codeNode = node.children.find(
				(child: any) => child?.type === "element" && child.tagName === "code",
			) as TreeNode | undefined;
			if (!codeNode) return;

			const language = getCodeBlockLanguage(codeNode) || "text";
			setNodeProperty(node, "data-language", language);
			setNodeProperty(codeNode, "data-language", language);

			const preClassNames = getNodeClassNames(node);
			if (!preClassNames.includes("code-block")) {
				preClassNames.push("code-block");
			}
			setNodeClassNames(node, preClassNames);
		});
	};
};

const createMarkdownProcessor = (enableMediaEmbed: boolean) =>
	unified()
		.use(remarkParse)
		.use(remarkGfm)
		.use(remarkMath)
		.use(remarkMediaEmbed(enableMediaEmbed))
		.use(remarkFormatCodeBlocks)
		.use(remarkRehype, { allowDangerousHtml: true })
		.use(rehypeRaw)
		.use(rehypeKatex, {
			output: "mathml",
		})
		.use(rehypeHighlight, {
			detect: true,
			ignoreMissing: true,
		})
		.use(rehypeCodeBlockMeta)
		.use(rehypeStringify);

const markdownProcessor = createMarkdownProcessor(false);
const markdownProcessorWithEmbed = createMarkdownProcessor(true);

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
		"figure",
		"figcaption",
		"div",
		"span",
		"video",
		"audio",
		"source",
		"embed",
		"iframe",
		"table",
		"thead",
		"tbody",
		"tr",
		"th",
		"td",
		"mark",
		"math",
		"semantics",
		"annotation",
		"mrow",
		"mi",
		"mn",
		"mo",
		"mtext",
		"msub",
		"msup",
		"msubsup",
		"mfrac",
		"msqrt",
		"mroot",
		"munder",
		"mover",
		"munderover",
		"mtable",
		"mtr",
		"mtd",
		"mstyle",
		"mspace",
		"mpadded",
		"mphantom",
		"menclose",
	],
	allowedAttributes: {
		a: ["href", "title", "target", "rel"],
		img: ["src", "alt", "title", "width", "height", "loading", "decoding"],
		pre: ["data-language"],
		code: ["data-language"],
		video: ["src", "controls", "preload", "poster", "class"],
		audio: ["src", "controls", "preload", "class"],
		source: ["src", "type"],
		embed: ["src", "type", "class"],
		iframe: [
			"src",
			"title",
			"loading",
			"allow",
			"allowfullscreen",
			"frameborder",
			"referrerpolicy",
		],
		math: ["xmlns", "display"],
		annotation: ["encoding"],
		mo: ["stretchy", "fence", "form", "separator", "lspace", "rspace"],
		mstyle: [
			"displaystyle",
			"scriptlevel",
			"mathsize",
			"mathvariant",
			"mathcolor",
			"mathbackground",
		],
		mtable: ["columnalign", "rowalign", "columnspacing", "rowspacing"],
		mtd: ["rowspan", "columnspan", "columnalign", "rowalign"],
		mspace: ["width", "height", "depth", "linebreak"],
		mpadded: ["width", "height", "depth", "lspace", "voffset"],
		mark: ["data-annotation-id"],
		"*": ["class"],
	},
	allowedSchemes: ["http", "https", "mailto"],
	allowedSchemesByTag: {
		iframe: ["https"],
	},
	allowedSchemesAppliedToAttributes: ["href", "src"],
	allowedIframeHostnames: EMBED_IFRAME_HOSTNAMES,
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

export function renderSafeMarkdown(
	markdown: string,
	options: MarkdownRenderOptions = {},
): string {
	const processor = options.enableMediaEmbed
		? markdownProcessorWithEmbed
		: markdownProcessor;
	const file = processor.processSync(markdown || "");
	return sanitizeRichHtml(String(file.value || ""));
}
