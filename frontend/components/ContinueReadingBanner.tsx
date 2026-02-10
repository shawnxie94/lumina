import { useRouter } from 'next/router';
import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { useReading } from '@/contexts/ReadingContext';
import { IconClock, IconChevronRight, IconTrash, IconBroom } from '@/components/icons';
import { useI18n } from '@/lib/i18n';

export function ContinueReadingBanner() {
  const router = useRouter();
  const { recentArticles, removeArticle, clearArticles, isCollapsed, setIsCollapsed, isHidden } = useReading();
  const panelRef = useRef<HTMLDivElement>(null);
  const { t } = useI18n();

  const isArticlePage = router.pathname === '/article/[id]';

  useEffect(() => {
    if (isCollapsed) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) {
        setIsCollapsed(true);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isCollapsed, setIsCollapsed]);

  if (recentArticles.length === 0 || isHidden) return null;

  if (isCollapsed) {
    return (
      <div className="fixed top-24 right-4 z-40">
        <button
          type="button"
          onClick={() => setIsCollapsed(false)}
          className="flex items-center justify-center w-10 h-10 rounded-full bg-surface border border-border shadow-lg text-text-2 hover:text-text-1 hover:bg-muted transition"
          title={t('最近阅读')}
          aria-label={t('展开最近阅读')}
        >
          <IconClock className="h-5 w-5" />
        </button>
      </div>
    );
  }

  return (
    <div
      className="fixed top-24 left-1/2 -translate-x-1/2 lg:left-auto lg:translate-x-0 lg:right-4 z-40 animate-slide-in w-[calc(100vw-2rem)] max-w-sm lg:w-72"
      ref={panelRef}
    >
      <div className="bg-surface rounded-lg shadow-lg border border-border w-full">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h3 className="font-semibold text-text-1 flex items-center gap-2">
            <IconClock className="h-4 w-4" />
            {t('最近阅读')}
          </h3>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={clearArticles}
              className="text-text-3 hover:text-danger transition"
              title={t('清空全部')}
              aria-label={t('清空全部')}
            >
              <IconBroom className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setIsCollapsed(true)}
              className="text-text-3 hover:text-text-1 transition"
              title={t('收起')}
              aria-label={t('收起最近阅读')}
            >
              <IconChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div className="py-2">
          {recentArticles.map((article) => {
            const isCurrentArticle = isArticlePage && router.query.id === article.slug;
            const truncatedTitle = article.title.length > 20
              ? `${article.title.slice(0, 20)}...`
              : article.title;

            return (
              <div
                key={article.id}
                className={`flex items-center justify-between px-4 py-2 group ${
                  isCurrentArticle ? 'bg-primary-soft' : 'hover:bg-muted'
                }`}
              >
                <Link
                  href={`/article/${article.slug}`}
                  className={`text-sm transition flex-1 truncate ${
                    isCurrentArticle
                      ? 'text-primary-ink'
                      : 'text-text-2 hover:text-text-1'
                  }`}
                  title={article.title}
                >
                  {truncatedTitle}
                </Link>
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    removeArticle(article.id);
                  }}
                  className="text-text-3 hover:text-danger transition ml-2 flex-shrink-0"
                  title={t('删除')}
                  aria-label={t('删除')}
                >
                  <IconTrash className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
