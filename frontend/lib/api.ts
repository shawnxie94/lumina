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

export const resolveMediaUrl = (url?: string | null): string => {
	if (!url) return "";
	const apiBase = getApiBaseUrl().replace(/\/+$/, "");
	if (url.startsWith("/media/")) {
		return `${apiBase}${url}`;
	}
	if (typeof window !== "undefined") {
		try {
			const parsed = new URL(url, apiBase);
			const isLocalhost =
				parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
			const isMediaPath =
				parsed.pathname.startsWith("/media/") ||
				parsed.pathname.startsWith("/backend/media/");
			if (isLocalhost && isMediaPath) {
				const normalizedPath = parsed.pathname.startsWith("/backend/")
					? parsed.pathname.replace("/backend", "")
					: parsed.pathname;
				return `${apiBase}${normalizedPath}`;
			}
		} catch {
			return url;
		}
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
	headers: {
		"Content-Type": "application/json",
	},
});

// ============ Token 管理 ============

const TOKEN_KEY = "admin_token";

export const getToken = (): string | null => {
	if (typeof window === "undefined") return null;
	return localStorage.getItem(TOKEN_KEY);
};

export const setToken = (token: string): void => {
	if (typeof window === "undefined") return;
	localStorage.setItem(TOKEN_KEY, token);
};

export const removeToken = (): void => {
	if (typeof window === "undefined") return;
	localStorage.removeItem(TOKEN_KEY);
};

// ============ 请求拦截器：自动添加 token ============

api.interceptors.request.use(
	(config) => {
		config.baseURL = getApiBaseUrl();
		const token = getToken();
		if (token) {
			config.headers.Authorization = `Bearer ${token}`;
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
};

export interface Article {
	id: string;
	slug: string;  // SEO友好的URL slug
	title: string;
	summary: string;
	top_image: string;
	category: { id: string; name: string; color?: string } | null;
	author: string;
	status: string;
	source_domain: string | null;
	published_at: string | null;
	created_at: string;
	is_visible: boolean;
	original_language?: string;
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
	ai_analysis: {
		summary: string | null;
		summary_status: string | null;
		key_points: string | null;
		key_points_status: string | null;
		outline: string | null;
		outline_status: string | null;
		quotes: string | null;
		quotes_status: string | null;
		error_message?: string | null;
		updated_at?: string | null;
	} | null;
	prev_article?: { id: string; slug: string; title: string } | null;
	next_article?: { id: string; slug: string; title: string } | null;
}

export interface SimilarArticleItem {
	id: string;
	slug: string;
	title: string;
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
	home_badge_text: string;
	home_tagline_text: string;
	home_primary_button_text: string;
	home_primary_button_url: string;
	home_secondary_button_text: string;
	home_secondary_button_url: string;
}

export interface BackupPayload {
	meta: {
		schema_version: number;
		exported_at: string;
		app: string;
		policy: string;
	};
	data: {
		categories: Record<string, unknown>[];
		model_api_configs: Record<string, unknown>[];
		prompt_configs: Record<string, unknown>[];
		settings: Record<string, unknown>;
		articles: Record<string, unknown>[];
		ai_analyses: Record<string, unknown>[];
	};
}

export interface BackupImportResult {
	meta: {
		schema_version: number;
		imported_at: string;
		policy: string;
	};
	stats: {
		categories: { created: number; skipped: number; errors: number };
		model_api_configs: { created: number; skipped: number; errors: number };
		prompt_configs: { created: number; skipped: number; errors: number };
		articles: { created: number; skipped: number; errors: number };
		ai_analyses: { created: number; skipped: number; errors: number };
		settings: { created: number; skipped: number; errors: number };
	};
	skipped_total: number;
	skipped_items: Array<{
		section: string;
		identifier: string;
		reason: string;
	}>;
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

export interface PromptConfig {
	id: string;
	name: string;
	category_id: string | null;
	category_name: string | null;
	type: string;
	prompt: string;
	system_prompt?: string | null;
	response_format?: string | null;
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
		},
	) => {
		const response = await api.put(`/api/articles/${id}/notes`, data);
		return response.data;
	},

	deleteArticle: async (id: string) => {
		const response = await api.delete(`/api/articles/${id}`);
		return response.data;
	},

	updateArticle: async (
		id: string,
		data: {
			title?: string;
			author?: string;
			published_at?: string | null;
			category_id?: string | null;
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

	searchArticles: async (query: string): Promise<{id: string; title: string; slug: string}[]> => {
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
	}) => {
		try {
			const response = await api.get("/api/ai-tasks", { params });
			return response.data;
		} catch (error) {
			if (isTransientNetworkError(error)) {
				await sleep(250);
				const retryResponse = await api.get("/api/ai-tasks", { params });
				return retryResponse.data;
			}
			throw error;
		}
	},

	getAITask: async (taskId: string) => {
		const response = await api.get(`/api/ai-tasks/${taskId}`);
		return response.data;
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
		response_format?: string | null;
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
			response_format?: string | null;
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
	exportBackup: async (): Promise<BackupPayload> => {
		const response = await api.get("/api/backup/export", {
			responseType: "text",
			transformResponse: [(data) => data],
		});
		const raw = typeof response.data === "string" ? response.data : "";
		return JSON.parse(raw) as BackupPayload;
	},
	importBackup: async (payload: BackupPayload): Promise<BackupImportResult> => {
		const response = await api.post("/api/backup/import", payload);
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

export const commentApi = {
	getArticleComments: async (articleId: string): Promise<ArticleComment[]> => {
		const token = getToken();
		if (token) {
			const response = await api.get(`/api/articles/${articleId}/comments`, {
				params: { include_hidden: true },
			});
			return response.data as ArticleComment[];
		}
		const response = await fetch(`/api/comments/${articleId}`, {
			credentials: "same-origin",
		});
		if (!response.ok) {
			throw new Error(localize("获取评论失败", "Failed to fetch comments"));
		}
		return response.json();
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

export const mediaApi = {
	upload: async (articleId: string, file: File, kind: "image" | "book" = "image") => {
		const form = new FormData();
		form.append("file", file);
		form.append("article_id", articleId);
		form.append("kind", kind);
		const response = await api.post("/api/media/upload", form, {
			headers: { "Content-Type": "multipart/form-data" },
		});
		return response.data as {
			asset_id: string;
			url: string;
			filename: string;
			size: number;
			content_type: string;
		};
	},
	ingest: async (
		articleId: string,
		url: string,
		kind: "image" | "book" = "image",
	) => {
		const response = await api.post("/api/media/ingest", {
			article_id: articleId,
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
