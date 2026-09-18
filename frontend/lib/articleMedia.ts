export type PastedMediaKind = "image" | "video" | "audio" | "book";

export interface PastedMediaLink {
	kind: PastedMediaKind;
	url: string;
}

export const IMAGE_LINK_PATTERN = /\.(png|jpe?g|gif|webp|svg|bmp|avif)(\?.*)?$/i;
export const VIDEO_LINK_PATTERN = /\.(mp4|webm|mov|m4v|ogv|ogg)(\?.*)?$/i;
export const AUDIO_LINK_PATTERN = /\.(mp3|wav|m4a|aac|ogg|flac|opus)(\?.*)?$/i;
export const BOOK_LINK_PATTERN = /\.(pdf|epub|mobi)(\?.*)?$/i;
export const VIDEO_HOST_PATTERN = /(youtube\.com|youtu\.be|bilibili\.com|vimeo\.com)/i;

export function cleanupPastedUrl(url: string): string {
	return (url || "")
		.trim()
		.replace(/^<|>$/g, "")
		.replace(/[),.;:!?]+$/, "");
}

export function detectMediaKindFromUrl(url: string): PastedMediaKind | null {
	const normalized = cleanupPastedUrl(url);
	if (!normalized || !/^https?:\/\//i.test(normalized)) return null;
	if (IMAGE_LINK_PATTERN.test(normalized)) return "image";
	if (AUDIO_LINK_PATTERN.test(normalized)) return "audio";
	if (VIDEO_LINK_PATTERN.test(normalized)) return "video";
	if (VIDEO_HOST_PATTERN.test(normalized)) return "video";
	if (BOOK_LINK_PATTERN.test(normalized)) return "book";
	return null;
}

export function buildMarkdownFromMediaLink(
	link: PastedMediaLink,
	t: (key: string) => string,
): string {
	if (link.kind === "image") {
		return `![](${link.url})`;
	}
	if (link.kind === "video") {
		return `[▶ ${t("视频")}](${link.url})`;
	}
	if (link.kind === "audio") {
		return `[🎧 ${t("音频")}](${link.url})`;
	}
	return `[📚 ${t("书籍")}](${link.url})`;
}

export function toPastedMediaLink(url?: string | null): PastedMediaLink | null {
	const normalized = cleanupPastedUrl(url || "");
	const kind = detectMediaKindFromUrl(normalized);
	if (!kind) return null;
	return { kind, url: normalized };
}

export function extractMediaLinkFromHtml(html: string): PastedMediaLink | null {
	if (!html) return null;
	try {
		const doc = new DOMParser().parseFromString(html, "text/html");
		const candidates = [
			doc.querySelector("img")?.getAttribute("src"),
			doc.querySelector("video")?.getAttribute("src"),
			doc.querySelector("video source")?.getAttribute("src"),
			doc.querySelector("audio")?.getAttribute("src"),
			doc.querySelector("audio source")?.getAttribute("src"),
			doc.querySelector("iframe")?.getAttribute("src"),
			doc.querySelector("a")?.getAttribute("href"),
		];
		for (const candidate of candidates) {
			const link = toPastedMediaLink(candidate);
			if (link) return link;
		}
		return null;
	} catch {
		return null;
	}
}

export function extractMediaLinkFromText(text: string): PastedMediaLink | null {
	if (!text) return null;
	const trimmed = text.trim();
	if (!trimmed) return null;
	if (/!\[[^\]]*\]\([^)]+\)/.test(trimmed)) return null;
	if (/\[[^\]]+\]\([^)]+\)/.test(trimmed)) return null;
	const urlMatch = trimmed.match(/https?:\/\/[^\s)]+/);
	if (!urlMatch?.[0]) return null;
	return toPastedMediaLink(urlMatch[0]);
}

export function insertTextAtCursor(
	target: HTMLTextAreaElement,
	text: string,
	onChange: (value: string) => void,
) {
	const start = target.selectionStart ?? target.value.length;
	const end = target.selectionEnd ?? target.value.length;
	const nextValue = `${target.value.slice(0, start)}${text}${target.value.slice(end)}`;
	onChange(nextValue);
	requestAnimationFrame(() => {
		const cursor = start + text.length;
		target.setSelectionRange(cursor, cursor);
		target.focus();
	});
}

export function extractMarkdownImageUrls(markdown: string): string[] {
	if (!markdown) return [];
	const pattern = /!\[[^\]]*\]\((\S+?)(?:\s+"[^"]*")?\)/g;
	const urls: string[] = [];
	let match: RegExpExecArray | null = null;
	while ((match = pattern.exec(markdown)) !== null) {
		const url = match[1];
		if (url && url.startsWith("http")) {
			urls.push(url);
		}
	}
	return Array.from(new Set(urls));
}

export function replaceMarkdownImageUrl(
	markdown: string,
	originalUrl: string,
	nextUrl: string,
): string {
	const escaped = originalUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const pattern = new RegExp(
		`!\\[([^\\]]*)\\]\\(${escaped}(\\s+\\"[^\\"]*\\")?\\)`,
		"g",
	);
	return markdown.replace(pattern, (_match, alt, titlePart) => {
		const title = titlePart || "";
		return `![${alt}](${nextUrl}${title})`;
	});
}
