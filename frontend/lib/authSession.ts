export type AuthSessionSnapshot = {
  isAdmin: boolean;
  isInitialized: boolean;
  checkedAt: number;
};

const AUTH_SESSION_STORAGE_KEY = "lumina_auth_session_v1";
const AUTH_SESSION_MAX_AGE_MS = 6 * 60 * 60 * 1000;

const isBrowser = (): boolean => typeof window !== "undefined";

export const isAuthProbePath = (url?: string | null): boolean => {
  if (!url) return false;
  const path = url.split("?")[0] || "";
  return (
    path.endsWith("/api/auth/status") ||
    path.endsWith("/api/auth/verify") ||
    path === "/api/auth/status" ||
    path === "/api/auth/verify"
  );
};

export const isCanceledRequestError = (error: unknown): boolean => {
  if (!error || typeof error !== "object") return false;
  const maybe = error as {
    code?: string;
    name?: string;
    message?: string;
  };
  const code = String(maybe.code || "").toUpperCase();
  const name = String(maybe.name || "");
  const message = String(maybe.message || "").toLowerCase();
  return (
    code === "ERR_CANCELED" ||
    name === "CanceledError" ||
    name === "AbortError" ||
    message.includes("canceled") ||
    message.includes("cancelled") ||
    message.includes("aborted")
  );
};

export const isTransientAuthNetworkError = (error: unknown): boolean => {
  if (isCanceledRequestError(error)) return true;
  if (!error || typeof error !== "object") return false;
  const maybe = error as {
    response?: unknown;
    code?: string;
    message?: string;
    isAxiosError?: boolean;
  };
  if (maybe.response) return false;
  const normalized = `${maybe.code || ""} ${maybe.message || ""}`.toLowerCase();
  return (
    normalized.includes("network error") ||
    normalized.includes("err_connection_closed") ||
    normalized.includes("econnreset") ||
    normalized.includes("socket hang up") ||
    normalized.includes("timeout") ||
    normalized.includes("failed to fetch")
  );
};

export const readAuthSessionSnapshot = (): AuthSessionSnapshot | null => {
  if (!isBrowser()) return null;
  try {
    const raw = window.sessionStorage.getItem(AUTH_SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AuthSessionSnapshot>;
    if (
      typeof parsed.isAdmin !== "boolean" ||
      typeof parsed.isInitialized !== "boolean" ||
      typeof parsed.checkedAt !== "number"
    ) {
      return null;
    }
    if (Date.now() - parsed.checkedAt > AUTH_SESSION_MAX_AGE_MS) {
      return null;
    }
    return {
      isAdmin: parsed.isAdmin,
      isInitialized: parsed.isInitialized,
      checkedAt: parsed.checkedAt,
    };
  } catch {
    return null;
  }
};

export const writeAuthSessionSnapshot = (
  snapshot: Omit<AuthSessionSnapshot, "checkedAt"> & { checkedAt?: number },
): void => {
  if (!isBrowser()) return;
  try {
    const payload: AuthSessionSnapshot = {
      isAdmin: snapshot.isAdmin,
      isInitialized: snapshot.isInitialized,
      checkedAt: snapshot.checkedAt ?? Date.now(),
    };
    window.sessionStorage.setItem(
      AUTH_SESSION_STORAGE_KEY,
      JSON.stringify(payload),
    );
  } catch {
    // ignore quota / private mode failures
  }
};

export const clearAuthSessionSnapshot = (): void => {
  if (!isBrowser()) return;
  try {
    window.sessionStorage.removeItem(AUTH_SESSION_STORAGE_KEY);
  } catch {
    // ignore
  }
};

export type AuthCheckFailureDecision = {
  keepPreviousAdmin: boolean;
  useCachedSnapshot: boolean;
  silenceNotification: boolean;
};

export const decideAuthCheckFailure = ({
  error,
  hasSuccessfulCheck,
  previousIsAdmin,
  cachedSnapshot,
}: {
  error: unknown;
  hasSuccessfulCheck: boolean;
  previousIsAdmin: boolean;
  cachedSnapshot: AuthSessionSnapshot | null;
}): AuthCheckFailureDecision => {
  const silenceNotification =
    isCanceledRequestError(error) || isTransientAuthNetworkError(error);

  if (isCanceledRequestError(error)) {
    return {
      keepPreviousAdmin: true,
      useCachedSnapshot: false,
      silenceNotification: true,
    };
  }

  if (isTransientAuthNetworkError(error)) {
    if (hasSuccessfulCheck) {
      return {
        keepPreviousAdmin: true,
        useCachedSnapshot: false,
        silenceNotification: true,
      };
    }
    if (cachedSnapshot?.isAdmin) {
      return {
        keepPreviousAdmin: false,
        useCachedSnapshot: true,
        silenceNotification: true,
      };
    }
    return {
      keepPreviousAdmin: previousIsAdmin,
      useCachedSnapshot: Boolean(cachedSnapshot),
      silenceNotification: true,
    };
  }

  return {
    keepPreviousAdmin: false,
    useCachedSnapshot: false,
    silenceNotification: false,
  };
};
