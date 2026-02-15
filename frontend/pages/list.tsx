import { useState, useEffect, useMemo, useRef } from 'react';

import Head from 'next/head';
import { useRouter } from 'next/router';
import Link from 'next/link';
import dayjs, { type Dayjs } from 'dayjs';

import { articleApi, categoryApi, Article, Category, resolveMediaUrl } from '@/lib/api';
import AppFooter from '@/components/AppFooter';
import AppHeader from '@/components/AppHeader';
import ArticleLanguageTag from '@/components/article/ArticleLanguageTag';
import ArticleMetaRow from '@/components/article/ArticleMetaRow';
import ArticleSplitEditorModal from '@/components/article/ArticleSplitEditorModal';
import FeedListSkeleton from '@/components/article/FeedListSkeleton';
import Button from '@/components/Button';
import DateRangePicker from '@/components/DateRangePicker';
import FilterInput from '@/components/FilterInput';
import FilterSelect from '@/components/FilterSelect';
import FilterSelectInline from '@/components/FilterSelectInline';
import ConfirmModal from '@/components/ConfirmModal';
import IconButton from '@/components/IconButton';
import CheckboxInput from '@/components/ui/CheckboxInput';
import FormField from '@/components/ui/FormField';
import SelectField from '@/components/ui/SelectField';
import TextInput from '@/components/ui/TextInput';
import { useToast } from '@/components/Toast';
import { BackToTop } from '@/components/BackToTop';
import { IconEye, IconEyeOff, IconSearch, IconTag, IconTrash, IconPlus } from '@/components/icons';
import { useAuth } from '@/contexts/AuthContext';
import { useBasicSettings } from '@/contexts/BasicSettingsContext';
import { useI18n } from '@/lib/i18n';
import { renderSafeMarkdown } from '@/lib/safeHtml';

const formatDate = (date: Date | null): string => {
  if (!date) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

// Quick date filter options
type QuickDateOption = '' | '1d' | '3d' | '1w' | '1m' | '3m' | '6m' | '1y';

const toDayjsRange = (range: [Date | null, Date | null]): [Dayjs | null, Dayjs | null] => [
  range[0] ? dayjs(range[0]) : null,
  range[1] ? dayjs(range[1]) : null,
];

type PastedMediaKind = 'image' | 'video' | 'audio';

interface PastedMediaLink {
  kind: PastedMediaKind;
  url: string;
}

const IMAGE_LINK_PATTERN = /\.(png|jpe?g|gif|webp|svg|bmp|avif)(\?.*)?$/i;
const VIDEO_LINK_PATTERN = /\.(mp4|webm|mov|m4v|ogv|ogg)(\?.*)?$/i;
const AUDIO_LINK_PATTERN = /\.(mp3|wav|m4a|aac|ogg|flac|opus)(\?.*)?$/i;
const VIDEO_HOST_PATTERN = /(youtube\.com|youtu\.be|bilibili\.com|vimeo\.com)/i;

const insertTextAtCursor = (
  target: HTMLTextAreaElement,
  text: string,
  onChange: (value: string) => void,
) => {
  const start = target.selectionStart ?? target.value.length;
  const end = target.selectionEnd ?? target.value.length;
  const nextValue = `${target.value.slice(0, start)}${text}${target.value.slice(end)}`;
  onChange(nextValue);
  requestAnimationFrame(() => {
    const cursor = start + text.length;
    target.setSelectionRange(cursor, cursor);
    target.focus();
  });
};

const cleanupPastedUrl = (url: string): string =>
  (url || '')
    .trim()
    .replace(/^<|>$/g, '')
    .replace(/[),.;:!?]+$/, '');

const detectMediaKindFromUrl = (url: string): PastedMediaKind | null => {
  const normalized = cleanupPastedUrl(url);
  if (!normalized || !/^https?:\/\//i.test(normalized)) return null;
  if (IMAGE_LINK_PATTERN.test(normalized)) return 'image';
  if (AUDIO_LINK_PATTERN.test(normalized)) return 'audio';
  if (VIDEO_LINK_PATTERN.test(normalized)) return 'video';
  if (VIDEO_HOST_PATTERN.test(normalized)) return 'video';
  return null;
};

const toPastedMediaLink = (url?: string | null): PastedMediaLink | null => {
  const normalized = cleanupPastedUrl(url || '');
  const kind = detectMediaKindFromUrl(normalized);
  if (!kind) return null;
  return { kind, url: normalized };
};

const extractMediaLinkFromHtml = (html: string): PastedMediaLink | null => {
  if (!html) return null;
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const candidates = [
      doc.querySelector('img')?.getAttribute('src'),
      doc.querySelector('video')?.getAttribute('src'),
      doc.querySelector('video source')?.getAttribute('src'),
      doc.querySelector('audio')?.getAttribute('src'),
      doc.querySelector('audio source')?.getAttribute('src'),
      doc.querySelector('iframe')?.getAttribute('src'),
      doc.querySelector('a')?.getAttribute('href'),
    ];
    for (const candidate of candidates) {
      const link = toPastedMediaLink(candidate);
      if (link) return link;
    }
    return null;
  } catch {
    return null;
  }
};

const extractMediaLinkFromText = (text: string): PastedMediaLink | null => {
  if (!text) return null;
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (/!\[[^\]]*\]\([^)]+\)/.test(trimmed)) return null;
  if (/\[[^\]]+\]\([^)]+\)/.test(trimmed)) return null;
  const urlMatch = trimmed.match(/https?:\/\/[^\s)]+/);
  if (!urlMatch?.[0]) return null;
  return toPastedMediaLink(urlMatch[0]);
};

const buildMarkdownFromMediaLink = (
  link: PastedMediaLink,
  t: (key: string) => string,
): string => {
  if (link.kind === 'image') {
    return `![](${link.url})`;
  }
  if (link.kind === 'video') {
    return `[▶ ${t('视频')}](${link.url})`;
  }
  return `[🎧 ${t('音频')}](${link.url})`;
};


const getDateRangeFromQuickOption = (option: QuickDateOption): [Date | null, Date | null] => {
  if (!option) return [null, null];
  
  const now = new Date();
  const startDate = new Date();
  
  switch (option) {
    case '1d':
      startDate.setDate(now.getDate() - 1);
      break;
    case '3d':
      startDate.setDate(now.getDate() - 3);
      break;
    case '1w':
      startDate.setDate(now.getDate() - 7);
      break;
    case '1m':
      startDate.setMonth(now.getMonth() - 1);
      break;
    case '3m':
      startDate.setMonth(now.getMonth() - 3);
      break;
    case '6m':
      startDate.setMonth(now.getMonth() - 6);
      break;
    case '1y':
      startDate.setFullYear(now.getFullYear() - 1);
      break;
  }
  
  return [startDate, now];
};

const quickDateOptions: QuickDateOption[] = ['', '1d', '3d', '1w', '1m', '3m', '6m', '1y'];

const getQueryValue = (value: string | string[] | undefined): string => {
  if (Array.isArray(value)) return value[0] || '';
  return value || '';
};

const parseDateQuery = (value: string): Date | null => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const serializeQuery = (query: Record<string, string>): string =>
  Object.entries(query)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('&');

const LIST_QUERY_KEYS = [
  'category_id',
  'search',
  'source_domain',
  'author',
  'visibility',
  'quick_date',
  'sort_by',
  'published_at_start',
  'published_at_end',
  'created_at_start',
  'created_at_end',
  'page',
  'size',
] as const;

const pickListQuery = (
  query: Record<string, string | string[] | undefined>,
): Record<string, string> => {
  const picked: Record<string, string> = {};
  LIST_QUERY_KEYS.forEach((key) => {
    const value = getQueryValue(query[key]);
    if (value) {
      picked[key] = value;
    }
  });
  return picked;
};

export default function Home() {
  const router = useRouter();
  const { showToast } = useToast();
  const { isAdmin, isLoading: authLoading } = useAuth();
  const { t } = useI18n();
  const { basicSettings } = useBasicSettings();
  const [articles, setArticles] = useState<Article[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryStats, setCategoryStats] = useState<{ id: string; name: string; color: string | null; article_count: number }[]>([]);
  const [authors, setAuthors] = useState<string[]>([]);
  const [sources, setSources] = useState<string[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [sourceDomain, setSourceDomain] = useState<string>('');
  const [author, setAuthor] = useState<string>('');
  const [publishedDateRange, setPublishedDateRange] = useState<[Date | null, Date | null]>([null, null]);
  const [createdDateRange, setCreatedDateRange] = useState<[Date | null, Date | null]>([null, null]);
  const [quickDateFilter, setQuickDateFilter] = useState<QuickDateOption>('');
  const [visibilityFilter, setVisibilityFilter] = useState<string>('');
  const [sortBy, setSortBy] = useState<string>('published_at_desc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [initialized, setInitialized] = useState(false);
  const [selectedArticleSlugs, setSelectedArticleSlugs] = useState<Set<string>>(new Set());
  const [showFilters, setShowFilters] = useState(false);
  const [showMobileFilters, setShowMobileFilters] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [jumpToPage, setJumpToPage] = useState('');
  const [batchCategoryId, setBatchCategoryId] = useState('');
  const [batchAction, setBatchAction] = useState<'none' | 'export' | 'visibility' | 'category' | 'delete'>('none');
  const [isMobile, setIsMobile] = useState(false);
  const [isAppending, setIsAppending] = useState(false);
  const [hasMore, setHasMore] = useState(true);
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
  const [createCategoryId, setCreateCategoryId] = useState('');
  const [createTopImage, setCreateTopImage] = useState('');
  const [createContent, setCreateContent] = useState('');
  const [createSourceUrl, setCreateSourceUrl] = useState('');
  const [createSaving, setCreateSaving] = useState(false);

  const [publishedStartDate, publishedEndDate] = publishedDateRange;
  const [createdStartDate, createdEndDate] = createdDateRange;
  const isBootstrapping = authLoading || !router.isReady || !initialized;
  const showAdminDesktop = isAdmin && !isMobile;
  const listLoading = loading || authLoading;
  const shouldHoldListView = isBootstrapping || listLoading;
  const [listContentReady, setListContentReady] = useState(false);
  const batchActionPending = batchAction !== 'none';
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const hydratedQueryRef = useRef('');
  const syncedQueryRef = useRef('');
  const suppressNextPageFetchRef = useRef(false);
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
  const defaultTopImageUrl = useMemo(
    () => resolveMediaUrl(basicSettings.site_logo_url || '/logo.png'),
    [basicSettings.site_logo_url],
  );

  const currentListPath = useMemo(() => {
    const asPath = router.asPath || '/list';
    return asPath.split('#')[0] || '/list';
  }, [router.asPath]);

  const buildArticleHref = (slug: string) => {
    const from = `${currentListPath}#article-${slug}`;
    return `/article/${slug}?from=${encodeURIComponent(from)}`;
  };
  const articleLinkTarget = isMobile ? undefined : '_blank';
  const articleLinkRel = isMobile ? undefined : 'noopener noreferrer';

  const fetchArticles = async () => {
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
      if (requestId !== articleRequestIdRef.current) {
        return;
      }
      setLoading(false);
      setLoadingMore(false);
      setIsAppending(false);
    }
  };

  const fetchCategories = async () => {
    try {
      const data = await categoryApi.getCategories();
      setCategories(data);
    } catch (error) {
      console.error('Failed to fetch categories:', error);
    }
  };

  const fetchCategoryStats = async () => {
    const requestId = categoryStatsRequestIdRef.current + 1;
    categoryStatsRequestIdRef.current = requestId;
    try {
      const data = await categoryApi.getCategoryStats({
        search: searchTerm || undefined,
        source_domain: sourceDomain || undefined,
        author: author || undefined,
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
  };

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
    suppressNextPageFetchRef.current = true;
    setHasMore(true);
    setIsAppending(false);
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    debounceRef.current = setTimeout(() => {
      fetchArticles();
      fetchCategoryStats();
    }, 400);
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
    if (!initialized || authLoading) return;
    if (suppressNextPageFetchRef.current) {
      suppressNextPageFetchRef.current = false;
      return;
    }
    fetchArticles();
  }, [initialized, authLoading, page, pageSize]);

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
    const visibilityParam = routerQueryState.visibility || '';
    const quickDateRaw = routerQueryState.quick_date || '';
    const sortByRaw = routerQueryState.sort_by || '';
    const publishedStart = parseDateQuery(routerQueryState.published_at_start || '');
    const publishedEnd = parseDateQuery(routerQueryState.published_at_end || '');
    const createdStart = parseDateQuery(routerQueryState.created_at_start || '');
    const createdEnd = parseDateQuery(routerQueryState.created_at_end || '');

    const quickDateParam: QuickDateOption = quickDateOptions.includes(quickDateRaw as QuickDateOption)
      ? (quickDateRaw as QuickDateOption)
      : '';
    const sortByParam = sortByRaw === 'published_at_desc' || sortByRaw === 'created_at_desc'
      ? sortByRaw
      : 'published_at_desc';

    const pageParam = Number(routerQueryState.page || '');
    const sizeParam = Number(routerQueryState.size || '');

    setSelectedCategory(categoryParam);
    setSearchTerm(searchParam);
    setSourceDomain(sourceDomainParam);
    setAuthor(authorParam);
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
    }
    if (sources.length === 0) {
      fetchSources();
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

  const activeFilters = useMemo(() => {
    const filters: string[] = [];
    const categoryName = categories.find((c) => c.id === selectedCategory)?.name;
    if (categoryName) filters.push(`${t('分类')}：${categoryName}`);
    if (searchTerm) filters.push(`${t('标题')}：${searchTerm}`);
    if (sourceDomain) filters.push(`${t('来源')}：${sourceDomain}`);
    if (author) filters.push(`${t('作者')}：${author}`);
    if (isAdmin && visibilityFilter) {
      filters.push(visibilityFilter === 'visible' ? `${t('可见')}：${t('是')}` : `${t('可见')}：${t('否')}`);
    }
    if (publishedStartDate || publishedEndDate) {
      filters.push(`${t('发表')}：${formatDate(publishedStartDate)} ~ ${formatDate(publishedEndDate)}`.trim());
    }
    if (createdStartDate || createdEndDate) {
      filters.push(`${t('创建')}：${formatDate(createdStartDate)} ~ ${formatDate(createdEndDate)}`.trim());
    }
    if (sortBy === 'published_at_desc') filters.push(`${t('排序')}：${t('发表时间倒序')}`);
    if (sortBy === 'created_at_desc') filters.push(`${t('排序')}：${t('创建时间倒序')}`);
    return filters;
  }, [
    categories,
    selectedCategory,
    searchTerm,
    sourceDomain,
    author,
    publishedStartDate,
    publishedEndDate,
    createdStartDate,
    createdEndDate,
    quickDateFilter,
    sortBy,
    isAdmin,
    visibilityFilter,
  ]);

  const advancedFiltersBody = (
    <>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
        <FilterInput
          label={t('文章标题')}
          value={searchTerm}
          onChange={(value) => { setSearchTerm(value); setPage(1); }}
          placeholder={t('模糊匹配标题')}
        />
        <FilterSelect
          label={t('来源')}
          value={sourceDomain}
          onChange={(value) => { setSourceDomain(value); setPage(1); }}
          options={[{ value: '', label: t('全部来源') }, ...sources.map((s) => ({ value: s, label: s }))]}
        />
        <FilterSelect
          label={t('作者')}
          value={author}
          onChange={(value) => { setAuthor(value); setPage(1); }}
          options={[{ value: '', label: t('全部作者') }, ...authors.map((a) => ({ value: a, label: a }))]}
        />
      </div>
      {isMobile && (
        <div className="grid grid-cols-1 gap-4 mb-4">
          <FilterSelect
            label={t('创建时间')}
            value={quickDateFilter}
            onChange={(value) => handleQuickDateChange(value as QuickDateOption)}
            options={[
              { value: '', label: t('全部') },
              { value: '1d', label: t('1天内') },
              { value: '3d', label: t('3天内') },
              { value: '1w', label: t('1周内') },
              { value: '1m', label: t('1个月') },
              { value: '3m', label: t('3个月') },
              { value: '6m', label: t('6个月') },
              { value: '1y', label: t('1年内') },
            ]}
          />
          {isAdmin && (
            <FilterSelect
              label={t('可见性')}
              value={visibilityFilter}
              onChange={(value) => { setVisibilityFilter(value); setPage(1); }}
              options={[
                { value: '', label: t('全部') },
                { value: 'visible', label: t('可见') },
                { value: 'hidden', label: t('隐藏') },
              ]}
            />
          )}
          <FilterSelect
            label={t('排序')}
            value={sortBy}
            onChange={(value) => { setSortBy(value); setPage(1); }}
            options={[
              { value: 'published_at_desc', label: t('发表时间倒序') },
              { value: 'created_at_desc', label: t('创建时间倒序') },
            ]}
          />
        </div>
      )}
      <div className="hidden lg:grid grid-cols-1 md:grid-cols-3 gap-4 mb-2">
        <div>
          <label htmlFor="published-date-range" className="block text-sm text-text-2 mb-1.5">{t('发表时间')}</label>
          <DateRangePicker
            id="published-date-range"
            value={toDayjsRange(publishedDateRange)}
            onChange={(values) => {
              const [start, end] = values || [];
              setPublishedDateRange([start ? start.toDate() : null, end ? end.toDate() : null]);
              setPage(1);
            }}
            className="w-full"
          />
        </div>
        <div>
          <label htmlFor="created-date-range" className="block text-sm text-text-2 mb-1.5">{t('创建时间')}</label>
          <DateRangePicker
            id="created-date-range"
            value={toDayjsRange(createdDateRange)}
            onChange={(values) => {
              const [start, end] = values || [];
              setCreatedDateRange([start ? start.toDate() : null, end ? end.toDate() : null]);
              setQuickDateFilter('');
              setPage(1);
            }}
            className="w-full"
          />
        </div>
        <div className="hidden md:block" />
      </div>
    </>
  );

  const filterSummary = (
    <div className="flex flex-wrap items-center gap-2">
      {activeFilters.length === 0 ? (
        <span className="text-sm text-text-3">{t('暂无筛选条件')}</span>
      ) : (
        activeFilters.map((filter) => (
          <span
            key={filter}
            className="filter-chip px-2.5 py-1 text-sm rounded-sm"
          >
            {filter}
          </span>
        ))
      )}
      <button
        type="button"
        onClick={handleClearFilters}
        className={`ml-auto px-3 py-1 text-sm rounded-sm transition ${activeFilters.length === 0 ? 'bg-muted text-text-3 cursor-not-allowed' : 'bg-surface text-text-2 hover:bg-muted hover:text-text-1'}`}
        disabled={activeFilters.length === 0}
      >
        {t('清除筛选')}
      </button>
    </div>
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

  const handleCreatePaste = (
    event: React.ClipboardEvent<HTMLTextAreaElement>,
  ) => {
    const clipboard = event.clipboardData;
    if (!clipboard) return;
    const mediaLink =
      extractMediaLinkFromHtml(clipboard.getData('text/html')) ||
      extractMediaLinkFromText(clipboard.getData('text/plain'));
    if (!mediaLink) return;
    event.preventDefault();
    insertTextAtCursor(
      event.currentTarget,
      buildMarkdownFromMediaLink(mediaLink, t),
      setCreateContent,
    );
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
      const response = await articleApi.createArticle({
        title: createTitle.trim(),
        content_md: createContent.trim(),
        source_url: createSourceUrl.trim() || undefined,
        author: createAuthor.trim() || undefined,
        published_at: new Date().toISOString(),
        top_image: createTopImage.trim() || undefined,
        category_id: createCategoryId || undefined,
      });

      showToast(t('创建成功'));
      setShowCreateModal(false);
      setCreateTitle('');
      setCreateAuthor('');
      setCreateCategoryId('');
      setCreateTopImage('');
      setCreateContent('');
      setCreateSourceUrl('');
      fetchArticles();

      if (response.slug) {
        router.push(buildArticleHref(response.slug));
      }
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : String(error);
      showToast(t('创建失败') + ': ' + errMsg, 'error');
    } finally {
      setCreateSaving(false);
    }
  };


  const batchActions = (
    <div className="mt-4 pt-4 border-t border-border">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm text-text-2">{t('已选')} {selectedArticleSlugs.size} {t('篇')}</span>
          <Button
            type="button"
            onClick={handleExport}
            disabled={batchActionPending}
            variant="ghost"
            size="sm"
            className="min-w-[104px]"
          >
            {batchAction === 'export' ? t('导出中...') : `${t('导出选中')} (${selectedArticleSlugs.size})`}
          </Button>
        </div>
        {isAdmin && (
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              onClick={() => handleBatchVisibility(true)}
              disabled={batchActionPending}
              variant="ghost"
              size="sm"
              className="min-w-[88px]"
            >
              {batchAction === 'visibility' ? t('处理中...') : t('设为可见')}
            </Button>
            <Button
              type="button"
              onClick={() => handleBatchVisibility(false)}
              disabled={batchActionPending}
              variant="ghost"
              size="sm"
              className="min-w-[88px]"
            >
              {batchAction === 'visibility' ? t('处理中...') : t('设为隐藏')}
            </Button>
            <div className="flex items-center gap-2">
              <SelectField
                value={batchCategoryId}
                onChange={(value) => setBatchCategoryId(value)}
                className="w-36"
                disabled={batchActionPending}
                options={[
                  { value: '', label: t('选择分类') },
                  { value: '__clear__', label: t('清空分类') },
                  ...categories.map((category) => ({ value: category.id, label: category.name })),
                ]}
              />
              <Button
                type="button"
                onClick={handleBatchCategory}
                disabled={batchActionPending}
                variant="ghost"
                size="sm"
                className="min-w-[88px]"
              >
                {batchAction === 'category' ? t('处理中...') : t('应用分类')}
              </Button>
            </div>
            <Button
              type="button"
              onClick={handleBatchDelete}
              disabled={batchActionPending}
              variant="danger"
              size="sm"
              className="min-w-[96px]"
            >
              {batchAction === 'delete' ? t('删除中...') : t('批量删除')}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
  const skeletonCount = isMobile ? 4 : 6;
  const listSkeleton = <FeedListSkeleton count={skeletonCount} showAdminDesktop={showAdminDesktop} />;

  return (
    <div className="min-h-screen bg-app flex flex-col">
      <Head>
        <title>
          {basicSettings.site_name || 'Lumina'} - {basicSettings.site_description || t('信息灯塔')}
        </title>
      </Head>
      <AppHeader />

      <div className="lg:hidden border-b border-border bg-surface panel-subtle">
        <div className="max-w-7xl mx-auto px-4 py-3">
          <div className="flex items-center gap-2 overflow-x-auto">
            <button type="button"
              onClick={() => { setSelectedCategory(''); setPage(1); }}
              className={`whitespace-nowrap px-3 py-1.5 text-sm rounded-full transition ${
                selectedCategory === '' ? 'bg-primary-soft text-primary-ink' : 'bg-muted text-text-2'
              }`}
            >
              {t('全部文章')} ({categoryStats.reduce((sum, c) => sum + c.article_count, 0)})
            </button>
            {categoryStats.map((category) => (
              <button type="button"
                key={category.id}
                onClick={() => { setSelectedCategory(category.id); setPage(1); }}
                className={`whitespace-nowrap px-3 py-1.5 text-sm rounded-full transition ${
                  selectedCategory === category.id ? 'bg-primary-soft text-primary-ink' : 'bg-muted text-text-2'
                }`}
              >
                {category.name} ({category.article_count})
              </button>
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
          <aside className={`hidden lg:block flex-shrink-0 w-full transition-all duration-300 ${sidebarCollapsed ? 'lg:w-12' : 'lg:w-56'}`}>
            <div className="panel-raised rounded-sm border border-border p-4 max-h-none overflow-visible lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto">
              <div className="flex items-center justify-between mb-4">
                {!sidebarCollapsed && (
                  <h2 className="font-semibold text-text-1 inline-flex items-center gap-2">
                    <IconTag className="h-4 w-4" />
                    <span>{t('分类筛选')}</span>
                  </h2>
                )}
                <button
                  type="button"
                  onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
                  className="text-text-3 hover:text-text-2 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35"
                  title={sidebarCollapsed ? t('展开') : t('收起')}
                  aria-label={sidebarCollapsed ? t('展开分类筛选') : t('收起分类筛选')}
                >
                  {sidebarCollapsed ? '»' : '«'}
                </button>
              </div>
              {!sidebarCollapsed && (
                <div className="space-y-2">
                  <button type="button"
                    onClick={() => { setSelectedCategory(''); setPage(1); }}
                    className={`w-full text-left px-3 py-2 rounded-sm transition ${
                      selectedCategory === '' ? 'bg-primary-soft text-primary-ink' : 'hover:bg-muted'
                    }`}
                  >
                    {t('全部文章')} ({categoryStats.reduce((sum, c) => sum + c.article_count, 0)})
                  </button>
                  {categoryStats.map((category) => (
                    <button type="button"
                      key={category.id}
                      onClick={() => { setSelectedCategory(category.id); setPage(1); }}
                      className={`w-full text-left px-3 py-2 rounded-sm transition ${
                        selectedCategory === category.id ? 'bg-primary-soft text-primary-ink' : 'hover:bg-muted'
                      }`}
                    >
                      {category.name} ({category.article_count})
                    </button>
                  ))}
                </div>
              )}
            </div>
          </aside>

          <main className="flex-1" aria-busy={!listContentReady}>
            {!isMobile && (
              <div className="panel-raised rounded-sm border border-border p-4 sm:p-6 mb-6">
                {!isMobile && (
                  <>
                    <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
                      <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={() => setShowFilters(!showFilters)}
                            className={`hidden lg:inline-flex whitespace-nowrap px-4 py-1 text-sm rounded-sm transition ${showFilters ? 'bg-primary-soft text-primary-ink' : 'bg-muted text-text-2 hover:bg-surface'}`}
                          >
                            <span className="inline-flex items-center gap-2">
                              <IconSearch className="h-4 w-4" />
                              <span>{t('高级筛选')}</span>
                            </span>
                          </button>
                        {isAdmin && (
                          <Button
                            type="button"
                            onClick={() => setShowCreateModal(true)}
                            variant="primary"
                            size="sm"
                            className="hidden lg:inline-flex whitespace-nowrap"
                          >
                            <span className="inline-flex items-center gap-2">
                              <IconPlus className="h-4 w-4" />
                              <span>{t('创建文章')}</span>
                            </span>
                          </Button>
                        )}
                      </div>
                      <div className="hidden lg:flex flex-wrap items-center gap-4 lg:justify-end">
                        <FilterSelectInline
                          label={`${t('创建时间')}：`}
                          value={quickDateFilter}
                          onChange={(value) => handleQuickDateChange(value as QuickDateOption)}
                          options={[
                            { value: '', label: t('全部') },
                            { value: '1d', label: t('1天内') },
                            { value: '3d', label: t('3天内') },
                            { value: '1w', label: t('1周内') },
                            { value: '1m', label: t('1个月') },
                            { value: '3m', label: t('3个月') },
                            { value: '6m', label: t('6个月') },
                            { value: '1y', label: t('1年内') },
                          ]}
                        />
                        {isAdmin && (
                          <FilterSelectInline
                            label={`${t('可见性')}：`}
                            value={visibilityFilter}
                            onChange={(value) => { setVisibilityFilter(value); setPage(1); }}
                            options={[
                              { value: '', label: t('全部') },
                              { value: 'visible', label: t('可见') },
                              { value: 'hidden', label: t('隐藏') },
                            ]}
                          />
                        )}
                        <FilterSelectInline
                          label={`${t('排序')}：`}
                          value={sortBy}
                          onChange={(value) => { setSortBy(value); setPage(1); }}
                          options={[
                            { value: 'published_at_desc', label: t('发表时间倒序') },
                            { value: 'created_at_desc', label: t('创建时间倒序') },
                          ]}
                        />
                      </div>
                    </div>

                    {showFilters && (
                      <div className="mt-4 pt-4 border-t border-border">
                        {advancedFiltersBody}
                      </div>
                    )}

                    <div className="mt-4 pt-4 border-t border-border">
                      {filterSummary}
                    </div>
                  </>
                )}
                {showAdminDesktop && selectedArticleSlugs.size > 0 && batchActions}
              </div>
            )}

            {!listContentReady ? (
              listSkeleton
            ) : articles.length === 0 ? (
              <div className="panel-subtle rounded-sm border border-border text-center py-12 text-text-3">{t('暂无文章')}</div>
             ) : (
                <> 
                  {showAdminDesktop && (
                    <div className="mb-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <CheckboxInput
                          checked={selectedArticleSlugs.size === articles.length}
                          onChange={handleSelectAll}
                        />
                        <span className="text-sm text-text-2">
                          {t('全选')} ({selectedArticleSlugs.size}/{articles.length})
                        </span>
                      </div>
                    </div>
                  )}
                  <div className="space-y-4">
                    {articles.map((article) => {
                      const articleHref = buildArticleHref(article.slug);
                      const selected = showAdminDesktop && selectedArticleSlugs.has(article.slug);
                      const cardTopImageUrl = resolveMediaUrl(article.top_image || basicSettings.site_logo_url || '/logo.png');
                      const mediaBlock = (
                        showAdminDesktop ? (
                          <div className="relative w-full sm:w-40 aspect-video sm:aspect-square overflow-hidden rounded-lg bg-muted">
                            <img
                              src={cardTopImageUrl || defaultTopImageUrl}
                              alt={article.title}
                              className="absolute inset-0 h-full w-full object-cover"
                              loading="lazy"
                              decoding="async"
                            />
                            <ArticleLanguageTag article={article} className="absolute left-2 top-2 px-2 py-0.5 text-xs" />
                          </div>
                        ) : (
                          <Link
                            href={articleHref}
                            target={articleLinkTarget}
                            rel={articleLinkRel}
                            className="relative block w-full sm:w-40 aspect-video sm:aspect-square overflow-hidden rounded-lg bg-muted"
                          >
                            <img
                              src={cardTopImageUrl || defaultTopImageUrl}
                              alt={article.title}
                              className="absolute inset-0 h-full w-full object-cover"
                              loading="lazy"
                              decoding="async"
                            />
                            <ArticleLanguageTag article={article} className="absolute left-2 top-2 px-2 py-0.5 text-xs" />
                          </Link>
                        )
                      );

                      return (
                        <article
                          key={article.slug}
                          id={`article-${article.slug}`}
                          onClick={showAdminDesktop ? (event) => handleOpenArticle(event, article) : undefined}
                          onKeyDown={showAdminDesktop ? (event) => handleArticleCardKeyDown(event, article) : undefined}
                          role={showAdminDesktop ? 'button' : undefined}
                          tabIndex={showAdminDesktop ? 0 : undefined}
                          aria-label={showAdminDesktop ? t('选择文章') : undefined}
                          aria-pressed={showAdminDesktop ? selected : undefined}
                          className={`panel-raised rounded-lg border border-border p-4 sm:p-6 min-h-[184px] transition relative scroll-mt-24 ${
                            showAdminDesktop
                              ? 'cursor-pointer hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40'
                              : 'hover:shadow-md'
                          } ${!article.is_visible && isAdmin ? 'opacity-60' : ''} ${selected ? 'ring-2 ring-primary/70 ring-offset-2 bg-primary-soft/25' : ''}`}
                        >
                          {showAdminDesktop && (
                            <div className="absolute top-3 right-3 flex items-center gap-1">
                              <IconButton
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleToggleVisibility(article.slug, article.is_visible);
                                }}
                                variant="default"
                                size="sm"
                                title={article.is_visible ? t('点击隐藏') : t('点击显示')}
                              >
                                {article.is_visible ? (
                                  <IconEye className="h-4 w-4" />
                                ) : (
                                  <IconEyeOff className="h-4 w-4" />
                                )}
                              </IconButton>
                              <IconButton
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDelete(article.slug);
                                }}
                                variant="danger"
                                size="sm"
                                title={t('删除')}
                              >
                                <IconTrash className="h-4 w-4" />
                              </IconButton>
                            </div>
                          )}
                          <div className="flex flex-col sm:flex-row gap-4">
                            {showAdminDesktop && (
                              <CheckboxInput
                                checked={selected}
                                onChange={() => handleToggleSelect(article.slug)}
                                onClick={(e) => e.stopPropagation()}
                                className="mt-1"
                              />
                            )}
                            {mediaBlock}
                            <div className="flex-1 sm:pr-6">
                              <Link
                                href={articleHref}
                                onClick={(e) => e.stopPropagation()}
                                target={articleLinkTarget}
                                rel={articleLinkRel}
                              >
                                <h3 className="text-xl font-semibold text-text-1 hover:text-primary transition cursor-pointer">
                                  {article.title}
                                </h3>
                              </Link>
                              <ArticleMetaRow
                                className="mt-2"
                                publishedAt={article.published_at}
                                createdAt={article.created_at}
                                items={[
                                  article.category ? (
                                    <span
                                      className="category-chip px-2 py-1 rounded-sm"
                                      style={{
                                        backgroundColor: article.category.color ? `${article.category.color}20` : 'var(--bg-muted)',
                                        color: article.category.color || 'var(--text-2)',
                                      }}
                                    >
                                      {article.category.name}
                                    </span>
                                  ) : null,
                                  article.author ? <span>{t('作者')}: {article.author}</span> : null,
                                ]}
                              />
                              {article.summary && (
                                <p className="mt-2 text-text-2 line-clamp-3">
                                  {article.summary}
                                </p>
                              )}
                            </div>
                          </div>
                        </article>
                      );
                    })}
                  </div>

                {!isMobile && (
                  <div className="mt-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                    <div className="flex flex-wrap items-center gap-2 text-sm text-text-2">
                      <span>{t('每页显示')}</span>
                      <SelectField
                        value={pageSize}
                        onChange={(value) => { setPageSize(Number(value)); setPage(1); }}
                        className="w-20"
                        options={[
                          { value: 10, label: '10' },
                          { value: 20, label: '20' },
                          { value: 50, label: '50' },
                          { value: 100, label: '100' },
                        ]}
                      />
                      <span>{t('条')}，{t('共')} {total} {t('条')}</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        onClick={() => setPage((p) => Math.max(1, p - 1))}
                        disabled={page === 1}
                        variant="secondary"
                        size="sm"
                      >
                        {t('上一页')}
                      </Button>
                      <span className="px-4 py-2 text-sm bg-surface border border-border rounded-sm text-text-2">
                        {t('第')} {page} / {totalPages} {t('页')}
                      </span>
                      <Button
                        onClick={() => setPage((p) => p + 1)}
                        disabled={page >= totalPages}
                        variant="secondary"
                        size="sm"
                      >
                        {t('下一页')}
                      </Button>
                      <div className="ml-2 flex flex-none items-center gap-1 whitespace-nowrap">
                        <TextInput
                          type="number"
                          value={jumpToPage}
                          onChange={(e) => setJumpToPage(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && handleJumpToPage()}
                          className="w-16 text-center"
                          compact
                          min={1}
                          max={totalPages}
                        />
                        <Button
                          onClick={handleJumpToPage}
                          variant="primary"
                          size="sm"
                          className="whitespace-nowrap"
                        >
                          {t('跳转')}
                        </Button>
                      </div>
                    </div>
                  </div>
                )}
                {isMobile && (
                  <div className="mt-6 text-center text-sm text-text-3">
                    {loadingMore ? t('加载中...') : hasMore ? t('上拉加载更多') : t('没有更多了')}
                    <div ref={loadMoreRef} className="h-6" />
                  </div>
                )}
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
      {isMobile && (
        <>
          <button
            type="button"
            onClick={() => {
              setShowFilters(true);
              setShowMobileFilters(true);
            }}
            className="fixed right-4 top-24 flex items-center justify-center w-10 h-10 rounded-full bg-surface border border-border shadow-lg text-text-2 hover:text-text-1 hover:bg-muted transition z-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35"
            title={t('高级筛选')}
            aria-label={t('打开高级筛选')}
          >
            <IconSearch className="h-4 w-4" />
          </button>
          {showMobileFilters && (
            <div
              className="fixed inset-0 z-50 bg-black/40 flex justify-end"
              onClick={() => setShowMobileFilters(false)}
            >
              <div
                className="h-full w-[86vw] max-w-sm bg-surface shadow-xl overflow-y-auto"
                onClick={(event) => event.stopPropagation()}
              >
                <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-surface">
                  <span className="text-sm font-semibold text-text-1">
                    {t('高级筛选')}
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowMobileFilters(false)}
                    className="text-text-3 hover:text-text-1 transition text-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35"
                    aria-label={t('关闭')}
                  >
                    ×
                  </button>
                </div>
                <div className="p-4">{advancedFiltersBody}</div>
              </div>
            </div>
          )}
        </>
      )}
      <ArticleSplitEditorModal
        isOpen={showCreateModal}
        title={t('创建文章')}
        closeAriaLabel={t('关闭创建文章弹窗')}
        onClose={() => setShowCreateModal(false)}
        onSave={handleCreateArticle}
        topFields={(
          <>
            <FormField label={t('标题')} required>
              <TextInput
                type="text"
                value={createTitle}
                onChange={(e) => setCreateTitle(e.target.value)}
                placeholder={t('请输入文章标题')}
              />
            </FormField>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <FormField label={t('作者')}>
                <TextInput
                  type="text"
                  value={createAuthor}
                  onChange={(e) => setCreateAuthor(e.target.value)}
                  placeholder={t('请输入作者')}
                />
              </FormField>
              <FormField label={t('分类')}>
                <SelectField
                  value={createCategoryId}
                  onChange={(value) => setCreateCategoryId(value)}
                  className="w-full"
                  options={[
                    { value: '', label: t('未分类') },
                    ...categories.map((category) => ({
                      value: category.id,
                      label: category.name,
                    })),
                  ]}
                />
              </FormField>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <FormField label={t('来源 URL')}>
                <TextInput
                  type="text"
                  value={createSourceUrl}
                  onChange={(e) => setCreateSourceUrl(e.target.value)}
                  placeholder={t('请输入来源链接')}
                />
              </FormField>

              <FormField label={t('头图 URL')}>
                <TextInput
                  type="text"
                  value={createTopImage}
                  onChange={(e) => setCreateTopImage(e.target.value)}
                  placeholder={t('输入图片 URL')}
                />
              </FormField>
            </div>
          </>
        )}
        contentValue={createContent}
        onContentChange={setCreateContent}
        onContentPaste={handleCreatePaste}
        saveText={t('创建')}
        savingText={t('保存中...')}
        isSaving={createSaving}
        previewImageUrl={resolveMediaUrl(createTopImage || basicSettings.site_logo_url || '/logo.png') || ''}
        previewImageAlt={createTitle}
        previewHtml={renderSafeMarkdown(createContent || '', { enableMediaEmbed: true })}
        closeOnBackdrop
      />

      <AppFooter />
      <BackToTop />
    </div>
  );
}
