import { useState, useEffect, useMemo, useRef, useCallback } from 'react';

import type { GetServerSideProps } from 'next';
import { useRouter } from 'next/router';
import Link from 'next/link';

import {
  articleApi,
  categoryApi,
  mediaApi,
  storageSettingsApi,
  topicApi,
  Article,
  BasicSettings,
  Category,
  TopicSummary,
  normalizeMediaHtml,
  resolveMediaUrl,
} from '@/lib/api';
import { buildArticleHref as buildNavigableArticleHref } from '@/lib/articlePreview';
import AppFooter from '@/components/AppFooter';
import AppHeader from '@/components/AppHeader';
import SeoHead from '@/components/SeoHead';
import ArticleSplitEditorModal from '@/components/article/ArticleSplitEditorModal';
import FeedListSkeleton from '@/components/article/FeedListSkeleton';
import CategorySidebar from '@/components/list/CategorySidebar';
import PaginationBar from '@/components/list/PaginationBar';
import AdvancedFilters, { FilterSummary } from '@/components/list/AdvancedFilters';
import FilterToolbar from '@/components/list/FilterToolbar';
import MobileFilterDrawer from '@/components/list/MobileFilterDrawer';
import ArticleCard from '@/components/list/ArticleCard';
import BatchActionBar, { SelectAllBar } from '@/components/list/BatchActionBar';
import CreateArticleFormFields from '@/components/list/CreateArticleFormFields';
import ConfirmModal from '@/components/ConfirmModal';
import { useToast } from '@/components/Toast';
import { BackToTop } from '@/components/BackToTop';
import { useAuth } from '@/contexts/AuthContext';
import { useBasicSettings } from '@/contexts/BasicSettingsContext';
import { resolveCreateArticlePatch, type CreatePendingMedia } from '@/lib/createArticleMedia';
import { useI18n } from '@/lib/i18n';
import { parseQuickDateOption, type QuickDateOption } from '@/lib/listFilters';
import { buildCanonicalUrl, buildPathWithQuery, getListPageSeo, resolveSeoAssetUrl } from '@/lib/seo';
import {
  fetchServerAuthState,
  fetchServerArticles,
  fetchServerBasicSettings,
  fetchServerCategories,
  fetchServerCategoryStats,
  resolveRequestOrigin,
} from '@/lib/serverApi';
import { shouldRefreshListAfterAuthResolution } from '@/lib/listAuthSync';
import { renderSafeMarkdown } from '@/lib/safeHtml';
import {
  extractMediaLinkFromHtml,
  extractMediaLinkFromText,
  buildMarkdownFromMediaLink,
  insertTextAtCursor,
} from '@/lib/articleMedia';
import { buildCreateMediaToken } from '@/lib/createPasteMedia';
import {
  formatDate,
  getDateRangeFromQuickOption,
  parseDateQuery,
  serializeQuery,
  pickListQuery,
} from '@/lib/listQuery';

const FILTER_FETCH_DEBOUNCE_MS = 500;
const TITLE_SEARCH_FETCH_DEBOUNCE_MS = 900;

interface ListPageProps {
  initialBasicSettings: BasicSettings;
  initialArticles: Article[];
  initialCategories: Category[];
  initialCategoryStats: { id: string; name: string; color: string | null; article_count: number }[];
  initialPagination: {
    page: number;
    size: number;
    total: number;
    total_pages: number;
  };
  initialQuery: Record<string, string>;
  initialIsAdmin: boolean;
  initialDataLoaded: boolean;
  siteOrigin: string;
}

export const getServerSideProps: GetServerSideProps<ListPageProps> = async ({ req, query }) => {
  const initialQuery = pickListQuery(query as Record<string, string | string[] | undefined>);
  const siteOrigin = resolveRequestOrigin(req);
  const page = Number(initialQuery.page || '1');
  const size = Number(initialQuery.size || '10');

  try {
    const [
      initialIsAdmin,
      initialBasicSettings,
      articleResponse,
      initialCategories,
      initialCategoryStats,
    ] = await Promise.all([
      fetchServerAuthState(req),
      fetchServerBasicSettings(req),
      fetchServerArticles(req, {
        page: Number.isFinite(page) && page > 0 ? page : 1,
        size: Number.isFinite(size) && [10, 20, 50, 100].includes(size) ? size : 10,
        category_id: initialQuery.category_id,
        search: initialQuery.search,
        source_domain: initialQuery.source_domain,
        author: initialQuery.author,
        topic: initialQuery.topic,
        published_at_start: initialQuery.published_at_start,
        published_at_end: initialQuery.published_at_end,
        created_at_start: initialQuery.created_at_start,
        created_at_end: initialQuery.created_at_end,
        sort_by: initialQuery.sort_by || 'published_at_desc',
      }),
      fetchServerCategories(req),
      fetchServerCategoryStats(req, {
        search: initialQuery.search,
        source_domain: initialQuery.source_domain,
        author: initialQuery.author,
        topic: initialQuery.topic,
        published_at_start: initialQuery.published_at_start,
        published_at_end: initialQuery.published_at_end,
        created_at_start: initialQuery.created_at_start,
        created_at_end: initialQuery.created_at_end,
      }),
    ]);

    return {
      props: {
        initialBasicSettings,
        initialArticles: articleResponse.data || [],
        initialCategories,
        initialCategoryStats,
        initialPagination: articleResponse.pagination,
        initialQuery,
        initialIsAdmin,
        initialDataLoaded: true,
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
          header_custom_links: [],
        },
        initialArticles: [],
        initialCategories: [],
        initialCategoryStats: [],
        initialPagination: {
          page: 1,
          size: 10,
          total: 0,
          total_pages: 1,
        },
        initialQuery,
        initialIsAdmin: false,
        initialDataLoaded: false,
        siteOrigin,
      },
    };
  }
};

export default function Home({
  initialArticles,
  initialCategories,
  initialCategoryStats,
  initialPagination,
  initialQuery,
  initialIsAdmin,
  initialDataLoaded,
  siteOrigin,
}: ListPageProps) {
  const router = useRouter();
  const { showToast } = useToast();
  const { isAdmin, isLoading: authLoading } = useAuth();
  const { t } = useI18n();
  const { basicSettings } = useBasicSettings();
  const initialSelectedCategory = initialQuery.category_id || '';
  const initialSearchTerm = initialQuery.search || '';
  const initialSourceDomain = initialQuery.source_domain || '';
  const initialAuthor = initialQuery.author || '';
  const initialVisibilityFilter =
    initialQuery.visibility === 'visible' || initialQuery.visibility === 'hidden'
      ? initialQuery.visibility
      : '';
  const initialQuickDateFilter = parseQuickDateOption(initialQuery.quick_date);
  const initialSortBy =
    initialQuery.sort_by === 'created_at_desc' ||
    initialQuery.sort_by === 'published_at_desc' ||
    initialQuery.sort_by === 'note_recommendation_level_desc'
      ? initialQuery.sort_by
      : 'published_at_desc';
  const initialPublishedStart = parseDateQuery(initialQuery.published_at_start || '');
  const initialPublishedEnd = parseDateQuery(initialQuery.published_at_end || '');
  const initialCreatedStart = parseDateQuery(initialQuery.created_at_start || '');
  const initialCreatedEnd = parseDateQuery(initialQuery.created_at_end || '');
  const initialPage = Number.isFinite(Number(initialQuery.page || ''))
    ? Math.max(1, Math.floor(Number(initialQuery.page || '1')))
    : initialPagination.page || 1;
  const initialPageSize =
    Number.isFinite(Number(initialQuery.size || '')) &&
    [10, 20, 50, 100].includes(Number(initialQuery.size || ''))
      ? Number(initialQuery.size)
      : initialPagination.size || 10;
  const [articles, setArticles] = useState<Article[]>(initialArticles);
  const [categories, setCategories] = useState<Category[]>(initialCategories);
  const [categoryStats, setCategoryStats] = useState<{ id: string; name: string; color: string | null; article_count: number }[]>(initialCategoryStats);
  const [authors, setAuthors] = useState<string[]>([]);
  const [sources, setSources] = useState<string[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>(initialSelectedCategory);
  const [searchTerm, setSearchTerm] = useState<string>(initialSearchTerm);
  const [sourceDomain, setSourceDomain] = useState<string>(initialSourceDomain);
  const [author, setAuthor] = useState<string>(initialAuthor);
  const [topicKey, setTopicKey] = useState<string>(initialQuery.topic || '');
  const [topics, setTopics] = useState<TopicSummary[]>([]);
  const [publishedDateRange, setPublishedDateRange] = useState<[Date | null, Date | null]>([initialPublishedStart, initialPublishedEnd]);
  const [createdDateRange, setCreatedDateRange] = useState<[Date | null, Date | null]>(
    initialCreatedStart || initialCreatedEnd
      ? [initialCreatedStart, initialCreatedEnd]
      : initialQuickDateFilter
        ? getDateRangeFromQuickOption(initialQuickDateFilter)
        : [null, null],
  );
  const [quickDateFilter, setQuickDateFilter] = useState<QuickDateOption>(initialQuickDateFilter);
  const [visibilityFilter, setVisibilityFilter] = useState<string>(initialVisibilityFilter);
  const [sortBy, setSortBy] = useState<string>(initialSortBy);
  const [page, setPage] = useState(initialPage);
  const [pageSize, setPageSize] = useState(initialPageSize);
  const [total, setTotal] = useState(initialPagination.total);
  const [loading, setLoading] = useState(!initialDataLoaded);
  const [initialized, setInitialized] = useState(initialDataLoaded);
  const [selectedArticleSlugs, setSelectedArticleSlugs] = useState<Set<string>>(new Set());
  const [showFilters, setShowFilters] = useState(
    Boolean(
      initialSearchTerm ||
      initialSourceDomain ||
      initialAuthor ||
      initialVisibilityFilter ||
      initialPublishedStart ||
      initialPublishedEnd ||
      initialCreatedStart ||
      initialCreatedEnd,
    ),
  );
  const [showMobileFilters, setShowMobileFilters] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [jumpToPage, setJumpToPage] = useState('');
  const [batchCategoryId, setBatchCategoryId] = useState('');
  const [batchAction, setBatchAction] = useState<'none' | 'export' | 'visibility' | 'category' | 'delete'>('none');
  const [isMobile, setIsMobile] = useState(false);
  const [isAppending, setIsAppending] = useState(false);
  const [hasMore, setHasMore] = useState(initialArticles.length < initialPagination.total);
  const [loadingMore, setLoadingMore] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const [confirmState, setConfirmState] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    confirmText?: string;
    cancelText?: string;
    onConfirm: () => void | Promise<void>;
  }>({
    isOpen: false,
    title: '',
    message: '',
    confirmText: t('确定'),
    cancelText: t('取消'),
    onConfirm: () => {},
  });


  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createTitle, setCreateTitle] = useState('');
  const [createAuthor, setCreateAuthor] = useState('');
  const [createPublishedAt, setCreatePublishedAt] = useState(() => formatDate(new Date()));
  const [createCategoryId, setCreateCategoryId] = useState('');
  const [createTopImage, setCreateTopImage] = useState('');
  const [createContent, setCreateContent] = useState('');
  const [createSourceUrl, setCreateSourceUrl] = useState('');
  const [createSaving, setCreateSaving] = useState(false);
  const [createMediaStorageEnabled, setCreateMediaStorageEnabled] = useState(false);
  const [createPendingMedia, setCreatePendingMedia] = useState<CreatePendingMedia[]>([]);

  const [publishedStartDate, publishedEndDate] = publishedDateRange;
  const [createdStartDate, createdEndDate] = createdDateRange;
  const isBootstrapping = authLoading || !router.isReady || !initialized;
  const showAdminDesktop = isAdmin && !isMobile;
  const listLoading = loading || authLoading;
  const shouldHoldListView = isBootstrapping || listLoading;
  const [listContentReady, setListContentReady] = useState(initialDataLoaded);
  const batchActionPending = batchAction !== 'none';
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const initialQuerySignature = useMemo(() => serializeQuery(initialQuery), [initialQuery]);
  const hydratedQueryRef = useRef(initialDataLoaded ? initialQuerySignature : '');
  const syncedQueryRef = useRef('');
  const suppressNextPageFetchRef = useRef(false);
  const skipInitialFilterFetchRef = useRef(initialDataLoaded);
  const skipInitialPageFetchRef = useRef(initialDataLoaded);
  const authResolvedRef = useRef(false);
  const lastAdminStateRef = useRef<boolean | null>(null);
  const authorsLoadingRef = useRef(false);
  const sourcesLoadingRef = useRef(false);
  const articleRequestIdRef = useRef(0);
  const categoryStatsRequestIdRef = useRef(0);
  const routerQueryState = useMemo(
    () => pickListQuery(router.query as Record<string, string | string[] | undefined>),
    [router.query],
  );
  const routerQuerySignature = useMemo(
    () => serializeQuery(routerQueryState),
    [routerQueryState],
  );

  const currentListPath = useMemo(() => {
    const asPath = router.asPath || '/list';
    return asPath.split('#')[0] || '/list';
  }, [router.asPath]);

  const currentListQuery = useMemo(() => {
    const nextQuery: Record<string, string> = {};
    if (selectedCategory) nextQuery.category_id = selectedCategory;
    if (searchTerm) nextQuery.search = searchTerm;
    if (sourceDomain) nextQuery.source_domain = sourceDomain;
    if (author) nextQuery.author = author;
    if (topicKey) nextQuery.topic = topicKey;
    if (visibilityFilter) nextQuery.visibility = visibilityFilter;
    if (quickDateFilter) nextQuery.quick_date = quickDateFilter;
    if (publishedStartDate) nextQuery.published_at_start = formatDate(publishedStartDate);
    if (publishedEndDate) nextQuery.published_at_end = formatDate(publishedEndDate);
    if (createdStartDate) nextQuery.created_at_start = formatDate(createdStartDate);
    if (createdEndDate) nextQuery.created_at_end = formatDate(createdEndDate);
    if (sortBy !== 'published_at_desc') nextQuery.sort_by = sortBy;
    if (page > 1) nextQuery.page = String(page);
    if (pageSize !== 10) nextQuery.size = String(pageSize);
    return nextQuery;
  }, [
    selectedCategory,
    searchTerm,
    sourceDomain,
    author,
    visibilityFilter,
    quickDateFilter,
    publishedStartDate,
    publishedEndDate,
    createdStartDate,
    createdEndDate,
    sortBy,
    page,
    pageSize,
  ]);

  const selectedCategoryMeta = useMemo(
    () => categories.find((category) => category.id === selectedCategory) || null,
    [categories, selectedCategory],
  );

  const listSeo = useMemo(
    () =>
      getListPageSeo(currentListQuery, {
        siteName: basicSettings.site_name || 'Lumina',
        siteDescription: basicSettings.site_description || t('信息灯塔'),
        categoryName: selectedCategoryMeta?.name || null,
        authorName: author || null,
      }),
    [
      currentListQuery,
      basicSettings.site_name,
      basicSettings.site_description,
      selectedCategoryMeta?.name,
      author,
      t,
    ],
  );
  const pageHeading = useMemo(() => {
    if (selectedCategoryMeta?.name) return `${selectedCategoryMeta.name} ${t('全部文章')}`;
    if (author) return `${author} ${t('作者')}`;
    return t('全部文章');
  }, [selectedCategoryMeta?.name, author, t]);
  const listCanonicalUrl = useMemo(
    () => buildCanonicalUrl(siteOrigin, '/list', listSeo.canonicalQuery),
    [siteOrigin, listSeo.canonicalQuery],
  );
  const seoImageUrl = useMemo(
    () => resolveSeoAssetUrl(siteOrigin, basicSettings.site_logo_url || '/logo.png'),
    [siteOrigin, basicSettings.site_logo_url],
  );
  const listStructuredData = listSeo.indexable ? [
    {
      '@context': 'https://schema.org',
      '@type': 'CollectionPage',
      name: listSeo.title,
      description: listSeo.description,
      url: listCanonicalUrl,
    },
    {
      '@context': 'https://schema.org',
      '@type': 'ItemList',
      itemListElement: articles.slice(0, 20).map((article, index) => ({
        '@type': 'ListItem',
        position: index + 1,
        url: buildCanonicalUrl(siteOrigin, `/article/${article.slug}`),
        name: article.title_trans?.trim() || article.title,
      })),
    },
  ] : [];
  const buildCategoryHref = (categoryId?: string) =>
    buildPathWithQuery('/list', {
      ...currentListQuery,
      category_id: categoryId || undefined,
      page: undefined,
    });
  const buildPaginationHref = (targetPage: number) =>
    buildPathWithQuery('/list', {
      ...currentListQuery,
      page: targetPage > 1 ? String(targetPage) : undefined,
    });

  const buildArticleHref = (slug: string) => {
    const from = `${currentListPath}#article-${slug}`;
    return buildNavigableArticleHref(slug, {
      from,
    });
  };

  const fetchArticles = useCallback(async () => {
    const requestId = articleRequestIdRef.current + 1;
    articleRequestIdRef.current = requestId;
    const appendMode = isAppending;
    if (appendMode) {
      setLoadingMore(true);
    } else {
      setLoading(true);
    }
    try {
      const visibilityValue =
        visibilityFilter === 'visible' ? true : visibilityFilter === 'hidden' ? false : undefined;
      const response = await articleApi.getArticles({
        page,
        size: pageSize,
        category_id: selectedCategory || undefined,
        search: searchTerm || undefined,
        source_domain: sourceDomain || undefined,
        author: author || undefined,
        topic: topicKey || undefined,
        is_visible: isAdmin ? visibilityValue : undefined,
        published_at_start: formatDate(publishedStartDate) || undefined,
        published_at_end: formatDate(publishedEndDate) || undefined,
        created_at_start: formatDate(createdStartDate) || undefined,
        created_at_end: formatDate(createdEndDate) || undefined,
        sort_by: sortBy,
      });
      if (requestId !== articleRequestIdRef.current) {
        return;
      }
      setTotal(response.pagination.total);
      setArticles((prev) => {
        const next = appendMode ? [...prev, ...response.data] : response.data;
        setHasMore(next.length < response.pagination.total);
        return next;
      });
    } catch (error) {
      if (requestId !== articleRequestIdRef.current) {
        return;
      }
      console.error('Failed to fetch articles:', error);
    } finally {
      // 过期请求不重置 loading，交给持有最新 requestId 的那次请求收尾。
      if (requestId !== articleRequestIdRef.current) {
        // biome-ignore lint/correctness/noUnsafeFinally: 有意用 return 跳过过期请求的状态复位
        return;
      }
      setLoading(false);
      setLoadingMore(false);
      setIsAppending(false);
    }
  }, [
    author,
    topicKey,
    createdEndDate,
    createdStartDate,
    isAdmin,
    isAppending,
    page,
    pageSize,
    publishedEndDate,
    publishedStartDate,
    searchTerm,
    selectedCategory,
    sortBy,
    sourceDomain,
    visibilityFilter,
  ]);

  const fetchCategories = async () => {
    try {
      const data = await categoryApi.getCategories();
      setCategories(data);
    } catch (error) {
      console.error('Failed to fetch categories:', error);
    }
  };

  const fetchCategoryStats = useCallback(async () => {
    const requestId = categoryStatsRequestIdRef.current + 1;
    categoryStatsRequestIdRef.current = requestId;
    try {
      const data = await categoryApi.getCategoryStats({
        search: searchTerm || undefined,
        source_domain: sourceDomain || undefined,
        author: author || undefined,
        topic: topicKey || undefined,
        published_at_start: formatDate(publishedStartDate) || undefined,
        published_at_end: formatDate(publishedEndDate) || undefined,
        created_at_start: formatDate(createdStartDate) || undefined,
        created_at_end: formatDate(createdEndDate) || undefined,
      });
      if (requestId !== categoryStatsRequestIdRef.current) {
        return;
      }
      setCategoryStats(data);
    } catch (error) {
      if (requestId !== categoryStatsRequestIdRef.current) {
        return;
      }
      console.error('Failed to fetch category stats:', error);
    }
  }, [
    author,
    topicKey,
    createdEndDate,
    createdStartDate,
    publishedEndDate,
    publishedStartDate,
    searchTerm,
    sourceDomain,
  ]);

  const fetchAuthors = async () => {
    if (authorsLoadingRef.current) return;
    authorsLoadingRef.current = true;
    try {
      const data = await articleApi.getAuthors();
      setAuthors(data);
    } catch (error) {
      console.error('Failed to fetch authors:', error);
    } finally {
      authorsLoadingRef.current = false;
    }
  };


  const fetchTopics = async () => {
    try {
      const data = await topicApi.list({ page: 1, size: 100 });
      setTopics(Array.isArray(data?.data) ? data.data : []);
    } catch (error) {
      console.error('Failed to fetch topics:', error);
      setTopics([]);
    }
  };
  const fetchSources = async () => {
    if (sourcesLoadingRef.current) return;
    sourcesLoadingRef.current = true;
    try {
      const data = await articleApi.getSources();
      setSources(data);
    } catch (error) {
      console.error('Failed to fetch sources:', error);
    } finally {
      sourcesLoadingRef.current = false;
    }
  };


  useEffect(() => {
    if (!showCreateModal || !isAdmin) return;
    let cancelled = false;
    const fetchStorageSettings = async () => {
      try {
        const settings = await storageSettingsApi.getSettings();
        if (!cancelled) {
          setCreateMediaStorageEnabled(Boolean(settings.media_storage_enabled));
        }
      } catch (error) {
        console.error('Failed to fetch storage settings:', error);
      }
    };
    fetchStorageSettings();
    return () => {
      cancelled = true;
    };
  }, [showCreateModal, isAdmin]);

  useEffect(() => {
    if (shouldHoldListView) {
      setListContentReady(false);
      return;
    }
    if (typeof window === 'undefined') {
      setListContentReady(true);
      return;
    }
    const frameId = window.requestAnimationFrame(() => {
      setListContentReady(true);
    });
    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [shouldHoldListView, articles.length, total, page, pageSize]);

  useEffect(() => {
    if (!initialized || authLoading) return;
    if (skipInitialFilterFetchRef.current) {
      skipInitialFilterFetchRef.current = false;
      return;
    }
    suppressNextPageFetchRef.current = true;
    setHasMore(true);
    setIsAppending(false);
    const debounceMs = searchTerm ? TITLE_SEARCH_FETCH_DEBOUNCE_MS : FILTER_FETCH_DEBOUNCE_MS;
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    debounceRef.current = setTimeout(() => {
      suppressNextPageFetchRef.current = false;
      fetchArticles();
      fetchCategoryStats();
    }, debounceMs);
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [
    initialized,
    authLoading,
    selectedCategory,
    searchTerm,
    sourceDomain,
    author,
    visibilityFilter,
    publishedStartDate,
    publishedEndDate,
    createdStartDate,
    createdEndDate,
    sortBy,
    fetchArticles,
    fetchCategoryStats,
  ]);

  useEffect(() => {
    setSelectedArticleSlugs(new Set());
  }, [
    selectedCategory,
    searchTerm,
    sourceDomain,
    author,
    visibilityFilter,
    publishedStartDate,
    publishedEndDate,
    createdStartDate,
    createdEndDate,
    sortBy,
  ]);

  useEffect(() => {
    if (createPendingMedia.length === 0) return;
    setCreatePendingMedia((prev) =>
      prev.filter((item) => createContent.includes(item.token)),
    );
  }, [createContent, createPendingMedia.length]);

  useEffect(() => {
    if (!initialized || authLoading) return;
    if (skipInitialPageFetchRef.current) {
      skipInitialPageFetchRef.current = false;
      return;
    }
    if (suppressNextPageFetchRef.current) {
      suppressNextPageFetchRef.current = false;
      return;
    }
    fetchArticles();
  }, [initialized, authLoading, page, pageSize, fetchArticles]);

  useEffect(() => {
    if (!initialized || authLoading) return;
    const hasResolvedBefore = authResolvedRef.current;
    const previousAdminState = lastAdminStateRef.current;
    authResolvedRef.current = true;
    lastAdminStateRef.current = isAdmin;

    if (!shouldRefreshListAfterAuthResolution({
      hasResolvedBefore,
      previousAdminState,
      isAdmin,
      initialDataLoaded,
      initialIsAdmin,
    })) {
      return;
    }

    fetchArticles();
    fetchCategoryStats();
  }, [initialized, authLoading, isAdmin, fetchArticles, fetchCategoryStats, initialDataLoaded, initialIsAdmin]);

  useEffect(() => {
    if (!router.isReady) return;
    if (initialized && hydratedQueryRef.current === routerQuerySignature) {
      return;
    }
    hydratedQueryRef.current = routerQuerySignature;

    const categoryParam = routerQueryState.category_id || '';
    const searchParam = routerQueryState.search || '';
    const sourceDomainParam = routerQueryState.source_domain || '';
    const authorParam = routerQueryState.author || '';
    const topicParam = routerQueryState.topic || '';
    const visibilityParam = routerQueryState.visibility || '';
    const quickDateRaw = routerQueryState.quick_date || '';
    const sortByRaw = routerQueryState.sort_by || '';
    const publishedStart = parseDateQuery(routerQueryState.published_at_start || '');
    const publishedEnd = parseDateQuery(routerQueryState.published_at_end || '');
    const createdStart = parseDateQuery(routerQueryState.created_at_start || '');
    const createdEnd = parseDateQuery(routerQueryState.created_at_end || '');

    const quickDateParam = parseQuickDateOption(quickDateRaw);
    const sortByParam = sortByRaw === 'published_at_desc' ||
      sortByRaw === 'created_at_desc' ||
      sortByRaw === 'note_recommendation_level_desc'
      ? sortByRaw
      : 'published_at_desc';

    const pageParam = Number(routerQueryState.page || '');
    const sizeParam = Number(routerQueryState.size || '');

    setSelectedCategory(categoryParam);
    setSearchTerm(searchParam);
    setSourceDomain(sourceDomainParam);
    setAuthor(authorParam);
    setTopicKey(topicParam);
    setVisibilityFilter(
      visibilityParam === 'visible' || visibilityParam === 'hidden'
        ? visibilityParam
        : '',
    );
    setQuickDateFilter(quickDateParam);
    setSortBy(sortByParam);
    setPublishedDateRange([publishedStart, publishedEnd]);

    if (createdStart || createdEnd) {
      setCreatedDateRange([createdStart, createdEnd]);
    } else if (quickDateParam) {
      setCreatedDateRange(getDateRangeFromQuickOption(quickDateParam));
    } else {
      setCreatedDateRange([null, null]);
    }

    setPage(Number.isFinite(pageParam) && pageParam > 0 ? Math.floor(pageParam) : 1);
    setPageSize(
      Number.isFinite(sizeParam) && [10, 20, 50, 100].includes(sizeParam)
        ? sizeParam
        : 10,
    );

    setShowFilters(
      Boolean(
        searchParam ||
        sourceDomainParam ||
        authorParam ||
        visibilityParam ||
        publishedStart ||
        publishedEnd ||
        createdStart ||
        createdEnd,
      ),
    );

    if (!initialized) {
      setInitialized(true);
    }
  }, [initialized, router.isReady, routerQuerySignature, routerQueryState]);

  useEffect(() => {
    if (!router.isReady || !initialized) return;

    const nextQuery: Record<string, string> = {};
    if (selectedCategory) nextQuery.category_id = selectedCategory;
    if (searchTerm) nextQuery.search = searchTerm;
    if (sourceDomain) nextQuery.source_domain = sourceDomain;
    if (author) nextQuery.author = author;
    if (topicKey) nextQuery.topic = topicKey;
    if (visibilityFilter) nextQuery.visibility = visibilityFilter;
    if (quickDateFilter) nextQuery.quick_date = quickDateFilter;
    if (publishedStartDate) nextQuery.published_at_start = formatDate(publishedStartDate);
    if (publishedEndDate) nextQuery.published_at_end = formatDate(publishedEndDate);
    if (createdStartDate) nextQuery.created_at_start = formatDate(createdStartDate);
    if (createdEndDate) nextQuery.created_at_end = formatDate(createdEndDate);
    if (sortBy !== 'published_at_desc') nextQuery.sort_by = sortBy;
    if (page > 1) nextQuery.page = String(page);
    if (pageSize !== 10) nextQuery.size = String(pageSize);

    const nextQuerySignature = serializeQuery(nextQuery);

    if (nextQuerySignature === routerQuerySignature) {
      syncedQueryRef.current = nextQuerySignature;
      return;
    }

    if (syncedQueryRef.current === nextQuerySignature) {
      return;
    }
    syncedQueryRef.current = nextQuerySignature;

    router.replace(
      {
        pathname: router.pathname,
        query: nextQuery,
      },
      undefined,
      { shallow: true, scroll: false },
    );
  }, [
    router,
    router.isReady,
    router.pathname,
    initialized,
    routerQuerySignature,
    selectedCategory,
    searchTerm,
    sourceDomain,
    author,
    visibilityFilter,
    quickDateFilter,
    publishedStartDate,
    publishedEndDate,
    createdStartDate,
    createdEndDate,
    sortBy,
    page,
    pageSize,
  ]);

  useEffect(() => {
    fetchCategories();
  }, []);

  useEffect(() => {
    if (!showFilters && !showMobileFilters) return;
    if (authors.length === 0) {
      fetchAuthors();
      fetchTopics();
    }
    if (sources.length === 0) {
      fetchSources();
      fetchTopics();
    }
  }, [showFilters, showMobileFilters, authors.length, sources.length]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const media = window.matchMedia('(max-width: 1023px)');
    const handleChange = (event?: MediaQueryListEvent) => {
      const matches = event ? event.matches : media.matches;
      setIsMobile(matches);
      if (!matches) {
        setShowMobileFilters(false);
      }
    };
    handleChange();
    media.addEventListener('change', handleChange);
    return () => media.removeEventListener('change', handleChange);
  }, []);

  useEffect(() => {
    if (!isMobile) return;
    if (!listContentReady) return;
    const node = loadMoreRef.current;
    if (!node) return;
    if (!hasMore || loadingMore || listLoading || isAppending) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting) return;
        if (loadingMore || listLoading || isAppending) return;
        setIsAppending(true);
        setPage((prev) => prev + 1);
      },
      { rootMargin: '200px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [isMobile, listContentReady, hasMore, loadingMore, listLoading, isAppending, articles.length]);

  useEffect(() => {
    if (typeof window === 'undefined' || articles.length === 0) return;
    const hash = window.location.hash || '';
    if (!hash.startsWith('#article-')) return;
    const target = document.getElementById(hash.slice(1));
    if (!target) return;
    const timer = window.setTimeout(() => {
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 120);
    return () => window.clearTimeout(timer);
  }, [articles]);

  const handleQuickDateChange = (option: QuickDateOption) => {
    setQuickDateFilter(option);
    const [start, end] = getDateRangeFromQuickOption(option);
    setCreatedDateRange([start, end]);
    setPage(1);
  };

  const handleClearFilters = () => {
    setSearchTerm('');
    setSourceDomain('');
    setAuthor('');
    setPublishedDateRange([null, null]);
    setCreatedDateRange([null, null]);
    setQuickDateFilter('');
    setSelectedCategory('');
    setVisibilityFilter('');
    setPage(1);
  };

  const handleBatchVisibility = async (isVisible: boolean) => {
    if (selectedArticleSlugs.size === 0 || batchActionPending) return;
    setBatchAction('visibility');
    try {
      await articleApi.batchUpdateVisibility(Array.from(selectedArticleSlugs), isVisible);
      showToast(isVisible ? t('已批量设为可见') : t('已批量设为隐藏'));
      setSelectedArticleSlugs(new Set());
      fetchArticles();
      fetchCategoryStats();
    } catch (error) {
      console.error('Failed to batch update visibility:', error);
      showToast(t('操作失败'), 'error');
    } finally {
      setBatchAction('none');
    }
  };

  const handleBatchCategory = async () => {
    if (selectedArticleSlugs.size === 0 || batchActionPending) return;
    if (!batchCategoryId) {
      showToast(t('请选择分类'), 'info');
      return;
    }
    const targetCategoryId = batchCategoryId === '__clear__' ? null : batchCategoryId;
    setBatchAction('category');
    try {
      await articleApi.batchUpdateCategory(Array.from(selectedArticleSlugs), targetCategoryId);
      showToast(t('分类已更新'));
      setBatchCategoryId('');
      setSelectedArticleSlugs(new Set());
      fetchArticles();
      fetchCategoryStats();
    } catch (error) {
      console.error('Failed to batch update category:', error);
      showToast(t('操作失败'), 'error');
    } finally {
      setBatchAction('none');
    }
  };

  const handleBatchDelete = () => {
    if (selectedArticleSlugs.size === 0) return;
    const slugs = Array.from(selectedArticleSlugs);
    setConfirmState({
      isOpen: true,
      title: t('批量删除文章'),
      message: t('确定要删除选中的文章吗？此操作不可撤销。'),
      confirmText: t('删除'),
      cancelText: t('取消'),
      onConfirm: async () => {
        setBatchAction('delete');
        try {
          await articleApi.batchDeleteArticles(slugs);
          showToast(t('删除成功'));
          setSelectedArticleSlugs(new Set());
          fetchArticles();
          fetchCategoryStats();
        } catch (error) {
          console.error('Failed to batch delete articles:', error);
          showToast(t('删除失败'), 'error');
        } finally {
          setBatchAction('none');
        }
      },
    });
  };

  const advancedFiltersBody = (
    <AdvancedFilters
      isAdmin={isAdmin}
      isMobile={isMobile}
      searchTerm={searchTerm}
      setSearchTerm={setSearchTerm}
      sourceDomain={sourceDomain}
      setSourceDomain={setSourceDomain}
      sources={sources}
      author={author}
      setAuthor={setAuthor}
      authors={authors}
      topicKey={topicKey}
      setTopicKey={setTopicKey}
      topics={topics}
      visibilityFilter={visibilityFilter}
      setVisibilityFilter={setVisibilityFilter}
      sortBy={sortBy}
      setSortBy={setSortBy}
      quickDateFilter={quickDateFilter}
      setQuickDateFilter={setQuickDateFilter}
      handleQuickDateChange={handleQuickDateChange}
      publishedDateRange={publishedDateRange}
      setPublishedDateRange={setPublishedDateRange}
      createdDateRange={createdDateRange}
      setCreatedDateRange={setCreatedDateRange}
      setPage={setPage}
    />
  );

  const filterSummary = (
    <FilterSummary
      categories={categories}
      selectedCategory={selectedCategory}
      searchTerm={searchTerm}
      sourceDomain={sourceDomain}
      author={author}
      isAdmin={isAdmin}
      visibilityFilter={visibilityFilter}
      publishedStartDate={publishedStartDate}
      publishedEndDate={publishedEndDate}
      createdStartDate={createdStartDate}
      createdEndDate={createdEndDate}
      sortBy={sortBy}
      handleClearFilters={handleClearFilters}
    />
  );


  const handleDelete = (slug: string) => {
    setConfirmState({
      isOpen: true,
      title: t('删除文章'),
      message: t('确定要删除这篇文章吗？此操作不可撤销。'),
      confirmText: t('删除'),
      cancelText: t('取消'),
      onConfirm: async () => {
        try {
          await articleApi.deleteArticle(slug);
          showToast(t('删除成功'));
          fetchArticles();
        } catch (error) {
          console.error('Failed to delete article:', error);
          showToast(t('删除失败'), 'error');
        }
      },
    });
  };

  const handleToggleVisibility = async (slug: string, currentVisibility: boolean) => {
    try {
      await articleApi.updateArticleVisibility(slug, !currentVisibility);
      setArticles((prev) =>
        prev.map((a) => (a.slug === slug ? { ...a, is_visible: !currentVisibility } : a))
      );
      showToast(currentVisibility ? t('已设为不可见') : t('已设为可见'));
    } catch (error) {
      console.error('Failed to toggle visibility:', error);
      showToast(t('操作失败'), 'error');
    }
  };

  const handleToggleSelect = (slug: string) => {
    setSelectedArticleSlugs((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) {
        next.delete(slug);
      } else {
        next.add(slug);
      }
      return next;
    });
  };

  const handleOpenArticle = (
    event: React.MouseEvent<HTMLElement>,
    article: Article,
  ) => {
    if (!showAdminDesktop) {
      return;
    }
    const target = event.target as HTMLElement | null;
    if (
      target?.closest(
        "button, a, input, textarea, select, option, label, svg",
      )
    ) {
      return;
    }
    handleToggleSelect(article.slug);
  };

  const handleArticleCardKeyDown = (
    event: React.KeyboardEvent<HTMLElement>,
    article: Article,
  ) => {
    if (!showAdminDesktop) {
      return;
    }
    if (event.key !== 'Enter' && event.key !== ' ') {
      return;
    }
    const target = event.target as HTMLElement | null;
    if (
      target?.closest(
        "button, a, input, textarea, select, option, label, svg",
      )
    ) {
      return;
    }
    event.preventDefault();
    handleToggleSelect(article.slug);
  };

  const handleSelectAll = () => {
    if (selectedArticleSlugs.size === articles.length) {
      setSelectedArticleSlugs(new Set());
    } else {
      setSelectedArticleSlugs(new Set(articles.map((a) => a.slug)));
    }
  };

  const handleExport = async () => {
    if (batchActionPending) return;

    if (!isAdmin) {
      showToast(t('仅管理员可导出文章'), 'info');
      return;
    }

    if (selectedArticleSlugs.size === 0) {
      showToast(t('请先选择要导出的文章'), 'info');
      return;
    }

    setBatchAction('export');
    try {
      const data = await articleApi.exportArticles(Array.from(selectedArticleSlugs));
      const blob = new Blob([data.content], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      
      const now = new Date();
      const timestamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
      
      const selectedArticles = articles.filter(a => selectedArticleSlugs.has(a.slug));
      const categoryCount: Record<string, number> = {};
      selectedArticles.forEach(article => {
        const catName = article.category?.name || t('未分类');
        categoryCount[catName] = (categoryCount[catName] || 0) + 1;
      });
      
      const categoryInfo = Object.entries(categoryCount)
        .map(([name, count]) => `${name}${count}${t('篇')}`)
        .join('_');
      
      a.download = `${timestamp}_${categoryInfo}.md`;
      
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setSelectedArticleSlugs(new Set());
      showToast(t('导出成功'));
    } catch (error) {
      console.error('Failed to export articles:', error);
      showToast(t('导出失败'), 'error');
    } finally {
      setBatchAction('none');
    }
  };

  const handleJumpToPage = () => {
    const pageNum = parseInt(jumpToPage);
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    if (pageNum >= 1 && pageNum <= totalPages) {
      suppressNextPageFetchRef.current = false;
      setPage(pageNum);
      setJumpToPage('');
    } else {
      showToast(
        t("请输入1-{totalPages}之间的页码").replace(
          "{totalPages}",
          totalPages.toString(),
        ),
        "error",
      );
    }
  };

  const resetCreateForm = () => {
    setShowCreateModal(false);
    setCreateTitle('');
    setCreateAuthor('');
    setCreatePublishedAt(formatDate(new Date()));
    setCreateCategoryId('');
    setCreateTopImage('');
    setCreateContent('');
    setCreateSourceUrl('');
    setCreatePendingMedia([]);
  };

  const handleCreatePaste = (
    event: React.ClipboardEvent<HTMLTextAreaElement>,
  ) => {
    const clipboard = event.clipboardData;
    if (!clipboard) return;
    const target = event.currentTarget;
    const pushPendingMedia = (item: CreatePendingMedia) => {
      const token = buildCreateMediaToken();
      setCreatePendingMedia((prev) => [...prev, { ...item, token }]);
      if (item.mediaKind === 'book') {
        insertTextAtCursor(target, `[📚 ${t('书籍')}](${token})`, setCreateContent);
        return;
      }
      insertTextAtCursor(target, `![](${token})`, setCreateContent);
    };

    const files = Array.from(clipboard.files || []);
    const imageFile = files.find((file) => file.type.startsWith('image/'));
    if (imageFile) {
      event.preventDefault();
      if (!createMediaStorageEnabled) {
        showToast(t('未开启本地图片存储，无法上传图片'), 'info');
        return;
      }
      pushPendingMedia({ token: '', kind: 'file', file: imageFile, mediaKind: 'image' });
      showToast(t('图片将在创建后转存'));
      return;
    }

    const mediaLink =
      extractMediaLinkFromHtml(clipboard.getData('text/html')) ||
      extractMediaLinkFromText(clipboard.getData('text/plain'));
    if (!mediaLink) return;
    event.preventDefault();
    if (mediaLink.kind === 'video' || mediaLink.kind === 'audio') {
      insertTextAtCursor(
        target,
        buildMarkdownFromMediaLink(mediaLink, t),
        setCreateContent,
      );
      return;
    }
    if (!createMediaStorageEnabled) {
      insertTextAtCursor(
        target,
        buildMarkdownFromMediaLink(mediaLink, t),
        setCreateContent,
      );
      return;
    }
    pushPendingMedia({
      token: '',
      kind: 'url',
      url: mediaLink.url,
      mediaKind: mediaLink.kind === 'book' ? 'book' : 'image',
    });
    showToast(mediaLink.kind === 'book' ? t('书籍将在创建后转存') : t('图片将在创建后转存'));
  };

  const handleCreateArticle = async () => {
    if (!createTitle.trim()) {
      showToast(t('请输入标题'), 'error');
      return;
    }
    if (!createContent.trim()) {
      showToast(t('请输入内容'), 'error');
      return;
    }

    setCreateSaving(true);
    try {
      const originalContent = createContent.trim();
      const pendingMedia = createPendingMedia.filter((item) =>
        originalContent.includes(item.token),
      );
      const response = await articleApi.createArticle({
        title: createTitle.trim(),
        content_md: originalContent,
        source_url: createSourceUrl.trim() || undefined,
        author: createAuthor.trim() || undefined,
        published_at: createPublishedAt || new Date().toISOString(),
        top_image: createTopImage.trim() || undefined,
        category_id: createCategoryId || undefined,
        skip_ai_processing: true,
      });

      const createdArticleId = response?.id ? String(response.id) : '';
      const createdArticleSlug = response?.slug ? String(response.slug) : '';

      let transferSuccessCount = 0;
      let transferFailedCount = 0;
      if (createdArticleId && createdArticleSlug) {
        const patchResult = await resolveCreateArticlePatch({
          originalContent,
          pendingMedia,
          topImage: createTopImage.trim(),
          articleId: createdArticleId,
          mediaStorageEnabled: createMediaStorageEnabled,
          ingestUrl: (articleId, url, mediaKind) =>
            mediaApi.ingest(articleId, url, mediaKind),
          uploadFile: (articleId, file) => mediaApi.upload(articleId, file),
        });

        transferSuccessCount = patchResult.transferSuccessCount;
        transferFailedCount = patchResult.transferFailedCount;

        const shouldPatch =
          patchResult.patch.content_md !== originalContent ||
          (patchResult.patch.top_image || '') !== (createTopImage.trim() || '');

        if (shouldPatch) {
          await articleApi.updateArticle(createdArticleSlug, {
            content_md: patchResult.patch.content_md,
            top_image: patchResult.patch.top_image,
          });
        }
      }

      if (transferFailedCount > 0) {
        showToast(t('创建成功，部分媒体转存失败'), 'error');
      } else if (transferSuccessCount > 0) {
        showToast(t('创建成功，媒体已转存'));
      } else {
        showToast(t('创建成功'));
      }

      resetCreateForm();
      fetchArticles();

      if (createdArticleSlug) {
        const from = `${currentListPath}#article-${createdArticleSlug}`;
        router.push(buildNavigableArticleHref(createdArticleSlug, { from, preserveFrom: true }));
      }
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : String(error);
      showToast(t('创建失败') + ': ' + errMsg, 'error');
    } finally {
      setCreateSaving(false);
    }
  };


  const batchActions = (
    <BatchActionBar
      selectedCount={selectedArticleSlugs.size}
      batchAction={batchAction}
      isAdmin={isAdmin}
      categories={categories}
      batchCategoryId={batchCategoryId}
      setBatchCategoryId={setBatchCategoryId}
      handleExport={handleExport}
      handleBatchVisibility={handleBatchVisibility}
      handleBatchCategory={handleBatchCategory}
      handleBatchDelete={handleBatchDelete}
    />
  );
  const skeletonCount = isMobile ? 4 : 6;
  const listSkeleton = <FeedListSkeleton count={skeletonCount} showAdminDesktop={showAdminDesktop} />;

  return (
    <div className="min-h-screen bg-app flex flex-col">
      <SeoHead
        title={listSeo.title}
        description={listSeo.description}
        canonicalUrl={listCanonicalUrl}
        robots={listSeo.robots}
        imageUrl={seoImageUrl}
        siteName={basicSettings.site_name || 'Lumina'}
        structuredData={listStructuredData}
      />
      <AppHeader />

      <div className="lg:hidden border-b border-border bg-surface panel-subtle">
        <div className="max-w-7xl mx-auto px-4 py-3">
          <div className="flex items-center gap-2 overflow-x-auto">
            <Link
              href={buildCategoryHref(undefined)}
              aria-current={selectedCategory === '' ? 'page' : undefined}
              className={`whitespace-nowrap px-3 py-1.5 text-sm rounded-full transition ${
                selectedCategory === '' ? 'bg-primary-soft text-primary-ink' : 'bg-muted text-text-2'
              }`}
            >
              {t('全部文章')} ({categoryStats.reduce((sum, c) => sum + c.article_count, 0)})
            </Link>
            {categoryStats.map((category) => (
              <Link
                href={buildCategoryHref(category.id)}
                key={category.id}
                aria-current={selectedCategory === category.id ? 'page' : undefined}
                className={`whitespace-nowrap px-3 py-1.5 text-sm rounded-full transition ${
                  selectedCategory === category.id ? 'bg-primary-soft text-primary-ink' : 'bg-muted text-text-2'
                }`}
              >
                {category.name} ({category.article_count})
              </Link>
            ))}
          </div>
          <div className="pt-3">
            {filterSummary}
          </div>
          {showAdminDesktop && selectedArticleSlugs.size > 0 && (
            <div className="pt-3">
              {batchActions}
            </div>
          )}
        </div>
      </div>

      <div className="flex-1">
        <div className="max-w-7xl mx-auto px-4 py-6 sm:py-8">
          <div className="flex flex-col lg:flex-row gap-6">
          <CategorySidebar
            categoryStats={categoryStats}
            selectedCategory={selectedCategory}
            buildCategoryHref={buildCategoryHref}
            sidebarCollapsed={sidebarCollapsed}
            setSidebarCollapsed={setSidebarCollapsed}
          />

          <main className="flex-1" aria-busy={!listContentReady}>
            <div className="sr-only">
              <h1 className="text-2xl font-semibold text-text-1">{pageHeading}</h1>
              <p className="mt-2 text-sm text-text-2">{listSeo.description}</p>
            </div>
            <FilterToolbar
              isMobile={isMobile}
              showFilters={showFilters}
              setShowFilters={setShowFilters}
              isAdmin={isAdmin}
              setShowCreateModal={setShowCreateModal}
              quickDateFilter={quickDateFilter}
              handleQuickDateChange={handleQuickDateChange}
              visibilityFilter={visibilityFilter}
              setVisibilityFilter={setVisibilityFilter}
              sortBy={sortBy}
              setSortBy={setSortBy}
              setPage={setPage}
              showAdminDesktop={showAdminDesktop}
              selectedArticleSlugs={selectedArticleSlugs}
              advancedFiltersBody={advancedFiltersBody}
              filterSummary={filterSummary}
              batchActions={batchActions}
            />

            {!listContentReady ? (
              listSkeleton
            ) : articles.length === 0 ? (
              <div className="panel-subtle rounded-sm border border-border text-center py-12 text-text-3">{t('暂无文章')}</div>
             ) : (
                <> 
                  {showAdminDesktop && (
                    <SelectAllBar
                      selectedCount={selectedArticleSlugs.size}
                      totalCount={articles.length}
                      onSelectAll={handleSelectAll}
                    />
                  )}
                  <div className="space-y-4">
                    {articles.map((article) => (
                      <ArticleCard
                        key={article.slug}
                        article={article}
                        articleHref={buildArticleHref(article.slug)}
                        selected={showAdminDesktop && selectedArticleSlugs.has(article.slug)}
                        showAdminDesktop={showAdminDesktop}
                        isAdmin={isAdmin}
                        isMobile={isMobile}
                        siteLogoUrl={basicSettings.site_logo_url}
                        onOpenArticle={handleOpenArticle}
                        onCardKeyDown={handleArticleCardKeyDown}
                        onToggleSelect={handleToggleSelect}
                        onToggleVisibility={handleToggleVisibility}
                        onDelete={handleDelete}
                      />
                    ))}
                  </div>

                <PaginationBar
                  isMobile={isMobile}
                  page={page}
                  totalPages={totalPages}
                  total={total}
                  pageSize={pageSize}
                  jumpToPage={jumpToPage}
                  setJumpToPage={setJumpToPage}
                  setPage={setPage}
                  setPageSize={setPageSize}
                  suppressNextPageFetchRef={suppressNextPageFetchRef}
                  buildPaginationHref={buildPaginationHref}
                  handleJumpToPage={handleJumpToPage}
                  loadingMore={loadingMore}
                  hasMore={hasMore}
                  loadMoreRef={loadMoreRef}
                />
              </>
            )}
          </main>
        </div>
      </div>
      </div>
      <ConfirmModal
        isOpen={confirmState.isOpen}
        title={confirmState.title}
        message={confirmState.message}
        confirmText={confirmState.confirmText}
        cancelText={confirmState.cancelText}
        onConfirm={async () => {
          const action = confirmState.onConfirm;
          await action();
          setConfirmState((prev) => ({ ...prev, isOpen: false }));
        }}
        onCancel={() => setConfirmState((prev) => ({ ...prev, isOpen: false }))}
      />
      <MobileFilterDrawer
        isMobile={isMobile}
        showMobileFilters={showMobileFilters}
        setShowFilters={setShowFilters}
        setShowMobileFilters={setShowMobileFilters}
        advancedFiltersBody={advancedFiltersBody}
      />
      <ArticleSplitEditorModal
        isOpen={showCreateModal}
        title={t('创建文章')}
        closeAriaLabel={t('关闭创建文章弹窗')}
        onClose={() => setShowCreateModal(false)}
        onSave={handleCreateArticle}
        topFields={
          <CreateArticleFormFields
            createTitle={createTitle}
            setCreateTitle={setCreateTitle}
            createAuthor={createAuthor}
            setCreateAuthor={setCreateAuthor}
            createPublishedAt={createPublishedAt}
            setCreatePublishedAt={setCreatePublishedAt}
            createCategoryId={createCategoryId}
            setCreateCategoryId={setCreateCategoryId}
            createSourceUrl={createSourceUrl}
            setCreateSourceUrl={setCreateSourceUrl}
            createTopImage={createTopImage}
            setCreateTopImage={setCreateTopImage}
            categories={categories}
          />
        }
        contentValue={createContent}
        onContentChange={setCreateContent}
        onContentPaste={handleCreatePaste}
        saveText={t('创建')}
        savingText={t('保存中...')}
        isSaving={createSaving}
        previewImageUrl={resolveMediaUrl(createTopImage || basicSettings.site_logo_url || '/logo.png') || ''}
        previewImageAlt={createTitle}
        previewHtml={normalizeMediaHtml(renderSafeMarkdown(createContent || '', { enableMediaEmbed: true }))}
        closeOnBackdrop
      />

      <AppFooter />
      <BackToTop />
    </div>
  );
}
