const HTML_ENTITY_MAP: Record<string, string> = {
	amp: "&",
	lt: "<",
	gt: ">",
	quot: '"',
	apos: "'",
	nbsp: " ",
};

const decodeHtmlEntities = (value: string): string =>
	value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity) => {
		const normalized = String(entity).toLowerCase();
		if (normalized.startsWith("#x")) {
			const codePoint = Number.parseInt(normalized.slice(2), 16);
			return Number.isNaN(codePoint) ? match : String.fromCodePoint(codePoint);
		}
		if (normalized.startsWith("#")) {
			const codePoint = Number.parseInt(normalized.slice(1), 10);
			return Number.isNaN(codePoint) ? match : String.fromCodePoint(codePoint);
		}
		return HTML_ENTITY_MAP[normalized] ?? match;
	});

export const stripMarkdownStyles = (value?: string | null): string => {
	let text = value || "";
	if (!text) return "";

	text = text
		.replace(/\r\n?/g, "\n")
		.replace(/^[ \t]{0,3}\[[^\]]+\]:[^\n]*(?:\n|$)/gm, " ")
		.replace(/```[\s\S]*?```/g, (block) =>
			block.replace(/^```[^\n]*\n?/, "").replace(/\n?```$/, ""),
		)
		.replace(/~~~[\s\S]*?~~~/g, (block) =>
			block.replace(/^~~~[^\n]*\n?/, "").replace(/\n?~~~$/, ""),
		)
		.replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
		.replace(/!\[([^\]]*)\]\[[^\]]*\]/g, "$1")
		.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
		.replace(/\[([^\]]+)\]\[[^\]]*\]/g, "$1")
		.replace(/<((?:https?:\/\/|mailto:)[^>\s]+)>/gi, " ")
		.replace(/https?:\/\/[^\s<>()]+/gi, " ")
		.replace(/www\.[^\s<>()]+/gi, " ")
		.replace(/<style[\s\S]*?<\/style>/gi, " ")
		.replace(/<script[\s\S]*?<\/script>/gi, " ")
		.replace(/<[^>]+>/g, " ")
		.replace(/`([^`]+)`/g, "$1")
		.replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, "")
		.replace(/^[ \t]{0,3}>[ \t]?/gm, "")
		.replace(/^[ \t]*[-*+][ \t]+/gm, "")
		.replace(/^[ \t]*\d+\.[ \t]+/gm, "")
		.replace(/[*_~]{1,3}/g, "");

	return decodeHtmlEntities(text)
		.replace(/\s+/g, " ")
		.trim();
};
