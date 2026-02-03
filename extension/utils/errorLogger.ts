export interface ErrorLogEntry {
  id: string;
  timestamp: string;
  source: 'popup' | 'editor' | 'background' | 'content' | 'settings';
  type: 'error' | 'warning' | 'info';
  message: string;
  stack?: string;
  context?: Record<string, unknown>;
  url?: string;
  userAgent?: string;
}

const STORAGE_KEY = 'error_logs';
const MAX_LOG_ENTRIES = 100;

export async function logError(
  source: ErrorLogEntry['source'],
  error: Error | string,
  context?: Record<string, unknown>
): Promise<void> {
  const entry: ErrorLogEntry = {
    id: `err_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
    source,
    type: 'error',
    message: error instanceof Error ? error.message : error,
    stack: error instanceof Error ? error.stack : undefined,
    context,
    url: typeof window !== 'undefined' ? window.location.href : undefined,
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
  };

  await addLogEntry(entry);
}

export async function logWarning(
  source: ErrorLogEntry['source'],
  message: string,
  context?: Record<string, unknown>
): Promise<void> {
  const entry: ErrorLogEntry = {
    id: `warn_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
    source,
    type: 'warning',
    message,
    context,
    url: typeof window !== 'undefined' ? window.location.href : undefined,
  };

  await addLogEntry(entry);
}

async function addLogEntry(entry: ErrorLogEntry): Promise<void> {
  const logs = await getErrorLogs();
  logs.unshift(entry);

  if (logs.length > MAX_LOG_ENTRIES) {
    logs.splice(MAX_LOG_ENTRIES);
  }

  return new Promise((resolve, reject) => {
    chrome.storage.local.set({ [STORAGE_KEY]: logs }, () => {
      if (chrome.runtime.lastError) {
        console.error('Failed to save error log:', chrome.runtime.lastError);
        reject(chrome.runtime.lastError);
      } else {
        resolve();
      }
    });
  });
}

export async function getErrorLogs(): Promise<ErrorLogEntry[]> {
  return new Promise((resolve) => {
    chrome.storage.local.get([STORAGE_KEY], (result) => {
      resolve(result[STORAGE_KEY] || []);
    });
  });
}

export async function clearErrorLogs(): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.remove([STORAGE_KEY], () => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
      } else {
        resolve();
      }
    });
  });
}

export async function exportErrorLogs(): Promise<string> {
  const logs = await getErrorLogs();
  return JSON.stringify(logs, null, 2);
}

export function formatLogTime(isoDate: string): string {
  const date = new Date(isoDate);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${month}-${day} ${hours}:${minutes}:${seconds}`;
}

export function setupGlobalErrorHandler(source: ErrorLogEntry['source']): void {
  if (typeof window !== 'undefined') {
    window.addEventListener('error', (event) => {
      logError(source, event.error || event.message, {
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
      });
    });

    window.addEventListener('unhandledrejection', (event) => {
      const error = event.reason instanceof Error 
        ? event.reason 
        : new Error(String(event.reason));
      logError(source, error, { type: 'unhandledrejection' });
    });
  }
}
