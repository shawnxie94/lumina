import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";

export type LogError = (
	source: "popup" | "background" | "content",
	error: Error,
	context?: Record<string, unknown>,
) => void;

export function createTurndown(): TurndownService {
	const turndown = new TurndownService({
		headingStyle: "atx",
		codeBlockStyle: "fenced",
		fence: "```",
		bulletListMarker: "-",
		emDelimiter: "*",
		strongDelimiter: "**",
		linkStyle: "inlined",
	});

	turndown.use(gfm);
	turndown.remove([
		"script",
		"style",
		"noscript",
		"iframe",
		"nav",
		"footer",
		"aside",
	]);

	turndown.addRule("fencedCodeBlockWithLanguage", {
		filter: (node, options) => {
			return (
				options.codeBlockStyle === "fenced" &&
				node.nodeName === "PRE" &&
				node.firstChild &&
				node.firstChild.nodeName === "CODE"
			);
		},
		replacement: (_content, node, options) => {
			const codeNode = node.firstChild as HTMLElement;
			const className = codeNode.getAttribute("class") || "";
			const langMatch = className.match(/(?:language-|lang-)(\w+)/);
			const language = langMatch ? langMatch[1] : "";
			const code = codeNode.textContent || "";
			const fence = options.fence;
			return `\n\n${fence}${language}\n${code.replace(/\n$/, "")}\n${fence}\n\n`;
		},
	});

	turndown.addRule("mathBlock", {
		filter: (node) => {
			if (node.nodeName === "DIV" || node.nodeName === "SPAN") {
				const className = (node as HTMLElement).className || "";
				if (
					className.match(/MathJax|mathjax|katex|math-display|math-block/i)
				) {
					return true;
				}
			}
			if (
				node.nodeName === "SCRIPT" &&
				node.getAttribute("type")?.includes("math/tex")
			) {
				return true;
			}
			if (node.nodeName === "MATH") {
				return true;
			}
			return false;
		},
		replacement: (_content, node) => {
			const annotation = (node as HTMLElement).querySelector(
				'annotation[encoding="application/x-tex"]',
			);
			if (annotation?.textContent) {
				const tex = annotation.textContent.trim();
				const isBlock =
					node.nodeName === "DIV" ||
					(node as HTMLElement).className?.includes("display") ||
					(node as HTMLElement).className?.includes("block");
				return isBlock ? `\n\n$$\n${tex}\n$$\n\n` : `$${tex}$`;
			}

			if (node.nodeName === "SCRIPT") {
				const tex = node.textContent?.trim() || "";
				const isDisplay = node.getAttribute("type")?.includes("display");
				return isDisplay ? `\n\n$$\n${tex}\n$$\n\n` : `$${tex}$`;
			}

			const altText =
				node.getAttribute("alt") || node.getAttribute("data-formula");
			if (altText) {
				const isBlock =
					node.nodeName === "DIV" ||
					(node as HTMLElement).className?.includes("display") ||
					(node as HTMLElement).className?.includes("block");
				return isBlock ? `\n\n$$\n${altText}\n$$\n\n` : `$${altText}$`;
			}

			return _content;
		},
	});

	turndown.addRule("mathImg", {
		filter: (node) => {
			if (node.nodeName === "IMG") {
				const alt = node.getAttribute("alt") || "";
				const src = node.getAttribute("src") || "";
				const className = (node as HTMLElement).className || "";
				return (
					alt.includes("\\") ||
					src.includes("latex") ||
					src.includes("codecogs") ||
					src.includes("math") ||
					className.includes("math") ||
					className.includes("latex")
				);
			}
			return false;
		},
		replacement: (_content, node) => {
			const alt = node.getAttribute("alt") || "";
			if (alt && alt.includes("\\")) {
				return `$${alt}$`;
			}
			const src = node.getAttribute("src") || "";
			const texMatch = src.match(/[?&]tex=([^&]+)/);
			if (texMatch) {
				return `$${decodeURIComponent(texMatch[1])}$`;
			}
			return `![math](${src})`;
		},
	});

	turndown.addRule("videoEmbed", {
		filter: (node) => {
			if (node.nodeName === "IFRAME") {
				const src = node.getAttribute("src") || "";
				return (
					src.includes("youtube.com") ||
					src.includes("youtu.be") ||
					src.includes("bilibili.com") ||
					src.includes("vimeo.com") ||
					src.includes("player.bilibili.com")
				);
			}
			if (node.nodeName === "VIDEO") {
				return true;
			}
			return false;
		},
		replacement: (_content, node) => {
			const src = node.getAttribute("src") || "";
			const title = node.getAttribute("title") || "Video";

			let videoUrl = src;
			let videoId = "";

			const youtubeMatch = src.match(
				/(?:youtube\.com\/embed\/|youtu\.be\/)([^?&]+)/,
			);
			if (youtubeMatch) {
				videoId = youtubeMatch[1];
				videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
				return `\n\n[▶ ${title}](${videoUrl})\n\n`;
			}

			const bilibiliMatch = src.match(
				/player\.bilibili\.com\/player\.html\?.*?(?:bvid=|aid=)([^&]+)/,
			);
			if (bilibiliMatch) {
				videoId = bilibiliMatch[1];
				videoUrl = `https://www.bilibili.com/video/${videoId}`;
				return `\n\n[▶ ${title}](${videoUrl})\n\n`;
			}

			const vimeoMatch = src.match(/player\.vimeo\.com\/video\/(\d+)/);
			if (vimeoMatch) {
				videoId = vimeoMatch[1];
				videoUrl = `https://vimeo.com/${videoId}`;
				return `\n\n[▶ ${title}](${videoUrl})\n\n`;
			}

			if (node.nodeName === "VIDEO") {
				const videoSrc =
					node.getAttribute("src") ||
					node.querySelector("source")?.getAttribute("src") ||
					"";
				if (videoSrc) {
					return `\n\n[▶ Video](${videoSrc})\n\n`;
				}
			}

			return `\n\n[▶ ${title}](${src})\n\n`;
		},
	});

	turndown.addRule("improvedImage", {
		filter: "img",
		replacement: (_content, node) => {
			let src = node.getAttribute("src") || "";

			const pickBestUrlFromSrcset = (srcset: string) => {
				if (!srcset) return "";
				const candidates = srcset
					.split(",")
					.map((part) => part.trim())
					.map((part) => part.split(/\s+/)[0])
					.filter(Boolean);
				return candidates[candidates.length - 1] || "";
			};

			const isPlaceholder = (s: string) => {
				if (!s) return true;
				if (s.startsWith("data:image/svg+xml")) return true;
				if (s.startsWith("data:image/gif;base64,R0lGOD")) return true;
				if (s.includes("1x1") || s.includes("placeholder") || s.includes("blank"))
					return true;
				if (s.includes("spacer") || s.includes("loading")) return true;
				return false;
			};

			if (isPlaceholder(src)) {
				src =
					node.getAttribute("data-src") ||
					node.getAttribute("data-original") ||
					node.getAttribute("data-lazy-src") ||
					node.getAttribute("data-croporisrc") ||
					"";
			}

			if (!src) {
				src = pickBestUrlFromSrcset(node.getAttribute("srcset") || "");
			}

			if (!src || isPlaceholder(src)) return "";

			let alt = node.getAttribute("alt") || "";

			if (
				!alt ||
				alt === "image" ||
				alt === "img" ||
				alt === "图片" ||
				alt === "图像" ||
				alt.length < 2
			) {
				alt =
					node.getAttribute("title") ||
					node.getAttribute("data-alt") ||
					node.getAttribute("aria-label") ||
					"";
			}

			if (!alt) {
				const figcaption = node
					.closest("figure")
					?.querySelector("figcaption");
				if (figcaption) {
					alt = figcaption.textContent?.trim() || "";
				}
			}

			if (!alt) {
				const filename = src.split("/").pop()?.split("?")[0] || "";
				const nameWithoutExt = filename
					.replace(/\.[^.]+$/, "")
					.replace(/[-_]/g, " ");
				if (
					nameWithoutExt &&
					nameWithoutExt.length > 2 &&
					nameWithoutExt.length < 50
				) {
					alt = nameWithoutExt;
				}
			}

			alt = alt.replace(/[\[\]]/g, "").trim();

			const escapedAlt = alt.replace(/\n/g, " ").replace(/\r/g, " ");
			return `![${escapedAlt}](${src})`;
		},
	});

	turndown.addRule("imageOnlyLink", {
		filter: (node) => {
			if (node.nodeName !== "A") return false;
			const imgs = (node as HTMLElement).querySelectorAll("img");
			if (imgs.length === 0) return false;

			const textContent = node.textContent?.trim() || "";
			const imgAlts = Array.from(imgs)
				.map((img) => img.getAttribute("alt") || "")
				.join(" ")
				.trim();
			const nonImgText = textContent.replace(imgAlts, "").trim();

			if (
				nonImgText.length > 0 &&
				nonImgText !== "图像" &&
				nonImgText !== "图片" &&
				nonImgText !== "image"
			) {
				return false;
			}

			return true;
		},
		replacement: (content) => {
			return content;
		},
	});

	turndown.addRule("nestedBlockquote", {
		filter: "blockquote",
		replacement: (content, node) => {
			let depth = 0;
			let parent = node.parentNode;
			while (parent) {
				if (parent.nodeName === "BLOCKQUOTE") {
					depth++;
				}
				parent = parent.parentNode;
			}

			const prefix = "> ".repeat(depth + 1);
			const lines = content.trim().split("\n");
			const quotedLines = lines.map((line) => {
				if (line.trim() === "") return prefix.trim();
				if (line.startsWith(">")) return prefix + line;
				return prefix + line;
			});

			return "\n\n" + quotedLines.join("\n") + "\n\n";
		},
	});

	return turndown;
}

export function htmlToMarkdown(
	html: string,
	options?: { source?: "popup" | "background" | "content"; logError?: LogError },
): string {
	const { source = "popup", logError } = options || {};
	const turndown = createTurndown();
	try {
		return turndown.turndown(html || "");
	} catch (error) {
		if (logError) {
			logError(
				source,
				error instanceof Error ? error : new Error(String(error)),
				{ action: "htmlToMarkdown" },
			);
		}
		return (html || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
	}
}
