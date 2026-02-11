import type { CreateArticleRequest, CreateArticleResponse, StorageData } from '../types';
import { logError } from './errorLogger';

const DEFAULT_API_HOST = 'localhost:8000';
const STORAGE_KEY = 'apiHost';
const TOKEN_KEY = 'adminToken';
const API_PREFIX = '/backend';

export class ApiClient {
  private apiHost: string;
  private token: string | null = null;

  constructor(apiHost?: string) {
    this.apiHost = apiHost || DEFAULT_API_HOST;
  }

  get baseUrl(): string {
    return `http://${this.apiHost}`;
  }

  get frontendUrl(): string {
    const host = this.apiHost.replace(':8000', ':3000');
    return `http://${host}`;
  }

  setToken(token: string | null) {
    this.token = token;
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }
    return headers;
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

  static async loadToken(): Promise<string | null> {
    return new Promise((resolve) => {
      chrome.storage.local.get([TOKEN_KEY], (result) => {
        resolve(result[TOKEN_KEY] || null);
      });
    });
  }

  static saveToken(token: string): Promise<void> {
    return new Promise((resolve, reject) => {
      chrome.storage.local.set({ [TOKEN_KEY]: token }, () => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve();
        }
      });
    });
  }

  static removeToken(): Promise<void> {
    return new Promise((resolve, reject) => {
      chrome.storage.local.remove([TOKEN_KEY], () => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve();
        }
      });
    });
  }

  async verifyToken(): Promise<{ valid: boolean; role: string }> {
    if (!this.token) {
      return { valid: false, role: 'guest' };
    }
    try {
      const response = await fetch(`${this.baseUrl}${API_PREFIX}/api/auth/verify`, {
        method: 'GET',
        headers: this.getHeaders(),
      });
      if (!response.ok) {
        return { valid: false, role: 'guest' };
      }
      return await response.json();
    } catch {
      return { valid: false, role: 'guest' };
    }
  }


  async createArticle(data: CreateArticleRequest): Promise<CreateArticleResponse> {
    try {
      const response = await fetch(`${this.baseUrl}${API_PREFIX}/api/articles`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(data),
      });

      if (response.status === 401) {
        throw new Error('UNAUTHORIZED');
      }

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ detail: 'Unknown error' }));
        throw new Error(`Failed to create article: ${errorData.detail || 'Unknown error'}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Failed to create article:', error);
      logError('api', error instanceof Error ? error : new Error(String(error)), { action: 'createArticle', apiHost: this.apiHost });
      throw error;
    }
  }

  async checkHealth(): Promise<{ ok: boolean; latency: number }> {
    const start = Date.now();
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);
      
      const response = await fetch(`${this.baseUrl}${API_PREFIX}/api/categories`, {
        method: 'GET',
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      const latency = Date.now() - start;
      
      return { ok: response.ok, latency };
    } catch {
      return { ok: false, latency: Date.now() - start };
    }
  }
}
