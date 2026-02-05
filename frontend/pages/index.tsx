import { useState, useEffect, useMemo, useRef } from 'react';

import Head from 'next/head';
import { useRouter } from 'next/router';
import Link from 'next/link';
import { ConfigProvider, DatePicker, Select } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';

import { articleApi, categoryApi, Article, Category } from '@/lib/api';
import { useToast } from '@/components/Toast';
import { BackToTop } from '@/components/BackToTop';
import { IconEye, IconEyeOff, IconGlobe, IconLock, IconLogout, IconSearch, IconSettings, IconTag, IconTrash } from '@/components/icons';
import { useAuth } from '@/contexts/AuthContext';

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
  const { isAdmin, logout } = useAuth();
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
  const [selectedArticleIds, setSelectedArticleIds] = useState<Set<string>>(new Set());
  const [showFilters, setShowFilters] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [jumpToPage, setJumpToPage] = useState('');
  const [batchCategoryId, setBatchCategoryId] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [publishedStartDate, publishedEndDate] = publishedDateRange;
  const [createdStartDate, createdEndDate] = createdDateRange;

  const fetchArticles = async () => {
    setLoading(true);
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
      setArticles(response.data);
      setTotal(response.pagination.total);
    } catch (error) {
      console.error('Failed to fetch articles:', error);
    } finally {
      setLoading(false);
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
    if (selectedArticleIds.size === 0) return;
    try {
      await articleApi.batchUpdateVisibility(Array.from(selectedArticleIds), isVisible);
      showToast(isVisible ? '已批量设为可见' : '已批量设为隐藏');
      setSelectedArticleIds(new Set());
      fetchArticles();
      fetchCategoryStats();
    } catch (error) {
      console.error('Failed to batch update visibility:', error);
      showToast('操作失败', 'error');
    }
  };

  const handleBatchCategory = async () => {
    if (selectedArticleIds.size === 0) return;
    if (!batchCategoryId) {
      showToast('请选择分类', 'info');
      return;
    }
    const targetCategoryId = batchCategoryId === '__clear__' ? null : batchCategoryId;
    try {
      await articleApi.batchUpdateCategory(Array.from(selectedArticleIds), targetCategoryId);
      showToast('分类已更新');
      setBatchCategoryId('');
      setSelectedArticleIds(new Set());
      fetchArticles();
      fetchCategoryStats();
    } catch (error) {
      console.error('Failed to batch update category:', error);
      showToast('操作失败', 'error');
    }
  };

  const handleBatchDelete = async () => {
    if (selectedArticleIds.size === 0) return;
    if (!confirm('确定要删除选中的文章吗？此操作不可恢复')) return;
    try {
      await articleApi.batchDeleteArticles(Array.from(selectedArticleIds));
      showToast('删除成功');
      setSelectedArticleIds(new Set());
      fetchArticles();
      fetchCategoryStats();
    } catch (error) {
      console.error('Failed to batch delete articles:', error);
      showToast('删除失败', 'error');
    }
  };

  const activeFilters = useMemo(() => {
    const filters: string[] = [];
    const categoryName = categories.find((c) => c.id === selectedCategory)?.name;
    if (categoryName) filters.push(`分类：${categoryName}`);
    if (searchTerm) filters.push(`标题：${searchTerm}`);
    if (sourceDomain) filters.push(`来源：${sourceDomain}`);
    if (author) filters.push(`作者：${author}`);
    if (isAdmin && visibilityFilter) {
      filters.push(visibilityFilter === 'visible' ? '可见：是' : '可见：否');
    }
    if (publishedStartDate || publishedEndDate) {
      filters.push(`发表：${formatDate(publishedStartDate)} ~ ${formatDate(publishedEndDate)}`.trim());
    }
    if (createdStartDate || createdEndDate) {
      filters.push(`创建：${formatDate(createdStartDate)} ~ ${formatDate(createdEndDate)}`.trim());
    }
    if (sortBy === 'published_at_desc') filters.push('排序：发表时间倒序');
    if (sortBy === 'created_at_desc') filters.push('排序：创建时间倒序');
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

  const handleDelete = async (id: string) => {
    if (!confirm('确定要删除这篇文章吗？')) return;

    try {
      await articleApi.deleteArticle(id);
      showToast('删除成功');
      fetchArticles();
    } catch (error) {
      console.error('Failed to delete article:', error);
      showToast('删除失败', 'error');
    }
  };

  const handleToggleVisibility = async (id: string, currentVisibility: boolean) => {
    try {
      await articleApi.updateArticleVisibility(id, !currentVisibility);
      setArticles((prev) =>
        prev.map((a) => (a.id === id ? { ...a, is_visible: !currentVisibility } : a))
      );
      showToast(currentVisibility ? '已设为不可见' : '已设为可见');
    } catch (error) {
      console.error('Failed to toggle visibility:', error);
      showToast('操作失败', 'error');
    }
  };

  const handleToggleSelect = (id: string) => {
    setSelectedArticleIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleSelectAll = () => {
    if (selectedArticleIds.size === articles.length) {
      setSelectedArticleIds(new Set());
    } else {
      setSelectedArticleIds(new Set(articles.map((a) => a.id)));
    }
  };

  const handleExport = async () => {
    if (!isAdmin) {
      showToast('仅管理员可导出文章', 'info');
      return;
    }

    if (selectedArticleIds.size === 0) {
      showToast('请先选择要导出的文章', 'info');
      return;
    }

    try {
      const data = await articleApi.exportArticles(Array.from(selectedArticleIds));
      const blob = new Blob([data.content], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      
      const now = new Date();
      const timestamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
      
      const selectedArticles = articles.filter(a => selectedArticleIds.has(a.id));
      const categoryCount: Record<string, number> = {};
      selectedArticles.forEach(article => {
        const catName = article.category?.name || '未分类';
        categoryCount[catName] = (categoryCount[catName] || 0) + 1;
      });
      
      const categoryInfo = Object.entries(categoryCount)
        .map(([name, count]) => `${name}${count}篇`)
        .join('_');
      
      a.download = `${timestamp}_${categoryInfo}.md`;
      
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setSelectedArticleIds(new Set());
      showToast('导出成功');
    } catch (error) {
      console.error('Failed to export articles:', error);
      showToast('导出失败', 'error');
    }
  };

  const handleJumpToPage = () => {
    const pageNum = parseInt(jumpToPage);
    const totalPages = Math.ceil(total / pageSize) || 1;
    if (pageNum >= 1 && pageNum <= totalPages) {
      setPage(pageNum);
      setJumpToPage('');
    } else {
      showToast(`请输入1-${totalPages}之间的页码`, 'error');
    }
  };

  return (
    <div className="min-h-screen bg-app">
      <Head>
        <title>Lumina - 信息知识库</title>
      </Head>
      <nav className="bg-surface border-b border-border shadow-sm">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-text-1 flex items-center gap-2">
                <img src="/favicon.png" alt="Lumina" className="h-7 w-7" />
                <span>Lumina</span>
              </h1>
            </div>
            <div className="flex gap-2 items-center">
              {isAdmin && (
                <Link
                  href="/settings"
                  className="flex items-center gap-1 px-3 py-1 rounded-sm text-sm text-text-3 hover:text-text-1 hover:bg-muted transition"
                  title="设置"
                >
                  <IconSettings className="h-4 w-4" />
                  <span>设置</span>
                </Link>
              )}
              {isAdmin ? (
                <button
                  onClick={logout}
                  className="flex items-center gap-1 px-3 py-1 rounded-sm text-sm text-text-3 hover:text-red-600 hover:bg-red-50 transition"
                  title="退出登录"
                >
                  <IconLogout className="h-4 w-4" />
                  <span>退出</span>
                </button>
              ) : (
                <Link
                  href="/login"
                  className="flex items-center gap-1 px-3 py-1 rounded-sm text-sm text-text-3 hover:text-primary hover:bg-primary-soft transition"
                  title="管理员登录"
                >
                  <IconLock className="h-4 w-4" />
                  <span>登录</span>
                </Link>
              )}
            </div>
          </div>
        </div>
      </nav>

      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="flex gap-6">
          <aside className={`flex-shrink-0 transition-all duration-300 ${sidebarCollapsed ? 'w-12' : 'w-56'}`}>
            <div className="sticky top-4 bg-surface rounded-sm shadow-sm border border-border p-4 max-h-[calc(100vh-2rem)] overflow-y-auto">
              <div className="flex items-center justify-between mb-4">
                {!sidebarCollapsed && (
                  <h2 className="font-semibold text-text-1 inline-flex items-center gap-2">
                    <IconTag className="h-4 w-4" />
                    <span>分类筛选</span>
                  </h2>
                )}
                <button
                  onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
                  className="text-text-3 hover:text-text-2 transition"
                  title={sidebarCollapsed ? '展开' : '收起'}
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
                    全部文章 ({categoryStats.reduce((sum, c) => sum + c.article_count, 0)})
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
            <div className="bg-surface rounded-sm shadow-sm border border-border p-6 mb-6">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setShowFilters(!showFilters)}
                      className={`px-4 py-1 text-sm rounded-sm transition ${showFilters ? 'bg-primary-soft text-primary-ink' : 'bg-muted text-text-2 hover:bg-surface'}`}
                    >
                      <span className="inline-flex items-center gap-2">
                        <IconSearch className="h-4 w-4" />
                        <span>高级筛选</span>
                      </span>
                    </button>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-4">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-text-2">创建时间：</span>
                    <Select
                      value={quickDateFilter}
                      onChange={(value) => handleQuickDateChange(value as QuickDateOption)}
                      className="select-modern-antd w-20"
                      popupClassName="select-modern-dropdown"
                      options={[
                        { value: '', label: '全部' },
                        { value: '1d', label: '1天内' },
                        { value: '3d', label: '3天内' },
                        { value: '1w', label: '1周内' },
                        { value: '1m', label: '1个月' },
                        { value: '3m', label: '3个月' },
                        { value: '6m', label: '6个月' },
                        { value: '1y', label: '1年内' },
                      ]}
                    />
                </div>
                  {isAdmin && (
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-text-2">可见：</span>
                      <Select
                        value={visibilityFilter}
                        onChange={(value) => { setVisibilityFilter(value); setPage(1); }}
                        className="select-modern-antd"
                        popupClassName="select-modern-dropdown"
                        options={[
                          { value: '', label: '全部' },
                          { value: 'visible', label: '可见' },
                          { value: 'hidden', label: '隐藏' },
                        ]}
                      />
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-text-2">排序：</span>
                    <Select
                      value={sortBy}
                      onChange={(value) => { setSortBy(value); setPage(1); }}
                      className="select-modern-antd"
                      popupClassName="select-modern-dropdown"
                      options={[
                        { value: 'published_at_desc', label: '发表时间倒序' },
                        { value: 'created_at_desc', label: '创建时间倒序' },
                      ]}
                    />
                  </div>
                </div>
              </div>

              {showFilters && (
                <div className="mt-4 pt-4 border-t border-border">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                    <div>
                      <label className="block text-sm text-text-2 mb-1">文章标题</label>
                      <input
                        type="text"
                        placeholder="模糊匹配标题..."
                        value={searchTerm}
                        onChange={(e) => { setSearchTerm(e.target.value); setPage(1); }}
                        className="w-full px-3 py-2 text-sm border border-border-strong rounded-sm focus:outline-none focus:ring-2 focus:ring-primary"
                      />
                    </div>
                    <div>
                      <label className="block text-sm text-text-2 mb-1">来源</label>
                      <Select
                        value={sourceDomain}
                        onChange={(value) => { setSourceDomain(value); setPage(1); }}
                        className="select-modern-antd w-full"
                        popupClassName="select-modern-dropdown"
                        options={[{ value: '', label: '全部来源' }, ...sources.map((s) => ({ value: s, label: s }))]}
                      />
                    </div>
                    <div>
                      <label className="block text-sm text-text-2 mb-1">作者</label>
                      <Select
                        value={author}
                        onChange={(value) => { setAuthor(value); setPage(1); }}
                        className="select-modern-antd w-full"
                        popupClassName="select-modern-dropdown"
                        options={[{ value: '', label: '全部作者' }, ...authors.map((a) => ({ value: a, label: a }))]}
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-2">
                    <div>
                      <label className="block text-sm text-text-2 mb-1">发表时间</label>
                      <ConfigProvider
                        theme={{
                          token: {
                            colorPrimary: '#3B82F6',
                            borderRadius: 4,
                            fontSize: 14,
                            controlHeight: 36,
                          },
                        }}
                      >
                        <DatePicker.RangePicker
                          value={toDayjsRange(publishedDateRange)}
                          onChange={(values: [Dayjs | null, Dayjs | null] | null) => {
                            const [start, end] = values || [];
                            setPublishedDateRange([start ? start.toDate() : null, end ? end.toDate() : null]);
                            setPage(1);
                          }}
                          className="w-full"
                          size="middle"
                          allowClear
                          placeholder={['开始日期', '结束日期']}
                          format="YYYY-MM-DD"
                          style={{ height: 36, width: '100%', minWidth: 0 }}
                        />
                      </ConfigProvider>
                    </div>
                    <div>
                      <label className="block text-sm text-text-2 mb-1">创建时间</label>
                      <ConfigProvider
                        theme={{
                          token: {
                            colorPrimary: '#3B82F6',
                            borderRadius: 4,
                            fontSize: 14,
                            controlHeight: 36,
                          },
                        }}
                      >
                        <DatePicker.RangePicker
                          value={toDayjsRange(createdDateRange)}
                          onChange={(values: [Dayjs | null, Dayjs | null] | null) => {
                            const [start, end] = values || [];
                            setCreatedDateRange([start ? start.toDate() : null, end ? end.toDate() : null]);
                            setQuickDateFilter('');
                            setPage(1);
                          }}
                          className="w-full"
                          size="middle"
                          allowClear
                          placeholder={['开始日期', '结束日期']}
                          format="YYYY-MM-DD"
                          style={{ height: 36, width: '100%', minWidth: 0 }}
                        />
                      </ConfigProvider>
                    </div>
                    <div className="hidden md:block" />
                  </div>
                </div>
              )}

              <div className="mt-4 pt-4 border-t border-border">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap gap-2">
                    {activeFilters.length === 0 ? (
                      <span className="text-sm text-text-3">暂无筛选条件</span>
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
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleClearFilters}
                      className={`px-3 py-1 text-sm rounded-lg transition ${activeFilters.length === 0 ? 'bg-gray-50 text-gray-400 cursor-not-allowed' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
                      disabled={activeFilters.length === 0}
                    >
                      清除筛选
                    </button>
                  </div>
                </div>
              </div>
              {isAdmin && selectedArticleIds.size > 0 && (
                <div className="mt-4 pt-4 border-t border-gray-200">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="text-sm text-gray-600">已选 {selectedArticleIds.size} 篇</span>
                      <button
                        onClick={handleExport}
                        className="px-3 py-1 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 transition"
                      >
                        导出选中 ({selectedArticleIds.size})
                      </button>
                    </div>
                    {isAdmin && (
                      <div className="flex flex-wrap items-center gap-3">
                        <button
                          type="button"
                          onClick={() => handleBatchVisibility(true)}
                          className="px-3 py-1 text-sm bg-green-50 text-green-700 rounded-lg hover:bg-green-100 transition"
                        >
                          设为可见
                        </button>
                        <button
                          type="button"
                          onClick={() => handleBatchVisibility(false)}
                          className="px-3 py-1 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition"
                        >
                          设为隐藏
                        </button>
                        <div className="flex items-center gap-2">
                          <Select
                            value={batchCategoryId}
                            onChange={(value) => setBatchCategoryId(value)}
                            className="select-modern-antd"
                            popupClassName="select-modern-dropdown"
                            options={[
                              { value: '', label: '选择分类' },
                              { value: '__clear__', label: '清空分类' },
                              ...categories.map((category) => ({ value: category.id, label: category.name })),
                            ]}
                          />
                          <button
                            type="button"
                            onClick={handleBatchCategory}
                            className="px-3 py-1 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
                          >
                            应用分类
                          </button>
                        </div>
                        <button
                          type="button"
                          onClick={handleBatchDelete}
                          className="px-3 py-1 text-sm bg-red-50 text-red-600 rounded-lg hover:bg-red-100 transition"
                        >
                          批量删除
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {loading ? (
              <div className="text-center py-12 text-gray-500">加载中...</div>
            ) : articles.length === 0 ? (
              <div className="text-center py-12 text-gray-500">暂无文章</div>
             ) : (
                <> 
                  {isAdmin && (
                    <div className="mb-4">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={selectedArticleIds.size === articles.length}
                          onChange={handleSelectAll}
                          className="w-4 h-4 text-blue-600 rounded"
                        />
                        <span className="text-sm text-gray-600">全选 ({selectedArticleIds.size}/{articles.length})</span>
                      </label>
                    </div>
                  )}
                  <div className="space-y-4">
                    {articles.map((article) => (
                       <div
                         key={article.id}
                         className={`bg-white rounded-lg shadow-sm p-6 hover:shadow-md transition relative ${!article.is_visible && isAdmin ? 'opacity-60' : ''}`}
                       >
                         {isAdmin && (
                           <div className="absolute top-3 right-3 flex items-center gap-1">
                            <button
                              onClick={() => handleToggleVisibility(article.id, article.is_visible)}
                              className={`w-6 h-6 flex items-center justify-center rounded transition ${
                                article.is_visible
                                  ? 'text-green-500 hover:text-green-700 hover:bg-green-50'
                                  : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'
                              }`}
                              title={article.is_visible ? '点击隐藏' : '点击显示'}
                            >
                              {article.is_visible ? (
                                <IconEye className="h-4 w-4" />
                              ) : (
                                <IconEyeOff className="h-4 w-4" />
                              )}
                            </button>
                            <button
                              onClick={() => handleDelete(article.id)}
                              className="w-6 h-6 flex items-center justify-center text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition"
                              title="删除"
                            >
                              <IconTrash className="h-4 w-4" />
                            </button>
                          </div>
                        )}
                         <div className="flex gap-4">
                           {isAdmin && (
                             <input
                               type="checkbox"
                               checked={selectedArticleIds.has(article.id)}
                               onChange={() => handleToggleSelect(article.id)}
                               className="w-4 h-4 text-blue-600 rounded mt-1"
                             />
                           )}
                          {article.top_image && (
                            <img
                              src={article.top_image}
                              alt={article.title}
                              className="w-32 h-32 object-cover rounded-lg"
                            />
                          )}
                          <div className="flex-1 pr-6">
                            <Link href={`/article/${article.id}`}>
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
                                {article.source_domain && (
                                  <span className="px-2 py-1 bg-gray-100 rounded text-gray-600 inline-flex items-center gap-1">
                                    <IconGlobe className="h-3.5 w-3.5" />
                                    {article.source_domain}
                                  </span>
                                )}
                               {article.author && <span>作者: {article.author}</span>}
                               <span>
                                发表时间：
                                 {article.published_at
                                   ? new Date(article.published_at).toLocaleDateString('zh-CN')
                                   : new Date(article.created_at).toLocaleDateString('zh-CN')}
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

                <div className="mt-6 flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm text-gray-600">
                    <span>每页显示</span>
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
                    <span>条，共 {total} 条</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      disabled={page === 1}
                      className="px-4 py-2 text-sm bg-white border rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      上一页
                    </button>
                    <span className="px-4 py-2 text-sm bg-white border rounded-lg">
                      第 {page} / {Math.ceil(total / pageSize) || 1} 页
                    </span>
                    <button
                      onClick={() => setPage((p) => p + 1)}
                      disabled={articles.length < pageSize}
                      className="px-4 py-2 text-sm bg-white border rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      下一页
                    </button>
                    <div className="flex items-center gap-1 ml-2">
                      <span className="text-sm text-gray-600">跳转</span>
                      <input
                        type="number"
                        value={jumpToPage}
                        onChange={(e) => setJumpToPage(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleJumpToPage()}
                        className="w-16 px-2 py-1 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-center"
                        min={1}
                        max={Math.ceil(total / pageSize) || 1}
                      />
                      <button
                        onClick={handleJumpToPage}
                        className="px-3 py-1 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition text-sm"
                      >
                        GO
                      </button>
                    </div>
                  </div>
                </div>
              </>
            )}
          </main>
        </div>
      </div>
      <BackToTop />
    </div>
  );
}
