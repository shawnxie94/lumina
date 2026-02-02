import { useState, useEffect } from 'react';
import { articleApi, categoryApi, Article, Category } from '@/lib/api';
import Link from 'next/link';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';

const formatDate = (date: Date | null): string => {
  if (!date) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export default function Home() {
  const [articles, setArticles] = useState<Article[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [authors, setAuthors] = useState<string[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [author, setAuthor] = useState<string>('');
  const [publishedDateRange, setPublishedDateRange] = useState<[Date | null, Date | null]>([null, null]);
  const [createdDateRange, setCreatedDateRange] = useState<[Date | null, Date | null]>([null, null]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [selectedArticleIds, setSelectedArticleIds] = useState<Set<string>>(new Set());
  const [showFilters, setShowFilters] = useState(false);

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
        author: author || undefined,
        published_at_start: formatDate(publishedStartDate) || undefined,
        published_at_end: formatDate(publishedEndDate) || undefined,
        created_at_start: formatDate(createdStartDate) || undefined,
        created_at_end: formatDate(createdEndDate) || undefined,
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

  const fetchAuthors = async () => {
    try {
      const data = await articleApi.getAuthors();
      setAuthors(data);
    } catch (error) {
      console.error('Failed to fetch authors:', error);
    }
  };

  useEffect(() => {
    fetchArticles();
  }, [page, pageSize, selectedCategory, searchTerm, author, publishedStartDate, publishedEndDate, createdStartDate, createdEndDate]);

  useEffect(() => {
    fetchCategories();
    fetchAuthors();
  }, []);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    fetchArticles();
  };

  const handleClearFilters = () => {
    setAuthor('');
    setPublishedDateRange([null, null]);
    setCreatedDateRange([null, null]);
    setPage(1);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('确定要删除这篇文章吗？')) return;

    try {
      await articleApi.deleteArticle(id);
      fetchArticles();
    } catch (error) {
      console.error('Failed to delete article:', error);
      alert('删除失败');
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
      alert('请先选择要导出的文章');
      return;
    }

    try {
      const data = await articleApi.exportArticles(Array.from(selectedArticleIds));
      const blob = new Blob([data.content], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = data.filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setSelectedArticleIds(new Set());
    } catch (error) {
      console.error('Failed to export articles:', error);
      alert('导出失败');
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-bold text-gray-900">📚 文章知识库</h1>
            <div className="flex gap-2">
              {selectedArticleIds.size > 0 && (
                <button
                  onClick={handleExport}
                  className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition"
                >
                  导出选中 ({selectedArticleIds.size})
                </button>
              )}
              <Link
                href="/settings"
                className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition"
              >
                ⚙️ 设置
              </Link>
            </div>
          </div>
        </div>
      </nav>

      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="flex gap-6">
          <aside className="w-64 flex-shrink-0">
            <div className="bg-white rounded-lg shadow-sm p-4">
              <h2 className="font-semibold text-gray-900 mb-4">🏷️ 分类筛选</h2>
              <div className="space-y-2">
                <button
                  onClick={() => setSelectedCategory('')}
                  className={`w-full text-left px-3 py-2 rounded-lg transition ${
                    selectedCategory === '' ? 'bg-blue-100 text-blue-700' : 'hover:bg-gray-100'
                  }`}
                >
                  全部文章
                </button>
                {categories.map((category) => (
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
            </div>
          </aside>

          <main className="flex-1">
            <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
              <form onSubmit={handleSearch} className="flex gap-4">
                <input
                  type="text"
                  placeholder="搜索文章标题..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button
                  type="submit"
                  className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
                >
                  搜索
                </button>
                <button
                  type="button"
                  onClick={() => setShowFilters(!showFilters)}
                  className={`px-4 py-2 rounded-lg transition ${showFilters ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
                >
                  🔍 更多筛选
                </button>
              </form>

              {showFilters && (
                <div className="mt-4 pt-4 border-t border-gray-200">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">发布时间</label>
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
                        onChange={(update) => { setCreatedDateRange(update); setPage(1); }}
                        isClearable
                        placeholderText="选择日期范围"
                        dateFormat="yyyy-MM-dd"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                        wrapperClassName="w-full"
                      />
                    </div>
                    <div className="flex items-end">
                      <button
                        type="button"
                        onClick={handleClearFilters}
                        className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition"
                      >
                        清除筛选
                      </button>
                    </div>
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
                       className="bg-white rounded-lg shadow-sm p-6 hover:shadow-md transition"
                     >
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
                         <div className="flex-1">
                           <Link href={`/article/${article.id}`}>
                             <h3 className="text-xl font-semibold text-gray-900 hover:text-blue-600 transition cursor-pointer">
                               {article.title}
                             </h3>
                           </Link>
                            <div className="mt-2 flex items-center gap-4 text-sm text-gray-600">
                              {article.category && (
                                <span className="px-2 py-1 bg-gray-100 rounded">
                                  {article.category.name}
                                </span>
                              )}
                              {article.author && <span>作者: {article.author}</span>}
                              <span>
                                {article.published_at
                                  ? new Date(article.published_at).toLocaleDateString('zh-CN')
                                  : new Date(article.created_at).toLocaleDateString('zh-CN')}
                              </span>
                            </div>
                            {article.summary && (
                              <div className="relative group">
                                <p className="mt-2 text-gray-600 line-clamp-2 cursor-pointer">
                                  {article.summary}
                                </p>
                                <div className="absolute left-0 top-full mt-2 z-50 hidden group-hover:block w-full max-w-xl">
                                  <div className="bg-gray-900 text-white text-sm rounded-lg p-4 shadow-lg">
                                    {article.summary}
                                  </div>
                                </div>
                              </div>
                            )}
                           <div className="mt-4 flex gap-2">
                             <Link
                               href={`/article/${article.id}`}
                               className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
                             >
                               查看详情
                             </Link>
                             <button
                               onClick={() => handleDelete(article.id)}
                               className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition"
                             >
                               删除
                             </button>
                           </div>
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
                  <div className="flex gap-2">
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
                  </div>
                </div>
              </>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}