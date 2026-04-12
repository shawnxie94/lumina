import type { ModelAPIConfig } from "./api";

export const FALLBACK_REVIEW_TIMEZONE = "Asia/Shanghai";
export const REVIEW_TEMPLATE_MODAL_PANEL_CLASSNAME =
	"max-h-[90vh] overflow-y-auto overflow-x-visible";
export const REVIEW_TEMPLATE_HELP_PANEL_WIDTH = 320;
export const REVIEW_TEMPLATE_HELP_PANEL_GAP = 8;
export const REVIEW_TEMPLATE_HELP_VIEWPORT_PADDING = 16;

type ReviewTemplateHelpRect = {
	top: number;
	left: number;
	width: number;
	height: number;
};

type ReviewTemplateHelpViewport = {
	width: number;
	height: number;
};

type ReviewTemplateHelpBounds = {
	left: number;
	top: number;
	right: number;
	bottom: number;
};

export type ReviewTemplateHelpPlacement = {
	left: number;
	top: number;
};

export const shouldShowReviewTemplateModalRunAction = () => false;

export const buildReviewTaskMonitorUrl = (taskId: string): string => {
	const params = new URLSearchParams();
	params.set("task_type", "generate_review_issue");
	params.set("task_id", taskId);
	params.set("open_task_detail", "1");
	return `/admin/monitoring/tasks?${params.toString()}`;
};

const clamp = (value: number, min: number, max: number) => {
	if (min > max) return min;
	return Math.min(Math.max(value, min), max);
};

export const resolveReviewTemplateDefaultTimezone = (
	getTimeZone?: () => string | null | undefined,
): string => {
	const resolved = getTimeZone?.()?.trim();
	return resolved || FALLBACK_REVIEW_TIMEZONE;
};

export const filterReviewTemplateModelOptions = <T extends Pick<ModelAPIConfig, "is_enabled" | "model_type">>(
	models: T[],
): T[] =>
	models.filter(
		(model) => model.is_enabled && (model.model_type || "general") !== "vector",
	);

export const resolveReviewTemplateHelpPlacement = ({
	triggerRect,
	panelWidth,
	panelHeight,
	viewport,
	bounds,
}: {
	triggerRect: ReviewTemplateHelpRect;
	panelWidth: number;
	panelHeight: number;
	viewport: ReviewTemplateHelpViewport;
	bounds?: ReviewTemplateHelpBounds;
}): ReviewTemplateHelpPlacement => {
	const horizontalMin =
		bounds?.left ?? REVIEW_TEMPLATE_HELP_VIEWPORT_PADDING;
	const horizontalMax =
		(bounds?.right ?? viewport.width - REVIEW_TEMPLATE_HELP_VIEWPORT_PADDING) - panelWidth;
	const preferredLeft = triggerRect.left + triggerRect.width - panelWidth;
	const left = clamp(
		preferredLeft,
		horizontalMin,
		horizontalMax,
	);

	const preferredTop = triggerRect.top + triggerRect.height + REVIEW_TEMPLATE_HELP_PANEL_GAP;
	const verticalMin =
		bounds?.top ?? REVIEW_TEMPLATE_HELP_VIEWPORT_PADDING;
	const verticalMax =
		(bounds?.bottom ?? viewport.height - REVIEW_TEMPLATE_HELP_VIEWPORT_PADDING) - panelHeight;
	const top =
		preferredTop <= verticalMax
			? preferredTop
			: clamp(
					triggerRect.top - panelHeight - REVIEW_TEMPLATE_HELP_PANEL_GAP,
					verticalMin,
					verticalMax,
				);

	return { left, top };
};
