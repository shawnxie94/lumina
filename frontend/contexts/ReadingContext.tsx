import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';

interface ReadingArticle {
  id: string;
  slug: string;
  title: string;
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

export function ReadingProvider({ children }: { children: ReactNode }) {
  const [recentArticles, setRecentArticles] = useState<ReadingArticle[]>([]);
  const [isCollapsed, setIsCollapsed] = useState(true);
  const [isHidden, setIsHidden] = useState(false);
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem('recentReadingArticles');
    if (stored) {
      try {
        setRecentArticles(JSON.parse(stored));
      } catch {}
    }
    const collapsedStored = localStorage.getItem('recentReadingCollapsed');
    if (collapsedStored !== null) {
      setIsCollapsed(collapsedStored === 'true');
    }
    setInitialized(true);
  }, []);

  useEffect(() => {
    if (initialized) {
      localStorage.setItem('recentReadingArticles', JSON.stringify(recentArticles));
    }
  }, [recentArticles, initialized]);

  useEffect(() => {
    if (initialized) {
      localStorage.setItem('recentReadingCollapsed', String(isCollapsed));
    }
  }, [isCollapsed, initialized]);

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
