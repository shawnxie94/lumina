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
  category: { id: string; name: string } | null;
  author: string;
  status: string;
  created_at: string;
}

export interface ArticleDetail extends Article {
  content_html: string;
  content_md: string;
  content_trans: string;
  source_url: string;
  ai_analysis: { summary: string } | null;
}

export interface Category {
  id: string;
  name: string;
  description: string;
  color: string;
  article_count: number;
}

export const articleApi = {
  getArticles: async (params?: {
    page?: number;
    size?: number;
    category_id?: string;
    search?: string;
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

  exportArticles: async (articleIds: string[]) => {
    const response = await api.post('/api/export', { article_ids: articleIds });
    return response.data;
  },

  retryArticle: async (id: string) => {
    const response = await api.post(`/api/articles/${id}/retry`);
    return response.data;
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
};

export const categoryApi = {
  getCategories: async () => {
    const response = await api.get('/api/categories');
    return response.data;
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
};