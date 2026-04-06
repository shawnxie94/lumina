import { useEffect, useMemo, useState } from 'react';

import type { GetServerSideProps } from 'next';
import Link from 'next/link';

import SeoHead from '@/components/SeoHead';
import {
  articleApi,
  type Article,
  type BasicSettings,
  resolveMediaUrl,
  reviewApi,
  type ReviewIssue,
} from '@/lib/api';
import AppFooter from '@/components/AppFooter';
import AppHeader from '@/components/AppHeader';
import { BackToTop } from '@/components/BackToTop';
import ArticleGridSkeleton from '@/components/article/ArticleGridSkeleton';
import ArticleLanguageTag from '@/components/article/ArticleLanguageTag';
import LinkButton from '@/components/ui/LinkButton';
import { useBasicSettings } from '@/contexts/BasicSettingsContext';
import { useI18n } from '@/lib/i18n';
import {
  buildCanonicalUrl,
  buildMetaDescription,
  resolveSeoAssetUrl,
} from '@/lib/seo';
import {
  fetchServerArticles,
  fetchServerBasicSettings,
  fetchServerReviews,
  resolveRequestOrigin,
} from '@/lib/serverApi';

const githubUrl = 'https://github.com/shawnxie94/lumina';
const isExternalUrl = (url: string): boolean => /^(https?:\/\/)/.test(url);

const formatDate = (date: string | null, language: 'zh-CN' | 'en'): string => {
  if (!date) return '';
  return new Date(date).toLocaleDateString(language === 'en' ? 'en-US' : 'zh-CN');
};

const getReviewCategoryChips = (
  review: ReviewIssue,
  t: (key: string) => string,
): string[] => {
  if ((review as any).template?.include_all_categories) {
    return [t('全部分类')];
  }
  return review.category_names.length > 0 ? review.category_names : [];
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

interface HomePageProps {
  initialBasicSettings: BasicSettings;
  initialLatestArticles: Article[];
  initialLatestLoaded: boolean;
  initialLatestReviews: ReviewIssue[];
  initialLatestReviewsLoaded: boolean;
  siteOrigin: string;
}

export const getServerSideProps: GetServerSideProps<HomePageProps> = async ({ req }) => {
  const siteOrigin = resolveRequestOrigin(req);
  try {
    const [initialBasicSettings, latestResponse, reviewsResponse] = await Promise.all([
      fetchServerBasicSettings(req),
      fetchServerArticles(req, {
        page: 1,
        size: 6,
        sort_by: 'published_at_desc',
      }),
      fetchServerReviews(req, {
        page: 1,
        size: 3,
      }),
    ]);

    return {
      props: {
        initialBasicSettings,
        initialLatestArticles: latestResponse.data || [],
        initialLatestLoaded: true,
        initialLatestReviews: reviewsResponse.data || [],
        initialLatestReviewsLoaded: true,
        siteOrigin,
      },
    };
  } catch {
    return {
      props: {
        initialBasicSettings: {
          default_language: 'zh-CN',
          site_name: 'Lumina',
          site_description: '信息灯塔',
          site_logo_url: '',
          rss_enabled: false,
          home_badge_text: '',
          home_tagline_text: '',
          home_primary_button_text: '',
          home_primary_button_url: '',
          home_secondary_button_text: '',
          home_secondary_button_url: '',
        },
        initialLatestArticles: [],
        initialLatestLoaded: false,
        initialLatestReviews: [],
        initialLatestReviewsLoaded: false,
        siteOrigin,
      },
    };
  }
};

export default function HomePage({
  initialLatestArticles,
  initialLatestLoaded,
  initialLatestReviews,
  initialLatestReviewsLoaded,
  siteOrigin,
}: HomePageProps) {
  const { basicSettings } = useBasicSettings();
  const { t, language } = useI18n();
  const [latestArticles, setLatestArticles] = useState<Article[]>(initialLatestArticles);
  const [latestLoading, setLatestLoading] = useState(!initialLatestLoaded);
  const [latestReviews, setLatestReviews] = useState<ReviewIssue[]>(initialLatestReviews);
  const [reviewsLoading, setReviewsLoading] = useState(!initialLatestReviewsLoaded);

  useEffect(() => {
    if (initialLatestLoaded) {
      return;
    }
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
  }, [initialLatestLoaded]);

  useEffect(() => {
    if (initialLatestReviewsLoaded) {
      return;
    }
    let active = true;

    const fetchLatestReviews = async () => {
      setReviewsLoading(true);
      try {
        const response = await reviewApi.getPublicReviews({
          page: 1,
          size: 3,
        });
        if (!active) return;
        setLatestReviews((response.data as ReviewIssue[]) || []);
      } catch (error) {
        console.error('Failed to fetch latest reviews:', error);
        if (!active) return;
        setLatestReviews([]);
      } finally {
        if (active) {
          setReviewsLoading(false);
        }
      }
    };

    fetchLatestReviews();

    return () => {
      active = false;
    };
  }, [initialLatestReviewsLoaded]);

  const latestUpdatedAt = useMemo(() => {
    if (latestArticles.length === 0) return null;
    return (
      latestArticles
        .map((a) => a.published_at)
        .filter(Boolean)
        .sort()
        .slice(-1)[0] || null
    );
  }, [latestArticles]);

  const siteName = basicSettings.site_name || 'Lumina';
  const siteDescription = basicSettings.site_description || t('信息灯塔');
  const logoUrl = basicSettings.site_logo_url || '/logo.png';
  const fallbackTopImageUrl = resolveMediaUrl(logoUrl);
  const heroBadgeText = basicSettings.home_badge_text || t('信息灯塔');
  const heroTaglineText = basicSettings.home_tagline_text || t('汇流万象，智能提纯，沉淀真知。');
  const primaryButtonText = basicSettings.home_primary_button_text || t('信息流');
  const primaryButtonUrl = basicSettings.home_primary_button_url || '/list';
  const secondaryButtonText = basicSettings.home_secondary_button_text || t('更多');
  const secondaryButtonUrl = basicSettings.home_secondary_button_url || githubUrl;
  const seoDescription = buildMetaDescription(
    [siteDescription, heroTaglineText].filter(Boolean).join(' '),
  );
  const canonicalUrl = buildCanonicalUrl(siteOrigin, '/');
  const seoImageUrl = resolveSeoAssetUrl(siteOrigin, basicSettings.site_logo_url || '/logo.png');
  const structuredData = [
    {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: siteName,
      url: canonicalUrl,
      description: seoDescription,
    },
    {
      '@context': 'https://schema.org',
      '@type': 'Organization',
      name: siteName,
      url: canonicalUrl,
      logo: seoImageUrl || undefined,
    },
  ];

  const renderReviewCard = (review: ReviewIssue) => {
    const template = (review as any).template;
    const href = `/reviews/${review.slug}`;
    const displayTitle = review.title;
    const topImage = resolveMediaUrl(review.top_image || logoUrl) || fallbackTopImageUrl;

    const categoryChips = getReviewCategoryChips(review, t);

    return (
      <Link
        key={review.slug}
        href={href}
        className="group overflow-hidden rounded-2xl border border-border-strong bg-surface/80 shadow-md transition hover:border-primary/40 hover:shadow-lg hover:shadow-primary/10"
      >
        <div className="relative aspect-video overflow-hidden bg-muted">
          <img
            src={topImage}
            alt={displayTitle}
            className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
          />
          {template && (
            <span className="language-tag absolute left-2 top-2 px-2 py-0.5 text-xs">
              {template.name}
            </span>
          )}
        </div>
        <div className="p-4">
          <h3 className="text-base font-semibold text-text-1 truncate group-hover:text-primary transition" title={displayTitle}>
            {displayTitle}
          </h3>
          {review.summary && (
            <p className="mt-2 text-sm text-text-3 line-clamp-2">
              {review.summary}
            </p>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-text-3">
            {categoryChips.map((chip) => (
              <span key={chip} className="category-chip rounded-sm px-2 py-0.5 bg-muted text-text-2">
                {chip}
              </span>
            ))}
            <span>
              {formatDate(review.published_at || review.created_at, language)}
            </span>
          </div>
        </div>
      </Link>
    );
  };

  return (
    <div className="min-h-screen bg-app flex flex-col">
      <SeoHead
        title={`${siteDescription} - Lumina`}
        description={seoDescription}
        canonicalUrl={canonicalUrl}
        imageUrl={seoImageUrl}
        siteName={siteName}
        structuredData={structuredData}
      />
      <AppHeader hideRss />

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
                <LinkButton
                  href={primaryButtonUrl}
                  variant="primary"
                  className="rounded-full px-5 py-2.5"
                >
                  {primaryButtonText}
                </LinkButton>
                <LinkButton
                  href="/reviews"
                  variant="secondary"
                  className="rounded-full px-5 py-2.5"
                >
                  {t('回顾')}
                </LinkButton>
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
        </div>

        {!reviewsLoading && latestReviews.length > 0 && (
          <section className="max-w-7xl mx-auto px-4 pb-12">
            <div className="text-center">
              <h2 className="text-2xl sm:text-3xl font-semibold text-text-1">
                {t('最新回顾')}
              </h2>
              <div className="mx-auto mt-4 w-full max-w-3xl border-b border-border-strong" />
            </div>
            <div className="mt-4 grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
              {latestReviews.map(renderReviewCard)}
            </div>
          </section>
        )}

        <section className="max-w-7xl mx-auto px-4 pb-12">
          <div className="text-center">
            <h2 className="text-2xl sm:text-3xl font-semibold text-text-1">
              {t('最新内容')}
            </h2>
            <div className="mt-2 text-sm font-medium text-text-2">
              {t('更新时间')} {latestUpdatedAt ? formatDateTime(latestUpdatedAt, language) : '--'}
            </div>
            <div className="mx-auto mt-4 w-full max-w-3xl border-b border-border-strong" />
          </div>
          {latestLoading ? (
            <ArticleGridSkeleton />
          ) : latestArticles.length === 0 ? (
            <div className="py-12 text-center text-text-3">{t('暂无文章')}</div>
          ) : (
            <div className="mt-4 grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
              {latestArticles.map((article) => {
                const displayTitle = article.title_trans?.trim() || article.title;

                return (
                  <Link
                    key={article.slug}
                    href={`/article/${article.slug}`}
                    className="group overflow-hidden rounded-2xl border border-border-strong bg-surface/80 shadow-md transition hover:border-primary/40 hover:shadow-lg hover:shadow-primary/10"
                  >
                    <div className="relative aspect-video overflow-hidden bg-muted">
                      <img
                        src={resolveMediaUrl(article.top_image || logoUrl) || fallbackTopImageUrl}
                        alt={displayTitle}
                        className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
                      />
                      <ArticleLanguageTag article={article} className="absolute left-2 top-2 px-2 py-0.5 text-xs" />
                    </div>
                    <div className="p-4">
                      <h3 className="text-base font-semibold text-text-1 truncate group-hover:text-primary transition" title={displayTitle}>
                        {displayTitle}
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
                );
              })}
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
