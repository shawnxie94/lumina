import { parseDate } from "../utils/dateParser";
import {
	DEFUDDLE_ENGINE_VERSION,
	extractWithDefuddle,
	htmlToDefuddleMarkdown,
} from "../utils/defuddleExtract";
import { logError } from "../utils/errorLogger";
import { flattenShadowDom } from "../utils/flattenShadowDom";

let cachedResult: { url: string; data: ExtractedArticle } | null = null;
let lastContextLinkHref: string | null = null;

const LAZY_IMAGE_ATTRS = [
	"data-src",
	"data-lazy-src",
	"data-original",
	"data-lazy",
	"data-url",
	"data-croporisrc",
	"data-actualsrc",
	"data-echo",
	"data-lazyload",
	"data-hi-res-src",
	"data-zoom-src",
	"data-full-src",
];
const FORMULA_SIGNAL_SELECTOR = [
	"math",
	"mjx-container",
	".katex",
	".MathJax",
	"annotation[encoding='application/x-tex']",
	"script[type*='math/tex']",
	"img[alt*='\\\\']",
	"img[class*='math']",
	"img[class*='latex']",
	"[data-formula]",
].join(",");
const X_MEDIA_HOSTS = new Set([
	"x.com",
	"www.x.com",
	"twitter.com",
	"www.twitter.com",
]);
const TWITTER_IMAGE_CDN_HOST = "pbs.twimg.com";
const xMediaResolveCache = new Map<string, string | null>();

function setXMediaResolveCache(key: string, value: string | null): void {
	xMediaResolveCache.set(key, value);
}

export default defineContentScript({
	matches: ["<all_urls>"],
	runAt: "document_idle",
	main() {
		document.addEventListener(
			"contextmenu",
			(event) => {
				lastContextLinkHref = extractContextLinkHref(event);
			},
			true,
		);

		chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
			if (message.type === "PING") {
				sendResponse({ pong: true });
				return false;
			}
			if (message.type === "CHECK_X_ARTICLE") {
				sendResponse(checkXArticleRedirect());
				return false;
			}
			if (message.type === "CHECK_SELECTION") {
				const selection = window.getSelection();
				const hasSelection = Boolean(selection && selection.toString().trim().length > 0);
				sendResponse({ hasSelection });
				return false;
			}
			if (message.type === "GET_LAST_CONTEXT_LINK") {
				sendResponse({
					url: lastContextLinkHref || "",
				});
				return false;
			}
			if (message.type === "EXTRACT_CAPTURE") {
				const mode = normalizeCaptureMode(message.mode);
				const forceRefresh = message.forceRefresh === true;
				extractCapture(mode, forceRefresh)
					.then((result) => sendResponse(result))
					.catch((error) => {
						logError(
							"content",
							error instanceof Error ? error : new Error(String(error)),
							{
								action: "extractCapture",
								mode,
								url: window.location.href,
							},
						);
						sendResponse(emptyCapturePayload());
					});
				return true;
			}
			return false;
		});
	},
});

function extractContextLinkHref(event: MouseEvent): string | null {
	const directTarget =
		event.target instanceof Element
			? (event.target.closest("a[href]") as HTMLAnchorElement | null)
			: null;
	if (directTarget?.href) return directTarget.href;

	const path = typeof event.composedPath === "function" ? event.composedPath() : [];
	for (const node of path) {
		if (!(node instanceof Element)) continue;
		const anchor = node.closest("a[href]") as HTMLAnchorElement | null;
		if (anchor?.href) return anchor.href;
	}
	return null;
}

function checkXArticleRedirect(): {
	shouldRedirect: boolean;
	articleUrl?: string;
} {
	const url = window.location.href;
	const isTwitter = url.includes("twitter.com") || url.includes("x.com");

	if (!isTwitter) {
		return { shouldRedirect: false };
	}

	if (url.includes("/article/")) {
		return { shouldRedirect: false };
	}

	const statusMatch = url.match(
		/(?:twitter\.com|x\.com)\/([^/]+)\/status\/(\d+)/,
	);
	if (!statusMatch) {
		return { shouldRedirect: false };
	}

	const hasLongContent =
		document.querySelector('main h2, main [role="heading"][aria-level="2"]') !==
		null;
	const hasArticleLink =
		document.querySelector('a[href*="/article/"]') !== null;

	if (hasLongContent || hasArticleLink) {
		const [, username, statusId] = statusMatch;
		const articleUrl = `https://x.com/${username}/article/${statusId}`;
		return { shouldRedirect: true, articleUrl };
	}

	return { shouldRedirect: false };
}

type CaptureMode = "auto" | "selection" | "article";

interface ExtractDebug {
	strategy_final: "selection" | "defuddle" | "fallback";
	retries: Array<{ strategy: string; reason: string }>;
	parse_time_ms?: number;
	engine_version?: string;
	capture_mode?: CaptureMode;
}

interface ExtractedArticle {
	title: string;
	content_html: string;
	/** Built in content script (has DOM). Do not re-convert in service worker. */
	content_md?: string;
	source_url: string;
	top_image: string | null;
	author: string;
	published_at: string;
	source_domain: string;
	excerpt: string;
	isSelection?: boolean;
	quality?: ContentQuality;
	content_structured?: StructuredContent;
	extract_debug?: ExtractDebug;
}

interface ContentQuality {
	score: number;
	wordCount: number;
	hasImages: boolean;
	hasCode: boolean;
	warnings: string[];
}

interface StructuredContent {
	schema: "lumina.dom.v1";
	blocks: StructuredBlock[];
}

interface StructuredBlock {
	type:
		| "heading"
		| "paragraph"
		| "list"
		| "image"
		| "code"
		| "quote"
		| "table"
		| "divider";
	text?: string;
	level?: number;
	items?: string[];
	src?: string;
	alt?: string;
	html?: string;
	code?: string;
	language?: string;
}

interface JsonLdArticle {
	"@type"?: string;
	headline?: string;
	name?: string;
	author?: { name?: string } | string;
	datePublished?: string;
	image?: { url?: string } | string;
	description?: string;
}

function countImgTags(html: string): number {
	return html.match(/<img\b[^>]*>/gi)?.length || 0;
}

function countFormulaSignals(rootOrHtml: ParentNode | string): number {
	try {
		if (typeof rootOrHtml === "string") {
			if (!rootOrHtml) return 0;
			const doc = new DOMParser().parseFromString(rootOrHtml, "text/html");
			return doc.querySelectorAll(FORMULA_SIGNAL_SELECTOR).length;
		}
		return rootOrHtml.querySelectorAll(FORMULA_SIGNAL_SELECTOR).length;
	} catch {
		return 0;
	}
}

function textLen(html: string): number {
	return (html || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().length;
}

/**
 * Soft pick between Defuddle HTML and heuristic fallback.
 * Only switches when Defuddle is empty/short, lost images, or lost formulas.
 */
function pickContentHtml(
	engineHtml: string,
	fallbackHtml: string,
	sourceFormulaCount: number,
): { html: string; strategy: ExtractDebug["strategy_final"]; retries: ExtractDebug["retries"] } {
	const retries: ExtractDebug["retries"] = [];
	let html = engineHtml || "";
	let strategy: ExtractDebug["strategy_final"] = "defuddle";

	const useFallback = (reason: string) => {
		retries.push({ strategy: "fallback", reason });
		html = fallbackHtml;
		strategy = "fallback";
	};

	if (!html.trim()) {
		useFallback("empty_content");
		return { html, strategy, retries };
	}

	if (countImgTags(html) === 0 && countImgTags(fallbackHtml) > 0) {
		useFallback("empty_images");
	} else if (sourceFormulaCount > 0) {
		const engineF = countFormulaSignals(html);
		const fallF = countFormulaSignals(fallbackHtml);
		if (fallF > 0 && (engineF === 0 || fallF > engineF)) {
			const engineT = textLen(html);
			const fallT = textLen(fallbackHtml);
			if (fallT >= Math.max(120, Math.floor(engineT * 0.5))) {
				useFallback("formula_preservation");
			}
		}
	}

	if (strategy === "defuddle" && textLen(html) < 120 && textLen(fallbackHtml) >= 120) {
		useFallback("content_too_short");
	}

	return { html, strategy, retries };
}

function getTodayDate(): string {
	const now = new Date();
	const year = now.getFullYear();
	const month = String(now.getMonth() + 1).padStart(2, "0");
	const day = String(now.getDate()).padStart(2, "0");
	return `${year}-${month}-${day}`;
}

/** Defuddle first-party HTML->Markdown (same rules as Obsidian Clipper). */
function buildContentMarkdown(html: string, url: string): string {
	return htmlToDefuddleMarkdown(html || "", url || window.location.href);
}

function extractSelection(): ExtractedArticle | null {
	const selection = window.getSelection();
	if (!selection || selection.rangeCount === 0) {
		return null;
	}

	const range = selection.getRangeAt(0);
	const selectedText = selection.toString().trim();

	if (selectedText.length === 0) {
		return null;
	}

	const container = document.createElement("div");
	container.appendChild(range.cloneContents());

	processLazyImagesInElement(container);

	const baseUrl = window.location.href;
	const contentHtml = resolveRelativeUrls(container.innerHTML, baseUrl);
	const meta = extractMetadata();

	const topImage = extractFirstImage(contentHtml) || meta.topImage;

	// content_md / structured / quality filled by finalizeExtracted.
	return {
		title: meta.title || document.title,
		content_html: contentHtml,
		source_url: baseUrl,
		top_image: topImage,
		author: meta.author,
		published_at: parseDate(meta.publishedAt) || getTodayDate(),
		source_domain: new URL(baseUrl).hostname,
		excerpt: selectedText.slice(0, 200),
		isSelection: true,
	};
}

function isPlaceholderSrc(src: string): boolean {
	if (!src) return true;
	if (src.startsWith("data:image/svg+xml")) return true;
	if (src.startsWith("data:image/gif;base64,R0lGOD")) return true;
	if (
		src.includes("1x1") ||
		src.includes("placeholder") ||
		src.includes("blank")
	)
		return true;
	if (src.includes("spacer") || src.includes("loading")) return true;
	return false;
}

function processLazyImagesInElement(element: HTMLElement): void {
	element.querySelectorAll("img").forEach((img) => {
		const currentSrc = img.getAttribute("src") || "";
		if (isPlaceholderSrc(currentSrc)) {
			for (const attr of LAZY_IMAGE_ATTRS) {
				const lazySrc = img.getAttribute(attr);
				if (lazySrc && !isPlaceholderSrc(lazySrc)) {
					img.setAttribute("src", lazySrc);
					break;
				}
			}
		}
	});

	element.querySelectorAll("picture source").forEach((source) => {
		const lazySrcset = source.getAttribute("data-srcset");
		if (lazySrcset) {
			source.setAttribute("srcset", lazySrcset);
		}
	});
}

function extractJsonLd(): Partial<{
	title: string;
	author: string;
	publishedAt: string;
	topImage: string;
	description: string;
}> {
	const scripts = document.querySelectorAll(
		'script[type="application/ld+json"]',
	);

	for (const script of scripts) {
		try {
			const rawData = JSON.parse(script.textContent || "");
			const dataArray = Array.isArray(rawData) ? rawData : [rawData];

			for (const data of dataArray) {
				const article = findArticleInJsonLd(data);
				if (article) {
					const authorValue = article.author;
					let authorName = "";
					if (typeof authorValue === "string") {
						authorName = authorValue;
					} else if (
						authorValue &&
						typeof authorValue === "object" &&
						authorValue.name
					) {
						authorName = authorValue.name;
					}

					const imageValue = article.image;
					let imageUrl = "";
					if (typeof imageValue === "string") {
						imageUrl = imageValue;
					} else if (
						imageValue &&
						typeof imageValue === "object" &&
						imageValue.url
					) {
						imageUrl = imageValue.url;
					}

					return {
						title: article.headline || article.name || "",
						author: authorName,
						publishedAt: article.datePublished || "",
						topImage: imageUrl,
						description: article.description || "",
					};
				}
			}
		} catch {}
	}
	return {};
}

function findArticleInJsonLd(
	data: JsonLdArticle | { "@graph"?: JsonLdArticle[] },
): JsonLdArticle | null {
	const articleTypes = [
		"Article",
		"NewsArticle",
		"BlogPosting",
		"TechArticle",
		"ScholarlyArticle",
	];

	if (data["@type"] && articleTypes.includes(data["@type"])) {
		return data as JsonLdArticle;
	}

	if ("@graph" in data && Array.isArray(data["@graph"])) {
		for (const item of data["@graph"]) {
			if (item["@type"] && articleTypes.includes(item["@type"])) {
				return item;
			}
		}
	}

	return null;
}

async function finalizeExtracted(
	partial: ExtractedArticle,
	debug: ExtractDebug,
): Promise<ExtractedArticle> {
	const resolved = await resolveXMediaLinks(
		partial.content_html,
		partial.top_image,
		partial.source_url,
	);
	const contentHtml = resolved.contentHtml;
	return {
		...partial,
		content_html: contentHtml,
		top_image: resolved.topImage,
		content_structured: buildStructuredContentFromHtml(contentHtml),
		content_md: buildContentMarkdown(contentHtml, partial.source_url),
		quality: assessContentQuality(contentHtml),
		extract_debug: debug,
	};
}

function normalizeCaptureMode(mode: unknown): CaptureMode {
	if (mode === "selection" || mode === "article" || mode === "auto") {
		return mode;
	}
	return "auto";
}

function emptyCapturePayload(): ExtractedArticle {
	const href = window.location.href;
	return {
		title: "",
		content_html: "",
		content_md: "",
		source_url: href,
		top_image: null,
		author: "",
		published_at: getTodayDate(),
		source_domain: new URL(href).hostname,
		excerpt: "",
	};
}

function cacheKeyForCapture(url: string, mode: CaptureMode): string {
	return `${mode}::${url}`;
}

/**
 * Single capture entrypoint for createArticle-bound DOM extraction.
 * Always returns a finalized payload (content_md/structured/quality).
 */
async function extractCapture(
	mode: CaptureMode = "auto",
	forceRefresh = false,
): Promise<ExtractedArticle> {
	const currentUrl = window.location.href;
	const cacheKey = cacheKeyForCapture(currentUrl, mode);

	if (!forceRefresh && cachedResult && cachedResult.url === cacheKey) {
		return cachedResult.data;
	}

	processLazyImages();
	await flattenShadowDom(document);

	const preferSelection = mode === "auto" || mode === "selection";
	if (preferSelection) {
		const selectionResult = extractSelection();
		if (selectionResult?.content_html?.trim()) {
			const finalized = await finalizeExtracted(selectionResult, {
				strategy_final: "selection",
				retries: [],
				engine_version: DEFUDDLE_ENGINE_VERSION,
				capture_mode: mode,
			});
			cachedResult = { url: cacheKey, data: finalized };
			return finalized;
		}
		if (mode === "selection") {
			const empty = emptyCapturePayload();
			empty.extract_debug = {
				strategy_final: "selection",
				retries: [{ strategy: "selection", reason: "empty_selection" }],
				engine_version: DEFUDDLE_ENGINE_VERSION,
				capture_mode: mode,
			};
			return empty;
		}
	}

	const finalized = await extractFullArticle(currentUrl, mode);
	cachedResult = { url: cacheKey, data: finalized };
	return finalized;
}

async function extractFullArticle(
	currentUrl: string,
	mode: CaptureMode,
): Promise<ExtractedArticle> {
	const baseUrl = currentUrl;
	const sourceFormulaCount = countFormulaSignals(document);
	const jsonLdData = extractJsonLd();
	const meta = extractMetadata();
	const fallbackHtml = resolveRelativeUrls(extractFallbackContent(), baseUrl);

	let engineHtml = "";
	let engineTitle = "";
	let engineAuthor = "";
	let enginePublished = "";
	let engineImage = "";
	let engineDescription = "";
	let parseTimeMs = 0;
	const preRetries: ExtractDebug["retries"] = [];

	try {
		const defuddled = extractWithDefuddle(document, baseUrl);
		engineHtml = resolveRelativeUrls(defuddled.contentHtml, baseUrl);
		engineTitle = defuddled.title;
		engineAuthor = defuddled.author;
		enginePublished = defuddled.published;
		engineImage = defuddled.image;
		engineDescription = defuddled.description;
		parseTimeMs = defuddled.parseTime;
	} catch (error) {
		preRetries.push({
			strategy: "defuddle",
			reason: error instanceof Error ? error.message : "defuddle_failed",
		});
	}

	const picked = pickContentHtml(engineHtml, fallbackHtml, sourceFormulaCount);
	const retries = [...preRetries, ...picked.retries];
	const contentHtml = picked.html;

	const partial: ExtractedArticle = {
		title: engineTitle || jsonLdData.title || meta.title || document.title,
		content_html: contentHtml,
		source_url: baseUrl,
		top_image:
			engineImage ||
			jsonLdData.topImage ||
			meta.topImage ||
			extractFirstImage(contentHtml),
		author: engineAuthor || jsonLdData.author || meta.author,
		published_at:
			parseDate(enginePublished || jsonLdData.publishedAt || meta.publishedAt) ||
			getTodayDate(),
		source_domain: new URL(baseUrl).hostname,
		excerpt: engineDescription || jsonLdData.description || meta.description,
	};

	return finalizeExtracted(partial, {
		strategy_final: picked.strategy,
		retries,
		parse_time_ms: parseTimeMs || undefined,
		engine_version: DEFUDDLE_ENGINE_VERSION,
		capture_mode: mode,
	});
}

function buildStructuredContentFromHtml(html: string): StructuredContent {
	const parser = new DOMParser();
	const doc = parser.parseFromString(html, "text/html");
	return buildStructuredContentFromElement(doc.body);
}

function buildStructuredContentFromElement(element: HTMLElement): StructuredContent {
	const blocks: StructuredBlock[] = [];
	const pushParagraph = (text: string, html?: string) => {
		const normalized = normalizeText(text);
		if (!normalized) return;
		blocks.push({ type: "paragraph", text: normalized, html });
	};

	const visitNode = (node: Node) => {
		if (node.nodeType === Node.TEXT_NODE) {
			const text = node.textContent || "";
			if (normalizeText(text)) {
				pushParagraph(text);
			}
			return;
		}

		if (node.nodeType !== Node.ELEMENT_NODE) return;
		const el = node as HTMLElement;
		const tag = el.tagName.toLowerCase();

		if (/^h[1-6]$/.test(tag)) {
			const level = Number.parseInt(tag.replace("h", ""), 10);
			const text = normalizeText(el.textContent || "");
			if (text) blocks.push({ type: "heading", level, text });
			return;
		}

		if (tag === "p") {
			pushParagraph(el.textContent || "", el.innerHTML);
			return;
		}

		if (tag === "ul" || tag === "ol") {
			const items = Array.from(el.querySelectorAll("li"))
				.map((li) => normalizeText(li.textContent || ""))
				.filter(Boolean);
			if (items.length > 0) {
				blocks.push({ type: "list", items });
			}
			return;
		}

		if (tag === "img") {
			const src = el.getAttribute("src") || "";
			if (src) {
				blocks.push({
					type: "image",
					src,
					alt: el.getAttribute("alt") || "",
				});
			}
			return;
		}

		if (tag === "figure") {
			const img = el.querySelector("img");
			if (img?.getAttribute("src")) {
				const caption = el.querySelector("figcaption")?.textContent || "";
				blocks.push({
					type: "image",
					src: img.getAttribute("src") || "",
					alt: img.getAttribute("alt") || caption,
					text: normalizeText(caption),
				});
				return;
			}
		}

		if (tag === "pre" || tag === "code") {
			const codeNode = tag === "pre" ? el.querySelector("code") : el;
			const code = codeNode?.textContent || el.textContent || "";
			const className = codeNode?.getAttribute("class") || "";
			const langMatch = className.match(/(?:language-|lang-)(\w+)/);
			const language = langMatch ? langMatch[1] : "";
			if (normalizeText(code)) {
				blocks.push({
					type: "code",
					code: code.replace(/\n$/, ""),
					language,
				});
				return;
			}
		}

		if (tag === "blockquote") {
			const text = normalizeText(el.textContent || "");
			if (text) blocks.push({ type: "quote", text });
			return;
		}

		if (tag === "table") {
			const html = el.outerHTML;
			if (html) blocks.push({ type: "table", html });
			return;
		}

		if (tag === "hr") {
			blocks.push({ type: "divider" });
			return;
		}

		if (
			["div", "section", "article", "main", "aside"].includes(tag) &&
			el.childNodes.length > 0
		) {
			el.childNodes.forEach((child) => visitNode(child));
			return;
		}

		const text = normalizeText(el.textContent || "");
		if (text) {
			pushParagraph(text, el.innerHTML);
		}
	};

	Array.from(element.childNodes).forEach((child) => visitNode(child));
	return { schema: "lumina.dom.v1", blocks };
}

function normalizeText(text: string): string {
	return text.replace(/\s+/g, " ").trim();
}

/** Lightweight observability only; never gates capture success. */
function assessContentQuality(html: string): ContentQuality {
	const warnings: string[] = [];
	const wordCount = textLen(html);
	const hasImages = countImgTags(html) > 0;
	const hasCode = /<(pre|code)\b/i.test(html || "");
	let score = 100;

	if (wordCount < 200) {
		warnings.push("内容过短");
		score -= 30;
	} else if (wordCount < 500) {
		score -= 10;
	}
	if (/<(script|style)\b/i.test(html || "")) {
		warnings.push("可能含脚本/样式残留");
		score -= 15;
	}

	return {
		score: Math.max(0, score),
		wordCount,
		hasImages,
		hasCode,
		warnings,
	};
}

function processLazyImages(): void {
	document.querySelectorAll("img").forEach((img) => {
		const currentSrc = img.getAttribute("src") || "";
		const shouldReplace = !currentSrc || isPlaceholderSrc(currentSrc);

		if (shouldReplace) {
			for (const attr of LAZY_IMAGE_ATTRS) {
				const lazySrc = img.getAttribute(attr);
				if (lazySrc && !isPlaceholderSrc(lazySrc)) {
					img.setAttribute("src", lazySrc);
					break;
				}
			}
		}

		const srcset =
			img.getAttribute("data-srcset") || img.getAttribute("data-lazy-srcset");
		if (srcset && !img.srcset) {
			img.srcset = srcset;
		}
	});

	document.querySelectorAll("picture source").forEach((source) => {
		const lazySrcset = source.getAttribute("data-srcset");
		if (lazySrcset) {
			source.setAttribute("srcset", lazySrcset);
		}
	});

	document
		.querySelectorAll("[data-bg], [data-background-image]")
		.forEach((el) => {
			const lazyBg =
				el.getAttribute("data-bg") || el.getAttribute("data-background-image");
			if (lazyBg) {
				(el as HTMLElement).style.backgroundImage = `url(${lazyBg})`;
			}
		});
}

interface Metadata {
	title: string;
	author: string;
	publishedAt: string;
	topImage: string | null;
	description: string;
}

function extractMetadata(): Metadata {
	const getMeta = (selectors: string[]): string => {
		for (const selector of selectors) {
			const el = document.querySelector(selector);
			if (el instanceof HTMLMetaElement && el.content) {
				return el.content;
			}
			if (el instanceof HTMLTimeElement && el.dateTime) {
				return el.dateTime;
			}
			if (el?.textContent?.trim()) {
				return el.textContent.trim();
			}
		}
		return "";
	};

	return {
		title: getMeta(['meta[property="og:title"]', 'meta[name="twitter:title"]']),
		author: getMeta([
			'meta[name="author"]',
			'meta[property="article:author"]',
			'meta[name="twitter:creator"]',
			'meta[name="byl"]',
			'meta[name="sailthru.author"]',
			'[itemprop="author"]',
			'[rel="author"]',
			".author",
			".byline",
			".post-author",
			".entry-author",
		]),
		publishedAt: getMeta([
			'meta[property="article:published_time"]',
			'meta[name="article:published_time"]',
			'meta[name="published_time"]',
			'meta[property="article:published"]',
			'meta[name="date"]',
			'meta[name="DC.date.issued"]',
			'meta[property="og:published_time"]',
			"time[datetime]",
			'[itemprop="datePublished"]',
		]),
		topImage:
			getMeta([
				'meta[property="og:image"]',
				'meta[name="twitter:image"]',
				'meta[name="twitter:image:src"]',
			]) || null,
		description: getMeta([
			'meta[property="og:description"]',
			'meta[name="description"]',
			'meta[name="twitter:description"]',
		]),
	};
}

function extractFallbackContent(): string {
	const selectorsToTry = [
		"article",
		'[role="article"]',
		'[role="main"]',
		"main",
		".post-content",
		".article-content",
		".entry-content",
		".content",
		"#content",
		".post",
		".article",
	];

	let articleElement: Element | null = null;
	for (const selector of selectorsToTry) {
		const el = document.querySelector(selector);
		if (el && el.textContent && el.textContent.trim().length > 200) {
			articleElement = el;
			break;
		}
	}

	if (!articleElement) {
		articleElement = document.body;
	}

	const clone = articleElement.cloneNode(true) as Element;
	const removeSelectors = [
		"script",
		"style",
		"noscript",
		"iframe",
		"svg",
		"nav",
		"header",
		"footer",
		"aside",
		".nav",
		".navigation",
		".menu",
		".sidebar",
		".widget",
		".ads",
		".ad",
		".advertisement",
		".advert",
		".comments",
		".comment",
		"#comments",
		".comment-section",
		".share",
		".social",
		".social-share",
		".related",
		".related-posts",
		".recommended",
		".newsletter",
		".subscribe",
		'[role="navigation"]',
		'[role="banner"]',
		'[role="complementary"]',
		".paywall",
		".subscription-wall",
		".premium-content",
		".cookie-banner",
		".cookie-notice",
		".gdpr",
		".consent",
		".popup",
		".modal",
		".overlay",
		".sticky-header",
		".fixed-header",
		".floating-header",
		".breadcrumb",
		".breadcrumbs",
		".pagination",
		".pager",
		"[data-ad]",
		"[data-advertisement]",
		".sponsored",
		".promotion",
		".promo",
		".print-only",
		".author-bio",
		".author-card",
		".author-box",
		".table-of-contents",
		".toc",
		".feedback",
		".rating",
		".reactions",
	];

	removeSelectors.forEach((selector) => {
		clone.querySelectorAll(selector).forEach((el) => {
			el.remove();
		});
	});

	return clone.innerHTML;
}

function resolveRelativeUrls(html: string, baseUrl: string): string {
	const parser = new DOMParser();
	const doc = parser.parseFromString(html, "text/html");
	const base = new URL(baseUrl);

	doc.querySelectorAll("img[src]").forEach((img) => {
		const src = img.getAttribute("src");
		if (src && !src.startsWith("data:") && !src.startsWith("http")) {
			try {
				img.setAttribute("src", new URL(src, base).href);
			} catch {
				// Invalid URL, keep original
			}
		}
	});

	doc.querySelectorAll("a[href]").forEach((a) => {
		const href = a.getAttribute("href");
		if (
			href &&
			!href.startsWith("#") &&
			!href.startsWith("javascript:") &&
			!href.startsWith("http")
		) {
			try {
				a.setAttribute("href", new URL(href, base).href);
			} catch {
				// Invalid URL, keep original
			}
		}
	});

	return doc.body.innerHTML;
}

function toAbsoluteUrl(rawUrl: string, baseUrl: string): string {
	if (!rawUrl) return "";
	try {
		return new URL(rawUrl, baseUrl).href;
	} catch {
		return rawUrl;
	}
}

function isXMediaPageUrl(rawUrl: string, baseUrl: string): boolean {
	const absolute = toAbsoluteUrl(rawUrl, baseUrl);
	if (!absolute) return false;
	try {
		const parsed = new URL(absolute);
		const host = parsed.hostname.toLowerCase();
		if (!X_MEDIA_HOSTS.has(host)) return false;
		return parsed.pathname.includes("/media/");
	} catch {
		return false;
	}
}

function isTwitterImageUrl(rawUrl: string, baseUrl: string): boolean {
	const absolute = toAbsoluteUrl(rawUrl, baseUrl);
	if (!absolute) return false;
	try {
		const host = new URL(absolute).hostname.toLowerCase();
		return host === TWITTER_IMAGE_CDN_HOST;
	} catch {
		return false;
	}
}

function pickUrlFromSrcset(srcset: string, baseUrl: string): string {
	if (!srcset) return "";
	const candidates = srcset
		.split(",")
		.map((part) => part.trim().split(/\s+/)[0] || "")
		.filter(Boolean);
	for (const candidate of candidates) {
		const absolute = toAbsoluteUrl(candidate, baseUrl);
		if (isTwitterImageUrl(absolute, baseUrl)) {
			return absolute;
		}
	}
	return toAbsoluteUrl(candidates[0] || "", baseUrl);
}

function extractTwitterImageHintFromElement(
	element: Element,
	baseUrl: string,
): string | null {
	const attrs = [
		"src",
		"data-src",
		"data-full-src",
		"data-image-url",
		"data-url",
	];
	for (const attr of attrs) {
		const value = element.getAttribute(attr) || "";
		const absolute = toAbsoluteUrl(value, baseUrl);
		if (isTwitterImageUrl(absolute, baseUrl)) {
			return absolute;
		}
	}
	const srcset = element.getAttribute("srcset") || "";
	if (srcset) {
		const picked = pickUrlFromSrcset(srcset, baseUrl);
		if (isTwitterImageUrl(picked, baseUrl)) {
			return picked;
		}
	}
	return null;
}

function findTwitterImageHintInDocument(
	doc: Document,
	xMediaUrl: string,
	baseUrl: string,
): string | null {
	const normalizedTarget = toAbsoluteUrl(xMediaUrl, baseUrl);
	const anchors = Array.from(doc.querySelectorAll("a[href]"));
	for (const anchor of anchors) {
		const href = toAbsoluteUrl(anchor.getAttribute("href") || "", baseUrl);
		if (href !== normalizedTarget) continue;
		const image = anchor.querySelector("img, source");
		if (!image) continue;
		const hinted = extractTwitterImageHintFromElement(image, baseUrl);
		if (hinted) return hinted;
	}
	return null;
}

function extractMetaImageUrl(html: string, baseUrl: string): string | null {
	if (!html) return null;
	try {
		const doc = new DOMParser().parseFromString(html, "text/html");
		const selectors = [
			'meta[property="og:image"]',
			'meta[property="og:image:url"]',
			'meta[name="twitter:image"]',
			'meta[name="twitter:image:src"]',
		];
		for (const selector of selectors) {
			const meta = doc.querySelector(selector);
			const content = meta?.getAttribute("content") || "";
			const absolute = toAbsoluteUrl(content, baseUrl);
			if (!absolute) continue;
			if (!isXMediaPageUrl(absolute, baseUrl)) return absolute;
		}
		return null;
	} catch {
		return null;
	}
}

async function resolveXMediaUrlToImage(
	rawUrl: string,
	baseUrl: string,
	doc?: Document,
): Promise<string | null> {
	const normalizedUrl = toAbsoluteUrl(rawUrl, baseUrl);
	if (!isXMediaPageUrl(normalizedUrl, baseUrl)) return null;
	if (xMediaResolveCache.has(normalizedUrl)) {
		return xMediaResolveCache.get(normalizedUrl) || null;
	}

	const hinted = doc
		? findTwitterImageHintInDocument(doc, normalizedUrl, baseUrl)
		: null;
	if (hinted) {
		setXMediaResolveCache(normalizedUrl, hinted);
		return hinted;
	}

	try {
		const response = await fetch(normalizedUrl, {
			credentials: "include",
		});
		if (!response.ok) {
			setXMediaResolveCache(normalizedUrl, null);
			return null;
		}

		const contentType = (response.headers.get("content-type") || "")
			.split(";")[0]
			.trim()
			.toLowerCase();
		if (contentType.startsWith("image/")) {
			const imageUrl = toAbsoluteUrl(response.url || normalizedUrl, normalizedUrl);
			setXMediaResolveCache(normalizedUrl, imageUrl);
			return imageUrl;
		}

		const html = await response.text();
		const metaImage = extractMetaImageUrl(html, response.url || normalizedUrl);
		if (metaImage) {
			setXMediaResolveCache(normalizedUrl, metaImage);
			return metaImage;
		}
	} catch {}

	setXMediaResolveCache(normalizedUrl, null);
	return null;
}

async function resolveXMediaLinks(
	contentHtml: string,
	topImage: string | null,
	baseUrl: string,
): Promise<{ contentHtml: string; topImage: string | null }> {
	if (!contentHtml && !topImage) {
		return { contentHtml, topImage };
	}

	const parser = new DOMParser();
	const doc = parser.parseFromString(contentHtml || "", "text/html");
	const candidates = new Set<string>();

	doc.querySelectorAll("img[src], source[src], a[href]").forEach((element) => {
		const attr = element.hasAttribute("src") ? "src" : "href";
		const value = element.getAttribute(attr) || "";
		const absolute = toAbsoluteUrl(value, baseUrl);
		if (isXMediaPageUrl(absolute, baseUrl)) {
			candidates.add(absolute);
		}
	});

	if (topImage) {
		const absoluteTopImage = toAbsoluteUrl(topImage, baseUrl);
		if (isXMediaPageUrl(absoluteTopImage, baseUrl)) {
			candidates.add(absoluteTopImage);
		}
	}

	if (candidates.size === 0) {
		return { contentHtml, topImage };
	}

	const urlMappings = new Map<string, string>();
	const candidateList = Array.from(candidates);
	for (const candidate of candidateList) {
		const resolved = await resolveXMediaUrlToImage(candidate, baseUrl, doc);
		if (resolved) {
			urlMappings.set(candidate, resolved);
		}
	}

	if (urlMappings.size === 0) {
		return { contentHtml, topImage };
	}

	doc.querySelectorAll("img[src], source[src], a[href]").forEach((element) => {
		const attr = element.hasAttribute("src") ? "src" : "href";
		const raw = element.getAttribute(attr) || "";
		const absolute = toAbsoluteUrl(raw, baseUrl);
		const mapped = urlMappings.get(absolute);
		if (mapped) {
			element.setAttribute(attr, mapped);
		}
	});

	let nextTopImage = topImage;
	if (topImage) {
		const absoluteTopImage = toAbsoluteUrl(topImage, baseUrl);
		nextTopImage = urlMappings.get(absoluteTopImage) || topImage;
	}

	return {
		contentHtml: doc.body.innerHTML,
		topImage: nextTopImage,
	};
}

function extractFirstImage(html: string): string | null {
	const parser = new DOMParser();
	const doc = parser.parseFromString(html, "text/html");
	const img = doc.querySelector("img[src]");
	return img?.getAttribute("src") || null;
}
