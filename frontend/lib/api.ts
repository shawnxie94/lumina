import axios from 'axios';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

export interface Article {
  id: string;
  title: string;
  summary: string;
  top_image: string;
  category: { id: string; name: string; color?: string } | null;
  author: string;
  status: string;
  source_domain: string | null;
  published_at: string | null;
  created_at: string;
}

export interface ArticleDetail extends Article {
  content_html: string;
  content_md: string;
  content_trans: string;
  translation_status: string | null;
  translation_error: string | null;
  source_url: string;
  published_at: string | null;
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
  } | null;
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
  is_enabled: boolean;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export interface PromptConfig {
  id: string;
  name: string;
  category_id: string | null;
  category_name: string | null;
  type: string;
  prompt: string;
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
    published_at_start?: string;
    published_at_end?: string;
    created_at_start?: string;
    created_at_end?: string;
    sort_by?: string;
  }) => {
    const response = await api.get('/api/articles', { params });
    return response.data;
  },

  getArticle: async (id: string) => {
    const response = await api.get(`/api/articles/${id}`);
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
    },
  ) => {
    const response = await api.put(`/api/articles/${id}`, data);
    return response.data;
  },

  exportArticles: async (articleIds: string[]) => {
    const response = await api.post('/api/export', { article_ids: articleIds });
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

  generateAIContent: async (id: string, contentType: string, modelConfigId?: string, promptConfigId?: string) => {
    const params = new URLSearchParams();
    if (modelConfigId) params.append('model_config_id', modelConfigId);
    if (promptConfigId) params.append('prompt_config_id', promptConfigId);
    const queryString = params.toString();
    const url = `/api/articles/${id}/generate/${contentType}${queryString ? `?${queryString}` : ''}`;
    const response = await api.post(url);
    return response.data;
  },

  getAuthors: async () => {
    const response = await api.get('/api/authors');
    return response.data as string[];
  },

  getSources: async () => {
    const response = await api.get('/api/sources');
    return response.data as string[];
  },

  getAIConfigs: async (categoryId?: string) => {
    const response = await api.get('/api/configs/ai', {
      params: categoryId ? { category_id: categoryId } : undefined,
    });
    return response.data;
  },

  createAIConfig: async (data: {
    category_id?: string;
    dimension: string;
    is_enabled?: boolean;
    base_url: string;
    api_key: string;
    model_name?: string;
    prompt_template?: string;
    parameters?: string;
    is_default?: boolean;
  }) => {
    const response = await api.post('/api/configs/ai', data);
    return response.data;
  },

  updateAIConfig: async (
    configId: string,
    data: {
      category_id?: string;
      dimension?: string;
      is_enabled?: boolean;
      base_url?: string;
      api_key?: string;
      model_name?: string;
      prompt_template?: string;
      parameters?: string;
      is_default?: boolean;
    },
  ) => {
    const response = await api.put(`/api/configs/ai/${configId}`, data);
    return response.data;
  },

  deleteAIConfig: async (configId: string) => {
    const response = await api.delete(`/api/configs/ai/${configId}`);
    return response.data;
  },

  getModelAPIConfigs: async () => {
    const response = await api.get('/api/model-api-configs');
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
    const response = await api.post('/api/model-api-configs', data);
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

  testModelAPIConfig: async (configId: string) => {
    const response = await api.post(`/api/model-api-configs/${configId}/test`);
    return response.data;
  },

  getPromptConfigs: async (params?: {
    category_id?: string;
    type?: string;
  }) => {
    const response = await api.get('/api/prompt-configs', { params });
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
    model_api_config_id?: string;
    is_enabled?: boolean;
    is_default?: boolean;
  }) => {
    const response = await api.post('/api/prompt-configs', data);
    return response.data;
  },

  updatePromptConfig: async (
    configId: string,
    data: {
      name?: string;
      category_id?: string;
      type?: string;
      prompt?: string;
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

export const categoryApi = {
  getCategories: async () => {
    const response = await api.get('/api/categories');
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
    const response = await api.get('/api/categories/stats', { params });
    return response.data as { id: string; name: string; color: string | null; article_count: number }[];
  },

  createCategory: async (data: {
    name: string;
    description?: string;
    color?: string;
    sort_order?: number;
  }) => {
    const response = await api.post('/api/categories', data);
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
    const response = await api.put('/api/categories/sort', { items });
    return response.data;
  },
};