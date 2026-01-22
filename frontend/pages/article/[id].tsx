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
      alert('已提交重新生成AI分析请求');
      fetchArticle();
    } catch (error) {
      console.error('Failed to retry article:', error);
      alert('重试失败');
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
            <div className="w-20"></div>
          </div>
          <div className="flex flex-wrap gap-4 text-sm text-gray-600 pb-3 border-b border-gray-100">
            {article.author && (
              <div>
                <span className="font-medium text-gray-700">作者：</span>
                {article.author}
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
              <span className="font-medium text-gray-700">创建时间：</span>
              {new Date(article.created_at).toLocaleString('zh-CN')}
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
                {(article.status === 'failed' || article.status === 'completed') && (
                  <button
                    onClick={handleRetry}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition text-sm"
                  >
                    重新生成
                  </button>
                )}
              </div>

              {article.status === 'failed' && (
                <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
                  <h3 className="font-semibold text-red-900 mb-2">⚠️ AI 解读失败</h3>
                  <p className="text-red-700 text-sm">
                    文章AI分析生成失败，请检查API配置是否正确，或点击"重新生成"按钮重试。
                  </p>
                </div>
              )}

              {article.ai_analysis?.summary && (
                <div className="mb-6">
                  <h3 className="font-semibold text-gray-900 mb-2">📝 摘要</h3>
                  <p className="text-gray-700">{article.ai_analysis.summary}</p>
                </div>
              )}

              {article.status === 'completed' && article.ai_analysis?.summary && (
                <div className="mt-6 pt-6 border-t">
                  <h3 className="font-semibold text-gray-900 mb-2">📊 处理信息</h3>
                  <div className="space-y-2 text-sm text-gray-600">
                    <div>
                      <span className="font-medium">状态：</span>
                      <span className="px-2 py-1 rounded bg-green-100 text-green-700">
                        已完成
                      </span>
                    </div>
                  </div>
                </div>
              )}
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