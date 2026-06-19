export type AIHistoryContentType =
	| "summary"
	| "outline"
	| "quotes";

export interface AIHistoryVisibilityAnalysis {
	summary?: string | null;
	summary_has_history?: boolean;
	outline?: string | null;
	outline_has_history?: boolean;
	quotes?: string | null;
	quotes_has_history?: boolean;
}

const hasRenderableText = (value?: string | null): boolean => Boolean(value?.trim());

export const shouldShowAiHistoryButton = (
	isAdmin: boolean,
	contentType: AIHistoryContentType,
	analysis: AIHistoryVisibilityAnalysis | null | undefined,
): boolean => {
	if (!isAdmin || !analysis) {
		return false;
	}

	switch (contentType) {
		case "summary":
			return hasRenderableText(analysis.summary) || Boolean(analysis.summary_has_history);
		case "outline":
			return hasRenderableText(analysis.outline) || Boolean(analysis.outline_has_history);
		case "quotes":
			return hasRenderableText(analysis.quotes) || Boolean(analysis.quotes_has_history);
		default:
			return false;
	}
};
