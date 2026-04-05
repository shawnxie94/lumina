import axios from "axios";
import { notificationStore } from "@/lib/notifications";

declare global {
	interface Window {
		__LUMINA_RUNTIME_CONFIG__?: {
			apiBaseUrl?: string;
			errorTaskPollIntervalMs?: number | string;
		};
	}
}

export const DEFAULT_ERROR_TASK_POLL_INTERVAL_MS = 10 * 60 * 1000;
const LANGUAGE_STORAGE_KEY = "ui_language";

const getUiLanguage = (): "zh-CN" | "en" => {
	if (typeof window === "undefined") return "zh-CN";
	const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY);
	if (stored === "zh-CN" || stored === "en") return stored;
	const browserLang = navigator.language?.toLowerCase() || "";
	return browserLang.startsWith("en") ? "en" : "zh-CN";
};

const localize = (zhText: string, enText: string): string =>
	getUiLanguage() === "en" ? enText : zhText;

const normalizeBaseUrl = (value?: string | null): string => {
	const trimmed = value?.trim();
	if (!trimmed) return "";
	return trimmed.replace(/\/+$/, "");
};

const getRuntimeApiBaseUrl = (): string => {
	if (typeof window === "undefined") return "";
	return normalizeBaseUrl(window.__LUMINA_RUNTIME_CONFIG__?.apiBaseUrl);
};

const parsePositiveInt = (value: unknown): number | null => {
	if (value === null || value === undefined) return null;
	const parsed = Number.parseInt(String(value), 10);
	if (!Number.isFinite(parsed) || parsed <= 0) return null;
	return parsed;
};

export const getErrorTaskPollIntervalMs = (): number => {
	if (typeof window !== "undefined") {
		const runtimeValue = parsePositiveInt(
			window.__LUMINA_RUNTIME_CONFIG__?.errorTaskPollIntervalMs,
		);
		if (runtimeValue !== null) {
			return runtimeValue;
		}
	}
	const publicValue = parsePositiveInt(
		process.env.NEXT_PUBLIC_ERROR_TASK_POLL_INTERVAL_MS,
	);
	if (publicValue !== null) {
		return publicValue;
	}
	return DEFAULT_ERROR_TASK_POLL_INTERVAL_MS;
};

export const getApiBaseUrl = (): string => {
	const runtimeBaseUrl = getRuntimeApiBaseUrl();
	if (runtimeBaseUrl) {
		return runtimeBaseUrl;
	}
	if (typeof window !== "undefined") {
		const isLocalhost =
			window.location.hostname === "localhost" ||
			window.location.hostname === "127.0.0.1";
		if (isLocalhost && window.location.port === "3000") {
			return "http://localhost:8000/backend";
		}
		return `${window.location.origin}/backend`;
	}
	const apiBaseUrl = normalizeBaseUrl(process.env.API_BASE_URL);
	if (apiBaseUrl) {
		return apiBaseUrl;
	}
	const backendApiUrl = normalizeBaseUrl(process.env.BACKEND_API_URL);
	if (backendApiUrl) {
		return backendApiUrl;
	}
	if (process.env.NODE_ENV === "development") {
		return "http://localhost:8000/backend";
	}
	return "http://api:8000/backend";
};

export const normalizePublicRssTagIds = (tagIds?: string[] | null): string[] =>
	[...(tagIds || [])]
		.map((item) => item.trim())
		.filter(Boolean)
		.filter((item, index, values) => values.indexOf(item) === index)
		.sort((left, right) => left.localeCompare(right));

const buildPublicRssQueryString = (params?: {
	categoryId?: string;
	tagIds?: string[];
}): string => {
	const searchParams = new URLSearchParams();
	const categoryId = params?.categoryId?.trim();
	const tagIds = normalizePublicRssTagIds(params?.tagIds);
	if (categoryId) {
		searchParams.set("category_id", categoryId);
	}
	if (tagIds.length > 0) {
		searchParams.set("tag_ids", tagIds.join(","));
	}
	const queryString = searchParams.toString();
	return queryString ? `?${queryString}` : "";
};

const buildPublicReviewRssQueryString = (params?: {
	templateId?: string;
}): string => {
	const searchParams = new URLSearchParams();
	const templateId = params?.templateId?.trim();
	if (templateId) {
		searchParams.set("template_id", templateId);
	}
	const queryString = searchParams.toString();
	return queryString ? `?${queryString}` : "";
};

export const buildPublicRssRelativeUrl = (params?: {
	categoryId?: string;
	tagIds?: string[];
}): string => `/backend/api/articles/rss.xml${buildPublicRssQueryString(params)}`;

export const buildPublicRssUrl = (params?: {
	categoryId?: string;
	tagIds?: string[];
}): string => {
	if (typeof window !== "undefined") {
		return `${window.location.origin}${buildPublicRssRelativeUrl(params)}`;
	}
	return `${getApiBaseUrl()}/api/articles/rss.xml${buildPublicRssQueryString(params)}`;
};

export const buildClientSafePublicRssUrl = (params?: {
	categoryId?: string;
	tagIds?: string[];
}): string => {
	if (typeof window === "undefined") {
		if (process.env.NODE_ENV === "development") {
			return `http://localhost:8000/backend/api/articles/rss.xml${buildPublicRssQueryString(params)}`;
		}
		return buildPublicRssRelativeUrl(params);
	}
	return buildPublicRssUrl(params);
};

export const buildPublicReviewRssRelativeUrl = (params?: {
	templateId?: string;
}): string => `/backend/api/reviews/rss.xml${buildPublicReviewRssQueryString(params)}`;

export const buildPublicReviewRssUrl = (params?: {
	templateId?: string;
}): string => {
	if (typeof window !== "undefined") {
		return `${window.location.origin}${buildPublicReviewRssRelativeUrl(params)}`;
	}
	return `${getApiBaseUrl()}/api/reviews/rss.xml${buildPublicReviewRssQueryString(params)}`;
};

export const resolveMediaUrl = (url?: string | null): string => {
	if (!url) return "";
	if (url.startsWith("/backend/media/")) {
		return url;
	}
	if (url.startsWith("/media/")) {
		return `/backend${url}`;
	}
	try {
		const parsed = new URL(url);
		const isLocalhost =
			parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
		const isMediaPath =
			parsed.pathname.startsWith("/media/") ||
			parsed.pathname.startsWith("/backend/media/");
		if (isLocalhost && isMediaPath) {
			return parsed.pathname.startsWith("/backend/")
				? parsed.pathname
				: `/backend${parsed.pathname}`;
		}
	} catch {
		return url;
	}
	return url;
};

export const normalizeMediaHtml = (html: string): string => {
	if (typeof window === "undefined") return html;
	try {
		const parser = new DOMParser();
		const doc = parser.parseFromString(html, "text/html");
		doc.querySelectorAll("img, video, audio, source, embed").forEach((element) => {
			const src = element.getAttribute("src");
			const resolved = resolveMediaUrl(src);
			if (resolved && resolved !== src) {
				element.setAttribute("src", resolved);
			}
		});
		doc.querySelectorAll("a[href]").forEach((element) => {
			const href = element.getAttribute("href");
			const resolved = resolveMediaUrl(href);
			if (resolved && resolved !== href) {
				element.setAttribute("href", resolved);
			}
		});
		return doc.body.innerHTML;
	} catch {
		return html;
	}
};

const sleep = (ms: number): Promise<void> =>
	new Promise((resolve) => setTimeout(resolve, ms));

const isTransientNetworkError = (error: unknown): boolean => {
	if (!axios.isAxiosError(error)) return false;
	if (error.response) return false;
	const normalized = `${error.code || ""} ${error.message || ""}`.toLowerCase();
	return (
		normalized.includes("network error") ||
		normalized.includes("err_connection_closed") ||
		normalized.includes("econnreset") ||
		normalized.includes("socket hang up") ||
		normalized.includes("timeout")
	);
};

const API_URL = getApiBaseUrl();

const api = axios.create({
	baseURL: API_URL,
	withCredentials: true,
	headers: {
		"Content-Type": "application/json",
	},
});

const LEGACY_WEB_ADMIN_TOKEN_KEY = "admin_token";

export const clearLegacyWebAdminToken = (): void => {
	if (typeof window === "undefined") return;
	localStorage.removeItem(LEGACY_WEB_ADMIN_TOKEN_KEY);
};

// ============ 请求拦截器 ============

api.interceptors.request.use(
	(config) => {
		config.baseURL = getApiBaseUrl();
		if (typeof FormData !== "undefined" && config.data instanceof FormData) {
			if (config.headers && typeof (config.headers as { delete?: (name: string) => void }).delete === "function") {
				(config.headers as { delete: (name: string) => void }).delete("Content-Type");
			} else if (config.headers) {
				delete (config.headers as Record<string, unknown>)["Content-Type"];
				delete (config.headers as Record<string, unknown>)["content-type"];
			}
		}
		return config;
	},
	(error) => {
		return Promise.reject(error);
	},
);

// ============ 响应拦截器：处理 401 错误 ============

api.interceptors.response.use(
	(response) => response,
	(error) => {
		try {
			if (typeof window !== "undefined") {
				const status = error?.response?.status;
				const detail =
					error?.response?.data?.detail ||
					error?.response?.data?.message ||
					error?.message ||
					localize("未知错误", "Unknown error");
				const endpoint = error?.config?.url || "";
				const method =
					error?.config?.method?.toUpperCase() ||
					localize("请求", "REQUEST");
				notificationStore.add({
					id: `api:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
					title: localize("接口请求失败", "API request failed"),
					message: `${method} ${endpoint} ${
						status ? `(${status})` : ""
					} ${detail}`.trim(),
					level: "error",
					source: "api",
					category: localize("接口错误", "API error"),
					createdAt: new Date().toISOString(),
				});
			}
		} catch {
			// ignore
		}
		// 401 错误不自动清除 token，让调用方决定如何处理
		return Promise.reject(error);
	},
);

// ============ 认证相关类型 ============

export interface AuthStatus {
	initialized: boolean;
}

export interface AuthVerifyResponse {
	valid: boolean;
	role: "admin" | "guest";
}

export interface LoginResponse {
	token: string;
	message: string;
}

// ============ 认证 API ============

export const authApi = {
	/** 获取认证状态：是否已初始化管理员密码 */
	getStatus: async (): Promise<AuthStatus> => {
		const response = await api.get("/api/auth/status");
		return response.data;
	},

	/** 首次设置管理员密码 */
	setup: async (password: string): Promise<LoginResponse> => {
		const response = await api.post("/api/auth/setup", { password });
		return response.data;
	},

	/** 管理员登录 */
	login: async (password: string): Promise<LoginResponse> => {
		const response = await api.post("/api/auth/login", { password });
		return response.data;
	},

	/** 验证当前 token 是否有效 */
	verify: async (): Promise<AuthVerifyResponse> => {
		const response = await api.get("/api/auth/verify");
		return response.data;
	},

	getExtensionToken: async (): Promise<LoginResponse> => {
		const response = await api.post("/api/auth/extension-token");
		return response.data;
	},

	/** 修改管理员密码 */
	changePassword: async (
		oldPassword: string,
		newPassword: string,
	): Promise<LoginResponse> => {
		const response = await api.put("/api/auth/password", {
			old_password: oldPassword,
			new_password: newPassword,
		});
		return response.data;
	},

	/** 管理员登出 */
	logout: async (): Promise<{ message: string }> => {
		const response = await api.post("/api/auth/logout");
		return response.data;
	},
};

export interface Article {
	id: string;
	slug: string;  // SEO友好的URL slug
	title: string;
	title_trans?: string | null;
	summary: string;
	top_image: string;
	category: { id: string; name: string; color?: string } | null;
	tags: Tag[];
	author: string;
	status: string;
	source_domain: string | null;
	published_at: string | null;
	created_at: string;
	is_visible: boolean;
	view_count: number;
	comment_count: number;
	original_language?: string;
	note_recommendation_level?:
		| "strongly_recommended"
		| "recommended"
		| "neutral"
		| "not_recommended"
		| null;
}

export interface ArticleDetail extends Article {
	content_html: string;
	content_md: string;
	content_trans: string;
	translation_status: string | null;
	translation_error: string | null;
	source_url: string;
	published_at: string | null;
	is_visible: boolean;
	note_content?: string | null;
	note_annotations?: string | null;
	note_recommendation_level?:
		| "strongly_recommended"
		| "recommended"
		| "neutral"
		| "not_recommended"
		| null;
	ai_analysis: {
		summary: string | null;
		summary_status: string | null;
		summary_current_version_id?: string | null;
		summary_current_version_number?: number | null;
		summary_has_history?: boolean;
		key_points: string | null;
		key_points_status: string | null;
		key_points_current_version_id?: string | null;
		key_points_current_version_number?: number | null;
		key_points_has_history?: boolean;
		outline: string | null;
		outline_status: string | null;
		outline_current_version_id?: string | null;
		outline_current_version_number?: number | null;
		outline_has_history?: boolean;
		quotes: string | null;
		quotes_status: string | null;
		quotes_current_version_id?: string | null;
		quotes_current_version_number?: number | null;
		quotes_has_history?: boolean;
		infographic_status: string | null;
		infographic_image_url?: string | null;
		infographic_html?: string | null;
		infographic_current_version_id?: string | null;
		infographic_current_version_number?: number | null;
		infographic_has_history?: boolean;
		tagging_status: string | null;
		tagging_manual_override?: boolean | null;
		error_message?: string | null;
		updated_at?: string | null;
	} | null;
	prev_article?: {
		id: string;
		slug: string;
		title: string;
		title_trans?: string | null;
	} | null;
	next_article?: {
		id: string;
		slug: string;
		title: string;
		title_trans?: string | null;
	} | null;
}

export interface SimilarArticleItem {
	id: string;
	slug: string;
	title: string;
	title_trans?: string | null;
	published_at: string | null;
	created_at: string;
	category_id?: string | null;
	category_name?: string | null;
	category_color?: string | null;
}

export interface SimilarArticleResponse {
	status: "ready" | "pending" | "disabled";
	items: SimilarArticleItem[];
}

export type VersionedAIContentType =
	| "summary"
	| "key_points"
	| "outline"
	| "quotes"
	| "infographic";

export interface AIContentVersion {
	id: string;
	content_type: VersionedAIContentType;
	version_number: number;
	status: string;
	content_text?: string | null;
	content_html?: string | null;
	content_image_url?: string | null;
	created_by_mode: "generation" | "rollback" | string;
	rollback_from_version_id?: string | null;
	created_at: string;
	is_current?: boolean;
}

export interface AIContentVersionListResponse {
	article_id: string;
	content_type: VersionedAIContentType;
	versions: AIContentVersion[];
}

export type DeletableAIContentType = Exclude<VersionedAIContentType, "summary">;

export interface RecommendationSettings {
	recommendations_enabled: boolean;
	recommendation_model_config_id: string;
}

export interface RecommendationEmbeddingRefreshResult {
	success: boolean;
	scope_limit: number;
	scanned_articles: number;
	queued_tasks: number;
	skipped_articles: number;
}

export interface ArticleComment {
	id: string;
	article_id: string;
	article_slug?: string;
	user_id: string;
	user_name: string;
	user_avatar: string | null;
	provider: string | null;
	content: string;
	reply_to_id?: string | null;
	is_hidden?: boolean;
	created_at: string;
	updated_at: string;
}

export interface ReviewComment {
	id: string;
	review_id: string;
	review_slug?: string;
	user_id: string;
	user_name: string;
	user_avatar: string | null;
	provider: string | null;
	content: string;
	reply_to_id?: string | null;
	is_hidden?: boolean;
	created_at: string;
	updated_at: string;
}

export interface CommentSettings {
	comments_enabled: boolean;
	github_client_id: string;
	github_client_secret: string;
	google_client_id: string;
	google_client_secret: string;
	nextauth_secret: string;
	sensitive_filter_enabled: boolean;
	sensitive_words: string;
}

export interface StorageSettings {
	media_storage_enabled: boolean;
	media_compress_threshold: number;
	media_max_dim: number;
	media_webp_quality: number;
}

export interface BasicSettings {
	default_language: "zh-CN" | "en";
	site_name: string;
	site_description: string;
	site_logo_url: string;
	rss_enabled: boolean;
	home_badge_text: string;
	home_tagline_text: string;
	home_primary_button_text: string;
	home_primary_button_url: string;
	home_secondary_button_text: string;
	home_secondary_button_url: string;
}

export type ReviewScheduleType = "weekly" | "monthly" | "custom_days";
export type ReviewIssueStatus = "draft" | "published";
export type ReviewTemplateInputMode = "abstract" | "summary" | "full_text";

export interface ReviewIssueArticle {
	id?: string;
	article_id: string;
	category_id?: string | null;
	category_sort_order: number;
	article_sort_order: number;
}

export interface ReviewIssueVersionSummary {
	id: string;
	slug: string;
	title: string;
	status: ReviewIssueStatus;
	generated_at?: string | null;
	published_at?: string | null;
	created_at: string;
	updated_at: string;
}

export interface ReviewNeighbor {
	id: string;
	slug: string;
	title: string;
	published_at?: string | null;
	updated_at?: string | null;
}

export interface ReviewTemplateSummary {
	id: string;
	name: string;
	slug: string;
	include_all_categories?: boolean;
	model_api_config_id?: string | null;
	review_input_mode?: ReviewTemplateInputMode;
	description?: string | null;
	schedule_type?: ReviewScheduleType;
	custom_interval_days?: number | null;
	trigger_time?: string | null;
	category_names?: string[];
	temperature?: number | null;
	max_tokens?: number | null;
	top_p?: number | null;
}

export interface ReviewTemplate {
	id: string;
	name: string;
	slug: string;
	description?: string | null;
	is_enabled: boolean;
	schedule_type: ReviewScheduleType;
	custom_interval_days?: number | null;
	anchor_date: string;
	timezone: string;
	trigger_time: string;
	include_all_categories: boolean;
	category_ids: string[];
	model_api_config_id?: string | null;
	review_input_mode: ReviewTemplateInputMode;
	system_prompt?: string | null;
	prompt_template: string;
	temperature?: number | null;
	max_tokens?: number | null;
	top_p?: number | null;
	title_template: string;
	next_run_at?: string | null;
	last_run_at?: string | null;
	created_at: string;
	updated_at: string;
}

export type ReviewTemplateMutationInput = Omit<
	ReviewTemplate,
	"id" | "slug" | "created_at" | "updated_at" | "next_run_at" | "last_run_at"
>;

export interface ReviewIssue {
	id: string;
	slug: string;
	title: string;
	status: ReviewIssueStatus;
	window_start: string;
	window_end: string;
	top_image?: string | null;
	generated_at?: string | null;
	published_at?: string | null;
	created_at: string;
	updated_at: string;
	view_count?: number;
	template: ReviewTemplateSummary | null;
	category_names: string[];
	summary: string;
	version_count?: number;
	versions?: ReviewIssueVersionSummary[];
	markdown_content?: string;
	article_sections_markdown?: string;
	article_placeholder_blocks?: Record<string, string>;
	selected_article_ids?: string[];
	rendered_markdown?: string;
	comment_count?: number;
	prev_review?: ReviewNeighbor | null;
	next_review?: ReviewNeighbor | null;
	recent_reviews?: ReviewNeighbor[];
}

export interface ReviewTemplateFilterItem {
	id: string;
	name: string;
	slug: string;
	count: number;
}

export interface ReviewGenerationCandidate {
	id: string;
	slug: string;
	title: string;
	summary: string;
	top_image?: string | null;
	created_at: string;
	category: {
		id: string;
		name: string;
	} | null;
}

export interface ReviewTemplateGenerationPreview {
	template: ReviewTemplateSummary;
	date_start: string;
	date_end: string;
	window_start: string;
	window_end: string;
	period_label: string;
	articles: ReviewGenerationCandidate[];
}

export interface ReviewIssueListResponse {
	data: ReviewIssue[];
	filters: {
		templates: ReviewTemplateFilterItem[];
	};
	pagination: {
		page: number;
		size: number;
		total: number;
		total_pages: number;
	};
}

export interface BackupImportResult {
	success: boolean;
	meta: {
		backup_exported_at: string;
		backup_format_version: number;
		backup_source_schema_version: string;
		restored_at: string;
	};
	restored: {
		includes: {
			comments: boolean;
			media: boolean;
			secrets: boolean;
		};
	};
}

export interface CommentListResponse {
	items: ArticleComment[];
	pagination: {
		page: number;
		size: number;
		total: number;
		total_pages: number;
	};
}

export interface Category {
	id: string;
	name: string;
	description: string;
	color: string;
	article_count: number;
}

export interface Tag {
	id: string;
	name: string;
	article_count?: number;
}

export interface ModelAPIConfig {
	id: string;
	name: string;
	base_url: string;
	api_key: string;
	provider?: string | null;
	model_name: string;
	model_type?: string | null;
	price_input_per_1k?: number | null;
	price_output_per_1k?: number | null;
	currency?: string | null;
	context_window_tokens?: number | null;
	reserve_output_tokens?: number | null;
	is_enabled: boolean;
	is_default: boolean;
	created_at: string;
	updated_at: string;
}

export interface AIUsageLogItem {
	id: string;
	model_api_config_id: string | null;
	model_api_config_name: string | null;
	task_id: string | null;
	article_id: string | null;
	article_slug?: string | null;
	task_type: string | null;
	content_type: string | null;
	status: string;
	prompt_tokens: number | null;
	completion_tokens: number | null;
	total_tokens: number | null;
	cost_input: number | null;
	cost_output: number | null;
	cost_total: number | null;
	currency: string | null;
	latency_ms: number | null;
	error_message: string | null;
	request_payload: string | null;
	response_payload: string | null;
	created_at: string;
}

export interface AIUsageListResponse {
	items: AIUsageLogItem[];
	total: number;
	page: number;
	size: number;
}

export interface AIUsageSummaryResponse {
	summary: {
		calls: number;
		prompt_tokens: number;
		completion_tokens: number;
		total_tokens: number;
		cost_total: number;
	};
	by_model: Array<{
		model_api_config_id: string | null;
		model_api_config_name: string | null;
		currency: string | null;
		calls: number;
		prompt_tokens: number;
		completion_tokens: number;
		total_tokens: number;
		cost_total: number;
	}>;
}

export interface AITaskTimelineEvent {
	id: string;
	event_type: string;
	from_status: string | null;
	to_status: string | null;
	message: string | null;
	error_type: string | null;
	details: Record<string, unknown> | string | null;
	created_at: string;
}

export interface AITaskTimelineUsage {
	id: string;
	model_api_config_id: string | null;
	model_api_config_name: string | null;
	task_type: string | null;
	content_type: string | null;
	status: string;
	prompt_tokens: number | null;
	completion_tokens: number | null;
	total_tokens: number | null;
	cost_total: number | null;
	currency: string | null;
	latency_ms: number | null;
	finish_reason: string | null;
	truncated: boolean | null;
	chunk_index: number | null;
	continue_round: number | null;
	estimated_input_tokens: number | null;
	error_message: string | null;
	request_payload: string | null;
	response_payload: string | null;
	created_at: string;
}

export interface AITaskTimelineResponse {
	task: {
		id: string;
		article_id: string | null;
		article_title: string | null;
		article_slug: string | null;
		article_kind?: string | null;
		task_type: string;
		content_type: string | null;
		status: string;
		attempts: number;
		max_attempts: number;
		run_at: string | null;
		locked_at: string | null;
		locked_by: string | null;
		last_error: string | null;
		last_error_type: string | null;
		created_at: string;
		updated_at: string;
		finished_at: string | null;
	};
	events: AITaskTimelineEvent[];
	usage: AITaskTimelineUsage[];
}

export interface AITaskListItem {
	id: string;
	article_id: string | null;
	article_title: string | null;
	article_slug: string | null;
	article_kind?: string | null;
	task_type: string;
	content_type: string | null;
	status: string;
	attempts: number;
	max_attempts: number;
	run_at: string | null;
	locked_at: string | null;
	locked_by: string | null;
	last_error: string | null;
	last_error_type?: string | null;
	created_at: string;
	updated_at: string;
	finished_at: string | null;
}

export interface AITaskListResponse {
	data: AITaskListItem[];
	pagination: {
		page: number;
		size: number;
		total: number;
		total_pages: number;
	};
}

export interface PromptConfig {
	id: string;
	name: string;
	category_id: string | null;
	category_name: string | null;
	type: string;
	prompt: string;
	system_prompt?: string | null;
	temperature?: number | null;
	max_tokens?: number | null;
	top_p?: number | null;
	chunk_size_tokens?: number | null;
	chunk_overlap_tokens?: number | null;
	max_continue_rounds?: number | null;
	model_api_config_id: string | null;
	model_api_config_name: string | null;
	is_enabled: boolean;
	is_default: boolean;
	created_at: string;
	updated_at: string;
}

export const articleApi = {
	getArticles: async (params?: {
		page?: number;
		size?: number;
		category_id?: string;
		tag_ids?: string;
		search?: string;
		source_domain?: string;
		author?: string;
		is_visible?: boolean;
		published_at_start?: string;
		published_at_end?: string;
		created_at_start?: string;
		created_at_end?: string;
		sort_by?: string;
	}) => {
		const response = await api.get("/api/articles", { params });
		return response.data;
	},

	createArticle: async (data: {
		title: string;
		content_md: string;
		source_url?: string;
		author?: string;
		published_at?: string;
		top_image?: string;
		category_id?: string;
		skip_ai_processing?: boolean;
	}) => {
		const response = await api.post("/api/articles", data);
		return response.data;
	},

	getArticle: async (id: string) => {
		const response = await api.get(`/api/articles/${id}`);
		return response.data;
	},
	recordArticleView: async (
		slug: string,
	): Promise<{
		article_slug: string;
		view_count: number;
		counted: boolean;
	}> => {
		const response = await api.post(`/api/articles/${slug}/view`);
		return response.data;
	},

	getSimilarArticles: async (
		slug: string,
		limit = 5,
	): Promise<SimilarArticleResponse> => {
		const response = await api.get(`/api/articles/${slug}/similar`, {
			params: { limit },
		});
		return response.data;
	},
	generateArticleEmbedding: async (slug: string) => {
		const response = await api.post(`/api/articles/${slug}/embedding`);
		return response.data;
	},

	updateArticleNotes: async (
		id: string,
		data: {
			note_content?: string | null;
			annotations?: Array<{ id: string; start: number; end: number; comment: string }>;
			note_recommendation_level?:
				| "strongly_recommended"
				| "recommended"
				| "neutral"
				| "not_recommended";
		},
	) => {
		const response = await api.put(`/api/articles/${id}/notes`, data);
		return response.data;
	},

	deleteArticle: async (id: string) => {
		const response = await api.delete(`/api/articles/${id}`);
		return response.data;
	},

	deleteAIContent: async (
		id: string,
		contentType: DeletableAIContentType,
	) => {
		const response = await api.delete(
			`/api/articles/${id}/ai-content/${contentType}`,
		);
		return response.data as {
			id: string;
			content_type: DeletableAIContentType;
			status: "deleted";
		};
	},

	getAIContentVersions: async (
		id: string,
		contentType: VersionedAIContentType,
	): Promise<AIContentVersionListResponse> => {
		const response = await api.get(`/api/articles/${id}/ai-versions/${contentType}`);
		return response.data;
	},

	rollbackAIContentVersion: async (
		id: string,
		contentType: VersionedAIContentType,
		versionId: string,
	): Promise<{
		article_id: string;
		content_type: VersionedAIContentType;
		status: "rolled_back";
		current_version_id: string;
		current_version_number: number;
	}> => {
		const response = await api.post(
			`/api/articles/${id}/ai-versions/${contentType}/${versionId}/rollback`,
		);
		return response.data;
	},

	updateArticle: async (
		id: string,
		data: {
			title?: string;
			title_trans?: string | null;
			author?: string;
			published_at?: string | null;
			category_id?: string | null;
			tag_names?: string[];
			top_image?: string;
			content_md?: string;
			content_trans?: string;
			is_visible?: boolean;
		},
	) => {
		const response = await api.put(`/api/articles/${id}`, data);
		return response.data;
	},

	updateArticleVisibility: async (id: string, isVisible: boolean) => {
		const response = await api.put(`/api/articles/${id}/visibility`, {
			is_visible: isVisible,
		});
		return response.data;
	},

	regenerateArticleTags: async (id: string) => {
		const response = await api.post(`/api/articles/${id}/tags/regenerate`);
		return response.data;
	},

	batchUpdateVisibility: async (articleIds: string[], isVisible: boolean) => {
		const response = await api.post("/api/articles/batch/visibility", {
			article_slugs: articleIds,
			is_visible: isVisible,
		});
		return response.data;
	},

	batchUpdateCategory: async (
		articleIds: string[],
		categoryId: string | null,
	) => {
		const response = await api.post("/api/articles/batch/category", {
			article_slugs: articleIds,
			category_id: categoryId,
		});
		return response.data;
	},

	batchDeleteArticles: async (articleIds: string[]) => {
		const response = await api.post("/api/articles/batch/delete", {
			article_slugs: articleIds,
		});
		return response.data;
	},

	exportArticles: async (articleIds: string[]) => {
		const response = await api.post("/api/export", { article_slugs: articleIds });
		return response.data;
	},

	searchArticles: async (
		query: string,
	): Promise<
		{
			id: string;
			title: string;
			title_trans?: string | null;
			display_title: string;
			slug: string;
		}[]
	> => {
		const response = await api.get("/api/articles/search", { params: { query } });
		return response.data;
	},

	getAITasks: async (params?: {
		page?: number;
		size?: number;
		status?: string;
		task_type?: string;
		content_type?: string;
		article_id?: string;
		article_title?: string;
	}): Promise<AITaskListResponse> => {
		try {
			const response = await api.get("/api/ai-tasks", { params });
			return response.data as AITaskListResponse;
		} catch (error) {
			if (isTransientNetworkError(error)) {
				await sleep(250);
				const retryResponse = await api.get("/api/ai-tasks", { params });
				return retryResponse.data as AITaskListResponse;
			}
			throw error;
		}
	},

	getAITask: async (taskId: string): Promise<AITaskListItem> => {
		const response = await api.get(`/api/ai-tasks/${taskId}`);
		return response.data as AITaskListItem;
	},

	getAITaskTimeline: async (taskId: string): Promise<AITaskTimelineResponse> => {
		const response = await api.get(`/api/ai-tasks/${taskId}/timeline`);
		return response.data;
	},

	retryAITasks: async (
		taskIds: string[],
		options?: {
			model_config_id?: string;
			prompt_config_id?: string;
		},
	) => {
		const response = await api.post("/api/ai-tasks/retry", {
			task_ids: taskIds,
			model_config_id: options?.model_config_id,
			prompt_config_id: options?.prompt_config_id,
		});
		return response.data;
	},

	cancelAITasks: async (taskIds: string[]) => {
		const response = await api.post("/api/ai-tasks/cancel", {
			task_ids: taskIds,
		});
		return response.data;
	},

	retryArticle: async (id: string) => {
		const response = await api.post(`/api/articles/${id}/retry`);
		return response.data;
	},

	retryArticleWithConfig: async (
		id: string,
		modelConfigId?: string,
		promptConfigId?: string,
	) => {
		const params = new URLSearchParams();
		if (modelConfigId) params.append("model_config_id", modelConfigId);
		if (promptConfigId) params.append("prompt_config_id", promptConfigId);
		const queryString = params.toString();
		const url = `/api/articles/${id}/retry${queryString ? `?${queryString}` : ""}`;
		const response = await api.post(url);
		return response.data;
	},

	retryTranslation: async (id: string) => {
		const response = await api.post(`/api/articles/${id}/retry-translation`);
		return response.data;
	},

	retryTranslationWithConfig: async (
		id: string,
		modelConfigId?: string,
		promptConfigId?: string,
	) => {
		const params = new URLSearchParams();
		if (modelConfigId) params.append("model_config_id", modelConfigId);
		if (promptConfigId) params.append("prompt_config_id", promptConfigId);
		const queryString = params.toString();
		const url = `/api/articles/${id}/retry-translation${
			queryString ? `?${queryString}` : ""
		}`;
		const response = await api.post(url);
		return response.data;
	},

	generateAIContent: async (
		id: string,
		contentType: string,
		modelConfigId?: string,
		promptConfigId?: string,
	) => {
		const params = new URLSearchParams();
		if (modelConfigId) params.append("model_config_id", modelConfigId);
		if (promptConfigId) params.append("prompt_config_id", promptConfigId);
		const queryString = params.toString();
		const url = `/api/articles/${id}/generate/${contentType}${queryString ? `?${queryString}` : ""}`;
		const response = await api.post(url);
		return response.data;
	},

	repairInfographic: async (
		id: string,
		errorMessage: string,
		modelConfigId?: string,
	) => {
		const response = await api.post(`/api/articles/${id}/repair-infographic`, {
			error_message: errorMessage,
			model_config_id: modelConfigId,
		});
		return response.data;
	},

	uploadInfographicImage: async (id: string, file: File) => {
		const formData = new FormData();
		formData.append("file", file);
		const response = await api.post(`/api/articles/${id}/infographic-image`, formData);
		return response.data as {
			asset_id: string;
			url: string;
			filename: string;
			size: number;
			content_type: string;
		};
	},

	getAuthors: async () => {
		const response = await api.get("/api/authors");
		return response.data as string[];
	},

	getSources: async () => {
		const response = await api.get("/api/sources");
		return response.data as string[];
	},

	getModelAPIConfigs: async () => {
		const response = await api.get("/api/model-api-configs");
		return response.data;
	},

	getModelAPIConfig: async (configId: string) => {
		const response = await api.get(`/api/model-api-configs/${configId}`);
		return response.data;
	},

	createModelAPIConfig: async (data: {
		name: string;
		base_url: string;
		api_key: string;
		provider?: string;
		model_name?: string;
		model_type?: string;
		price_input_per_1k?: number;
		price_output_per_1k?: number;
		currency?: string;
		context_window_tokens?: number;
		reserve_output_tokens?: number;
		is_enabled?: boolean;
		is_default?: boolean;
	}) => {
		const response = await api.post("/api/model-api-configs", data);
		return response.data;
	},

	updateModelAPIConfig: async (
		configId: string,
		data: {
			name?: string;
			base_url?: string;
			api_key?: string;
			provider?: string;
			model_name?: string;
			model_type?: string;
			price_input_per_1k?: number;
			price_output_per_1k?: number;
			currency?: string;
			context_window_tokens?: number;
			reserve_output_tokens?: number;
			is_enabled?: boolean;
			is_default?: boolean;
		},
	) => {
		const response = await api.put(`/api/model-api-configs/${configId}`, data);
		return response.data;
	},

	deleteModelAPIConfig: async (configId: string) => {
		const response = await api.delete(`/api/model-api-configs/${configId}`);
		return response.data;
	},

	testModelAPIConfig: async (
		configId: string,
		data?: { prompt?: string; max_tokens?: number },
	) => {
		const response = await api.post(
			`/api/model-api-configs/${configId}/test`,
			data,
		);
		return response.data;
	},
	getModelAPIModels: async (data: {
		base_url: string;
		api_key: string;
		provider?: string;
	}) => {
		const response = await api.post("/api/model-api-configs/models", data);
		return response.data as {
			success: boolean;
			models?: string[];
			message?: string;
			raw_response?: string;
		};
	},

	getPromptConfigs: async (params?: {
		category_id?: string;
		type?: string;
	}) => {
		const response = await api.get("/api/prompt-configs", { params });
		return response.data;
	},

	getPromptConfig: async (configId: string) => {
		const response = await api.get(`/api/prompt-configs/${configId}`);
		return response.data;
	},

	createPromptConfig: async (data: {
		name: string;
		category_id?: string;
		type: string;
		prompt: string;
		system_prompt?: string | null;
		temperature?: number | null;
		max_tokens?: number | null;
		top_p?: number | null;
		chunk_size_tokens?: number | null;
		chunk_overlap_tokens?: number | null;
		max_continue_rounds?: number | null;
		model_api_config_id?: string;
		is_enabled?: boolean;
		is_default?: boolean;
	}) => {
		const response = await api.post("/api/prompt-configs", data);
		return response.data;
	},

	updatePromptConfig: async (
		configId: string,
		data: {
			name?: string;
			category_id?: string;
			type?: string;
			prompt?: string;
			system_prompt?: string | null;
			temperature?: number | null;
			max_tokens?: number | null;
			top_p?: number | null;
			chunk_size_tokens?: number | null;
			chunk_overlap_tokens?: number | null;
			max_continue_rounds?: number | null;
			model_api_config_id?: string;
			is_enabled?: boolean;
			is_default?: boolean;
		},
	) => {
		const response = await api.put(`/api/prompt-configs/${configId}`, data);
		return response.data;
	},

	deletePromptConfig: async (configId: string) => {
		const response = await api.delete(`/api/prompt-configs/${configId}`);
		return response.data;
	},
};

export const backupApi = {
	exportBackup: async (): Promise<Blob> => {
		const response = await api.get("/api/backup/export", {
			responseType: "blob",
		});
		return response.data as Blob;
	},
	importBackup: async (file: File): Promise<BackupImportResult> => {
		const formData = new FormData();
		formData.append("file", file);
		const response = await api.post("/api/backup/import", formData, {
			headers: {
				"Content-Type": "multipart/form-data",
			},
		});
		return response.data as BackupImportResult;
	},
};

export const recommendationSettingsApi = {
	getSettings: async () => {
		const response = await api.get("/api/settings/recommendations");
		return response.data as RecommendationSettings;
	},

	updateSettings: async (data: RecommendationSettings) => {
		const response = await api.put("/api/settings/recommendations", data);
		return response.data;
	},

	rebuildEmbeddings: async (): Promise<RecommendationEmbeddingRefreshResult> => {
		const response = await api.post(
			"/api/settings/recommendations/rebuild-embeddings",
		);
		return response.data as RecommendationEmbeddingRefreshResult;
	},
};

export const aiUsageApi = {
	list: async (params?: {
		model_api_config_id?: string;
		status?: string;
		task_type?: string;
		content_type?: string;
		start?: string;
		end?: string;
		page?: number;
		size?: number;
	}): Promise<AIUsageListResponse> => {
		const response = await api.get("/api/ai-usage", { params });
		return response.data;
	},
	summary: async (params?: {
		model_api_config_id?: string;
		status?: string;
		task_type?: string;
		content_type?: string;
		start?: string;
		end?: string;
	}): Promise<AIUsageSummaryResponse> => {
		const response = await api.get("/api/ai-usage/summary", { params });
		return response.data;
	},
};

export const categoryApi = {
	getCategories: async () => {
		const response = await api.get("/api/categories");
		return response.data;
	},

	getCategoryStats: async (params?: {
		search?: string;
		source_domain?: string;
		author?: string;
		tag_ids?: string;
		published_at_start?: string;
		published_at_end?: string;
		created_at_start?: string;
		created_at_end?: string;
	}) => {
		const response = await api.get("/api/categories/stats", { params });
		return response.data as {
			id: string;
			name: string;
			color: string | null;
			article_count: number;
		}[];
	},

	createCategory: async (data: {
		name: string;
		description?: string;
		color?: string;
		sort_order?: number;
	}) => {
		const response = await api.post("/api/categories", data);
		return response.data;
	},

	deleteCategory: async (id: string) => {
		const response = await api.delete(`/api/categories/${id}`);
		return response.data;
	},

	updateCategory: async (
		id: string,
		data: {
			name?: string;
			description?: string;
			color?: string;
			sort_order?: number;
		},
	) => {
		const response = await api.put(`/api/categories/${id}`, data);
		return response.data;
	},

	updateCategoriesSort: async (items: { id: string; sort_order: number }[]) => {
		const response = await api.put("/api/categories/sort", { items });
		return response.data;
	},
};

export const tagApi = {
	getTags: async (): Promise<Tag[]> => {
		const response = await api.get("/api/tags");
		return response.data as Tag[];
	},
};

export const commentApi = {
	getArticleComments: async (articleId: string): Promise<ArticleComment[]> => {
		const response = await api.get(`/api/articles/${articleId}/comments`, {
			params: { include_hidden: true },
		});
		return response.data as ArticleComment[];
	},
	createArticleComment: async (
		articleId: string,
		content: string,
		replyToId?: string | null,
	) => {
		const response = await fetch(`/api/comments/${articleId}`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ content, reply_to_id: replyToId || null }),
			credentials: "same-origin",
		});
		const data = await response.json();
		if (!response.ok) {
			throw new Error(data?.message || localize("发布评论失败", "Failed to post comment"));
		}
		return data as ArticleComment;
	},
	updateComment: async (commentId: string, content: string) => {
		const response = await fetch(`/api/comments/item/${commentId}`, {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ content }),
			credentials: "same-origin",
		});
		const data = await response.json();
		if (!response.ok) {
			throw new Error(
				data?.message || localize("更新评论失败", "Failed to update comment"),
			);
		}
		return data as ArticleComment;
	},
	deleteComment: async (commentId: string) => {
		const response = await fetch(`/api/comments/item/${commentId}`, {
			method: "DELETE",
			credentials: "same-origin",
		});
		const data = await response.json();
		if (!response.ok) {
			throw new Error(data?.message || localize("删除评论失败", "Failed to delete comment"));
		}
		return data as { success: boolean };
	},
	toggleHidden: async (commentId: string, isHidden: boolean) => {
		const response = await api.put(`/api/comments/${commentId}/visibility`, {
			is_hidden: isHidden,
		});
		return response.data as { id: string; is_hidden: boolean; updated_at: string };
	},
};

export const basicSettingsApi = {
	getSettings: async (): Promise<BasicSettings> => {
		const response = await api.get("/api/settings/basic");
		return response.data;
	},
	updateSettings: async (payload: Partial<BasicSettings>) => {
		const response = await api.put("/api/settings/basic", payload);
		return response.data;
	},
	getPublicSettings: async (): Promise<BasicSettings> => {
		const response = await api.get("/api/settings/basic/public");
		return response.data;
	},
};

export const reviewApi = {
	getPublicReviews: async (params?: {
		page?: number;
		size?: number;
		template_id?: string;
		search?: string;
		published_at_start?: string;
		published_at_end?: string;
		visibility?: string;
	}): Promise<ReviewIssueListResponse> => {
		const response = await api.get("/api/reviews", { params });
		return response.data;
	},

	getPublicReview: async (slug: string): Promise<ReviewIssue> => {
		const response = await api.get(`/api/reviews/${slug}`);
		return response.data;
	},

	recordReviewView: async (slug: string) => {
		const response = await api.post(`/api/reviews/${slug}/view`);
		return response.data as {
			review_slug: string;
			view_count: number;
			counted: boolean;
		};
	},

	getTemplates: async (): Promise<ReviewTemplate[]> => {
		const response = await api.get("/api/review-templates");
		return response.data;
	},

	createTemplate: async (
		data: ReviewTemplateMutationInput,
	) => {
		const response = await api.post("/api/review-templates", data);
		return response.data as { id: string };
	},

	updateTemplate: async (
		id: string,
		data: Partial<ReviewTemplateMutationInput>,
	) => {
		const response = await api.put(`/api/review-templates/${id}`, data);
		return response.data as { success: boolean };
	},

	deleteTemplate: async (id: string) => {
		const response = await api.delete(`/api/review-templates/${id}`);
		return response.data as { success: boolean };
	},

	getTemplateIssues: async (id: string): Promise<ReviewIssue[]> => {
		const response = await api.get(`/api/review-templates/${id}/issues`);
		return response.data;
	},

	runTemplateNow: async (id: string) => {
		const response = await api.post(`/api/review-templates/${id}/run-now`);
		return response.data as { success: boolean; task_id: string };
	},

	getTemplateGenerationPreview: async (
		id: string,
		params?: {
			date_start?: string;
			date_end?: string;
		},
	): Promise<ReviewTemplateGenerationPreview> => {
		const response = await api.get(`/api/review-templates/${id}/generation-preview`, {
			params,
		});
		return response.data;
	},

	runTemplateManual: async (
		id: string,
		data: {
			date_start?: string | null;
			date_end?: string | null;
			article_ids: string[];
			model_api_config_id?: string | null;
		},
	) => {
		const response = await api.post(`/api/review-templates/${id}/run-manual`, data);
		return response.data as { success: boolean; task_id: string; issue_id: string };
	},

	getIssue: async (id: string): Promise<ReviewIssue> => {
		const response = await api.get(`/api/review-issues/${id}`);
		return response.data;
	},

	updateIssue: async (
		id: string,
		data: {
			title?: string;
			published_at?: string | null;
			top_image?: string | null;
			markdown_content: string;
		},
	): Promise<ReviewIssue> => {
		const response = await api.put(`/api/review-issues/${id}`, data);
		return response.data;
	},

	publishIssue: async (id: string) => {
		const response = await api.post(`/api/review-issues/${id}/publish`);
		return response.data as { success: boolean; status: ReviewIssueStatus };
	},

	unpublishIssue: async (id: string) => {
		const response = await api.post(`/api/review-issues/${id}/unpublish`);
		return response.data as { success: boolean; status: ReviewIssueStatus };
	},

	deleteIssue: async (id: string) => {
		const response = await api.delete(`/api/review-issues/${id}`);
		return response.data as { success: boolean };
	},
};

export const reviewCommentApi = {
	getReviewComments: async (reviewSlug: string): Promise<ReviewComment[]> => {
		const response = await api.get(`/api/reviews/${reviewSlug}/comments`, {
			params: { include_hidden: true },
		});
		return response.data as ReviewComment[];
	},
	createReviewComment: async (
		reviewSlug: string,
		content: string,
		replyToId?: string | null,
	) => {
		const response = await fetch(`/api/review-comments/${reviewSlug}`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ content, reply_to_id: replyToId || null }),
			credentials: "same-origin",
		});
		const data = await response.json();
		if (!response.ok) {
			throw new Error(data?.message || localize("发布评论失败", "Failed to post comment"));
		}
		return data as ReviewComment;
	},
	updateComment: async (commentId: string, content: string) => {
		const response = await fetch(`/api/review-comments/item/${commentId}`, {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ content }),
			credentials: "same-origin",
		});
		const data = await response.json();
		if (!response.ok) {
			throw new Error(
				data?.message || localize("更新评论失败", "Failed to update comment"),
			);
		}
		return data as ReviewComment;
	},
	deleteComment: async (commentId: string) => {
		const response = await fetch(`/api/review-comments/item/${commentId}`, {
			method: "DELETE",
			credentials: "same-origin",
		});
		const data = await response.json();
		if (!response.ok) {
			throw new Error(data?.message || localize("删除评论失败", "Failed to delete comment"));
		}
		return data as { success: boolean };
	},
	toggleHidden: async (commentId: string, isHidden: boolean) => {
		const response = await api.put(`/api/review-comments/${commentId}/visibility`, {
			is_hidden: isHidden,
		});
		return response.data as { id: string; is_hidden: boolean; updated_at: string };
	},
};

export const commentSettingsApi = {
	getSettings: async (): Promise<CommentSettings> => {
		const response = await api.get("/api/settings/comments");
		return response.data;
	},
	updateSettings: async (payload: Partial<CommentSettings>) => {
		const response = await api.put("/api/settings/comments", payload);
		return response.data;
	},
	getPublicSettings: async (): Promise<{
		comments_enabled: boolean;
		providers: { github: boolean; google: boolean };
	}> => {
		const response = await api.get("/api/settings/comments/public");
		return response.data;
	},
};

export const storageSettingsApi = {
	getSettings: async (): Promise<StorageSettings> => {
		const response = await api.get("/api/settings/storage");
		return response.data;
	},
	updateSettings: async (payload: Partial<StorageSettings>) => {
		const response = await api.put("/api/settings/storage", payload);
		return response.data;
	},
};

type MediaOwnerInput = string | { articleId?: string | null; reviewIssueId?: string | null };

const resolveMediaOwnerPayload = (owner: MediaOwnerInput) => {
	if (typeof owner === "string") {
		return { article_id: owner, review_issue_id: undefined };
	}
	return {
		article_id: owner.articleId || undefined,
		review_issue_id: owner.reviewIssueId || undefined,
	};
};

export const mediaApi = {
	upload: async (
		owner: MediaOwnerInput,
		file: File,
		kind: "image" | "book" = "image",
	) => {
		const form = new FormData();
		form.append("file", file);
		const payload = resolveMediaOwnerPayload(owner);
		if (payload.article_id) {
			form.append("article_id", payload.article_id);
		}
		if (payload.review_issue_id) {
			form.append("review_issue_id", payload.review_issue_id);
		}
		form.append("kind", kind);
		const response = await api.post("/api/media/upload", form);
		return response.data as {
			asset_id: string;
			url: string;
			filename: string;
			size: number;
			content_type: string;
		};
	},
	ingest: async (
		owner: MediaOwnerInput,
		url: string,
		kind: "image" | "book" = "image",
	) => {
		const payload = resolveMediaOwnerPayload(owner);
		const response = await api.post("/api/media/ingest", {
			article_id: payload.article_id,
			review_issue_id: payload.review_issue_id,
			url,
			kind,
		});
		return response.data as {
			asset_id: string;
			url: string;
			filename: string;
			size: number;
			content_type: string;
		};
	},
	cleanup: async () => {
		const response = await api.post("/api/media/cleanup");
		return response.data as {
			success: boolean;
			removed_records: number;
			removed_files: number;
			kept: number;
		};
	},
	getStats: async () => {
		const response = await api.get("/api/media/stats");
		return response.data as {
			success: boolean;
			asset_count: number;
			asset_total_size: number;
			disk_file_count: number;
			disk_total_size: number;
		};
	},
};

export const commentAdminApi = {
	list: async (params: {
		query?: string;
		article_title?: string;
		author?: string;
		created_start?: string;
		created_end?: string;
		is_hidden?: boolean;
		has_reply?: boolean;
		page?: number;
		size?: number;
	}): Promise<CommentListResponse> => {
		const response = await api.get("/api/comments", { params });
		return response.data;
	},
	delete: async (commentId: string) => {
		const response = await api.delete(`/api/comments/${commentId}`);
		return response.data as { success: boolean };
	},
};
