import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';

interface ReadingArticle {
  id: string;
  slug: string;
  title: string;
  title_trans?: string | null;
  type?: 'article' | 'review';
}

interface ReadingContextType {
  recentArticles: ReadingArticle[];
  addArticle: (article: ReadingArticle) => void;
  removeArticle: (id: string) => void;
  clearArticles: () => void;
  isCollapsed: boolean;
  setIsCollapsed: (collapsed: boolean) => void;
  isHidden: boolean;
  setIsHidden: (hidden: boolean) => void;
}

const ReadingContext = createContext<ReadingContextType | undefined>(undefined);

const MAX_RECENT_ARTICLES = 5;
const RECENT_READING_STORAGE_KEY = 'recentReadingArticles';
const RECENT_READING_COLLAPSED_STORAGE_KEY = 'recentReadingCollapsed';

function parseStoredArticles(value: string | null): ReadingArticle[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function ReadingProvider({ children }: { children: ReactNode }) {
  const [recentArticles, setRecentArticles] = useState<ReadingArticle[]>(() => {
    if (typeof window === 'undefined') return [];
    return parseStoredArticles(localStorage.getItem(RECENT_READING_STORAGE_KEY));
  });
  const [isCollapsed, setIsCollapsed] = useState(() => {
    if (typeof window === 'undefined') return true;
    return localStorage.getItem(RECENT_READING_COLLAPSED_STORAGE_KEY) === 'true';
  });
  const [isHidden, setIsHidden] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const refreshFromStorage = () => {
      setRecentArticles(parseStoredArticles(localStorage.getItem(RECENT_READING_STORAGE_KEY)));
      const collapsedStored = localStorage.getItem(RECENT_READING_COLLAPSED_STORAGE_KEY);
      if (collapsedStored !== null) {
        setIsCollapsed(collapsedStored === 'true');
      }
    };

    const handleStorageChange = (event: StorageEvent) => {
      if (event.key !== RECENT_READING_STORAGE_KEY && event.key !== RECENT_READING_COLLAPSED_STORAGE_KEY) return;
      refreshFromStorage();
    };

    window.addEventListener('storage', handleStorageChange);
    window.addEventListener('focus', refreshFromStorage);
    document.addEventListener('visibilitychange', refreshFromStorage);
    return () => {
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener('focus', refreshFromStorage);
      document.removeEventListener('visibilitychange', refreshFromStorage);
    };
  }, []);

  useEffect(() => {
    localStorage.setItem(RECENT_READING_STORAGE_KEY, JSON.stringify(recentArticles));
  }, [recentArticles]);

  useEffect(() => {
    localStorage.setItem(RECENT_READING_COLLAPSED_STORAGE_KEY, String(isCollapsed));
  }, [isCollapsed]);

  const addArticle = useCallback((article: ReadingArticle) => {
    setRecentArticles((prev) => {
      const filtered = prev.filter((a) => a.id !== article.id);
      return [article, ...filtered].slice(0, MAX_RECENT_ARTICLES);
    });
  }, []);

  const removeArticle = useCallback((id: string) => {
    setRecentArticles((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const clearArticles = useCallback(() => {
    setRecentArticles([]);
    setIsCollapsed(true);
  }, [setIsCollapsed]);

  return (
    <ReadingContext.Provider value={{ recentArticles, addArticle, removeArticle, clearArticles, isCollapsed, setIsCollapsed, isHidden, setIsHidden }}>
      {children}
    </ReadingContext.Provider>
  );
}

export function useReading() {
  const context = useContext(ReadingContext);
  if (!context) {
    throw new Error('useReading must be used within a ReadingProvider');
  }
  return context;
}
