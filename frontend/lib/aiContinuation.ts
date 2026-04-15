import type { AICallSessionInfo } from "@/lib/api";

type Translate = (key: string) => string;

export type AIContinuationContentType =
  | "summary"
  | "key_points"
  | "outline"
  | "quotes"
  | "infographic";

export interface AIContinuationTarget {
  taskType?: string | null;
  contentType?: string | null;
  requestPayload?: string | null;
  sessionInfo?: AICallSessionInfo | null;
}

export interface AIContinuationModelOption {
  id: string;
}

const SUPPORTED_CONTENT_TYPES = new Set<AIContinuationContentType>([
  "summary",
  "key_points",
  "outline",
  "quotes",
  "infographic",
]);

export function isSupportedAIContinuationContentType(
  contentType: string | null | undefined,
): contentType is AIContinuationContentType {
  return SUPPORTED_CONTENT_TYPES.has(contentType as AIContinuationContentType);
}

export function isAIContinuationSupported(
  target: AIContinuationTarget | null | undefined,
): boolean {
  if (!target) return false;
  if (target.taskType !== "process_ai_content") return false;
  if (!isSupportedAIContinuationContentType(target.contentType)) return false;
  return Boolean(target.sessionInfo || target.requestPayload);
}

export function getAIContinuationCopy(
  contentType: string | null | undefined,
  t: Translate,
): {
  title: string;
  feedbackLabel: string;
  submitLabel: string;
  placeholder: string;
  successMessage: string;
  failureMessage: string;
} {
  if (contentType === "infographic") {
    return {
      title: t("提交修复说明"),
      feedbackLabel: t("修复说明"),
      submitLabel: t("提交修复"),
      placeholder: t("请描述当前信息图存在的布局、样式或内容问题"),
      successMessage: t("已提交信息图修复请求"),
      failureMessage: t("提交修复失败"),
    };
  }
  return {
    title: t("提交修改意见"),
    feedbackLabel: t("修改意见"),
    submitLabel: t("提交意见"),
    placeholder: t("请说明你希望本次 AI 结果如何调整"),
    successMessage: t("已提交修改意见"),
    failureMessage: t("提交修改意见失败"),
  };
}

export function resolveAIContinuationModelConfigId(
  sourceModelConfigId: string | null | undefined,
  options: AIContinuationModelOption[],
): string {
  const normalizedId = (sourceModelConfigId || "").trim();
  if (!normalizedId) return "";
  return options.some((option) => option.id === normalizedId) ? normalizedId : "";
}
