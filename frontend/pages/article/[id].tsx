import Head from 'next/head';
import { useState, useEffect, useRef, useCallback } from 'react';

import { useRouter } from 'next/router';
import Link from 'next/link';
import { marked } from 'marked';

import { articleApi, type ArticleDetail, type ModelAPIConfig, type PromptConfig } from '@/lib/api';
import { useToast } from '@/components/Toast';
import { BackToTop } from '@/components/BackToTop';
import { IconBolt, IconBook, IconCopy, IconDoc, IconEdit, IconEye, IconEyeOff, IconList, IconRefresh, IconRobot, IconTrash } from '@/components/icons';
import { useAuth } from '@/contexts/AuthContext';
import { Select } from 'antd';

// 轮询间隔（毫秒）
const POLLING_INTERVAL = 3000;

interface AIContentSectionProps {
  title: string;
  content: string | null | undefined;
  status: string | null | undefined;
  onGenerate: () => void;
  onCopy: () => void;
  canEdit?: boolean;
  renderMarkdown?: boolean;
  renderMindMap?: boolean;
  onMindMapOpen?: () => void;
  showStatus?: boolean;
  statusLink?: string;
}

interface MindMapNode {
  title: string;
  children?: MindMapNode[];
}

function normalizeMindMapNode(input: unknown): MindMapNode | null {
  if (typeof input === 'string') {
    return { title: input };
  }
  if (!input || typeof input !== 'object') return null;
  const record = input as { title?: unknown; children?: unknown };
  const title = typeof record.title === 'string' ? record.title : '';
  const childrenRaw = Array.isArray(record.children) ? record.children : [];
  const children = childrenRaw
    .map((child) => normalizeMindMapNode(child))
    .filter((node): node is MindMapNode => Boolean(node && (node.title || node.children?.length)));
  return { title, children };
}

function parseMindMapOutline(content: string): MindMapNode | null {
  try {
    const parsed = JSON.parse(content) as unknown;
    if (Array.isArray(parsed)) {
      const children = parsed
        .map((child) => normalizeMindMapNode(child))
        .filter((node): node is MindMapNode => Boolean(node));
      return { title: '', children };
    }
    return normalizeMindMapNode(parsed);
  } catch {
    return null;
  }
}

function MindMapTree({ node, isRoot = false, compact = false, depth = 0 }: { node: MindMapNode; isRoot?: boolean; compact?: boolean; depth?: number }) {
  const hasTitle = node.title && node.title.trim().length > 0;
  const hasChildren = Boolean(node.children && node.children.length > 0);
  const containerClass = isRoot
    ? compact
      ? 'space-y-2'
      : 'space-y-4'
    : compact
      ? 'pl-3 border-l border-gray-200/70 space-y-2'
      : 'pl-5 border-l border-gray-200/70 space-y-4';

  const palette = [
    'border-blue-200 bg-blue-50/60 text-blue-800',
    'border-emerald-200 bg-emerald-50/60 text-emerald-800',
    'border-amber-200 bg-amber-50/60 text-amber-800',
    'border-purple-200 bg-purple-50/60 text-purple-800',
  ];
  const colorClass = palette[depth % palette.length];

  return (
    <div className={containerClass}>
      {hasTitle && (
        <div className={isRoot ? '' : compact ? 'flex items-start gap-2 -ml-3' : 'flex items-start gap-3 -ml-5'}>
          {!isRoot && (
            <span
              className={
                compact
                  ? 'mt-2 h-1.5 w-1.5 rounded-full bg-gray-300'
                  : 'mt-2 h-2 w-2 rounded-full bg-gray-300'
              }
            />
          )}
          <span
            className={
              compact
                ? `inline-flex items-center rounded-md border px-2 py-1 text-xs shadow-sm ${colorClass}`
                : `inline-flex items-center rounded-lg border px-3 py-1.5 text-sm shadow-sm ${colorClass}`
            }
          >
            {node.title}
          </span>
        </div>
      )}
      {hasChildren && (
        <div className={compact ? 'space-y-2' : 'space-y-5'}>
          {node.children?.map((child, index) => (
            <MindMapTree key={`${child.title}-${index}`} node={child} compact={compact} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

function AIContentSection({
  title,
  content,
  status,
  onGenerate,
  onCopy,
  canEdit = false,
  renderMarkdown = false,
  renderMindMap = false,
  onMindMapOpen,
  showStatus = false,
  statusLink,
}: AIContentSectionProps) {
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

  const showGenerateButton = canEdit && (!status || status === 'completed' || status === 'failed');
  const statusBadge = showStatus ? getStatusBadge() : null;

  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <h3 className="font-semibold text-gray-900">{title}</h3>
        {statusBadge && statusLink ? (
          <Link href={statusLink} className="hover:opacity-80 transition">
            {statusBadge}
          </Link>
        ) : (
          statusBadge
        )}
        {showGenerateButton && (
          <button
            onClick={onGenerate}
            className="text-gray-400 hover:text-blue-600 transition"
            title={content ? '重新生成' : '生成'}
          >
          {content ? <IconRefresh className="h-4 w-4" /> : <IconBolt className="h-4 w-4" />}
          </button>
        )}
        {content && (
          <button
            onClick={onCopy}
            className="text-gray-400 hover:text-blue-600 transition"
            title="复制内容"
          >
            <IconCopy className="h-4 w-4" />
          </button>
        )}
      </div>
      {content ? (
        renderMindMap ? (
          (() => {
            const tree = parseMindMapOutline(content);
            return tree ? (
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-2">
                <div
                  onClick={onMindMapOpen}
                  className="cursor-zoom-in"
                  role="button"
                  tabIndex={0}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      onMindMapOpen?.();
                    }
                  }}
                >
                  <div className="overflow-hidden relative">
                    <div className="inline-block">
                      <MindMapTree node={tree} isRoot compact />
                    </div>
                    <div className="absolute top-1 right-1 text-xs text-gray-400 bg-white/80 px-2 py-0.5 rounded">
                      点击放大
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-gray-700 text-sm whitespace-pre-wrap">{content}</div>
            );
          })()
        ) : renderMarkdown ? (
          <div
            className="prose prose-sm max-w-none rounded-lg border border-gray-200 bg-gray-50 p-3 text-gray-700"
            dangerouslySetInnerHTML={{ __html: marked(content) }}
          />
        ) : (
          <div className="text-gray-700 text-sm whitespace-pre-wrap">{content}</div>
        )
      ) : showStatus ? (
        <p className="text-gray-400 text-sm">
          {status === 'processing' ? '正在生成...' : '未生成'}
        </p>
      ) : null}
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
          className={`block text-xs truncate rounded px-2 py-1 transition ${
            activeId === item.id
              ? 'text-blue-700 font-semibold bg-blue-50'
              : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
          }`}
          style={{ paddingLeft: `${(item.level - 1) * 8}px` }}
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

interface ArticleNeighbor {
  id: string;
  title: string;
}

export default function ArticleDetailPage() {
  const router = useRouter();
  const { showToast } = useToast();
  const { isAdmin } = useAuth();
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
  const activeHeadingMapRef = useRef<Map<string, number>>(new Map());
  const [immersiveMode, setImmersiveMode] = useState(false);
  const [lightboxImage, setLightboxImage] = useState<string | null>(null);
  const [mindMapOpen, setMindMapOpen] = useState(false);
  const [prevArticle, setPrevArticle] = useState<ArticleNeighbor | null>(null);
  const [nextArticle, setNextArticle] = useState<ArticleNeighbor | null>(null);
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
    setActiveTocId(items[0]?.id || '');
  }, [article, showTranslation]);

  useEffect(() => {
    if (tocItems.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const activeMap = activeHeadingMapRef.current;
        entries.forEach((entry) => {
          const targetId = entry.target.id;
          if (entry.isIntersecting) {
            activeMap.set(targetId, entry.boundingClientRect.top);
          } else {
            activeMap.delete(targetId);
          }
        });

        if (activeMap.size > 0) {
          const nextActive = Array.from(activeMap.entries()).sort((a, b) => a[1] - b[1])[0]?.[0];
          if (nextActive) {
            setActiveTocId(nextActive);
          }
        }
      },
      { rootMargin: '-80px 0px -80% 0px', threshold: [0, 0.1, 0.5] }
    );

    activeHeadingMapRef.current.clear();
    tocItems.forEach((item) => {
      const element = document.getElementById(item.id);
      if (element) observer.observe(element);
    });

    return () => observer.disconnect();
  }, [tocItems]);

  useEffect(() => {
    if (!lightboxImage) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setLightboxImage(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [lightboxImage]);

  const fetchArticle = async () => {
    setLoading(true);
    try {
      const data = await articleApi.getArticle(id as string);
      setArticle(data);
      if (data?.prev_article) {
        setPrevArticle(data.prev_article as ArticleNeighbor);
      } else {
        setPrevArticle(null);
      }
      if (data?.next_article) {
        setNextArticle(data.next_article as ArticleNeighbor);
      } else {
        setNextArticle(null);
      }
    } catch (error) {
      console.error('Failed to fetch article:', error);
      showToast('加载文章失败', 'error');
    } finally {
      setLoading(false);
    }
  };

  const openMindMap = () => {
    setMindMapOpen(true);
  };

  const handleContentClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement | null;
    if (!target || target.tagName !== 'IMG') return;
    const img = target as HTMLImageElement;
    if (img.src) {
      setLightboxImage(img.src);
    }
  };

  const showSummarySection = isAdmin || Boolean(article?.ai_analysis?.summary);
  const showKeyPointsSection = isAdmin || Boolean(article?.ai_analysis?.key_points);
  const showOutlineSection = isAdmin || Boolean(article?.ai_analysis?.outline);
  const showQuotesSection = isAdmin || Boolean(article?.ai_analysis?.quotes);
  const aiUpdatedAt = article?.ai_analysis?.updated_at
    ? new Date(article.ai_analysis.updated_at).toLocaleString('zh-CN')
    : '';

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

  const handleToggleVisibility = async () => {
    if (!id || !article) return;

    try {
      await articleApi.updateArticleVisibility(id as string, !article.is_visible);
      setArticle({ ...article, is_visible: !article.is_visible });
      showToast(article.is_visible ? '已设为不可见' : '已设为可见');
    } catch (error) {
      console.error('Failed to toggle visibility:', error);
      showToast('操作失败', 'error');
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
      <div className="min-h-screen bg-app flex items-center justify-center">
        <div className="text-text-3">加载中...</div>
      </div>
    );
  }

  if (!article) {
    return (
      <div className="min-h-screen bg-app flex items-center justify-center">
        <div className="text-text-3">文章不存在</div>
      </div>
    );
  }

  return (
    <div className={`min-h-screen ${immersiveMode ? 'bg-surface' : 'bg-app'}`}>
      <Head>
        <title>{article?.title ? `${article.title} - Lumina` : '文章详情 - Lumina'}</title>
      </Head>
      <ReadingProgress />
       <nav className={`bg-surface ${immersiveMode ? '' : 'shadow-sm border-b border-border'}`}>
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between mb-3 relative">
            <Link href="/" className="text-primary hover:text-primary-ink transition">
              ← 返回列表
            </Link>
            <h1 className="text-2xl font-bold text-text-1 truncate absolute left-1/2 -translate-x-1/2 max-w-[70%] text-center">
              {article.title}
            </h1>
            <div></div>
          </div>
          <div className={`flex flex-wrap gap-4 text-sm text-text-2 pb-3 justify-center ${immersiveMode ? '' : 'border-b border-border'}`}>
            {article.category && (
              <div>
                <span className="font-medium text-text-2">分类：</span>
                <Link
                  href={`/?category_id=${article.category.id}`}
                  className="inline-flex items-center gap-1"
                >
                  <span className="text-primary hover:underline">{article.category.name}</span>
                </Link>
              </div>
            )}
            {article.author && (
              <div>
                <span className="font-medium text-text-2">作者：</span>
                <Link
                  href={`/?author=${encodeURIComponent(article.author)}`}
                  className="text-primary hover:underline"
                >
                  {article.author}
                </Link>
              </div>
            )}
            {article.source_url && (
              <div>
                <span className="font-medium text-text-2">来源：</span>
                <a
                  href={article.source_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  点击查看
                </a>
              </div>
            )}
            <div>
              <span className="font-medium text-text-2">发表时间：</span>
              {article.published_at
                ? new Date(article.published_at).toLocaleDateString('zh-CN')
                : new Date(article.created_at).toLocaleDateString('zh-CN')}
            </div>
          </div>
        </div>
      </nav>

        <div className={`max-w-7xl mx-auto px-4 ${immersiveMode ? 'py-6' : 'py-8'}`}>
          <div className="flex gap-4">
            {!immersiveMode && tocItems.length > 0 && (
              <aside className={`hidden xl:block flex-shrink-0 transition-all duration-300 ${tocCollapsed ? 'w-12' : 'w-48'}`}>
                <div className="sticky top-4 bg-surface rounded-sm shadow-sm border border-border p-4 max-h-[calc(100vh-2rem)] overflow-y-auto">
                  <div className="flex items-center justify-between mb-3">
                    {!tocCollapsed && (
                      <h3 className="text-lg font-semibold text-text-1 inline-flex items-center gap-2">
                        <IconList className="h-4 w-4" />
                        <span>目录</span>
                      </h3>
                    )}
                    <button
                      onClick={() => setTocCollapsed(!tocCollapsed)}
                      className="text-text-3 hover:text-text-2 transition"
                      title={tocCollapsed ? '展开' : '收起'}
                    >
                      {tocCollapsed ? '»' : '«'}
                    </button>
                  </div>
                  {!tocCollapsed && <TableOfContents items={tocItems} activeId={activeTocId} />}
                </div>
              </aside>
            )}

            <div className={`flex-1 bg-surface ${immersiveMode ? '' : 'rounded-sm shadow-sm border border-border p-6'}`}>
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-semibold text-text-1 inline-flex items-center gap-2">
                    <IconDoc className="h-4 w-4" />
                    <span>内容</span>
                  </h2>
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
                      {(article.translation_status === 'completed' || article.translation_status === 'failed') && isAdmin && (
                        <button
                          onClick={handleRetryTranslation}
                          className="text-gray-400 hover:text-blue-600 transition"
                          title={article.translation_error || '重新翻译'}
                        >
                          <IconRefresh className="h-4 w-4" />
                        </button>
                      )}
                    </>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {isAdmin && (
                    <>
                      <button
                        onClick={handleToggleVisibility}
                        className={`flex items-center gap-1 px-2 py-1 rounded-lg text-sm transition ${
                          article.is_visible
                            ? 'text-green-700 hover:bg-green-50'
                            : 'text-gray-600 hover:bg-gray-100'
                        }`}
                        title={article.is_visible ? '点击隐藏' : '点击显示'}
                      >
              {article.is_visible ? <IconEye className="h-4 w-4" /> : <IconEyeOff className="h-4 w-4" />}
                        <span>{article.is_visible ? '隐藏' : '显示'}</span>
                      </button>
                      <button
                        onClick={() => openEditModal(showTranslation && article.content_trans ? 'translation' : 'original')}
                        className="flex items-center gap-1 px-2 py-1 rounded-lg text-sm text-gray-600 hover:text-blue-600 hover:bg-blue-50 transition"
                        title={'编辑'}
                      >
                        <IconEdit className="h-4 w-4" />
                        <span>{'编辑'}</span>
                      </button>
                      <button
                        onClick={() => setShowDeleteModal(true)}
                        className="flex items-center gap-1 px-2 py-1 rounded-lg text-sm text-red-600 hover:bg-red-50 transition"
                        title="删除文章"
                      >
                <IconTrash className="h-4 w-4" />
                        <span>删除</span>
                      </button>
                    </>
                  )}
                  {article.content_trans && (
                    <button
                      onClick={() => setShowTranslation(!showTranslation)}
                      className="flex items-center gap-1 px-2 py-1 rounded-lg text-sm text-blue-700 bg-blue-50 hover:bg-blue-100 transition"
                      title={showTranslation ? '当前查看中文' : '当前查看英文'}
                    >
                      <span>{showTranslation ? '🇺🇸' : '🇨🇳'}</span>
                      <span>{showTranslation ? '切换英文' : '切换中文'}</span>
                    </button>
                  )}
                  <button
                    onClick={() => setImmersiveMode(!immersiveMode)}
                    className={`flex items-center gap-1 px-2 py-1 rounded-lg text-sm transition ${
                      immersiveMode
                        ? 'text-gray-700 hover:bg-gray-100'
                        : 'text-blue-700 hover:bg-blue-50'
                    }`}
                    title={immersiveMode ? '退出沉浸式阅读' : '进入沉浸式阅读'}
                  >
                    <IconBook className="h-4 w-4" />
                    <span>{immersiveMode ? '退出沉浸' : '沉浸式阅读'}</span>
                  </button>
                </div>
              </div>

              <div
                ref={contentRef}
                onClick={handleContentClick}
                className="prose prose-sm max-w-none prose-img:cursor-zoom-in prose-img:rounded-lg prose-img:border prose-img:border-gray-200 prose-img:bg-white prose-img:shadow-sm prose-img:max-w-[320px] sm:prose-img:max-w-[420px]"
              >
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

              <div className="flex items-center justify-between mt-6 text-sm">
                <button
                  onClick={() => prevArticle && router.push(`/article/${prevArticle.id}`)}
                  disabled={!prevArticle}
                  className={`px-3 py-2 rounded-lg transition text-left ${
                    prevArticle
                      ? 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      : 'bg-gray-50 text-gray-400 cursor-not-allowed'
                  }`}
                  title={prevArticle ? prevArticle.title : '无上一篇'}
                >
                  <span className="block">← 上一篇</span>
                  {prevArticle && (
                    <span className="block text-xs text-gray-500">
                      {prevArticle.title.length > 20 ? `${prevArticle.title.slice(0, 20)}...` : prevArticle.title}
                    </span>
                  )}
                </button>
                <button
                  onClick={() => nextArticle && router.push(`/article/${nextArticle.id}`)}
                  disabled={!nextArticle}
                  className={`px-3 py-2 rounded-lg transition text-right ${
                    nextArticle
                      ? 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      : 'bg-gray-50 text-gray-400 cursor-not-allowed'
                  }`}
                  title={nextArticle ? nextArticle.title : '无下一篇'}
                >
                  <span className="block">下一篇 →</span>
                  {nextArticle && (
                    <span className="block text-xs text-gray-500">
                      {nextArticle.title.length > 20 ? `${nextArticle.title.slice(0, 20)}...` : nextArticle.title}
                    </span>
                  )}
                </button>
              </div>
            </div>

            {!immersiveMode && (
              <aside className={`flex-shrink-0 transition-all duration-300 ${analysisCollapsed ? 'w-12' : 'w-96'}`}>
              <div className="bg-white rounded-lg shadow-sm p-4 sticky top-4 max-h-[calc(100vh-2rem)] overflow-y-auto">
                <div className="flex items-center justify-between mb-4">
                  {!analysisCollapsed && (
                    <div>
                  <h2 className="text-lg font-semibold text-gray-900 inline-flex items-center gap-2">
                    <IconRobot className="h-4 w-4" />
                    <span>AI 解读</span>
                  </h2>
                      {aiUpdatedAt && (
                        <div className="text-xs text-gray-500 mt-1">更新时间：{aiUpdatedAt}</div>
                      )}
                    </div>
                  )}
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
                    {showSummarySection && (
                      <AIContentSection
                  title="摘要"
                        content={article.ai_analysis?.summary}
                        status={article.ai_analysis?.summary_status || (article.status === 'completed' ? 'completed' : article.status)}
                        onGenerate={() => handleGenerateContent('summary')}
                        onCopy={() => handleCopyContent(article.ai_analysis?.summary, '摘要')}
                        canEdit={isAdmin}
                        showStatus={isAdmin}
                        statusLink={`/settings?section=tasks&article_id=${article.id}`}
                      />
                    )}

                    {showKeyPointsSection && (
                      <AIContentSection
                  title="总结"
                        content={article.ai_analysis?.key_points}
                        status={article.ai_analysis?.key_points_status}
                        onGenerate={() => handleGenerateContent('key_points')}
                        onCopy={() => handleCopyContent(article.ai_analysis?.key_points, '总结')}
                        canEdit={isAdmin}
                        showStatus={isAdmin}
                        statusLink={`/settings?section=tasks&article_id=${article.id}`}
                      />
                    )}

                    {showOutlineSection && (
                      <AIContentSection
                  title="大纲"
                        content={article.ai_analysis?.outline}
                        status={article.ai_analysis?.outline_status}
                        onGenerate={() => handleGenerateContent('outline')}
                        onCopy={() => handleCopyContent(article.ai_analysis?.outline, '大纲')}
                        canEdit={isAdmin}
                        renderMindMap
                        onMindMapOpen={openMindMap}
                        showStatus={isAdmin}
                        statusLink={`/settings?section=tasks&article_id=${article.id}`}
                      />
                    )}

                    {showQuotesSection && (
                      <AIContentSection
                        title="金句"
                        content={article.ai_analysis?.quotes}
                        status={article.ai_analysis?.quotes_status}
                        onGenerate={() => handleGenerateContent('quotes')}
                        onCopy={() => handleCopyContent(article.ai_analysis?.quotes, '金句')}
                        canEdit={isAdmin}
                        renderMarkdown
                        showStatus={isAdmin}
                        statusLink={`/settings?section=tasks&article_id=${article.id}`}
                      />
                    )}

                    {isAdmin && article.ai_analysis?.error_message && (
                      <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
                        <p className="text-red-700 text-sm">{article.ai_analysis.error_message}</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </aside>
            )}
          </div>
        </div>

      {showConfigModal && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
          onClick={() => setShowConfigModal(false)}
        >
          <div
            className="bg-white rounded-lg shadow-xl max-w-md w-full"
            onClick={(event) => event.stopPropagation()}
          >
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
                <Select
                  value={selectedModelConfigId}
                  onChange={(value) => setSelectedModelConfigId(value)}
                  className="select-modern-antd w-full"
                  popupClassName="select-modern-dropdown"
                  options={[
                    { value: '', label: '使用默认配置' },
                    ...modelConfigs.map((config) => ({
                      value: config.id,
                      label: `${config.name} (${config.model_name})`,
                    })),
                  ]}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  提示词配置
                </label>
                <Select
                  value={selectedPromptConfigId}
                  onChange={(value) => setSelectedPromptConfigId(value)}
                  className="select-modern-antd w-full"
                  popupClassName="select-modern-dropdown"
                  options={[
                    { value: '', label: '使用默认配置' },
                    ...promptConfigs.map((config) => ({
                      value: config.id,
                      label: config.name,
                    })),
                  ]}
                />
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
        <div
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
          onClick={() => setShowEditModal(false)}
        >
          <div
            className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] flex flex-col"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between p-4 border-b">
              <h3 className="text-lg font-semibold text-gray-900">
                编辑文章
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
                  内容（Markdown）
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

      {lightboxImage && (
        <div
          className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4"
          onClick={() => setLightboxImage(null)}
        >
          <div className="relative">
            <button
              onClick={() => setLightboxImage(null)}
              className="absolute -top-3 -right-3 w-8 h-8 rounded-full bg-white text-gray-700 shadow flex items-center justify-center hover:bg-gray-100"
              aria-label="关闭"
            >
              ×
            </button>
            <img
              src={lightboxImage}
              alt="预览"
              className="max-h-[80vh] max-w-[90vw] rounded-lg shadow-xl"
              onClick={(event) => event.stopPropagation()}
            />
          </div>
        </div>
      )}

      {mindMapOpen && article?.ai_analysis?.outline && (
        (() => {
          const tree = parseMindMapOutline(article.ai_analysis?.outline || '');
          if (!tree) return null;
          return (
            <div
              className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4"
              onClick={() => setMindMapOpen(false)}
            >
              <div
                className="relative w-full max-w-6xl h-[80vh]"
                onClick={(event) => event.stopPropagation()}
              >
                <button
                  onClick={() => setMindMapOpen(false)}
                  className="absolute top-3 right-3 w-8 h-8 rounded-full bg-white text-gray-700 shadow flex items-center justify-center hover:bg-gray-100"
                  aria-label="关闭"
                >
                  ×
                </button>
                <div className="w-full h-full rounded-lg bg-white shadow-xl border overflow-auto">
                  <div className="p-6">
                    <MindMapTree node={tree} isRoot />
                  </div>
                </div>
              </div>
            </div>
          );
        })()
      )}

      <BackToTop />
    </div>
  );
}
