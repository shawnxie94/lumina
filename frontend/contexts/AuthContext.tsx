import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';

import { authApi, clearLegacyWebAdminToken } from '@/lib/api';

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

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isAdmin, setIsAdmin] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isInitialized, setIsInitialized] = useState(true);

  const checkAuth = useCallback(async () => {
    setIsLoading(true);
    try {
      const status = await authApi.getStatus();
      setIsInitialized(status.initialized);

      if (status.initialized) {
        const verify = await authApi.verify();
        setIsAdmin(verify.valid && verify.role === 'admin');
      } else {
        setIsAdmin(false);
      }
    } catch {
      setIsAdmin(false);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    clearLegacyWebAdminToken();
    checkAuth();
  }, [checkAuth]);

  const login = async (password: string) => {
    await authApi.login(password);
    clearLegacyWebAdminToken();
    setIsAdmin(true);
  };

  const logout = useCallback(() => {
    void authApi.logout().catch(() => undefined).finally(() => {
      clearLegacyWebAdminToken();
      setIsAdmin(false);
    });
  }, []);

  const setup = async (password: string) => {
    await authApi.setup(password);
    clearLegacyWebAdminToken();
    setIsAdmin(true);
    setIsInitialized(true);
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
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
