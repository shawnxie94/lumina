import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { articleApi, type ArticleDetail } from '@/lib/api';
import { useToast } from '@/components/Toast';
import { BackToTop } from '@/components/BackToTop';
import Link from 'next/link';
import { marked } from 'marked';

interface AIContentSectionProps {
  title: string;
  content: string | null | undefined;
  status: string | null | undefined;
  onGenerate: () => void;
}

function AIContentSection({ title, content, status, onGenerate }: AIContentSectionProps) {
  const getStatusBadge = () => {
    if (!status) return null;
    const statusConfig: Record<string, { bg: string; text: string; label: string }> = {
      pending: { bg: 'bg-gray-100', text: 'text-gray-600', label: '等待处理' },
      processing: { bg: 'bg-blue-100', text: 'text-blue-700', label: '生成中...' },
      completed: { bg: 'bg-green-100', text: 'text-green-700', label: '已完成' },
      failed: { bg: 'bg-red-100', text: 'text-red-700', label: '失败' },
    };
    const config = statusConfig[status];
    if (!config) return null;
    return (
      <span className={`px-2 py-0.5 rounded text-xs ${config.bg} ${config.text}`}>
        {config.label}
      </span>
    );
  };

  const showGenerateButton = !status || status === 'completed' || status === 'failed';

  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <h3 className="font-semibold text-gray-900">{title}</h3>
        {getStatusBadge()}
        {showGenerateButton && (
          <button
            onClick={onGenerate}
            className="text-gray-400 hover:text-blue-600 transition"
            title={content ? '重新生成' : '生成'}
          >
            {content ? '🔄' : '✨'}
          </button>
        )}
      </div>
      {content ? (
        <div className="text-gray-700 text-sm whitespace-pre-wrap">{content}</div>
      ) : (
        <p className="text-gray-400 text-sm">
          {status === 'processing' ? '正在生成...' : '点击 ✨ 生成'}
        </p>
      )}
    </div>
  );
}

export default function ArticleDetailPage() {
  const router = useRouter();
  const { showToast } = useToast();
  const { id } = router.query;
  const [article, setArticle] = useState<ArticleDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [showTranslation, setShowTranslation] = useState(true);
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
      showToast('加载文章失败', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleRetry = async () => {
    if (!id || !article) return;

    try {
      await articleApi.retryArticle(id as string);
      setArticle({ ...article, status: 'pending' });
      showToast('已重新提交生成请求');
      fetchArticle();
    } catch (error) {
      console.error('Failed to retry article:', error);
      showToast('重试失败', 'error');
    }
  };

  const handleRetryTranslation = async () => {
    if (!id || !article) return;

    try {
      await articleApi.retryTranslation(id as string);
      setArticle({ ...article, translation_status: 'pending' });
      showToast('已重新提交翻译请求');
      fetchArticle();
    } catch (error: any) {
      console.error('Failed to retry translation:', error);
      showToast(error.response?.data?.detail || '重试翻译失败', 'error');
    }
  };

  const handleGenerateContent = async (contentType: string) => {
    if (!id || !article) return;

    try {
      await articleApi.generateAIContent(id as string, contentType);
      if (article.ai_analysis) {
        setArticle({
          ...article,
          ai_analysis: {
            ...article.ai_analysis,
            [`${contentType}_status`]: 'pending'
          }
        });
      }
      showToast(`已提交${contentType === 'key_points' ? '关键内容' : contentType === 'outline' ? '文章大纲' : contentType === 'quotes' ? '文章金句' : '摘要'}生成请求`);
      setTimeout(fetchArticle, 1000);
    } catch (error: any) {
      console.error(`Failed to generate ${contentType}:`, error);
      showToast(error.response?.data?.detail || '生成失败', 'error');
    }
  };

  const handleDelete = async () => {
    if (!id) return;
    if (!confirm('确定要删除这篇文章吗？')) return;

    try {
      await articleApi.deleteArticle(id as string);
      showToast('删除成功');
      router.push('/');
    } catch (error) {
      console.error('Failed to delete article:', error);
      showToast('删除失败', 'error');
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

        <div className="max-w-7xl mx-auto px-4 py-8">
          <div className="flex gap-6">
            <div className="flex-1 bg-white rounded-lg shadow-sm p-6">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-semibold text-gray-900">📄 原文内容</h2>
                  {article.translation_status && (
                    <>
                      <span className={`px-2 py-0.5 rounded text-xs ${
                        article.translation_status === 'completed' ? 'bg-green-100 text-green-700' :
                        article.translation_status === 'processing' ? 'bg-blue-100 text-blue-700' :
                        article.translation_status === 'pending' ? 'bg-gray-100 text-gray-600' :
                        article.translation_status === 'failed' ? 'bg-red-100 text-red-700' : ''
                      }`}>
                        {article.translation_status === 'completed' ? '翻译完成' :
                         article.translation_status === 'processing' ? '翻译中...' :
                         article.translation_status === 'pending' ? '等待翻译' :
                         article.translation_status === 'failed' ? '翻译失败' : ''}
                      </span>
                      {(article.translation_status === 'completed' || article.translation_status === 'failed') && (
                        <button
                          onClick={handleRetryTranslation}
                          className="text-gray-400 hover:text-blue-600 transition"
                          title={article.translation_error || '重新翻译'}
                        >
                          🔄
                        </button>
                      )}
                    </>
                  )}
                </div>
                {article.content_trans && (
                  <button
                    onClick={() => setShowTranslation(!showTranslation)}
                    className="px-3 py-1 rounded-lg transition text-blue-700 hover:bg-blue-100"
                  >
                    {showTranslation ? '🇺🇸' : '🇨🇳'}
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

            <aside className={`flex-shrink-0 transition-all duration-300 ${analysisCollapsed ? 'w-12' : 'w-96'}`}>
              <div className="bg-white rounded-lg shadow-sm p-4 sticky top-4 max-h-[calc(100vh-2rem)] overflow-y-auto">
                <div className="flex items-center justify-between mb-4">
                  {!analysisCollapsed && <h2 className="text-lg font-semibold text-gray-900">🤖 AI 解读</h2>}
                  <button
                    onClick={() => setAnalysisCollapsed(!analysisCollapsed)}
                    className="text-gray-500 hover:text-gray-700 transition"
                    title={analysisCollapsed ? '展开' : '收起'}
                  >
                    {analysisCollapsed ? '«' : '»'}
                  </button>
                </div>

                {!analysisCollapsed && (
                  <div className="space-y-6">
                    <AIContentSection
                      title="📝 摘要"
                      content={article.ai_analysis?.summary}
                      status={article.ai_analysis?.summary_status || (article.status === 'completed' ? 'completed' : article.status)}
                      onGenerate={() => handleGenerateContent('summary')}
                    />

                    <AIContentSection
                      title="🔑 关键内容"
                      content={article.ai_analysis?.key_points}
                      status={article.ai_analysis?.key_points_status}
                      onGenerate={() => handleGenerateContent('key_points')}
                    />

                    <AIContentSection
                      title="📋 文章大纲"
                      content={article.ai_analysis?.outline}
                      status={article.ai_analysis?.outline_status}
                      onGenerate={() => handleGenerateContent('outline')}
                    />

                    <AIContentSection
                      title="💬 文章金句"
                      content={article.ai_analysis?.quotes}
                      status={article.ai_analysis?.quotes_status}
                      onGenerate={() => handleGenerateContent('quotes')}
                    />

                    {article.ai_analysis?.error_message && (
                      <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
                        <p className="text-red-700 text-sm">{article.ai_analysis.error_message}</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </aside>
          </div>
        </div>
      <BackToTop />
    </div>
  );
}