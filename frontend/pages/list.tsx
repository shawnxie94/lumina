import { useState, useEffect, useMemo, useRef } from 'react';

import Head from 'next/head';
import { useRouter } from 'next/router';
import Link from 'next/link';
import { Select } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';

import { articleApi, categoryApi, Article, Category, resolveMediaUrl } from '@/lib/api';
import { marked } from 'marked';
import AppFooter from '@/components/AppFooter';
import AppHeader from '@/components/AppHeader';
import Button from '@/components/Button';
import DateRangePicker from '@/components/DateRangePicker';
import FilterInput from '@/components/FilterInput';
import FilterSelect from '@/components/FilterSelect';
import FilterSelectInline from '@/components/FilterSelectInline';
import ConfirmModal from '@/components/ConfirmModal';
import IconButton from '@/components/IconButton';
import { useToast } from '@/components/Toast';
import { BackToTop } from '@/components/BackToTop';
import { IconEye, IconEyeOff, IconSearch, IconTag, IconTrash, IconPlus } from '@/components/icons';
import { useAuth } from '@/contexts/AuthContext';
import { useBasicSettings } from '@/contexts/BasicSettingsContext';
import { useI18n } from '@/lib/i18n';

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

const getArticleLanguageTag = (article: Article): string => {
  // 优先使用 original_language 字段，回退到基于内容的检测
  if (article.original_language) {
    return article.original_language === 'zh' ? '中文' : '英文';
  }
  // 兼容旧数据：基于内容检测
  const sample = `${article.title || ''} ${article.summary || ''}`;
  const hasChinese = /[\u4e00-\u9fff]/.test(sample);
  return hasChinese ? '中文' : '英文';
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

export default function Home() {
  const router = useRouter();
  const { showToast } = useToast();
  const { isAdmin } = useAuth();
  const { t, language } = useI18n();
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
  const [sortBy, setSortBy] = useState<string>('created_at_desc');
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
  const createTextareaRef = useRef<HTMLTextAreaElement>(null);
  const createPreviewRef = useRef<HTMLDivElement>(null);

  const [publishedStartDate, publishedEndDate] = publishedDateRange;
  const [createdStartDate, createdEndDate] = createdDateRange;

  const fetchArticles = async () => {
    if (isAppending) {
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
      setTotal(response.pagination.total);
      setArticles((prev) => {
        const next = isAppending ? [...prev, ...response.data] : response.data;
        setHasMore(next.length < response.pagination.total);
        return next;
      });
    } catch (error) {
      console.error('Failed to fetch articles:', error);
    } finally {
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
      setCategoryStats(data);
    } catch (error) {
      console.error('Failed to fetch category stats:', error);
    }
  };

  const fetchAuthors = async () => {
    try {
      const data = await articleApi.getAuthors();
      setAuthors(data);
    } catch (error) {
      console.error('Failed to fetch authors:', error);
    }
  };

  const fetchSources = async () => {
    try {
      const data = await articleApi.getSources();
      setSources(data);
    } catch (error) {
      console.error('Failed to fetch sources:', error);
    }
  };

  useEffect(() => {
    if (!initialized) return;
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
    if (!initialized) return;
    fetchArticles();
  }, [initialized, page, pageSize]);

  useEffect(() => {
    if (router.isReady) {
      const { author: authorParam, category_id: categoryParam } = router.query;
      if (authorParam && typeof authorParam === 'string') {
        setAuthor(authorParam);
        setShowFilters(true);
      }
      if (categoryParam && typeof categoryParam === 'string') {
        setSelectedCategory(categoryParam);
        setShowFilters(true);
      }
      setInitialized(true);
    }
  }, [router.isReady, router.query]);

  useEffect(() => {
    fetchCategories();
    fetchAuthors();
    fetchSources();
  }, []);

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
    const node = loadMoreRef.current;
    if (!node) return;
    if (!hasMore || loadingMore || loading) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting) return;
        setIsAppending(true);
        setPage((prev) => prev + 1);
      },
      { rootMargin: '200px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [isMobile, hasMore, loadingMore, loading]);


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
    if (selectedArticleSlugs.size === 0) return;
    try {
      await articleApi.batchUpdateVisibility(Array.from(selectedArticleSlugs), isVisible);
      showToast(isVisible ? t('已批量设为可见') : t('已批量设为隐藏'));
      setSelectedArticleSlugs(new Set());
      fetchArticles();
      fetchCategoryStats();
    } catch (error) {
      console.error('Failed to batch update visibility:', error);
      showToast(t('操作失败'), 'error');
    }
  };

  const handleBatchCategory = async () => {
    if (selectedArticleSlugs.size === 0) return;
    if (!batchCategoryId) {
      showToast(t('请选择分类'), 'info');
      return;
    }
    const targetCategoryId = batchCategoryId === '__clear__' ? null : batchCategoryId;
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
        try {
          await articleApi.batchDeleteArticles(slugs);
          showToast(t('删除成功'));
          setSelectedArticleSlugs(new Set());
          fetchArticles();
          fetchCategoryStats();
        } catch (error) {
          console.error('Failed to batch delete articles:', error);
          showToast(t('删除失败'), 'error');
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
            className="px-2 py-1 text-sm bg-primary-soft text-primary-ink rounded-xs"
          >
            {filter}
          </span>
        ))
      )}
      <button
        type="button"
        onClick={handleClearFilters}
        className={`ml-auto px-3 py-1 text-sm rounded-lg transition ${activeFilters.length === 0 ? 'bg-gray-50 text-gray-400 cursor-not-allowed' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
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
    event: React.MouseEvent<HTMLDivElement>,
    article: Article,
  ) => {
    const target = event.target as HTMLElement | null;
    if (
      target?.closest(
        "button, a, input, textarea, select, option, label, svg",
      )
    ) {
      return;
    }
    // 使用 slug 作为 URL，seo 更友好
    router.push(`/article/${article.slug}`);
  };

  const handleSelectAll = () => {
    if (selectedArticleSlugs.size === articles.length) {
      setSelectedArticleSlugs(new Set());
    } else {
      setSelectedArticleSlugs(new Set(articles.map((a) => a.slug)));
    }
  };

  const handleExport = async () => {
    if (!isAdmin) {
      showToast(t('仅管理员可导出文章'), 'info');
      return;
    }

    if (selectedArticleSlugs.size === 0) {
      showToast(t('请先选择要导出的文章'), 'info');
      return;
    }

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
    }
  };

  const handleJumpToPage = () => {
    const pageNum = parseInt(jumpToPage);
    const totalPages = Math.ceil(total / pageSize) || 1;
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
        router.push(`/article/${response.slug}`);
      }
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : String(error);
      showToast(t('创建失败') + ': ' + errMsg, 'error');
    } finally {
      setCreateSaving(false);
    }
  };

  const batchActions = (
    <div className="mt-4 pt-4 border-t border-gray-200">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm text-gray-600">{t('已选')} {selectedArticleSlugs.size} {t('篇')}</span>
          <button
            onClick={handleExport}
            className="px-3 py-1 text-sm rounded-sm text-text-2 hover:text-text-1 hover:bg-muted transition"
          >
            {t('导出选中')} ({selectedArticleSlugs.size})
          </button>
        </div>
        {isAdmin && (
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => handleBatchVisibility(true)}
              className="px-3 py-1 text-sm rounded-sm text-text-2 hover:text-text-1 hover:bg-muted transition"
            >
              {t('设为可见')}
            </button>
            <button
              type="button"
              onClick={() => handleBatchVisibility(false)}
              className="px-3 py-1 text-sm rounded-sm text-text-2 hover:text-text-1 hover:bg-muted transition"
            >
              {t('设为隐藏')}
            </button>
            <div className="flex items-center gap-2">
              <Select
                value={batchCategoryId}
                onChange={(value) => setBatchCategoryId(value)}
                className="select-modern-antd"
                popupClassName="select-modern-dropdown"
                options={[
                  { value: '', label: t('选择分类') },
                  { value: '__clear__', label: t('清空分类') },
                  ...categories.map((category) => ({ value: category.id, label: category.name })),
                ]}
              />
              <button
                type="button"
                onClick={handleBatchCategory}
                className="px-3 py-1 text-sm rounded-sm text-text-2 hover:text-text-1 hover:bg-muted transition"
              >
                {t('应用分类')}
              </button>
            </div>
            <button
              type="button"
              onClick={handleBatchDelete}
              className="px-3 py-1 text-sm rounded-sm text-text-2 hover:text-red-600 hover:bg-red-50 transition"
            >
              {t('批量删除')}
            </button>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-app flex flex-col">
      <Head>
        <title>
          {basicSettings.site_name || 'Lumina'} - {basicSettings.site_description || t('信息灯塔')}
        </title>
      </Head>
      <AppHeader />

      <div className="lg:hidden border-b border-border bg-surface">
        <div className="max-w-7xl mx-auto px-4 py-3">
          <div className="flex items-center gap-2 overflow-x-auto">
            <button
              onClick={() => { setSelectedCategory(''); setPage(1); }}
              className={`whitespace-nowrap px-3 py-1.5 text-sm rounded-full transition ${
                selectedCategory === '' ? 'bg-primary-soft text-primary-ink' : 'bg-muted text-text-2'
              }`}
            >
              {t('全部')} ({categoryStats.reduce((sum, c) => sum + c.article_count, 0)})
            </button>
            {categoryStats.map((category) => (
              <button
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
          {isAdmin && !isMobile && selectedArticleSlugs.size > 0 && (
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
            <div className="bg-surface rounded-sm shadow-sm border border-border p-4 max-h-none overflow-visible lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto">
              <div className="flex items-center justify-between mb-4">
                {!sidebarCollapsed && (
                  <h2 className="font-semibold text-text-1 inline-flex items-center gap-2">
                    <IconTag className="h-4 w-4" />
                    <span>{t('分类筛选')}</span>
                  </h2>
                )}
                <button
                  onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
                  className="text-text-3 hover:text-text-2 transition"
                  title={sidebarCollapsed ? t('展开') : t('收起')}
                >
                  {sidebarCollapsed ? '»' : '«'}
                </button>
              </div>
              {!sidebarCollapsed && (
                <div className="space-y-2">
                  <button
                    onClick={() => { setSelectedCategory(''); setPage(1); }}
                    className={`w-full text-left px-3 py-2 rounded-sm transition ${
                      selectedCategory === '' ? 'bg-primary-soft text-primary-ink' : 'hover:bg-muted'
                    }`}
                  >
                    {t('全部内容')} ({categoryStats.reduce((sum, c) => sum + c.article_count, 0)})
                  </button>
                  {categoryStats.map((category) => (
                    <button
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

          <main className="flex-1">
            {!isMobile && (
              <div className="bg-surface rounded-sm shadow-sm border border-border p-4 sm:p-6 mb-6">
                {!isMobile && (
                  <>
                    <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
                      <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={() => setShowFilters(!showFilters)}
                            className={`hidden lg:inline-flex px-4 py-1 text-sm rounded-sm transition ${showFilters ? 'bg-primary-soft text-primary-ink' : 'bg-muted text-text-2 hover:bg-surface'}`}
                          >
                            <span className="inline-flex items-center gap-2">
                              <IconSearch className="h-4 w-4" />
                              <span>{t('高级筛选')}</span>
                            </span>
                          </button>
                        {isAdmin && (
                          <button
                            type="button"
                            onClick={() => setShowCreateModal(true)}
                            className="hidden lg:inline-flex px-4 py-1 text-sm rounded-sm bg-primary text-white hover:bg-primary-ink transition"
                          >
                            <span className="inline-flex items-center gap-2">
                              <IconPlus className="h-4 w-4" />
                              <span>{t('创建文章')}</span>
                            </span>
                          </button>
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
                {isAdmin && !isMobile && selectedArticleSlugs.size > 0 && batchActions}
              </div>
            )}

            {loading ? (
              <div className="text-center py-12 text-gray-500">{t('加载中')}</div>
            ) : articles.length === 0 ? (
              <div className="text-center py-12 text-gray-500">{t('暂无文章')}</div>
             ) : (
                <> 
                  {isAdmin && !isMobile && (
                    <div className="mb-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <input
                          type="checkbox"
                          checked={selectedArticleSlugs.size === articles.length}
                          onChange={handleSelectAll}
                          className="w-4 h-4 text-blue-600 rounded"
                        />
                        <span className="text-sm text-gray-600">
                          {t('全选')} ({selectedArticleSlugs.size}/{articles.length})
                        </span>
                      </div>
                    </div>
                  )}
                  <div className="space-y-4">
                    {articles.map((article) => (
                      <div
                        key={article.slug}
                        onClick={() => handleToggleSelect(article.slug)}
                        className={`bg-white rounded-lg shadow-sm p-4 sm:p-6 hover:shadow-md transition relative cursor-pointer ${!article.is_visible && isAdmin ? 'opacity-60' : ''} ${selectedArticleSlugs.has(article.slug) ? 'ring-2 ring-primary ring-offset-2' : ''}`}
                      >
                         {isAdmin && !isMobile && (
                           <div className="absolute top-3 right-3 flex items-center gap-1">
                            <IconButton
                              onClick={(e) => { e.stopPropagation(); handleToggleVisibility(article.slug, article.is_visible); }}
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
                              onClick={(e) => { e.stopPropagation(); handleDelete(article.slug); }}
                              variant="danger"
                              size="sm"
                              title={t('删除')}
                            >
                              <IconTrash className="h-4 w-4" />
                            </IconButton>
                          </div>
                        )}
                         <div className="flex flex-col sm:flex-row gap-4">
                           {isAdmin && !isMobile && (
                             <input
                               type="checkbox"
                               checked={selectedArticleSlugs.has(article.slug)}
                               onChange={() => handleToggleSelect(article.slug)}
                               onClick={(e) => e.stopPropagation()}
                               className="w-4 h-4 text-blue-600 rounded mt-1"
                             />
                           )}
                           {article.top_image && (
                             <div className="relative w-full sm:w-40 aspect-video sm:aspect-square overflow-hidden rounded-lg bg-muted">
                               <img
                                 src={resolveMediaUrl(article.top_image)}
                                 alt={article.title}
                                 className="absolute inset-0 h-full w-full object-cover"
                               />
                               <span className="absolute left-2 top-2 rounded-sm bg-black/60 px-2 py-0.5 text-xs text-white">
                                 {getArticleLanguageTag(article)}
                               </span>
                             </div>
                           )}
                           <div className="flex-1 sm:pr-6">
                             <Link href={`/article/${article.slug}`} onClick={(e) => e.stopPropagation()}>
                               <h3 className="text-xl font-semibold text-gray-900 hover:text-blue-600 transition cursor-pointer">
                                 {article.title}
                               </h3>
                             </Link>
                              <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-gray-600">
                                {article.category && (
                                  <span 
                                    className="px-2 py-1 rounded"
                                    style={{
                                      backgroundColor: article.category.color ? `${article.category.color}20` : '#f3f4f6',
                                      color: article.category.color || '#4b5563',
                                    }}
                                  >
                                    {article.category.name}
                                  </span>
                                )}
                                {article.author && <span>{t('作者')}: {article.author}</span>}
                                <span>
                                 {t('发表时间')}：
                                  {article.published_at
                                    ? new Date(article.published_at).toLocaleDateString(
                                       language === 'en' ? 'en-US' : 'zh-CN',
                                     )
                                    : new Date(article.created_at).toLocaleDateString(
                                       language === 'en' ? 'en-US' : 'zh-CN',
                                     )}
                                </span>
                              </div>
                               {article.summary && (
                                 <p className="mt-2 text-gray-600 line-clamp-3">
                                   {article.summary}
                                 </p>
                               )}
                           </div>
                         </div>
                       </div>
                    ))}
                  </div>

                {!isMobile && (
                  <div className="mt-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                    <div className="flex flex-wrap items-center gap-2 text-sm text-gray-600">
                      <span>{t('每页显示')}</span>
                      <Select
                        value={pageSize}
                        onChange={(value) => { setPageSize(Number(value)); setPage(1); }}
                        className="select-modern-antd"
                        popupClassName="select-modern-dropdown"
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
                        {t('第')} {page} / {Math.ceil(total / pageSize) || 1} {t('页')}
                      </span>
                      <Button
                        onClick={() => setPage((p) => p + 1)}
                        disabled={articles.length < pageSize}
                        variant="secondary"
                        size="sm"
                      >
                        {t('下一页')}
                      </Button>
                      <div className="flex items-center gap-1 ml-2">
                        <span className="text-sm text-text-2">{t('跳转')}</span>
                        <input
                          type="number"
                          value={jumpToPage}
                          onChange={(e) => setJumpToPage(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && handleJumpToPage()}
                          className="w-16 px-2 py-1.5 text-sm border border-border rounded-sm focus:outline-none focus:ring-2 focus:ring-accent/20 text-center bg-surface"
                          min={1}
                          max={Math.ceil(total / pageSize) || 1}
                        />
                        <Button
                          onClick={handleJumpToPage}
                          variant="primary"
                          size="sm"
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
          setConfirmState((prev) => ({ ...prev, isOpen: false }));
          await action();
        }}
        onCancel={() => setConfirmState((prev) => ({ ...prev, isOpen: false }))}
      />
      {isMobile && (
        <>
          <button
            onClick={() => {
              setShowFilters(true);
              setShowMobileFilters(true);
            }}
            className="fixed right-4 top-24 flex items-center justify-center w-10 h-10 rounded-full bg-surface border border-border shadow-lg text-text-2 hover:text-text-1 hover:bg-muted transition z-50"
            title={t('高级筛选')}
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
                    onClick={() => setShowMobileFilters(false)}
                    className="text-text-3 hover:text-text-1 transition text-lg"
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
      {showCreateModal && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-2 sm:p-4"
          onClick={() => setShowCreateModal(false)}
        >
          <div
            className="bg-white rounded-lg shadow-xl w-full h-[95vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-4 border-b flex-shrink-0">
              <h3 className="text-lg font-semibold text-gray-900">
                {t('创建文章')}
              </h3>
              <button
                onClick={() => setShowCreateModal(false)}
                className="text-gray-500 hover:text-gray-700 text-xl"
              >
                ×
              </button>
            </div>

            <div className="flex-1 overflow-hidden">
              <div className="grid grid-cols-1 lg:grid-cols-2 h-full">
                <div className="p-4 flex flex-col h-full border-r border-gray-200">
                  <div className="space-y-4 flex-shrink-0">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        {t('标题')} <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="text"
                        value={createTitle}
                        onChange={(e) => setCreateTitle(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder={t('请输入文章标题')}
                      />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          {t('作者')}
                        </label>
                        <input
                          type="text"
                          value={createAuthor}
                          onChange={(e) => setCreateAuthor(e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                          placeholder={t('请输入作者')}
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          {t('分类')}
                        </label>
                        <Select
                          value={createCategoryId}
                          onChange={(value) => setCreateCategoryId(value)}
                          className="select-modern-antd w-full"
                          popupClassName="select-modern-dropdown"
                          options={[
                            { value: '', label: t('未分类') },
                            ...categories.map((category) => ({
                              value: category.id,
                              label: category.name,
                            })),
                          ]}
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        {t('来源 URL')}
                      </label>
                      <input
                        type="text"
                        value={createSourceUrl}
                        onChange={(e) => setCreateSourceUrl(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder={t('请输入来源链接')}
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        {t('头图 URL')}
                      </label>
                      <input
                        type="text"
                        value={createTopImage}
                        onChange={(e) => setCreateTopImage(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder={t('输入图片 URL')}
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        {t('内容（Markdown）')} <span className="text-red-500">*</span>
                      </label>
                    </div>
                  </div>

                  <textarea
                    ref={createTextareaRef}
                    value={createContent}
                    onChange={(e) => setCreateContent(e.target.value)}
                    onScroll={() => {
                      if (createTextareaRef.current && createPreviewRef.current) {
                        const textarea = createTextareaRef.current;
                        const preview = createPreviewRef.current;
                        const scrollRatio = textarea.scrollTop / (textarea.scrollHeight - textarea.clientHeight);
                        preview.scrollTop = scrollRatio * (preview.scrollHeight - preview.clientHeight);
                      }
                    }}
                    className="flex-1 w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-sm resize-none min-h-[200px]"
                    placeholder={t('在此输入 Markdown 内容...')}
                  />

                  <div className="flex justify-end gap-2 pt-4 border-t flex-shrink-0">
                    <button
                      onClick={() => setShowCreateModal(false)}
                      className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition"
                      disabled={createSaving}
                    >
                      {t('取消')}
                    </button>
                    <button
                      onClick={handleCreateArticle}
                      disabled={createSaving}
                      className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition disabled:opacity-50"
                    >
                      {createSaving ? t('保存中...') : t('创建')}
                    </button>
                  </div>
                </div>

                <div
                  ref={createPreviewRef}
                  onScroll={() => {
                    if (createTextareaRef.current && createPreviewRef.current) {
                      const textarea = createTextareaRef.current;
                      const preview = createPreviewRef.current;
                      const scrollRatio = preview.scrollTop / (preview.scrollHeight - preview.clientHeight);
                      textarea.scrollTop = scrollRatio * (textarea.scrollHeight - textarea.clientHeight);
                    }
                  }}
                  className="bg-gray-50 overflow-y-auto h-full hidden lg:block"
                >
                  <div className="max-w-3xl mx-auto bg-white min-h-full shadow-sm">
                    {createTopImage && (
                      <div className="relative w-full aspect-[21/9] overflow-hidden">
                        <img
                          src={resolveMediaUrl(createTopImage)}
                          alt={createTitle}
                          className="w-full h-full object-cover"
                          onError={(e) => {
                            (e.target as HTMLImageElement).style.display = 'none';
                          }}
                        />
                      </div>
                    )}
                    <article className="p-6">
                      <div
                        className="prose prose-sm max-w-none"
                        dangerouslySetInnerHTML={{ __html: marked(createContent || '') }}
                      />
                    </article>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <AppFooter />
      <BackToTop />
    </div>
  );
}
