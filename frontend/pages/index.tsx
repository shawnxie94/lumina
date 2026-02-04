import { useState, useEffect } from 'react';

import { useRouter } from 'next/router';
import Link from 'next/link';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';

import { articleApi, categoryApi, Article, Category } from '@/lib/api';
import { useToast } from '@/components/Toast';
import { BackToTop } from '@/components/BackToTop';
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
  const [sortBy, setSortBy] = useState<string>('created_at_desc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [initialized, setInitialized] = useState(false);
  const [selectedArticleIds, setSelectedArticleIds] = useState<Set<string>>(new Set());
  const [showFilters, setShowFilters] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [jumpToPage, setJumpToPage] = useState('');

  const [publishedStartDate, publishedEndDate] = publishedDateRange;
  const [createdStartDate, createdEndDate] = createdDateRange;

  const fetchArticles = async () => {
    setLoading(true);
    try {
      const response = await articleApi.getArticles({
        page,
        size: pageSize,
        category_id: selectedCategory || undefined,
        search: searchTerm || undefined,
        source_domain: sourceDomain || undefined,
        author: author || undefined,
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
    if (initialized) {
      fetchArticles();
      fetchCategoryStats();
    }
  }, [initialized, page, pageSize, selectedCategory, searchTerm, sourceDomain, author, publishedStartDate, publishedEndDate, createdStartDate, createdEndDate, sortBy]);

  useEffect(() => {
    if (router.isReady) {
      const { author: authorParam } = router.query;
      if (authorParam && typeof authorParam === 'string') {
        setAuthor(authorParam);
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

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    fetchArticles();
  };

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
    setPage(1);
  };

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
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-bold text-gray-900">📚 文章知识库</h1>
            <div className="flex gap-2 items-center">
              {selectedArticleIds.size > 0 && (
                <button
                  onClick={handleExport}
                  className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition"
                >
                  导出选中 ({selectedArticleIds.size})
                </button>
              )}
              {isAdmin && (
                <Link
                  href="/settings"
                  className="w-9 h-9 flex items-center justify-center text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition"
                  title="设置"
                >
                  ⚙️
                </Link>
              )}
              {isAdmin ? (
                <button
                  onClick={logout}
                  className="w-9 h-9 flex items-center justify-center text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition"
                  title="退出登录"
                >
                  🚪
                </button>
              ) : (
                <Link
                  href="/login"
                  className="w-9 h-9 flex items-center justify-center text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition"
                  title="管理员登录"
                >
                  🔐
                </Link>
              )}
            </div>
          </div>
        </div>
      </nav>

      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="flex gap-6">
          <aside className={`flex-shrink-0 transition-all duration-300 ${sidebarCollapsed ? 'w-12' : 'w-64'}`}>
            <div className="sticky top-4 bg-white rounded-lg shadow-sm p-4 max-h-[calc(100vh-2rem)] overflow-y-auto">
              <div className="flex items-center justify-between mb-4">
                {!sidebarCollapsed && <h2 className="font-semibold text-gray-900">🏷️ 分类筛选</h2>}
                <button
                  onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
                  className="text-gray-500 hover:text-gray-700 transition"
                  title={sidebarCollapsed ? '展开' : '收起'}
                >
                  {sidebarCollapsed ? '»' : '«'}
                </button>
              </div>
              {!sidebarCollapsed && (
                <div className="space-y-2">
                  <button
                    onClick={() => setSelectedCategory('')}
                    className={`w-full text-left px-3 py-2 rounded-lg transition ${
                      selectedCategory === '' ? 'bg-blue-100 text-blue-700' : 'hover:bg-gray-100'
                    }`}
                  >
                    全部文章 ({categoryStats.reduce((sum, c) => sum + c.article_count, 0)})
                  </button>
                  {categoryStats.map((category) => (
                    <button
                      key={category.id}
                      onClick={() => setSelectedCategory(category.id)}
                      className={`w-full text-left px-3 py-2 rounded-lg transition ${
                        selectedCategory === category.id ? 'bg-blue-100 text-blue-700' : 'hover:bg-gray-100'
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
            <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
              <div className="flex flex-wrap items-center justify-end gap-4">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-600">创建时间：</span>
                  <select
                    value={quickDateFilter}
                    onChange={(e) => handleQuickDateChange(e.target.value as QuickDateOption)}
                    className="px-3 py-1 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">全部</option>
                    <option value="1d">1天内</option>
                    <option value="3d">3天内</option>
                    <option value="1w">1周内</option>
                    <option value="1m">1个月</option>
                    <option value="3m">3个月</option>
                    <option value="6m">6个月</option>
                    <option value="1y">1年内</option>
                  </select>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-600">排序：</span>
                  <select
                    value={sortBy}
                    onChange={(e) => { setSortBy(e.target.value); setPage(1); }}
                    className="px-3 py-1 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="published_at_desc">发表时间倒序</option>
                    <option value="created_at_desc">创建时间倒序</option>
                  </select>
                </div>
                <button
                  type="button"
                  onClick={() => setShowFilters(!showFilters)}
                  className={`px-4 py-1 text-sm rounded-lg transition ${showFilters ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
                >
                  🔍 高级筛选
                </button>
              </div>

              {showFilters && (
                <div className="mt-4 pt-4 border-t border-gray-200">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">文章标题</label>
                      <input
                        type="text"
                        placeholder="模糊匹配标题..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">来源</label>
                      <select
                        value={sourceDomain}
                        onChange={(e) => { setSourceDomain(e.target.value); setPage(1); }}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        <option value="">全部来源</option>
                        {sources.map((s) => (
                          <option key={s} value={s}>{s}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">作者</label>
                      <select
                        value={author}
                        onChange={(e) => { setAuthor(e.target.value); setPage(1); }}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        <option value="">全部作者</option>
                        {authors.map((a) => (
                          <option key={a} value={a}>{a}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">发表时间</label>
                      <DatePicker
                        selectsRange
                        startDate={publishedStartDate}
                        endDate={publishedEndDate}
                        onChange={(update) => { setPublishedDateRange(update); setPage(1); }}
                        isClearable
                        placeholderText="选择日期范围"
                        dateFormat="yyyy-MM-dd"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                        wrapperClassName="w-full"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">创建时间</label>
                      <DatePicker
                        selectsRange
                        startDate={createdStartDate}
                        endDate={createdEndDate}
                        onChange={(update) => { setCreatedDateRange(update); setQuickDateFilter(''); setPage(1); }}
                        isClearable
                        placeholderText="选择日期范围"
                        dateFormat="yyyy-MM-dd"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                        wrapperClassName="w-full"
                      />
                    </div>
                  </div>
                  <div className="mt-4 flex justify-end">
                    <button
                      type="button"
                      onClick={handleClearFilters}
                      className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition"
                    >
                      清除筛选
                    </button>
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
                              {article.is_visible ? '👁️' : '👁️‍🗨️'}
                            </button>
                            <button
                              onClick={() => handleDelete(article.id)}
                              className="w-6 h-6 flex items-center justify-center text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition"
                              title="删除"
                            >
                              ✕
                            </button>
                          </div>
                        )}
                        <div className="flex gap-4">
                          <input
                            type="checkbox"
                            checked={selectedArticleIds.has(article.id)}
                            onChange={() => handleToggleSelect(article.id)}
                            className="w-4 h-4 text-blue-600 rounded mt-1"
                          />
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
                                 <span className="px-2 py-1 bg-gray-100 rounded text-gray-600">
                                   🌐 {article.source_domain}
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
                    <select
                      value={pageSize}
                      onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}
                      className="px-2 py-1 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value={10}>10</option>
                      <option value={20}>20</option>
                      <option value={50}>50</option>
                      <option value={100}>100</option>
                    </select>
                    <span>条，共 {total} 条</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      disabled={page === 1}
                      className="px-4 py-2 bg-white border rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      上一页
                    </button>
                    <span className="px-4 py-2 bg-white border rounded-lg">
                      第 {page} / {Math.ceil(total / pageSize) || 1} 页
                    </span>
                    <button
                      onClick={() => setPage((p) => p + 1)}
                      disabled={articles.length < pageSize}
                      className="px-4 py-2 bg-white border rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
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
                        className="w-16 px-2 py-1 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-center"
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
