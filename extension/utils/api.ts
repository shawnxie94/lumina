import type { Category, CreateArticleRequest, CreateArticleResponse, StorageData } from '../types';

const DEFAULT_API_HOST = 'localhost:8000';
const STORAGE_KEY = 'apiHost';

export class ApiClient {
  private apiHost: string;

  constructor(apiHost?: string) {
    this.apiHost = apiHost || DEFAULT_API_HOST;
  }

  get baseUrl(): string {
    return `http://${this.apiHost}`;
  }

  get frontendUrl(): string {
    return this.apiHost.replace(':8000', ':3000');
  }

  static async loadApiHost(): Promise<string> {
    return new Promise((resolve) => {
      chrome.storage.local.get([STORAGE_KEY], (result: StorageData) => {
        resolve(result.apiHost || DEFAULT_API_HOST);
      });
    });
  }

  static saveApiHost(apiHost: string): Promise<void> {
    return new Promise((resolve, reject) => {
      chrome.storage.local.set({ [STORAGE_KEY]: apiHost }, () => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve();
        }
      });
    });
  }

  async getCategories(): Promise<Category[]> {
    try {
      const response = await fetch(`${this.baseUrl}/api/categories`);
      if (!response.ok) {
        throw new Error('Failed to fetch categories');
      }
      return await response.json();
    } catch (error) {
      console.error('Failed to load categories:', error);
      throw error;
    }
  }

  async createArticle(data: CreateArticleRequest): Promise<CreateArticleResponse> {
    try {
      const response = await fetch(`${this.baseUrl}/api/articles`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ detail: 'Unknown error' }));
        throw new Error(`Failed to create article: ${errorData.detail || 'Unknown error'}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Failed to create article:', error);
      throw error;
    }
  }
}

export const DEFAULT_CATEGORIES: Category[] = [
  { id: 'default-1', name: '业界资讯' },
  { id: 'default-2', name: '技术博客' },
];
