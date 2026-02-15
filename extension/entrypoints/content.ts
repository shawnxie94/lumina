import { Readability } from "@mozilla/readability";
import { parseDate } from "../utils/dateParser";
import { logError } from "../utils/errorLogger";
import { extractWithAdapter, getSiteAdapter } from "../utils/siteAdapters";

let cachedResult: { url: string; data: ExtractedArticle } | null = null;

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
		chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
			if (message.type === "PING") {
				sendResponse({ pong: true });
			}
			if (message.type === "CHECK_X_ARTICLE") {
				const result = checkXArticleRedirect();
				sendResponse(result);
			}
			if (message.type === "EXTRACT_ARTICLE") {
				const forceRefresh = message.forceRefresh === true;
				extractArticle(forceRefresh)
					.then((result) => sendResponse(result))
					.catch((error) => {
						logError(
							"content",
							error instanceof Error ? error : new Error(String(error)),
							{
								action: "extractArticle",
								url: window.location.href,
							},
						);
						sendResponse({
							title: "",
							content_html: "",
							source_url: window.location.href,
							top_image: null,
							author: "",
							published_at: getTodayDate(),
							source_domain: new URL(window.location.href).hostname,
							excerpt: "",
						});
					});
			}
			if (message.type === "CHECK_SELECTION") {
				const selection = window.getSelection();
				const hasSelection =
					selection && selection.toString().trim().length > 0;
				sendResponse({ hasSelection });
			}
			if (message.type === "EXTRACT_SELECTION") {
				const result = extractSelection();
				sendResponse(result);
			}
			return true;
		});
	},
});

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

interface ExtractedArticle {
	title: string;
	content_html: string;
	source_url: string;
	top_image: string | null;
	author: string;
	published_at: string;
	source_domain: string;
	excerpt: string;
	isSelection?: boolean;
	quality?: ContentQuality;
	content_structured?: StructuredContent;
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

function countFormulaSignalsInRoot(root: ParentNode): number {
	try {
		return root.querySelectorAll(FORMULA_SIGNAL_SELECTOR).length;
	} catch {
		return 0;
	}
}

function countFormulaSignalsInHtml(html: string): number {
	if (!html) return 0;
	const parser = new DOMParser();
	const doc = parser.parseFromString(html, "text/html");
	return countFormulaSignalsInRoot(doc);
}

function getTextLengthFromHtml(html: string): number {
	if (!html) return 0;
	return (html || "")
		.replace(/<[^>]*>/g, " ")
		.replace(/\s+/g, " ")
		.trim().length;
}

function shouldPreferFallbackForFormula(
	sourceFormulaCount: number,
	readabilityHtml: string,
	fallbackHtml: string,
): boolean {
	if (sourceFormulaCount <= 0) return false;
	const readabilityFormulaCount = countFormulaSignalsInHtml(readabilityHtml);
	const fallbackFormulaCount = countFormulaSignalsInHtml(fallbackHtml);

	if (fallbackFormulaCount <= 0) return false;
	if (readabilityFormulaCount === 0) return true;
	if (fallbackFormulaCount <= readabilityFormulaCount) return false;

	const readabilityTextLength = getTextLengthFromHtml(readabilityHtml);
	const fallbackTextLength = getTextLengthFromHtml(fallbackHtml);
	if (fallbackTextLength < Math.max(120, Math.floor(readabilityTextLength * 0.5))) {
		return false;
	}
	return true;
}

function getTodayDate(): string {
	const now = new Date();
	const year = now.getFullYear();
	const month = String(now.getMonth() + 1).padStart(2, "0");
	const day = String(now.getDate()).padStart(2, "0");
	return `${year}-${month}-${day}`;
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
	const contentStructured = buildStructuredContentFromHtml(contentHtml);

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
		content_structured: contentStructured,
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

async function extractArticle(forceRefresh = false): Promise<ExtractedArticle> {
	const currentUrl = window.location.href;

	if (!forceRefresh && cachedResult && cachedResult.url === currentUrl) {
		return cachedResult.data;
	}
	processLazyImages();

	const baseUrl = window.location.href;
	const sourceFormulaCount = countFormulaSignalsInRoot(document);
	const jsonLdData = extractJsonLd();
	const meta = extractMetadata();
	const mergedMeta = {
		title: jsonLdData.title || meta.title,
		author: jsonLdData.author || meta.author,
		publishedAt: jsonLdData.publishedAt || meta.publishedAt,
		topImage: jsonLdData.topImage || meta.topImage,
		description: jsonLdData.description || meta.description,
	};

	let result: ExtractedArticle;
	let fallbackContentCache: string | null = null;
	const getFallbackContent = () => {
		if (fallbackContentCache === null) {
			fallbackContentCache = resolveRelativeUrls(extractFallbackContent(), baseUrl);
		}
		return fallbackContentCache;
	};

	const adapter = getSiteAdapter(baseUrl);
	if (adapter) {
		const adapterResult = extractWithAdapter(adapter);
		let contentHtml = resolveRelativeUrls(adapterResult.contentHtml, baseUrl);
		if (countImgTags(contentHtml) === 0) {
			const fallbackContent = getFallbackContent();
			if (countImgTags(fallbackContent) > 0) {
				contentHtml = fallbackContent;
			}
		}
		if (
			shouldPreferFallbackForFormula(
				sourceFormulaCount,
				contentHtml,
				getFallbackContent(),
			)
		) {
			contentHtml = getFallbackContent();
		}
		const rawDate = adapterResult.publishedAt || mergedMeta.publishedAt;

		result = {
			title: adapterResult.title || mergedMeta.title || document.title,
			content_html: contentHtml,
			source_url: baseUrl,
			top_image: mergedMeta.topImage || extractFirstImage(contentHtml),
			author: adapterResult.author || mergedMeta.author,
			published_at: parseDate(rawDate) || getTodayDate(),
			source_domain: new URL(baseUrl).hostname,
			excerpt: mergedMeta.description,
			content_structured: buildStructuredContentFromHtml(contentHtml),
		};
	} else {
		const doc = document.cloneNode(true) as Document;
		const reader = new Readability(doc, {
			charThreshold: 100,
			keepClasses: true,
		});
		const article = reader.parse();

		if (article) {
			let contentHtml = resolveRelativeUrls(article.content, baseUrl);
			if (countImgTags(contentHtml) === 0) {
				const fallbackContent = getFallbackContent();
				if (countImgTags(fallbackContent) > 0) {
					contentHtml = fallbackContent;
				}
			}
			if (
				shouldPreferFallbackForFormula(
					sourceFormulaCount,
					contentHtml,
					getFallbackContent(),
				)
			) {
				contentHtml = getFallbackContent();
			}
			const topImage = mergedMeta.topImage || extractFirstImage(contentHtml);
			const rawDate = article.publishedTime || mergedMeta.publishedAt;

			result = {
				title: article.title || mergedMeta.title || document.title,
				content_html: contentHtml,
				source_url: baseUrl,
				top_image: topImage,
				author: article.byline || mergedMeta.author,
				published_at: parseDate(rawDate) || getTodayDate(),
				source_domain: new URL(baseUrl).hostname,
				excerpt: article.excerpt || mergedMeta.description,
				content_structured: buildStructuredContentFromHtml(contentHtml),
			};
		} else {
			const contentHtml = getFallbackContent();

			result = {
				title: mergedMeta.title || document.title,
				content_html: contentHtml,
				source_url: baseUrl,
				top_image: mergedMeta.topImage || extractFirstImage(contentHtml),
				author: mergedMeta.author,
				published_at: parseDate(mergedMeta.publishedAt) || getTodayDate(),
				source_domain: new URL(baseUrl).hostname,
				excerpt: mergedMeta.description,
				content_structured: buildStructuredContentFromHtml(contentHtml),
			};
		}
	}

	const resolvedMedia = await resolveXMediaLinks(
		result.content_html,
		result.top_image,
		baseUrl,
	);
	result.content_html = resolvedMedia.contentHtml;
	result.top_image = resolvedMedia.topImage;
	result.content_structured = buildStructuredContentFromHtml(result.content_html);

	result.quality = assessContentQuality(result.content_html);
	cachedResult = { url: currentUrl, data: result };
	return result;
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

function assessContentQuality(html: string): ContentQuality {
	const warnings: string[] = [];
	let score = 100;

	const textContent = html.replace(/<[^>]*>/g, "");
	const wordCount = textContent.length;

	if (wordCount < 200) {
		warnings.push("内容过短，可能提取不完整");
		score -= 30;
	} else if (wordCount < 500) {
		warnings.push("内容较短");
		score -= 10;
	}

	if (html.includes("<script") || html.includes("<style")) {
		warnings.push("内容可能包含脚本残留");
		score -= 20;
	}

	const imgMatches = html.match(/<img[^>]*>/g) || [];
	const imgCount = imgMatches.length;
	let brokenImgCount = 0;

	for (const imgTag of imgMatches) {
		if (
			imgTag.includes("data:image/gif") ||
			imgTag.includes("data:image/svg+xml")
		) {
			brokenImgCount++;
		}
	}

	if (imgCount > 0 && brokenImgCount > imgCount / 2) {
		warnings.push("部分图片可能未正确加载");
		score -= 15;
	}

	const hasCode =
		html.includes("<pre") || html.includes("<code") || html.includes("```");

	return {
		score: Math.max(0, score),
		wordCount,
		hasImages: imgCount > 0,
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
