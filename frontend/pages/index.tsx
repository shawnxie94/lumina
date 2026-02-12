import { useEffect, useMemo, useState } from 'react';

import Head from 'next/head';
import Link from 'next/link';

import { articleApi, type Article, resolveMediaUrl } from '@/lib/api';
import AppFooter from '@/components/AppFooter';
import AppHeader from '@/components/AppHeader';
import { BackToTop } from '@/components/BackToTop';
import ArticleGridSkeleton from '@/components/article/ArticleGridSkeleton';
import ArticleLanguageTag from '@/components/article/ArticleLanguageTag';
import LinkButton from '@/components/ui/LinkButton';
import { useBasicSettings } from '@/contexts/BasicSettingsContext';
import { useI18n } from '@/lib/i18n';

const githubUrl = 'https://github.com/shawnxie94/lumina';
const isExternalUrl = (url: string): boolean => /^(https?:\/\/)/.test(url);

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
  const fallbackTopImageUrl = resolveMediaUrl(logoUrl);
  const heroBadgeText = basicSettings.home_badge_text || t('信息灯塔');
  const heroTaglineText = basicSettings.home_tagline_text || t('汇流万象，智能提纯，沉淀真知。');
  const primaryButtonText = basicSettings.home_primary_button_text || t('浏览内容');
  const primaryButtonUrl = basicSettings.home_primary_button_url || '/list';
  const secondaryButtonText = basicSettings.home_secondary_button_text || t('了解更多');
  const secondaryButtonUrl = basicSettings.home_secondary_button_url || githubUrl;
  return (
    <div className="min-h-screen bg-app flex flex-col">
      <Head>
        <title>
          {siteName} - {siteDescription}
        </title>
      </Head>
      <AppHeader />

      <main className="flex-1">
        <div className="relative overflow-hidden bg-surface/80">
          <div
            className="absolute inset-0 opacity-20"
            style={{
              backgroundImage: `url(${logoUrl})`,
              backgroundRepeat: 'no-repeat',
              backgroundPosition: 'center center',
              backgroundSize: 'contain',
            }}
          />
          <div className="absolute inset-0 bg-gradient-to-br from-primary-soft/30 via-transparent to-primary-soft/20" />
          <div className="absolute -right-16 top-10 h-56 w-56 rounded-full bg-primary-soft/40 blur-3xl" />

          <section className="relative px-4 sm:px-6 lg:px-10 py-8 sm:py-12 min-h-[420px] flex items-center justify-center">
            <div className="max-w-md mx-auto text-center">
              <div className="text-base text-text-3">{heroBadgeText}</div>
              <h1 className="mt-2 text-4xl sm:text-5xl font-semibold text-text-1">
                {siteName}
              </h1>
              <p className="mt-3 text-xl text-text-2">{siteDescription}</p>
              <p className="mt-3 text-base text-text-3 leading-relaxed">
                {heroTaglineText}
              </p>
              <div className="mt-6 flex flex-wrap gap-3 justify-center">
                {isExternalUrl(primaryButtonUrl) ? (
                  <LinkButton
                    href={primaryButtonUrl}
                    variant="primary"
                    className="rounded-full px-5 py-2.5"
                    target="_blank"
                    rel="noreferrer"
                  >
                    {primaryButtonText}
                  </LinkButton>
                ) : (
                  <LinkButton
                    href={primaryButtonUrl}
                    variant="primary"
                    className="rounded-full px-5 py-2.5"
                  >
                    {primaryButtonText}
                  </LinkButton>
                )}
                {isExternalUrl(secondaryButtonUrl) ? (
                  <LinkButton
                    href={secondaryButtonUrl}
                    variant="secondary"
                    className="rounded-full px-5 py-2.5"
                    target="_blank"
                    rel="noreferrer"
                  >
                    {secondaryButtonText}
                  </LinkButton>
                ) : (
                  <LinkButton
                    href={secondaryButtonUrl}
                    variant="secondary"
                    className="rounded-full px-5 py-2.5"
                  >
                    {secondaryButtonText}
                  </LinkButton>
                )}
              </div>
            </div>
          </section>

          <div className="relative max-w-7xl mx-auto px-4 pb-12 text-center">
            <h2 className="text-2xl sm:text-3xl font-semibold text-text-1">
              {t('最新内容')}
            </h2>
            <div className="mt-2 text-sm font-medium text-text-2">
              {t('更新时间')} {latestUpdatedAt ? formatDateTime(latestUpdatedAt, language) : '--'}
            </div>
            <div className="mx-auto mt-4 w-full max-w-3xl border-b border-border-strong" />
          </div>
        </div>

        <section className="max-w-7xl mx-auto px-4 pb-12">
          {latestLoading ? (
            <ArticleGridSkeleton />
          ) : latestArticles.length === 0 ? (
            <div className="py-12 text-center text-text-3">{t('暂无文章')}</div>
          ) : (
            <div className="mt-4 grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
              {latestArticles.map((article) => (
                <Link
                  key={article.slug}
                  href={`/article/${article.slug}`}
                  className="group overflow-hidden rounded-2xl border border-border-strong bg-surface/80 shadow-md transition hover:border-primary/40 hover:shadow-lg hover:shadow-primary/10"
                >
                  <div className="relative aspect-video overflow-hidden bg-muted">
                    <img
                      src={resolveMediaUrl(article.top_image || logoUrl) || fallbackTopImageUrl}
                      alt={article.title}
                      className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
                    />
                    <ArticleLanguageTag article={article} className="absolute left-2 top-2 px-2 py-0.5 text-xs" />
                  </div>
                  <div className="p-4">
                    <h3 className="text-base font-semibold text-text-1 truncate group-hover:text-primary transition" title={article.title}>
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
          <div className="mt-8 text-center">
            <LinkButton
              href="/list"
              variant="secondary"
              className="rounded-full px-6 py-2.5 hover:bg-primary hover:text-white hover:border-primary"
            >
              {t('查看更多...')}
            </LinkButton>
          </div>
        </section>
      </main>

      <AppFooter />
      <BackToTop />
    </div>
  );
}
