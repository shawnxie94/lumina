import axios from "axios";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

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
	model_name: string;
	price_input_per_1k?: number | null;
	price_output_per_1k?: number | null;
	currency?: string | null;
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

	getArticle: async (id: string) => {
		const response = await api.get(`/api/articles/${id}`);
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
			article_ids: articleIds,
			is_visible: isVisible,
		});
		return response.data;
	},

	batchUpdateCategory: async (
		articleIds: string[],
		categoryId: string | null,
	) => {
		const response = await api.post("/api/articles/batch/category", {
			article_ids: articleIds,
			category_id: categoryId,
		});
		return response.data;
	},

	batchDeleteArticles: async (articleIds: string[]) => {
		const response = await api.post("/api/articles/batch/delete", {
			article_ids: articleIds,
		});
		return response.data;
	},

	exportArticles: async (articleIds: string[]) => {
		const response = await api.post("/api/export", { article_ids: articleIds });
		return response.data;
	},

	getAITasks: async (params?: {
		page?: number;
		size?: number;
		status?: string;
		task_type?: string;
		content_type?: string;
		article_id?: string;
	}) => {
		const response = await api.get("/api/ai-tasks", { params });
		return response.data;
	},

	getAITask: async (taskId: string) => {
		const response = await api.get(`/api/ai-tasks/${taskId}`);
		return response.data;
	},

	retryAITasks: async (taskIds: string[]) => {
		const response = await api.post("/api/ai-tasks/retry", {
			task_ids: taskIds,
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

	retryTranslation: async (id: string) => {
		const response = await api.post(`/api/articles/${id}/retry-translation`);
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
		model_name?: string;
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
			model_name?: string;
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
	getModelAPIModels: async (data: { base_url: string; api_key: string }) => {
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
			throw new Error("获取评论失败");
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
			throw new Error(data?.message || "发布评论失败");
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
			throw new Error(data?.message || "更新评论失败");
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
			throw new Error(data?.message || "删除评论失败");
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

export const commentAdminApi = {
	list: async (params: {
		query?: string;
		article_id?: string;
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
