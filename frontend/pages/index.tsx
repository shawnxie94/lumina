import { useEffect, useMemo, useState } from 'react';

import Head from 'next/head';
import Link from 'next/link';

import { articleApi, type Article, resolveMediaUrl } from '@/lib/api';
import AppFooter from '@/components/AppFooter';
import AppHeader from '@/components/AppHeader';
import { BackToTop } from '@/components/BackToTop';
import { useBasicSettings } from '@/contexts/BasicSettingsContext';
import { useI18n } from '@/lib/i18n';

const githubUrl = 'https://github.com/shawnxie94/lumina';

const formatDate = (date: string | null, language: 'zh-CN' | 'en'): string => {
  if (!date) return '';
  return new Date(date).toLocaleDateString(language === 'en' ? 'en-US' : 'zh-CN');
};

const formatDateTime = (date: string | null, language: 'zh-CN' | 'en'): string => {
  if (!date) return '';
  return new Date(date).toLocaleString(language === 'en' ? 'en-US' : 'zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
};

export default function HomePage() {
  const { basicSettings } = useBasicSettings();
  const { t, language } = useI18n();
  const [latestArticles, setLatestArticles] = useState<Article[]>([]);
  const [latestLoading, setLatestLoading] = useState(true);

  useEffect(() => {
    let active = true;

    const fetchLatest = async () => {
      setLatestLoading(true);
      try {
        const response = await articleApi.getArticles({
          page: 1,
          size: 6,
          sort_by: 'published_at_desc',
        });
        if (!active) return;
        setLatestArticles(response.data || []);
      } catch (error) {
        console.error('Failed to fetch latest articles:', error);
        if (!active) return;
        setLatestArticles([]);
      } finally {
        if (active) {
          setLatestLoading(false);
        }
      }
    };

    fetchLatest();

    return () => {
      active = false;
    };
  }, []);

  const latestUpdatedAt = useMemo(() => {
    if (latestArticles.length === 0) return null;
    return latestArticles
      .map((article) => article.created_at)
      .filter(Boolean)
      .sort()
      .slice(-1)[0] || null;
  }, [latestArticles]);

  const siteName = basicSettings.site_name || 'Lumina';
  const siteDescription = basicSettings.site_description || t('信息灯塔');
  const logoUrl = basicSettings.site_logo_url || '/logo.png';

  return (
    <div className="min-h-screen bg-app flex flex-col">
      <Head>
        <title>
          {siteName} - {siteDescription}
        </title>
      </Head>
      <AppHeader />

      <main className="flex-1">
        <div className="bg-muted/60">
          <section className="max-w-7xl mx-auto px-4 pt-10 pb-6">
            <div
              className="relative overflow-hidden rounded-2xl bg-surface/80"
              style={{
                backgroundImage: `url(${logoUrl})`,
                backgroundRepeat: 'no-repeat',
                backgroundPosition: '18% 75%',
                backgroundSize: '30% auto',
              }}
            >
              <div className="absolute inset-0 bg-gradient-to-br from-primary-soft/45 via-transparent to-transparent" />
              <div className="absolute -right-16 top-10 h-56 w-56 rounded-full bg-primary-soft/40 blur-3xl" />
              <div className="relative px-4 sm:px-6 lg:px-10 py-8 sm:py-12 min-h-[320px] flex items-center">
                <div className="max-w-7xl mx-auto w-full">
                  <div className="max-w-md mx-auto md:mx-0 md:ml-[55%] text-left">
                    <div className="text-sm text-text-3">{t('信息灯塔')}</div>
                    <h1 className="mt-2 text-3xl sm:text-4xl font-semibold text-text-1">
                      {siteName}
                    </h1>
                    <p className="mt-3 text-lg text-text-2">{siteDescription}</p>
                    <p className="mt-3 text-sm text-text-3 leading-relaxed">
                      {t('汇流万象，智能提纯，沉淀真知。')}
                    </p>
                    <div className="mt-6 flex flex-wrap gap-3">
                      <Link
                        href="/list"
                        className="inline-flex items-center justify-center rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-primary-ink transition"
                      >
                        {t('浏览内容')}
                      </Link>
                      <a
                        href={githubUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center justify-center rounded-full border border-border bg-surface px-5 py-2.5 text-sm font-medium text-text-2 hover:bg-muted hover:text-text-1 transition"
                      >
                        {t('了解更多')}
                      </a>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <div className="h-6" />
        </div>

        <section className="max-w-7xl mx-auto px-4 pt-10 pb-12">
          <div className="mt-6 text-center">
            <h2 className="text-2xl sm:text-3xl font-semibold text-text-1">
              {t('最新内容')}
            </h2>
            <div className="mt-2 text-xs text-text-3">
              {t('更新时间')} {latestUpdatedAt ? formatDateTime(latestUpdatedAt, language) : '--'}
            </div>
            <div className="mx-auto mt-4 h-[2px] w-64 bg-border-strong" />
          </div>

          {latestLoading ? (
            <div className="py-12 text-center text-text-3">{t('加载中')}</div>
          ) : latestArticles.length === 0 ? (
            <div className="py-12 text-center text-text-3">{t('暂无文章')}</div>
          ) : (
            <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {latestArticles.map((article) => (
                <Link
                  key={article.slug}
                  href={`/article/${article.slug}`}
                  className="group rounded-2xl bg-surface/80 shadow-sm transition hover:shadow-md"
                >
                  <div className="relative aspect-video overflow-hidden rounded-t-lg bg-muted">
                    {article.top_image ? (
                      <img
                        src={resolveMediaUrl(article.top_image)}
                        alt={article.title}
                        className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
                      />
                    ) : (
                      <div className="h-full w-full bg-gradient-to-br from-muted to-app" />
                    )}
                  </div>
                  <div className="p-4">
                    <h3 className="text-base font-semibold text-text-1 line-clamp-2 group-hover:text-primary transition">
                      {article.title}
                    </h3>
                    {article.summary && (
                      <p className="mt-2 text-sm text-text-3 line-clamp-2">
                        {article.summary}
                      </p>
                    )}
                    <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-text-3">
                      {article.category && (
                        <span
                          className="rounded-sm px-2 py-0.5"
                          style={{
                            backgroundColor: article.category.color
                              ? `${article.category.color}20`
                              : 'var(--bg-muted)',
                            color: article.category.color || 'var(--text-2)',
                          }}
                        >
                          {article.category.name}
                        </span>
                      )}
                      {article.author && <span>{t('作者')}: {article.author}</span>}
                      <span>
                        {formatDate(article.published_at || article.created_at, language)}
                      </span>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>
      </main>

      <AppFooter />
      <BackToTop />
    </div>
  );
}
