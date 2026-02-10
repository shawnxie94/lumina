import { createContext, useContext, useState, useCallback, useRef, ReactNode } from 'react';
import { useI18n } from '@/lib/i18n';

type ToastType = 'success' | 'error' | 'info';

interface Toast {
  id: number;
  message: string;
  type: ToastType;
}

interface ToastContextType {
  showToast: (message: string, type?: ToastType) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);
const TOAST_DURATION = 3000;
const TOAST_DEDUPE_MS = 1200;

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const { t } = useI18n();
  const recentToastRef = useRef<Map<string, number>>(new Map());

  const showToast = useCallback((message: string, type: ToastType = 'success') => {
    const now = Date.now();
    const key = `${type}:${message}`;
    const lastTimestamp = recentToastRef.current.get(key);
    if (lastTimestamp && now - lastTimestamp < TOAST_DEDUPE_MS) {
      return;
    }
    recentToastRef.current.set(key, now);

    recentToastRef.current.forEach((timestamp, toastKey) => {
      if (now - timestamp > TOAST_DURATION) {
        recentToastRef.current.delete(toastKey);
      }
    });

    const id = now + Math.floor(Math.random() * 1000);
    setToasts((prev) => [...prev, { id, message, type }]);

    setTimeout(() => {
      setToasts((prev) => prev.filter((item) => item.id !== id));
    }, TOAST_DURATION);
  }, []);

  const removeToast = (id: number) => {
    setToasts((prev) => prev.filter((item) => item.id !== id));
  };

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div className="fixed top-4 right-4 z-50 space-y-2" aria-live="polite" aria-atomic="false">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`px-4 py-3 rounded-sm shadow-md flex items-center gap-3 min-w-[280px] animate-slide-in ${
              toast.type === 'success'
                ? 'bg-green-500 text-white'
                : toast.type === 'error'
                ? 'bg-red-500 text-white'
                : 'bg-blue-500 text-white'
            }`}
          >
            <span className="text-lg" aria-hidden="true">
              {toast.type === 'success' ? '✓' : toast.type === 'error' ? '✕' : 'ℹ'}
            </span>
            <span className="flex-1">{t(toast.message)}</span>
            <button
              onClick={() => removeToast(toast.id)}
              className="text-white/80 hover:text-white"
              aria-label={t('关闭')}
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
