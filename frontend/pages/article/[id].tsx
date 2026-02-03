import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/router';
import { articleApi, type ArticleDetail, type ModelAPIConfig, type PromptConfig } from '@/lib/api';
import { useToast } from '@/components/Toast';
import { BackToTop } from '@/components/BackToTop';
import Link from 'next/link';
import { marked } from 'marked';

// 轮询间隔（毫秒）
const POLLING_INTERVAL = 3000;

interface AIContentSectionProps {
  title: string;
  content: string | null | undefined;
  status: string | null | undefined;
  onGenerate: () => void;
  onCopy: () => void;
}

function AIContentSection({ title, content, status, onGenerate, onCopy }: AIContentSectionProps) {
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
        {content && (
          <button
            onClick={onCopy}
            className="text-gray-400 hover:text-blue-600 transition"
            title="复制内容"
          >
            📋
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

interface ConfirmModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

function ConfirmModal({ isOpen, title, message, confirmText = '确定', cancelText = '取消', onConfirm, onCancel }: ConfirmModalProps) {
  if (!isOpen) return null;
  
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-sm w-full">
        <div className="p-4 border-b">
          <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
        </div>
        <div className="p-4">
          <p className="text-gray-600">{message}</p>
        </div>
        <div className="flex justify-end gap-2 p-4 border-t bg-gray-50 rounded-b-lg">
          <button
            onClick={onCancel}
            className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition"
          >
            {cancelText}
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition"
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}

interface TocItem {
  id: string;
  text: string;
  level: number;
}

function TableOfContents({ items, activeId }: { items: TocItem[]; activeId: string }) {
  if (items.length === 0) return null;

  return (
    <nav className="space-y-1">
      {items.map((item) => (
        <a
          key={item.id}
          href={`#${item.id}`}
          className={`block text-sm truncate transition ${
            activeId === item.id
              ? 'text-blue-600 font-medium'
              : 'text-gray-600 hover:text-gray-900'
          }`}
          style={{ paddingLeft: `${(item.level - 1) * 12}px` }}
        >
          {item.text}
        </a>
      ))}
    </nav>
  );
}

function ReadingProgress() {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const handleScroll = () => {
      const scrollTop = window.scrollY;
      const docHeight = document.documentElement.scrollHeight - window.innerHeight;
      const scrollPercent = docHeight > 0 ? (scrollTop / docHeight) * 100 : 0;
      setProgress(Math.min(100, Math.max(0, scrollPercent)));
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll();
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  return (
    <div className="fixed top-0 left-0 right-0 h-1 bg-gray-200 z-50">
      <div
        className="h-full bg-blue-600 transition-all duration-150"
        style={{ width: `${progress}%` }}
      />
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
  
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [configModalContentType, setConfigModalContentType] = useState<string>('');
  const [modelConfigs, setModelConfigs] = useState<ModelAPIConfig[]>([]);
  const [promptConfigs, setPromptConfigs] = useState<PromptConfig[]>([]);
  const [selectedModelConfigId, setSelectedModelConfigId] = useState<string>('');
  const [selectedPromptConfigId, setSelectedPromptConfigId] = useState<string>('');

  const [showEditModal, setShowEditModal] = useState(false);
  const [editMode, setEditMode] = useState<'original' | 'translation'>('original');
  const [editTitle, setEditTitle] = useState('');
  const [editAuthor, setEditAuthor] = useState('');
  const [editTopImage, setEditTopImage] = useState('');
  const [editContent, setEditContent] = useState('');
  const [saving, setSaving] = useState(false);

  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [tocItems, setTocItems] = useState<TocItem[]>([]);
  const [activeTocId, setActiveTocId] = useState('');
  const [tocCollapsed, setTocCollapsed] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const pollingRef = useRef<NodeJS.Timeout | null>(null);

  const needsPolling = useCallback((data: ArticleDetail | null): boolean => {
    if (!data) return false;
    const pendingStatuses = ['pending', 'processing'];
    if (pendingStatuses.includes(data.status)) return true;
    if (pendingStatuses.includes(data.translation_status || '')) return true;
    if (data.ai_analysis) {
      const { summary_status, key_points_status, outline_status, quotes_status } = data.ai_analysis;
      if (pendingStatuses.includes(summary_status || '')) return true;
      if (pendingStatuses.includes(key_points_status || '')) return true;
      if (pendingStatuses.includes(outline_status || '')) return true;
      if (pendingStatuses.includes(quotes_status || '')) return true;
    }
    return false;
  }, []);
  useEffect(() => {
    if (id) {
      fetchArticle();
    }
    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
      }
    };
  }, [id]);

  useEffect(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }

    if (needsPolling(article)) {
      pollingRef.current = setInterval(async () => {
        try {
          const data = await articleApi.getArticle(id as string);
          setArticle(data);
          if (!needsPolling(data) && pollingRef.current) {
            clearInterval(pollingRef.current);
            pollingRef.current = null;
          }
        } catch (error) {
          console.error('Polling failed:', error);
        }
      }, POLLING_INTERVAL);
    }
  }, [article, id, needsPolling]);

  useEffect(() => {
    if (!contentRef.current) return;

    const headings = contentRef.current.querySelectorAll('h1, h2, h3, h4, h5, h6');
    const items: TocItem[] = [];
    
    headings.forEach((heading, index) => {
      const id = `heading-${index}`;
      heading.id = id;
      items.push({
        id,
        text: heading.textContent || '',
        level: parseInt(heading.tagName[1]),
      });
    });
    
    setTocItems(items);
  }, [article, showTranslation]);

  useEffect(() => {
    if (tocItems.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setActiveTocId(entry.target.id);
          }
        });
      },
      { rootMargin: '-80px 0px -80% 0px' }
    );

    tocItems.forEach((item) => {
      const element = document.getElementById(item.id);
      if (element) observer.observe(element);
    });

    return () => observer.disconnect();
  }, [tocItems]);

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

  const fetchConfigs = async (contentType: string) => {
    try {
      const [models, prompts] = await Promise.all([
        articleApi.getModelAPIConfigs(),
        articleApi.getPromptConfigs(),
      ]);
      setModelConfigs(models.filter((m: ModelAPIConfig) => m.is_enabled));
      setPromptConfigs(prompts.filter((p: PromptConfig) => p.is_enabled && p.type === contentType));
    } catch (error) {
      console.error('Failed to fetch configs:', error);
    }
  };

  const openConfigModal = (contentType: string) => {
    setConfigModalContentType(contentType);
    setSelectedModelConfigId('');
    setSelectedPromptConfigId('');
    fetchConfigs(contentType);
    setShowConfigModal(true);
  };

  const handleConfigModalGenerate = async () => {
    if (!id || !article) return;
    setShowConfigModal(false);
    
    try {
      await articleApi.generateAIContent(
        id as string,
        configModalContentType,
        selectedModelConfigId || undefined,
        selectedPromptConfigId || undefined
      );
      if (article.ai_analysis) {
        setArticle({
          ...article,
          ai_analysis: {
            ...article.ai_analysis,
            [`${configModalContentType}_status`]: 'pending'
          }
        });
      }
      showToast('已提交生成请求');
    } catch (error: any) {
      console.error('Failed to generate:', error);
      showToast(error.response?.data?.detail || '生成失败', 'error');
    }
  };

  const handleRetryTranslation = async () => {
    if (!id || !article) return;

    try {
      await articleApi.retryTranslation(id as string);
      setArticle({ ...article, translation_status: 'pending' });
      showToast('已重新提交翻译请求');
    } catch (error: any) {
      console.error('Failed to retry translation:', error);
      showToast(error.response?.data?.detail || '重试翻译失败', 'error');
    }
  };

  const handleGenerateContent = (contentType: string) => {
    if (!id || !article) return;
    openConfigModal(contentType);
  };

  const handleDelete = async () => {
    if (!id) return;

    try {
      await articleApi.deleteArticle(id as string);
      showToast('删除成功');
      router.push('/');
    } catch (error) {
      console.error('Failed to delete article:', error);
      showToast('删除失败', 'error');
    }
  };

  const handleCopyContent = async (content: string | null | undefined, label: string) => {
    if (!content) return;
    try {
      await navigator.clipboard.writeText(content);
      showToast(`${label}已复制`);
    } catch (error) {
      console.error('Failed to copy:', error);
      showToast('复制失败', 'error');
    }
  };

  const openEditModal = (mode: 'original' | 'translation') => {
    if (!article) return;
    setEditMode(mode);
    setEditTitle(article.title || '');
    setEditAuthor(article.author || '');
    setEditTopImage(article.top_image || '');
    setEditContent(mode === 'translation' ? (article.content_trans || '') : (article.content_md || ''));
    setShowEditModal(true);
  };

  const handleSaveEdit = async () => {
    if (!id || !article) return;
    setSaving(true);

    try {
      const updateData: {
        title?: string;
        author?: string;
        top_image?: string;
        content_md?: string;
        content_trans?: string;
      } = {
        title: editTitle,
        author: editAuthor,
        top_image: editTopImage,
      };

      if (editMode === 'translation') {
        updateData.content_trans = editContent;
      } else {
        updateData.content_md = editContent;
      }

      await articleApi.updateArticle(id as string, updateData);
      showToast('保存成功');
      setShowEditModal(false);
      fetchArticle();
    } catch (error: any) {
      console.error('Failed to save article:', error);
      showToast(error.response?.data?.detail || '保存失败', 'error');
    } finally {
      setSaving(false);
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
      <ReadingProgress />
       <nav className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between mb-3">
            <Link href="/" className="text-blue-600 hover:text-blue-700 transition">
              ← 返回列表
            </Link>
            <h1 className="text-xl font-bold text-gray-900 truncate">{article.title}</h1>
            <button
              onClick={() => setShowDeleteModal(true)}
              className="text-gray-400 hover:text-red-600 transition"
              title="删除文章"
            >
              ✕
            </button>
          </div>
          <div className="flex flex-wrap gap-4 text-sm text-gray-600 pb-3 border-b border-gray-100">
            {article.category && (
              <div>
                <span className="font-medium text-gray-700">分类：</span>
                <Link
                  href={`/?category_id=${article.category.id}`}
                  className="inline-flex items-center gap-1"
                >
                  <span className="text-blue-600 hover:underline">{article.category.name}</span>
                </Link>
              </div>
            )}
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
            {tocItems.length > 0 && (
              <aside className={`hidden xl:block flex-shrink-0 transition-all duration-300 ${tocCollapsed ? 'w-12' : 'w-48'}`}>
                <div className="sticky top-4 bg-white rounded-lg shadow-sm p-4 max-h-[calc(100vh-2rem)] overflow-y-auto">
                  <div className="flex items-center justify-between mb-3">
                    {!tocCollapsed && <h3 className="text-sm font-semibold text-gray-900">📑 目录</h3>}
                    <button
                      onClick={() => setTocCollapsed(!tocCollapsed)}
                      className="text-gray-500 hover:text-gray-700 transition"
                      title={tocCollapsed ? '展开' : '收起'}
                    >
                      {tocCollapsed ? '»' : '«'}
                    </button>
                  </div>
                  {!tocCollapsed && <TableOfContents items={tocItems} activeId={activeTocId} />}
                </div>
              </aside>
            )}

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
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => openEditModal(showTranslation && article.content_trans ? 'translation' : 'original')}
                    className="text-gray-400 hover:text-blue-600 transition"
                    title={showTranslation && article.content_trans ? '编辑译文' : '编辑原文'}
                  >
                    ✏️
                  </button>
                  {article.content_trans && (
                    <button
                      onClick={() => setShowTranslation(!showTranslation)}
                      className="px-3 py-1 rounded-lg transition text-blue-700 hover:bg-blue-100"
                    >
                      {showTranslation ? '🇺🇸' : '🇨🇳'}
                    </button>
                  )}
                </div>
              </div>

              <div ref={contentRef} className="prose prose-sm max-w-none">
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
                      onCopy={() => handleCopyContent(article.ai_analysis?.summary, '摘要')}
                    />

                    <AIContentSection
                      title="🔑 关键内容"
                      content={article.ai_analysis?.key_points}
                      status={article.ai_analysis?.key_points_status}
                      onGenerate={() => handleGenerateContent('key_points')}
                      onCopy={() => handleCopyContent(article.ai_analysis?.key_points, '关键内容')}
                    />

                    <AIContentSection
                      title="📋 文章大纲"
                      content={article.ai_analysis?.outline}
                      status={article.ai_analysis?.outline_status}
                      onGenerate={() => handleGenerateContent('outline')}
                      onCopy={() => handleCopyContent(article.ai_analysis?.outline, '文章大纲')}
                    />

                    <AIContentSection
                      title="💬 文章金句"
                      content={article.ai_analysis?.quotes}
                      status={article.ai_analysis?.quotes_status}
                      onGenerate={() => handleGenerateContent('quotes')}
                      onCopy={() => handleCopyContent(article.ai_analysis?.quotes, '文章金句')}
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

      {showConfigModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full">
            <div className="flex items-center justify-between p-4 border-b">
              <h3 className="text-lg font-semibold text-gray-900">选择生成配置</h3>
              <button
                onClick={() => setShowConfigModal(false)}
                className="text-gray-500 hover:text-gray-700 text-xl"
              >
                ×
              </button>
            </div>

            <div className="p-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  模型配置
                </label>
                <select
                  value={selectedModelConfigId}
                  onChange={(e) => setSelectedModelConfigId(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">使用默认配置</option>
                  {modelConfigs.map((config) => (
                    <option key={config.id} value={config.id}>
                      {config.name} ({config.model_name})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  提示词配置
                </label>
                <select
                  value={selectedPromptConfigId}
                  onChange={(e) => setSelectedPromptConfigId(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">使用默认配置</option>
                  {promptConfigs.map((config) => (
                    <option key={config.id} value={config.id}>
                      {config.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex justify-end gap-2 p-4 border-t bg-gray-50 rounded-b-lg">
              <button
                onClick={() => setShowConfigModal(false)}
                className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition"
              >
                取消
              </button>
              <button
                onClick={handleConfigModalGenerate}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
              >
                生成
              </button>
            </div>
          </div>
        </div>
      )}

      {showEditModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between p-4 border-b">
              <h3 className="text-lg font-semibold text-gray-900">
                编辑文章{editMode === 'translation' ? '（译文）' : '（原文）'}
              </h3>
              <button
                onClick={() => setShowEditModal(false)}
                className="text-gray-500 hover:text-gray-700 text-xl"
              >
                ×
              </button>
            </div>

            <div className="p-4 space-y-4 overflow-y-auto flex-1">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  标题
                </label>
                <input
                  type="text"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  作者
                </label>
                <input
                  type="text"
                  value={editAuthor}
                  onChange={(e) => setEditAuthor(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  头图 URL
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={editTopImage}
                    onChange={(e) => setEditTopImage(e.target.value)}
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="输入图片 URL"
                  />
                </div>
                {editTopImage && (
                  <div className="mt-2">
                    <img
                      src={editTopImage}
                      alt="头图预览"
                      className="max-h-32 rounded-lg object-cover"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = 'none';
                      }}
                    />
                  </div>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  {editMode === 'translation' ? '译文内容' : '原文内容'}（Markdown）
                </label>
                <textarea
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  rows={15}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-sm"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 p-4 border-t bg-gray-50 rounded-b-lg">
              <button
                onClick={() => setShowEditModal(false)}
                className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition"
                disabled={saving}
              >
                取消
              </button>
              <button
                onClick={handleSaveEdit}
                disabled={saving}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition disabled:opacity-50"
              >
                {saving ? '保存中...' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmModal
        isOpen={showDeleteModal}
        title="删除文章"
        message="确定要删除这篇文章吗？此操作不可撤销。"
        confirmText="删除"
        cancelText="取消"
        onConfirm={() => {
          setShowDeleteModal(false);
          handleDelete();
        }}
        onCancel={() => setShowDeleteModal(false)}
      />

      <BackToTop />
    </div>
  );
}