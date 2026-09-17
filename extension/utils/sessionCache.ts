/**
 * TTL cache over chrome.storage.session for popup startup state.
 * Session storage is shared across extension contexts (popup + background)
 * and cleared when the browser exits, which suits short-lived hints.
 */

export const LOGIN_CACHE_KEY = "login_state_cache";
export const HEALTH_CACHE_KEY = "api_health_cache";

export const LOGIN_CACHE_TTL_MS = 5 * 60 * 1000;
export const HEALTH_CACHE_TTL_MS = 30 * 1000;

interface CacheEntry {
	checkedAt: number;
}

export async function getSessionCache<T extends CacheEntry>(
	key: string,
	ttlMs: number,
): Promise<T | null> {
	return new Promise((resolve) => {
		try {
			chrome.storage.session.get([key], (result) => {
				const entry = result?.[key] as T | undefined;
				if (entry && Date.now() - entry.checkedAt <= ttlMs) {
					resolve(entry);
				} else {
					resolve(null);
				}
			});
		} catch {
			resolve(null);
		}
	});
}

export async function setSessionCache<T extends CacheEntry>(
	key: string,
	value: Omit<T, "checkedAt">,
): Promise<void> {
	return new Promise((resolve) => {
		try {
			chrome.storage.session.set(
				{ [key]: { ...value, checkedAt: Date.now() } },
				() => {
					void chrome.runtime.lastError;
					resolve();
				},
			);
		} catch {
			resolve();
		}
	});
}

export async function clearSessionCache(key: string): Promise<void> {
	return new Promise((resolve) => {
		try {
			chrome.storage.session.remove([key], () => {
				void chrome.runtime.lastError;
				resolve();
			});
		} catch {
			resolve();
		}
	});
}
