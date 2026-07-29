const TOPIC_PLACEHOLDER_RE = /\{\{topic:([^}]+)\}\}/g;
const TOPIC_ARTICLE_PLACEHOLDER_RE = /\{\{topic_article:([^}]+)\}\}/g;

export function buildTopicPlaceholder(key: string): string {
	return `{{topic:${(key || "").trim()}}}`;
}

export function buildTopicArticlePlaceholder(slug: string): string {
	return `{{topic_article:${(slug || "").trim()}}}`;
}

export function materializeTopicPlaceholders(
	markdown: string,
	topicTitles: Record<string, string> = {},
): string {
	const withTopics = (markdown || "").replace(TOPIC_PLACEHOLDER_RE, (_match, rawKey: string) => {
		const key = String(rawKey || "").trim();
		if (!key) return "";
		const title = topicTitles[key] || key;
		return `[#${title}](/topics/${encodeURIComponent(key)})`;
	});
	return withTopics.replace(TOPIC_ARTICLE_PLACEHOLDER_RE, (_match, rawSlug: string) => {
		const slug = String(rawSlug || "").trim();
		if (!slug) return "";
		return `{{${slug}}}`;
	});
}

export function compileStatusLabel(status?: string | null): string {
	const value = (status || "none").trim() || "none";
	switch (value) {
		case "queued":
			return "排队编译";
		case "synced":
			return "已同步";
		case "compiled":
			return "已沉淀";
		case "stale":
			return "待重新编译";
		case "failed":
			return "编译失败";
		default:
			return "尚未进入主题沉淀";
	}
}

export function compileStatusTone(
	status?: string | null,
): "neutral" | "info" | "success" | "warning" | "danger" {
	const value = (status || "none").trim() || "none";
	switch (value) {
		case "compiled":
			return "success";
		case "synced":
		case "queued":
			return "info";
		case "stale":
			return "warning";
		case "failed":
			return "danger";
		default:
			return "neutral";
	}
}
