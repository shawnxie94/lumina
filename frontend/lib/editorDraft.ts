export type EditorDraftMeta = {
  updatedAt: number;
  sourceUpdatedAt?: string | null;
};

export type EditorDraftRecord<TPayload> = EditorDraftMeta & {
  payload: TPayload;
};

export type ArticleEditorDraftPayload = {
  mode: "original" | "translation";
  title: string;
  author: string;
  publishedAt: string;
  categoryId: string;
  topImage: string;
  content: string;
};

export type ColumnEditorDraftPayload = {
  title: string;
  publishedAt: string;
  topImage: string;
  markdownContent: string;
};

const DRAFT_PREFIX = "lumina_editor_draft_v1";
const DEFAULT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const isBrowser = (): boolean => typeof window !== "undefined";

export const buildArticleEditorDraftKey = (
  articleId: string,
  mode: "original" | "translation",
): string => `${DRAFT_PREFIX}:article:${articleId}:${mode}`;

export const buildColumnEditorDraftKey = (issueId: string): string =>
  `${DRAFT_PREFIX}:column:${issueId}`;

const safeParseJson = <T,>(raw: string | null): T | null => {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
};

export const normalizeComparableText = (value?: string | null): string =>
  (value || "").replace(/\r\n/g, "\n");

export const isArticleEditorDraftDirty = (
  draft: ArticleEditorDraftPayload,
  baseline: ArticleEditorDraftPayload,
): boolean =>
  draft.mode === baseline.mode &&
  (normalizeComparableText(draft.title) !==
    normalizeComparableText(baseline.title) ||
    normalizeComparableText(draft.author) !==
      normalizeComparableText(baseline.author) ||
    normalizeComparableText(draft.publishedAt) !==
      normalizeComparableText(baseline.publishedAt) ||
    normalizeComparableText(draft.categoryId) !==
      normalizeComparableText(baseline.categoryId) ||
    normalizeComparableText(draft.topImage) !==
      normalizeComparableText(baseline.topImage) ||
    normalizeComparableText(draft.content) !==
      normalizeComparableText(baseline.content));

export const isColumnEditorDraftDirty = (
  draft: ColumnEditorDraftPayload,
  baseline: ColumnEditorDraftPayload,
): boolean =>
  normalizeComparableText(draft.title) !==
    normalizeComparableText(baseline.title) ||
  normalizeComparableText(draft.publishedAt) !==
    normalizeComparableText(baseline.publishedAt) ||
  normalizeComparableText(draft.topImage) !==
    normalizeComparableText(baseline.topImage) ||
  normalizeComparableText(draft.markdownContent) !==
    normalizeComparableText(baseline.markdownContent);

export const isEditorDraftFresh = (
  draft: EditorDraftMeta | null | undefined,
  options?: {
    maxAgeMs?: number;
    sourceUpdatedAt?: string | null;
  },
): boolean => {
  if (!draft || !Number.isFinite(draft.updatedAt)) return false;
  const maxAgeMs = options?.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
  if (Date.now() - draft.updatedAt > maxAgeMs) return false;
  if (
    options?.sourceUpdatedAt &&
    draft.sourceUpdatedAt &&
    draft.sourceUpdatedAt !== options.sourceUpdatedAt
  ) {
    return false;
  }
  return true;
};

export const readEditorDraft = <TPayload,>(
  key: string,
): EditorDraftRecord<TPayload> | null => {
  if (!isBrowser() || !key) return null;
  try {
    const parsed = safeParseJson<EditorDraftRecord<TPayload>>(
      window.localStorage.getItem(key),
    );
    if (!parsed || typeof parsed !== "object") return null;
    if (typeof parsed.updatedAt !== "number" || parsed.payload == null) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
};

export const writeEditorDraft = <TPayload,>(
  key: string,
  payload: TPayload,
  options?: {
    sourceUpdatedAt?: string | null;
    updatedAt?: number;
  },
): EditorDraftRecord<TPayload> | null => {
  if (!isBrowser() || !key) return null;
  const record: EditorDraftRecord<TPayload> = {
    payload,
    updatedAt: options?.updatedAt ?? Date.now(),
    sourceUpdatedAt: options?.sourceUpdatedAt ?? null,
  };
  try {
    window.localStorage.setItem(key, JSON.stringify(record));
    return record;
  } catch {
    return null;
  }
};

export const clearEditorDraft = (key: string): void => {
  if (!isBrowser() || !key) return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    // ignore storage failures
  }
};

export const formatEditorDraftTime = (
  updatedAt: number,
  language: "zh-CN" | "en" = "zh-CN",
): string => {
  if (!Number.isFinite(updatedAt) || updatedAt <= 0) return "";
  try {
    return new Intl.DateTimeFormat(language === "en" ? "en-US" : "zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(new Date(updatedAt));
  } catch {
    return new Date(updatedAt).toLocaleString();
  }
};
