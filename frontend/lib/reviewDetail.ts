import { getApiBaseUrl } from "@/lib/api";
import { formatReviewReferenceInsertion } from "@/lib/reviewReference";

export const REVIEW_ARTICLE_SECTIONS_PLACEHOLDER = "{{review_article_sections}}";
export const VIEW_COUNT_DEDUPE_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface EditorSelectionRange {
	start: number;
	end: number;
}

export const syncScrollPosition = (from: HTMLElement, to: HTMLElement) => {
	const fromScrollable = from.scrollHeight - from.clientHeight;
	if (fromScrollable <= 0) {
		to.scrollTop = 0;
		return;
	}
	const ratio = from.scrollTop / fromScrollable;
	const toScrollable = Math.max(0, to.scrollHeight - to.clientHeight);
	to.scrollTop = ratio * toScrollable;
};

export const getReviewViewStorageKey = (slug: string): string =>
	`review_view_count_tracked:${slug}`;

export async function runWithConcurrency<T>(
	items: T[],
	limit: number,
	worker: (item: T) => Promise<void>,
) {
	const queue = [...items];
	const workers = Array.from({ length: Math.min(limit, queue.length) }).map(
		async () => {
			while (queue.length > 0) {
				const item = queue.shift();
				if (!item) return;
				await worker(item);
			}
		},
	);
	await Promise.all(workers);
}

export function formatDate(value: string | null | undefined, language: "zh-CN" | "en") {
	if (!value) return "";
	return new Date(value).toLocaleDateString(language === "en" ? "en-US" : "zh-CN");
}

export function replaceTextRange(
	target: HTMLTextAreaElement,
	range: EditorSelectionRange,
	text: string,
	onChange: (value: string) => void,
) {
	const formattedText = formatReviewReferenceInsertion(
		target.value,
		range.start,
		range.end,
		text,
	);
	const nextValue = `${target.value.slice(0, range.start)}${formattedText}${target.value.slice(range.end)}`;
	onChange(nextValue);
	requestAnimationFrame(() => {
		const cursor = range.start + formattedText.length;
		target.setSelectionRange(cursor, cursor);
		target.focus();
	});
}

export function materializeReviewArticlePlaceholders(
	markdown: string,
	articleSectionsMarkdown: string | undefined,
	articlePlaceholderBlocks: Record<string, string> | undefined,
): string {
	const sectionMarkdown = (articleSectionsMarkdown || "").trim();
	let nextMarkdown = (markdown || "").replace(
		REVIEW_ARTICLE_SECTIONS_PLACEHOLDER,
		sectionMarkdown,
	);
	if (!articlePlaceholderBlocks) return nextMarkdown;
	for (const [slug, block] of Object.entries(articlePlaceholderBlocks)) {
		if (!slug) continue;
		const placeholder = `{{${slug}}}`;
		nextMarkdown = nextMarkdown.split(placeholder).join(block || "");
	}
	return nextMarkdown;
}

export function isLikelyInternalMediaUrl(url: string): boolean {
	const trimmed = url.trim();
	if (!trimmed) return false;
	if (
		trimmed.startsWith("/media/") ||
		trimmed.startsWith("/backend/media/")
	) {
		return true;
	}
	if (typeof window === "undefined") return false;
	try {
		const apiOrigin = new URL(getApiBaseUrl(), window.location.origin).origin;
		const parsed = new URL(trimmed);
		const isInternalPath =
			parsed.pathname.startsWith("/media/") ||
			parsed.pathname.startsWith("/backend/media/");
		return isInternalPath && parsed.origin === apiOrigin;
	} catch {
		return false;
	}
}
