import rehypeKatex from "rehype-katex";
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
const DEFAULT_VIDEO_TITLE = "Video";
const DEFAULT_AUDIO_TITLE = "Audio";
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

type MediaEmbedType = "video" | "audio";
type MediaTargetType = "iframe" | "video" | "audio" | "link";

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
	value?: string;
	alt?: string;
	url?: string;
	children?: TreeNode[];
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
	return { type: "link", src: url };
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
	const marker = mediaType === "video" ? VIDEO_MARKER : AUDIO_MARKER;
	const label = `${marker} ${title}`;
	const safeLabel = escapeHtml(label);

	if (!safeHref) return "";

	if (target.type === "iframe") {
		return `<figure class="media-embed media-embed--video"><div class="media-embed__frame"><iframe src="${safeSrc}" title="${safeTitle}" loading="lazy" frameborder="0" referrerpolicy="no-referrer" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe></div><figcaption class="media-embed__caption"><a href="${safeHref}" target="_blank" rel="noopener noreferrer nofollow">${safeLabel}</a></figcaption></figure>`;
	}

	if (target.type === "video") {
		return `<figure class="media-embed media-embed--video"><video class="media-embed__player" controls preload="metadata" src="${safeSrc}"></video><figcaption class="media-embed__caption"><a href="${safeHref}" target="_blank" rel="noopener noreferrer nofollow">${safeLabel}</a></figcaption></figure>`;
	}

	if (target.type === "audio") {
		return `<figure class="media-embed media-embed--audio"><audio class="media-embed__player" controls preload="metadata" src="${safeSrc}"></audio><figcaption class="media-embed__caption"><a href="${safeHref}" target="_blank" rel="noopener noreferrer nofollow">${safeLabel}</a></figcaption></figure>`;
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

const remarkMediaEmbed = (enableMediaEmbed: boolean) => {
	return () => {
		return (tree: TreeNode) => {
			if (!enableMediaEmbed) return;
			visit(tree as any, "link", (node: any, index: number | undefined, parent: any) => {
				if (typeof node.url !== "string") return;
				const media = normalizeMediaLabel(getNodeText(node));
				if (!media) return;
				const html = renderMediaEmbed(media.type, media.title, node.url);
				if (!html) return;
				if (typeof index !== "number") return;
				if (!Array.isArray(parent.children)) return;
				parent.children[index] = { type: "html", value: html };
			});
		};
	};
};

const createMarkdownProcessor = (enableMediaEmbed: boolean) =>
	unified()
		.use(remarkParse)
		.use(remarkGfm)
		.use(remarkMath)
		.use(remarkMediaEmbed(enableMediaEmbed))
		.use(remarkRehype, { allowDangerousHtml: true })
		.use(rehypeRaw)
		.use(rehypeKatex, {
			output: "mathml",
		})
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
		video: ["src", "controls", "preload", "poster", "class"],
		audio: ["src", "controls", "preload", "class"],
		source: ["src", "type"],
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
