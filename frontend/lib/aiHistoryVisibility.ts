export type AIHistoryContentType =
	| "summary"
	| "key_points"
	| "outline"
	| "quotes"
	| "infographic";

export interface AIHistoryVisibilityAnalysis {
	summary?: string | null;
	summary_has_history?: boolean;
	key_points?: string | null;
	key_points_has_history?: boolean;
	outline?: string | null;
	outline_has_history?: boolean;
	quotes?: string | null;
	quotes_has_history?: boolean;
	infographic_html?: string | null;
	infographic_image_url?: string | null;
	infographic_has_history?: boolean;
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
		case "key_points":
			return (
				hasRenderableText(analysis.key_points) ||
				Boolean(analysis.key_points_has_history)
			);
		case "outline":
			return hasRenderableText(analysis.outline) || Boolean(analysis.outline_has_history);
		case "quotes":
			return hasRenderableText(analysis.quotes) || Boolean(analysis.quotes_has_history);
		case "infographic":
			return (
				Boolean(analysis.infographic_has_history) ||
				hasRenderableText(analysis.infographic_html) ||
				hasRenderableText(analysis.infographic_image_url)
			);
		default:
			return false;
	}
};
