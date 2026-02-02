import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { articleApi, type ArticleDetail } from '@/lib/api';
import Link from 'next/link';
import { marked } from 'marked';

export default function ArticleDetailPage() {
  const router = useRouter();
  const { id } = router.query;
  const [article, setArticle] = useState<ArticleDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [showTranslation, setShowTranslation] = useState(false);
  const [analysisCollapsed, setAnalysisCollapsed] = useState(false);

  useEffect(() => {
    if (id) {
      fetchArticle();
    }
  }, [id]);

  const fetchArticle = async () => {
    setLoading(true);
    try {
      const data = await articleApi.getArticle(id as string);
      setArticle(data);
    } catch (error) {
      console.error('Failed to fetch article:', error);
      alert('加载文章失败');
    } finally {
      setLoading(false);
    }
  };

  const handleRetry = async () => {
    if (!id || !article) return;

    try {
      await articleApi.retryArticle(id as string);
      setArticle({ ...article, status: 'pending' });
      fetchArticle();
    } catch (error) {
      console.error('Failed to retry article:', error);
      alert('重试失败');
    }
  };

  const handleDelete = async () => {
    if (!id) return;
    if (!confirm('确定要删除这篇文章吗？')) return;

    try {
      await articleApi.deleteArticle(id as string);
      router.push('/');
    } catch (error) {
      console.error('Failed to delete article:', error);
      alert('删除失败');
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-gray-500">加载中...</div>
      </div>
    );
  }

  if (!article) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-gray-500">文章不存在</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
       <nav className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between mb-3">
            <Link href="/" className="text-blue-600 hover:text-blue-700 transition">
              ← 返回列表
            </Link>
            <h1 className="text-xl font-bold text-gray-900 truncate">{article.title}</h1>
            <button
              onClick={handleDelete}
              className="text-gray-400 hover:text-red-600 transition"
              title="删除文章"
            >
              ✕
            </button>
          </div>
          <div className="flex flex-wrap gap-4 text-sm text-gray-600 pb-3 border-b border-gray-100">
            {article.author && (
              <div>
                <span className="font-medium text-gray-700">作者：</span>
                <Link
                  href={`/?author=${encodeURIComponent(article.author)}`}
                  className="text-blue-600 hover:underline"
                >
                  {article.author}
                </Link>
              </div>
            )}
            {article.source_url && (
              <div>
                <span className="font-medium text-gray-700">来源：</span>
                <a
                  href={article.source_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:underline"
                >
                  点击查看
                </a>
              </div>
            )}
            <div>
              <span className="font-medium text-gray-700">发表时间：</span>
              {article.published_at
                ? new Date(article.published_at).toLocaleDateString('zh-CN')
                : new Date(article.created_at).toLocaleDateString('zh-CN')}
            </div>
          </div>
        </div>
      </nav>

        <div className="max-w-7xl mx-auto px-4 py-8 relative">
          <div className={`grid gap-6 ${analysisCollapsed ? 'grid-cols-1' : 'grid-cols-1 lg:grid-cols-2'}`}>
            <div className="bg-white rounded-lg shadow-sm p-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-lg font-semibold text-gray-900">📄 原文内容</h2>
                {article.content_trans && (
                  <button
                    onClick={() => setShowTranslation(!showTranslation)}
                    className="px-3 py-1 rounded-lg transition bg-blue-100 text-blue-700 hover:bg-blue-200"
                  >
                    {showTranslation ? '🇺🇸 原文' : '🇨🇳 翻译'}
                  </button>
                )}
              </div>

              <div className="prose prose-sm max-w-none">
                {showTranslation && article.content_trans ? (
                  <div
                    dangerouslySetInnerHTML={{
                      __html: marked(article.content_trans),
                    }}
                  />
                ) : article.content_md ? (
                  <div
                    dangerouslySetInnerHTML={{
                      __html: marked(article.content_md),
                    }}
                  />
                ) : (
                  <div
                    dangerouslySetInnerHTML={{
                      __html: article.content_html,
                    }}
                  />
                )}
              </div>
            </div>

             {!analysisCollapsed && (
            <div className="bg-white rounded-lg shadow-sm p-6">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                  <h2 className="text-lg font-semibold text-gray-900">🤖 AI 解读</h2>
                  <button
                    onClick={() => setAnalysisCollapsed(true)}
                    className="px-2 py-1 text-sm bg-gray-100 rounded hover:bg-gray-200 transition"
                  >
                    → 折叠
                  </button>
                </div>
              </div>

              {article.status === 'failed' && (
                <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
                  <h3 className="font-semibold text-red-900 mb-2">⚠️ AI 解读失败</h3>
                  {article.ai_analysis?.error_message && (
                    <div className="space-y-2">
                      <p className="text-red-700 text-sm">
                        错误原因：
                      </p>
                      <p className="text-red-700 text-sm font-mono bg-red-100 p-3 rounded">
                        {article.ai_analysis.error_message}
                      </p>
                    </div>
                  )}
                  <p className="text-red-700 text-sm mt-3">
                    请检查以下配置：
                  </p>
                  <ul className="text-red-700 text-sm list-disc list-inside ml-4 mt-2 space-y-1">
                    <li>API配置是否正确（API地址、密钥、模型名称）</li>
                    <li>API Key是否有效且有足够额度</li>
                    <li>网络连接是否正常</li>
                    <li>点击"重新生成"按钮重试</li>
                  </ul>
                </div>
              )}

              <div className="mb-6">
                <div className="flex items-center gap-2 mb-2">
                  <h3 className="font-semibold text-gray-900">📝 摘要</h3>
                  {article.status === 'pending' && (
                    <span className="px-2 py-0.5 rounded text-xs bg-gray-100 text-gray-600">
                      等待处理
                    </span>
                  )}
                  {article.status === 'processing' && (
                    <span className="px-2 py-0.5 rounded text-xs bg-blue-100 text-blue-700">
                      处理中...
                    </span>
                  )}
                  {article.status === 'completed' && (
                    <span className="px-2 py-0.5 rounded text-xs bg-green-100 text-green-700">
                      已完成
                    </span>
                  )}
                  {article.status === 'failed' && (
                    <span className="px-2 py-0.5 rounded text-xs bg-red-100 text-red-700">
                      失败
                    </span>
                  )}
                  {(article.status === 'failed' || article.status === 'completed') && (
                    <button
                      onClick={handleRetry}
                      className="w-6 h-6 flex items-center justify-center text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-full transition"
                      title="重新生成"
                    >
                      🔄
                    </button>
                  )}
                </div>
                {article.ai_analysis?.summary ? (
                  <p className="text-gray-700">{article.ai_analysis.summary}</p>
                ) : (
                  <p className="text-gray-400 text-sm">暂无摘要</p>
                )}
              </div>
            </div>
            )}

          {analysisCollapsed && (
            <button
              onClick={() => setAnalysisCollapsed(false)}
              className="fixed right-8 top-1/2 transform -translate-y-1/2 px-4 py-3 bg-blue-600 text-white rounded-full shadow-lg hover:bg-blue-700 transition z-50"
              title="展开AI解读"
            >
              🤖 展开解读
            </button>
          )}
        </div>
      </div>
    </div>
  );
}