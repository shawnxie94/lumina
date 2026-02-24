import type {
  CreateArticleRequest,
  CreateArticleResponse,
  ReportArticleByUrlDuplicateResponse,
  ReportArticleByUrlRequest,
  StorageData,
} from '../types';
import { logError } from './errorLogger';

const DEFAULT_API_HOST = 'localhost:8000';
const STORAGE_KEY = 'apiHost';
const TOKEN_KEY = 'adminToken';
const API_PREFIX = '/backend';

const isLocalAddress = (host: string): boolean =>
  host === 'localhost' || host === '127.0.0.1';

const normalizeApiOrigin = (value: string): string => {
  const trimmed = value.trim().replace(/\/+$/, '');
  if (!trimmed) {
    return 'http://localhost:8000';
  }

  const hasProtocol = /^https?:\/\//i.test(trimmed);
  const withProtocol = hasProtocol
    ? trimmed
    : (() => {
        const hostPart = trimmed.split('/')[0] || '';
        const hostname = hostPart.split(':')[0] || '';
        const protocol = isLocalAddress(hostname) ? 'http' : 'https';
        return `${protocol}://${trimmed}`;
      })();

  try {
    const parsed = new URL(withProtocol);
    return parsed.origin;
  } catch {
    return 'http://localhost:8000';
  }
};

export class ApiClient {
  private apiHost: string;
  private apiOrigin: string;
  private token: string | null = null;

  constructor(apiHost?: string) {
    this.apiHost = apiHost || DEFAULT_API_HOST;
    this.apiOrigin = normalizeApiOrigin(this.apiHost);
  }

  get baseUrl(): string {
    return this.apiOrigin;
  }

  get frontendUrl(): string {
    try {
      const parsed = new URL(this.apiOrigin);
      if (isLocalAddress(parsed.hostname) && parsed.port === '8000') {
        parsed.port = '3000';
      }
      return parsed.origin;
    } catch {
      return 'http://localhost:3000';
    }
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

  async reportArticleByUrl(
    data: ReportArticleByUrlRequest,
  ): Promise<CreateArticleResponse | ReportArticleByUrlDuplicateResponse> {
    try {
      const response = await fetch(`${this.baseUrl}${API_PREFIX}/api/articles/report-url`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(data),
      });

      if (response.status === 401) {
        throw new Error('UNAUTHORIZED');
      }

      if (response.status === 409) {
        const duplicateData = (await response
          .json()
          .catch(() => ({ code: '', existing: null }))) as ReportArticleByUrlDuplicateResponse;
        if (duplicateData?.code === 'source_url_exists' && duplicateData?.existing) {
          return duplicateData;
        }
      }

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ detail: 'Unknown error' }));
        throw new Error(`Failed to report article URL: ${errorData.detail || 'Unknown error'}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Failed to report article URL:', error);
      logError('api', error instanceof Error ? error : new Error(String(error)), {
        action: 'reportArticleByUrl',
        apiHost: this.apiHost,
      });
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
