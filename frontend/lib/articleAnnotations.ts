import { renderSafeMarkdown } from "@/lib/safeHtml";

export type NoteRecommendationLevel =
	| "strongly_recommended"
	| "recommended"
	| "neutral"
	| "not_recommended";

export const DEFAULT_NOTE_RECOMMENDATION_LEVEL: NoteRecommendationLevel =
	"neutral";
export const NOTE_RECOMMENDATION_LEVEL_OPTIONS: Array<{
	value: NoteRecommendationLevel;
	label: string;
}> = [
	{ value: "strongly_recommended", label: "强烈推荐" },
	{ value: "recommended", label: "推荐" },
	{ value: "neutral", label: "一般" },
	{ value: "not_recommended", label: "不推荐" },
];

export interface ArticleAnnotation {
	id: string;
	start: number;
	end: number;
	comment: string;
}

export function createAnnotationId() {
	if (typeof crypto !== "undefined" && crypto.randomUUID) {
		return crypto.randomUUID();
	}
	return `anno_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

export function getRangeOffsets(root: HTMLElement, range: Range) {
	const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
	let startOffset = 0;
	let endOffset = 0;
	let current = walker.nextNode();
	let offset = 0;

	while (current) {
		const textNode = current as Text;
		const length = textNode.data.length;
		if (textNode === range.startContainer) {
			startOffset = offset + range.startOffset;
		}
		if (textNode === range.endContainer) {
			endOffset = offset + range.endOffset;
			break;
		}
		offset += length;
		current = walker.nextNode();
	}

	return { start: startOffset, end: endOffset };
}

export function getRangeSnippet(
	root: HTMLElement,
	start: number,
	end: number,
	context = 40,
) {
	if (start >= end) return "";
	const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
	let current = walker.nextNode();
	let fullText = "";

	while (current) {
		const node = current as Text;
		fullText += node.data;
		current = walker.nextNode();
	}

	const safeStart = Math.max(0, start);
	const safeEnd = Math.min(fullText.length, end);
	const left = Math.max(0, safeStart - context);
	const right = Math.min(fullText.length, safeEnd + context);
	const prefix = left > 0 ? "…" : "";
	const suffix = right < fullText.length ? "…" : "";
	const before = fullText.slice(left, safeStart);
	const middle = fullText.slice(safeStart, safeEnd);
	const after = fullText.slice(safeEnd, right);
	return `${prefix}${before}<mark class="annotation-highlight">${middle}</mark>${after}${suffix}`.trim();
}

export function applyAnnotations(
	html: string,
	annotations: ArticleAnnotation[],
) {
	if (!annotations || annotations.length === 0) return html;
	if (typeof window === "undefined") return html;

	const sorted = [...annotations].sort((a, b) => a.start - b.start);
	const parser = new DOMParser();
	const doc = parser.parseFromString(html, "text/html");

	const textNodes: Array<{ node: Text; start: number; end: number }> = [];
	const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
	let offset = 0;
	let current = walker.nextNode();
	while (current) {
		const node = current as Text;
		const length = node.data.length;
		textNodes.push({ node, start: offset, end: offset + length });
		offset += length;
		current = walker.nextNode();
	}

	sorted.forEach((annotation) => {
		textNodes.forEach(({ node, start, end }) => {
			if (end <= annotation.start) return;
			if (start >= annotation.end) return;
			if (!node.parentNode) return;
			const text = node.data;
			const highlightStart = Math.max(annotation.start - start, 0);
			const highlightEnd = Math.min(annotation.end - start, text.length);
			if (highlightStart >= highlightEnd) return;
			const before = text.slice(0, highlightStart);
			const middle = text.slice(highlightStart, highlightEnd);
			const after = text.slice(highlightEnd);
			const frag = doc.createDocumentFragment();
			if (before) frag.appendChild(doc.createTextNode(before));
			const mark = doc.createElement("mark");
			mark.className = "annotation-highlight";
			mark.setAttribute("data-annotation-id", annotation.id);
			mark.textContent = middle;
			frag.appendChild(mark);
			if (after) frag.appendChild(doc.createTextNode(after));
			node.replaceWith(frag);
		});
	});

	return doc.body.innerHTML;
}

export function renderMarkdown(
	content: string,
	options?: { enableMediaEmbed?: boolean },
) {
	return renderSafeMarkdown(content, options);
}

export function normalizeNoteRecommendationLevel(
	value?: string | null,
): NoteRecommendationLevel {
	if (!value) return DEFAULT_NOTE_RECOMMENDATION_LEVEL;
	const matched = NOTE_RECOMMENDATION_LEVEL_OPTIONS.find(
		(item) => item.value === value,
	);
	return matched?.value || DEFAULT_NOTE_RECOMMENDATION_LEVEL;
}
