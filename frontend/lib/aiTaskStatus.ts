import type { ReactNode } from "react";

import type { AIContentVersion, ArticleDetail } from "@/lib/api";

export const PENDING_JOB_STATUSES = ["pending", "processing"] as const;
export type PendingJobStatus = (typeof PENDING_JOB_STATUSES)[number];

export type AIContentType =
	| "summary"
	| "outline"
	| "quotes";
export type AITabKey = Exclude<AIContentType, "summary">;

export interface AITabConfig {
	key: AITabKey;
	label: string;
	enabled: boolean;
	content: string | null | undefined;
	status: string | null | undefined;
	onGenerate: () => void;
	onCopy: () => void;
	copyTitle?: string;
	canCopy?: boolean;
	renderMarkdown?: boolean;
	renderMindMap?: boolean;
	onMindMapOpen?: () => void;
	customContent?: ReactNode;
}

export interface ArticleNeighbor {
	id: string;
	slug: string;
	title: string;
	title_trans?: string | null;
};

export const VIEW_COUNT_STORAGE_PREFIX = "article-view::";

export const isPendingJobStatus = (
	value?: string | null,
): value is PendingJobStatus =>
	PENDING_JOB_STATUSES.includes(value as PendingJobStatus);

export const hasPendingArticleJob = (article: ArticleDetail | null): boolean => {
	if (!article) return false;
	if (isPendingJobStatus(article.status)) return true;
	if (isPendingJobStatus(article.translation_status)) return true;

	const statuses = article.ai_analysis
		? [
				article.ai_analysis.interpretation_status,
				article.ai_analysis.summary_status,
				article.ai_analysis.outline_status,
				article.ai_analysis.quotes_status,
			]
		: [];

	return statuses.some((status) => isPendingJobStatus(status));
};

export const hasAiTabContent = (content: string | null | undefined): boolean =>
	Boolean(content?.trim());

export const canManuallyGenerateAIContent = (
	status?: string | null,
	content?: string | null,
): boolean =>
	Boolean(content?.trim()) ||
	!status ||
	status === "completed" ||
	status === "failed" ||
	status === "skipped";

export const sortAiTabsByContent = (tabs: AITabConfig[]): AITabConfig[] =>
	[...tabs].sort(
		(left, right) =>
			Number(hasAiTabContent(right.content)) - Number(hasAiTabContent(left.content)),
	);

export const getArticleViewStorageKey = (slug: string): string =>
	`${VIEW_COUNT_STORAGE_PREFIX}${slug}`;

export function createEmptyAiAnalysis(): NonNullable<ArticleDetail["ai_analysis"]> {
	return {
		summary: null,
		summary_status: null,
		summary_current_version_id: null,
		summary_current_version_number: null,
		summary_has_history: false,
		outline: null,
		outline_status: null,
		outline_current_version_id: null,
		outline_current_version_number: null,
		outline_has_history: false,
		quotes: null,
		quotes_status: null,
		quotes_current_version_id: null,
		quotes_current_version_number: null,
		quotes_has_history: false,
		interpretation_status: null,
		interpretation_error: null,
		error_message: null,
		updated_at: null,
	};
}

export function getAiContentLabel(
	contentType: AIContentType,
	t: (key: string) => string,
): string {
	switch (contentType) {
		case "summary":
			return t("摘要");
		case "outline":
			return t("大纲");
		case "quotes":
			return t("金句");
	}
}

export function formatVersionSourceLabel(
	value: AIContentVersion["created_by_mode"],
	t: (key: string) => string,
): string {
	return value === "rollback" ? t("回滚") : t("生成");
}

export function toDateInputValue(value?: string | null): string {
	const raw = (value || "").trim();
	if (!raw) return "";
	const match = raw.match(/^(\d{4}-\d{2}-\d{2})/);
	if (match) return match[1];
	const parsed = new Date(raw);
	if (Number.isNaN(parsed.getTime())) return "";
	const year = parsed.getFullYear();
	const month = String(parsed.getMonth() + 1).padStart(2, "0");
	const day = String(parsed.getDate()).padStart(2, "0");
	return `${year}-${month}-${day}`;
}

export function splitArticleAuthors(value?: string | null): string[] {
	if (!value) return [];
	const authors = value
		.split(",")
		.map((item) => item.trim())
		.filter(Boolean);
	return Array.from(new Set(authors));
}

export const getPreferredNeighborTitle = (article: ArticleNeighbor): string => {
	const translatedTitle = article.title_trans?.trim();
	return translatedTitle || article.title;
};

export const getQueryValue = (value: string | string[] | undefined): string => {
	if (Array.isArray(value)) return value[0] || "";
	return value || "";
};

export const decodeQueryValue = (value: string): string => {
	if (!value) return "";
	try {
		return decodeURIComponent(value);
	} catch {
		return value;
	}
};
