import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  ReactNode,
} from "react";

import { authApi, clearLegacyWebAdminToken } from "@/lib/api";
import {
  clearAuthSessionSnapshot,
  decideAuthCheckFailure,
  isTransientAuthNetworkError,
  readAuthSessionSnapshot,
  writeAuthSessionSnapshot,
} from "@/lib/authSession";

interface AuthContextType {
  isAdmin: boolean;
  isLoading: boolean;
  isInitialized: boolean;
  login: (password: string) => Promise<void>;
  logout: () => void;
  setup: (password: string) => Promise<void>;
  changePassword: (oldPassword: string, newPassword: string) => Promise<void>;
  checkAuth: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const getInitialAuthState = () => {
  const cached = readAuthSessionSnapshot();
  return {
    isAdmin: Boolean(cached?.isAdmin),
    isInitialized: cached?.isInitialized ?? true,
    // Keep admin chrome stable while the first verify is in flight when we
    // already have a same-tab cached admin session.
    isLoading: !cached?.isAdmin,
  };
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const initialStateRef = useRef(getInitialAuthState());
  const [isAdmin, setIsAdmin] = useState(initialStateRef.current.isAdmin);
  const [isLoading, setIsLoading] = useState(initialStateRef.current.isLoading);
  const [isInitialized, setIsInitialized] = useState(
    initialStateRef.current.isInitialized,
  );
  const hasSuccessfulCheckRef = useRef(false);
  const isAdminRef = useRef(initialStateRef.current.isAdmin);
  const checkSeqRef = useRef(0);

  useEffect(() => {
    isAdminRef.current = isAdmin;
  }, [isAdmin]);

  const persistSession = useCallback(
    (next: { isAdmin: boolean; isInitialized: boolean }) => {
      writeAuthSessionSnapshot(next);
    },
    [],
  );

  const checkAuth = useCallback(async () => {
    const seq = ++checkSeqRef.current;
    setIsLoading(true);
    try {
      const status = await authApi.getStatus();
      if (seq !== checkSeqRef.current) return;

      setIsInitialized(status.initialized);

      if (!status.initialized) {
        setIsAdmin(false);
        isAdminRef.current = false;
        hasSuccessfulCheckRef.current = true;
        clearAuthSessionSnapshot();
        return;
      }

      const verify = await authApi.verify();
      if (seq !== checkSeqRef.current) return;

      const nextIsAdmin = Boolean(verify.valid && verify.role === "admin");
      setIsAdmin(nextIsAdmin);
      isAdminRef.current = nextIsAdmin;
      hasSuccessfulCheckRef.current = true;
      persistSession({
        isAdmin: nextIsAdmin,
        isInitialized: true,
      });
    } catch (error) {
      if (seq !== checkSeqRef.current) return;

      const cached = readAuthSessionSnapshot();
      const decision = decideAuthCheckFailure({
        error,
        hasSuccessfulCheck: hasSuccessfulCheckRef.current,
        previousIsAdmin: isAdminRef.current,
        cachedSnapshot: cached,
      });

      if (decision.keepPreviousAdmin) {
        // Preserve the last confirmed admin/guest state across transient
        // network blips so detail pages do not flicker into guest chrome.
        return;
      }

      if (decision.useCachedSnapshot && cached) {
        setIsAdmin(cached.isAdmin);
        setIsInitialized(cached.isInitialized);
        isAdminRef.current = cached.isAdmin;
        return;
      }

      // Hard failures (4xx/5xx with response body) clear admin state.
      if (!isTransientAuthNetworkError(error)) {
        setIsAdmin(false);
        isAdminRef.current = false;
        clearAuthSessionSnapshot();
      }
    } finally {
      if (seq === checkSeqRef.current) {
        setIsLoading(false);
      }
    }
  }, [persistSession]);

  useEffect(() => {
    clearLegacyWebAdminToken();
    void checkAuth();
  }, [checkAuth]);

  const login = async (password: string) => {
    await authApi.login(password);
    clearLegacyWebAdminToken();
    setIsAdmin(true);
    isAdminRef.current = true;
    hasSuccessfulCheckRef.current = true;
    setIsInitialized(true);
    persistSession({ isAdmin: true, isInitialized: true });
  };

  const logout = useCallback(() => {
    void authApi
      .logout()
      .catch(() => undefined)
      .finally(() => {
        clearLegacyWebAdminToken();
        clearAuthSessionSnapshot();
        setIsAdmin(false);
        isAdminRef.current = false;
        hasSuccessfulCheckRef.current = true;
      });
  }, []);

  const setup = async (password: string) => {
    await authApi.setup(password);
    clearLegacyWebAdminToken();
    setIsAdmin(true);
    isAdminRef.current = true;
    hasSuccessfulCheckRef.current = true;
    setIsInitialized(true);
    persistSession({ isAdmin: true, isInitialized: true });
  };

  const changePassword = async (oldPassword: string, newPassword: string) => {
    await authApi.changePassword(oldPassword, newPassword);
    clearLegacyWebAdminToken();
  };

  return (
    <AuthContext.Provider
      value={{
        isAdmin,
        isLoading,
        isInitialized,
        login,
        logout,
        setup,
        changePassword,
        checkAuth,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
