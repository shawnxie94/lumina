import Head from 'next/head';
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';

import { useRouter } from 'next/router';
import Link from 'next/link';
import { marked } from 'marked';

import { articleApi, commentApi, commentSettingsApi, type ArticleComment, type ArticleDetail, type ModelAPIConfig, type PromptConfig } from '@/lib/api';
import AppFooter from '@/components/AppFooter';
import AppHeader from '@/components/AppHeader';
import Button from '@/components/Button';
import IconButton from '@/components/IconButton';
import { useToast } from '@/components/Toast';
import { BackToTop } from '@/components/BackToTop';
import { IconBolt, IconBook, IconCopy, IconDoc, IconEdit, IconEye, IconEyeOff, IconList, IconNote, IconRefresh, IconRobot, IconTrash, IconCheck, IconReply, IconChevronDown, IconChevronUp } from '@/components/icons';
import { useAuth } from '@/contexts/AuthContext';
import { Select } from 'antd';
import { signIn, signOut, useSession } from 'next-auth/react';

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
  showHeader?: boolean;
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

function extractReplyPrefix(content: string): { prefix: string; body: string } {
  if (!content) return { prefix: '', body: '' };
  const lines = content.split('\n');
  const prefixLines: string[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (line.startsWith('> 回复 @') || line.startsWith('> [原评论链接](')) {
      prefixLines.push(line);
      index += 1;
      continue;
    }
    if (prefixLines.length > 0 && line.trim() === '') {
      index += 1;
      break;
    }
    break;
  }
  if (prefixLines.length === 0) {
    return { prefix: '', body: content };
  }
  return { prefix: prefixLines.join('\n'), body: lines.slice(index).join('\n') };
}

function getReplyMeta(content: string): { user: string; link: string } | null {
  if (!content) return null;
  const { prefix } = extractReplyPrefix(content);
  if (!prefix) return null;
  const userMatch = prefix.match(/> 回复 @(.+)/);
  const linkMatch = prefix.match(/\[原评论\]\((.+)\)/);
  const user = userMatch ? userMatch[1].trim() : '';
  const link = linkMatch ? linkMatch[1].trim() : '';
  if (!user && !link) return null;
  return { user, link };
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
  showHeader = true,
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
      {showHeader && (
        <div className="flex items-center justify-between gap-4 mb-2">
          <div className="flex items-center gap-2 pr-2">
            <h3 className="font-semibold text-gray-900">{title}</h3>
          </div>
          <div className="flex items-center gap-2">
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
                className="text-text-3 hover:text-primary transition"
                title={content ? '重新生成' : '生成'}
                type="button"
              >
              {content ? <IconRefresh className="h-4 w-4" /> : <IconBolt className="h-4 w-4" />}
              </button>
            )}
            {content && (
              <button
                onClick={onCopy}
                className="text-text-3 hover:text-primary transition"
                title="复制内容"
                type="button"
              >
                <IconCopy className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      )}
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

function TableOfContents({ items, activeId, onSelect }: { items: TocItem[]; activeId: string; onSelect: (id: string) => void }) {
  if (items.length === 0) return null;

  return (
    <nav className="space-y-1">
      {items.map((item) => (
        <a
          key={item.id}
          href={`#${item.id}`}
          onClick={() => onSelect(item.id)}
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

function createAnnotationId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `anno_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function getRangeOffsets(root: HTMLElement, range: Range) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let startOffset = 0;
  let endOffset = 0;
  let current = walker.nextNode();
  let offset = 0;

  while (current) {
    const textNode = current as Text;
    const length = textNode.data.length;
    if (textNode === range.startContainer) {
      startOffset = offset + range.startOffset;
    }
    if (textNode === range.endContainer) {
      endOffset = offset + range.endOffset;
      break;
    }
    offset += length;
    current = walker.nextNode();
  }

  return { start: startOffset, end: endOffset };
}

function getRangeSnippet(root: HTMLElement, start: number, end: number, context = 40) {
  if (start >= end) return '';
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let current = walker.nextNode();
  let offset = 0;
  let fullText = '';

  while (current) {
    const node = current as Text;
    fullText += node.data;
    current = walker.nextNode();
  }

  const safeStart = Math.max(0, start);
  const safeEnd = Math.min(fullText.length, end);
  const left = Math.max(0, safeStart - context);
  const right = Math.min(fullText.length, safeEnd + context);
  const prefix = left > 0 ? '…' : '';
  const suffix = right < fullText.length ? '…' : '';
  const before = fullText.slice(left, safeStart);
  const middle = fullText.slice(safeStart, safeEnd);
  const after = fullText.slice(safeEnd, right);
  return `${prefix}${before}<mark class="annotation-highlight">${middle}</mark>${after}${suffix}`.trim();
}

function applyAnnotations(html: string, annotations: ArticleAnnotation[]) {
  if (!annotations || annotations.length === 0) return html;
  if (typeof window === 'undefined') return html;

  const sorted = [...annotations].sort((a, b) => a.start - b.start);
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

  const textNodes: Array<{ node: Text; start: number; end: number }> = [];
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  let offset = 0;
  let current = walker.nextNode();
  while (current) {
    const node = current as Text;
    const length = node.data.length;
    textNodes.push({ node, start: offset, end: offset + length });
    offset += length;
    current = walker.nextNode();
  }

  sorted.forEach((annotation) => {
    textNodes.forEach(({ node, start, end }) => {
      if (end <= annotation.start) return;
      if (start >= annotation.end) return;
      if (!node.parentNode) return;
      const text = node.data;
      const highlightStart = Math.max(annotation.start - start, 0);
      const highlightEnd = Math.min(annotation.end - start, text.length);
      if (highlightStart >= highlightEnd) return;
      const before = text.slice(0, highlightStart);
      const middle = text.slice(highlightStart, highlightEnd);
      const after = text.slice(highlightEnd);
      const frag = doc.createDocumentFragment();
      if (before) frag.appendChild(doc.createTextNode(before));
      const mark = doc.createElement('mark');
      mark.className = 'annotation-highlight';
      mark.setAttribute('data-annotation-id', annotation.id);
      mark.textContent = middle;
      frag.appendChild(mark);
      if (after) frag.appendChild(doc.createTextNode(after));
      node.replaceWith(frag);
    });
  });

  return doc.body.innerHTML;
}

function renderMarkdown(content: string) {
  const result = marked.parse(content);
  return typeof result === 'string' ? result : '';
}

interface ArticleNeighbor {
  id: string;
  title: string;
}

interface ArticleAnnotation {
  id: string;
  start: number;
  end: number;
  comment: string;
}

export default function ArticleDetailPage() {
  const router = useRouter();
  const { showToast } = useToast();
  const { isAdmin } = useAuth();
  const { data: session } = useSession();
  const { id } = router.query;
  const [article, setArticle] = useState<ArticleDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [showTranslation, setShowTranslation] = useState(true);
  const [analysisCollapsed, setAnalysisCollapsed] = useState(false);
  const [activeAiTab, setActiveAiTab] = useState<'key_points' | 'outline' | 'quotes'>('key_points');
  
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

  const [noteContent, setNoteContent] = useState('');
  const [noteDraft, setNoteDraft] = useState('');
  const [showNoteModal, setShowNoteModal] = useState(false);
  const [annotations, setAnnotations] = useState<ArticleAnnotation[]>([]);
  const [activeAnnotationId, setActiveAnnotationId] = useState<string>('');
  const [showAnnotationView, setShowAnnotationView] = useState(false);
  const [pendingAnnotationRange, setPendingAnnotationRange] = useState<{
    start: number;
    end: number;
  } | null>(null);
  const [pendingAnnotationText, setPendingAnnotationText] = useState('');
  const [pendingAnnotationComment, setPendingAnnotationComment] = useState('');
  const [showAnnotationModal, setShowAnnotationModal] = useState(false);
  const [activeAnnotationText, setActiveAnnotationText] = useState('');
  const [annotationEditDraft, setAnnotationEditDraft] = useState('');
  const [showSelectionToolbar, setShowSelectionToolbar] = useState(false);
  const [selectionToolbarPos, setSelectionToolbarPos] = useState<{ x: number; y: number } | null>(null);
  const [hoverAnnotationId, setHoverAnnotationId] = useState<string>('');
  const [hoverTooltipPos, setHoverTooltipPos] = useState<{ x: number; y: number } | null>(null);
  const [comments, setComments] = useState<ArticleComment[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [commentDraft, setCommentDraft] = useState('');
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editingCommentDraft, setEditingCommentDraft] = useState('');
  const [editingCommentPrefix, setEditingCommentPrefix] = useState('');
  const [commentsEnabled, setCommentsEnabled] = useState(true);
  const [commentProviders, setCommentProviders] = useState({ github: false, google: false });
  const [showUserMenu, setShowUserMenu] = useState(false);
  const userMenuRef = useRef<HTMLDivElement | null>(null);
  const commentInputRef = useRef<HTMLTextAreaElement | null>(null);
  const [replyToId, setReplyToId] = useState<string | null>(null);
  const [replyToUser, setReplyToUser] = useState<string>('');
  const [replyTargetId, setReplyTargetId] = useState<string | null>(null);
  const [replyPrefix, setReplyPrefix] = useState<string>('');
  const [pendingScrollId, setPendingScrollId] = useState<string | null>(null);
  const [commentPage, setCommentPage] = useState(1);
  const commentPageSize = 5;
  const [pendingDeleteCommentId, setPendingDeleteCommentId] = useState<string | null>(null);
  const [showDeleteCommentModal, setShowDeleteCommentModal] = useState(false);
  const [expandedReplies, setExpandedReplies] = useState<Record<string, boolean>>({});

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

  const renderedHtml = useMemo(() => {
    if (!article) return '';
    const baseHtml = showTranslation && article.content_trans
      ? renderMarkdown(article.content_trans)
      : article.content_md
        ? renderMarkdown(article.content_md)
        : article.content_html;
    return applyAnnotations(baseHtml, annotations);
  }, [article, annotations, showTranslation]);

  const activeAnnotation = annotations.find(
    (item) => item.id === activeAnnotationId,
  );

  const sortedTopComments = useMemo(() => {
    return [...comments]
      .filter((comment) => !comment.reply_to_id)
      .sort(
        (a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      );
  }, [comments]);

  const totalTopComments = sortedTopComments.length;
  const totalCommentPages = Math.max(
    1,
    Math.ceil(totalTopComments / commentPageSize),
  );

  const pagedTopComments = useMemo(() => {
    const start = (commentPage - 1) * commentPageSize;
    return sortedTopComments.slice(start, start + commentPageSize);
  }, [sortedTopComments, commentPage]);

  useEffect(() => {
    if (commentPage > totalCommentPages) {
      setCommentPage(totalCommentPages);
    }
  }, [commentPage, totalCommentPages]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target as Node)) {
        setShowUserMenu(false);
      }
    };
    if (showUserMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showUserMenu]);

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
    if (id && commentsEnabled) {
      fetchComments();
    }
  }, [id, commentsEnabled]);

  useEffect(() => {
    fetchCommentSettings();
  }, []);

  useEffect(() => {
    const handleHashChange = () => {
      if (typeof window === 'undefined') return;
      const hash = window.location.hash || '';
      if (!hash.startsWith('#comment-')) return;
      const commentId = hash.slice('#comment-'.length);
      const commentExists = comments.some(c => c.id === commentId);
      if (commentExists) {
        setPendingScrollId(commentId);
      }
    };

    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, [comments]);

  useEffect(() => {
    if (!replyTargetId) return;
    const handleScroll = () => {
      const target = document.getElementById(`reply-box-${replyTargetId}`);
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      focusCommentInput();
    };
    const timer = window.setTimeout(handleScroll, 0);
    return () => window.clearTimeout(timer);
  }, [replyTargetId]);

  useEffect(() => {
    if (!pendingScrollId) return;
    const handleScroll = () => {
      const target = document.getElementById(`comment-${pendingScrollId}`);
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setPendingScrollId(null);
      }
    };
    const timer = window.setTimeout(handleScroll, 100);
    return () => window.clearTimeout(timer);
  }, [pendingScrollId]);


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
    if (!article) return;
    setNoteContent(article.note_content || '');
    setNoteDraft(article.note_content || '');
    if (article.note_annotations) {
      try {
        const parsed = JSON.parse(article.note_annotations) as ArticleAnnotation[];
        setAnnotations(parsed || []);
      } catch {
        setAnnotations([]);
      }
    } else {
      setAnnotations([]);
    }
  }, [article?.id]);

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

  const fetchComments = async () => {
    if (!id) return;
    setCommentsLoading(true);
    try {
      const data = await commentApi.getArticleComments(id as string);
      setComments(data);
      const hash = typeof window !== 'undefined' ? window.location.hash : '';
      if (hash.startsWith('#comment-')) {
        const commentId = hash.slice('#comment-'.length);
        const commentExists = data.some((c: ArticleComment) => c.id === commentId);
        if (!commentExists) {
          showToast('原评论不存在', 'info');
        } else {
          setPendingScrollId(commentId);
        }
      }
    } catch (error) {
      console.error('Failed to fetch comments:', error);
    } finally {
      setCommentsLoading(false);
    }
  };

  const fetchCommentSettings = async () => {
    try {
      const data = await commentSettingsApi.getPublicSettings();
      setCommentsEnabled(Boolean(data.comments_enabled));
      setCommentProviders({
        github: Boolean(data.providers?.github),
        google: Boolean(data.providers?.google),
      });
    } catch (error) {
      console.error('Failed to fetch comment settings:', error);
    }
  };

  const openMindMap = () => {
    setMindMapOpen(true);
  };

  const handleContentClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement | null;
    if (!target) return;
    if (target.tagName === 'IMG') {
      const img = target as HTMLImageElement;
      if (img.src) {
        setLightboxImage(img.src);
      }
      return;
    }
    const mark = target.closest('mark[data-annotation-id]') as HTMLElement | null;
    if (mark) {
      const annotationId = mark.getAttribute('data-annotation-id') || '';
      setActiveAnnotationId(annotationId);
      if (contentRef.current) {
        const annotation = annotations.find((item) => item.id === annotationId);
        if (annotation) {
          setActiveAnnotationText(
            getRangeSnippet(contentRef.current, annotation.start, annotation.end),
          );
          setAnnotationEditDraft(annotation.comment);
        } else {
          setActiveAnnotationText('');
        }
      }
      setShowAnnotationView(true);
    }
  };

  const handleContentMouseOver = (event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement | null;
    if (!target) return;
    const mark = target.closest('mark[data-annotation-id]') as HTMLElement | null;
    if (!mark) return;
    const annotationId = mark.getAttribute('data-annotation-id') || '';
    if (!annotationId) return;
    const rect = mark.getBoundingClientRect();
    setHoverAnnotationId(annotationId);
    setHoverTooltipPos({
      x: rect.left + rect.width / 2,
      y: rect.top,
    });
  };

  const handleContentMouseOut = (event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement | null;
    if (!target) return;
    const mark = target.closest('mark[data-annotation-id]') as HTMLElement | null;
    if (mark) {
      setHoverAnnotationId('');
      setHoverTooltipPos(null);
    }
  };


  const showSummarySection = isAdmin || Boolean(article?.ai_analysis?.summary);
  const showKeyPointsSection = isAdmin || Boolean(article?.ai_analysis?.key_points);
  const showOutlineSection = isAdmin || Boolean(article?.ai_analysis?.outline);
  const showQuotesSection = isAdmin || Boolean(article?.ai_analysis?.quotes);
  const aiUpdatedAt = article?.ai_analysis?.updated_at
    ? new Date(article.ai_analysis.updated_at).toLocaleString('zh-CN')
    : '';

  const aiTabConfigs = [
    {
      key: 'key_points' as const,
      label: '总结',
      enabled: showKeyPointsSection,
      content: article?.ai_analysis?.key_points,
      status: article?.ai_analysis?.key_points_status,
      renderMarkdown: true,
      renderMindMap: false,
      onMindMapOpen: undefined,
      onGenerate: () => handleGenerateContent('key_points'),
      onCopy: () => handleCopyContent(article?.ai_analysis?.key_points, '总结'),
    },
    {
      key: 'outline' as const,
      label: '大纲',
      enabled: showOutlineSection,
      content: article?.ai_analysis?.outline,
      status: article?.ai_analysis?.outline_status,
      renderMarkdown: false,
      renderMindMap: true,
      onMindMapOpen: openMindMap,
      onGenerate: () => handleGenerateContent('outline'),
      onCopy: () => handleCopyContent(article?.ai_analysis?.outline, '大纲'),
    },
    {
      key: 'quotes' as const,
      label: '金句',
      enabled: showQuotesSection,
      content: article?.ai_analysis?.quotes,
      status: article?.ai_analysis?.quotes_status,
      renderMarkdown: true,
      renderMindMap: false,
      onMindMapOpen: undefined,
      onGenerate: () => handleGenerateContent('quotes'),
      onCopy: () => handleCopyContent(article?.ai_analysis?.quotes, '金句'),
    },
  ];

  const activeTabConfig = aiTabConfigs.find((tab) => tab.key === activeAiTab)
    ?? aiTabConfigs.find((tab) => tab.enabled);
  const aiStatusLink = article ? `/settings?section=tasks&article_id=${article.id}` : '';
  const activeStatusBadge = isAdmin ? getAiTabStatusBadge(activeTabConfig?.status) : null;
  const showActiveGenerateButton = isAdmin
    && (!activeTabConfig?.status || activeTabConfig.status === 'completed' || activeTabConfig.status === 'failed');
  const showActiveCopyButton = Boolean(activeTabConfig?.content);


  useEffect(() => {
    const handleSelection = () => {
      if (!contentRef.current) return;
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0) {
        setShowSelectionToolbar(false);
        return;
      }
      const range = selection.getRangeAt(0);
      if (range.collapsed) {
        setShowSelectionToolbar(false);
        return;
      }
      if (!contentRef.current.contains(range.commonAncestorContainer)) {
        setShowSelectionToolbar(false);
        return;
      }
      const rect = range.getBoundingClientRect();
      setSelectionToolbarPos({
        x: rect.right + 8,
        y: rect.top - 8,
      });
      setShowSelectionToolbar(true);
    };
    document.addEventListener('selectionchange', handleSelection);
    return () => {
      document.removeEventListener('selectionchange', handleSelection);
    };
  }, []);

  function getAiTabStatusBadge(status?: string | null) {
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
  }

  useEffect(() => {
    const availableTabs: Array<'key_points' | 'outline' | 'quotes'> = [];
    if (showKeyPointsSection) availableTabs.push('key_points');
    if (showOutlineSection) availableTabs.push('outline');
    if (showQuotesSection) availableTabs.push('quotes');
    if (availableTabs.length === 0) return;
    if (!availableTabs.includes(activeAiTab)) {
      setActiveAiTab(availableTabs[0]);
    }
  }, [activeAiTab, showKeyPointsSection, showOutlineSection, showQuotesSection]);

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

  const saveNotes = async (nextNotes: string, nextAnnotations: ArticleAnnotation[]) => {
    if (!article) return;
    try {
      await articleApi.updateArticleNotes(article.id, {
        note_content: nextNotes,
        annotations: nextAnnotations,
      });
    } catch (error) {
      console.error('Failed to save notes:', error);
      showToast('保存失败', 'error');
    }
  };

  const handleSaveNoteContent = async () => {
    setNoteContent(noteDraft);
    setShowNoteModal(false);
    await saveNotes(noteDraft, annotations);
    showToast('已保存批注');
  };

  const handleStartAnnotation = () => {
    if (!contentRef.current) return;
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      showToast('请先选择需要划线的文字', 'info');
      return;
    }
    const range = selection.getRangeAt(0);
    if (range.collapsed) {
      showToast('请先选择需要划线的文字', 'info');
      return;
    }
    if (!contentRef.current.contains(range.commonAncestorContainer)) {
      showToast('请选择正文中的文字', 'info');
      return;
    }
    const { start, end } = getRangeOffsets(contentRef.current, range);
    if (start === end) {
      showToast('请选择正文中的文字', 'info');
      return;
    }
    setPendingAnnotationRange({ start, end });
    setPendingAnnotationText(range.toString());
    setPendingAnnotationComment('');
    setShowAnnotationModal(true);
    setShowSelectionToolbar(false);
    selection.removeAllRanges();
  };

  const handleConfirmAnnotation = async () => {
    if (!pendingAnnotationRange) return;
    if (!pendingAnnotationComment.trim()) {
      showToast('请输入划线批注内容', 'info');
      return;
    }
    const existingId = activeAnnotationId;
    const next = existingId
      ? annotations.map((item) =>
          item.id === existingId
            ? { ...item, comment: pendingAnnotationComment.trim() }
            : item,
        )
      : [
          ...annotations,
          {
            id: createAnnotationId(),
            start: pendingAnnotationRange.start,
            end: pendingAnnotationRange.end,
            comment: pendingAnnotationComment.trim(),
          },
        ];
    setAnnotations(next);
    setShowAnnotationModal(false);
    setPendingAnnotationRange(null);
    setActiveAnnotationId('');
    await saveNotes(noteContent, next);
    showToast(existingId ? '已更新划线批注' : '已添加划线批注');
  };

  const handleDeleteAnnotation = async (id: string) => {
    const next = annotations.filter((item) => item.id !== id);
    setAnnotations(next);
    if (activeAnnotationId === id) {
      setActiveAnnotationId('');
    }
    await saveNotes(noteContent, next);
    showToast('已删除划线批注');
  };

  const handleUpdateAnnotation = async () => {
    if (!activeAnnotation) return;
    const next = annotations.map((item) =>
      item.id === activeAnnotation.id
        ? { ...item, comment: annotationEditDraft.trim() }
        : item,
    );
    setAnnotations(next);
    await saveNotes(noteContent, next);
    showToast('已更新划线批注');
  };

  const handleSubmitComment = async () => {
    const content = replyPrefix ? `${replyPrefix}\n${commentDraft}` : commentDraft;
    if (!content.trim()) {
      showToast('请输入评论内容', 'info');
      return;
    }
    try {
      const data = await commentApi.createArticleComment(
        id as string,
        content.trim(),
        replyToId,
      );
      setComments((prev) => [data, ...prev]);
      setCommentPage(1);
      setCommentDraft('');
      setReplyToId(null);
      setReplyToUser('');
      setReplyTargetId(null);
      setReplyPrefix('');
      setPendingScrollId(data.id);
      showToast('评论已发布');
    } catch (error: any) {
      showToast(error?.message || '发布评论失败', 'error');
    }
  };

  const handleStartEditComment = (comment: ArticleComment) => {
    setEditingCommentId(comment.id);
    const parsed = extractReplyPrefix(comment.content);
    setEditingCommentPrefix(parsed.prefix);
    setEditingCommentDraft(parsed.body);
  };

  const handleSaveEditComment = async () => {
    if (!editingCommentId) return;
    if (!editingCommentDraft.trim()) {
      showToast('请输入评论内容', 'info');
      return;
    }
    try {
      const nextContent = editingCommentPrefix
        ? `${editingCommentPrefix}\n${editingCommentDraft.trim()}`
        : editingCommentDraft.trim();
      const data = await commentApi.updateComment(editingCommentId, nextContent);
      setComments((prev) =>
        prev.map((item) =>
          item.id === data.id
            ? { ...item, content: data.content, updated_at: data.updated_at }
            : item,
        ),
      );
      setEditingCommentId(null);
      setEditingCommentDraft('');
      setEditingCommentPrefix('');
      showToast('评论已更新');
    } catch (error: any) {
      showToast(error?.message || '更新评论失败', 'error');
    }
  };

  const handleDeleteComment = async (commentId: string) => {
    try {
      await commentApi.deleteComment(commentId);
      setComments((prev) => prev.filter((item) => item.id !== commentId));
      showToast('评论已删除');
    } catch (error: any) {
      showToast(error?.message || '删除评论失败', 'error');
    }
  };

  const handleToggleCommentHidden = async (comment: ArticleComment) => {
    try {
      const data = await commentApi.toggleHidden(comment.id, !comment.is_hidden);
      setComments((prev) =>
        prev.map((item) =>
          item.id === comment.id
            ? { ...item, is_hidden: data.is_hidden, updated_at: data.updated_at }
            : item,
        ),
      );
      showToast(data.is_hidden ? '评论已隐藏' : '评论已显示');
    } catch (error: any) {
      showToast(error?.message || '操作失败', 'error');
    }
  };

  const openDeleteCommentModal = (commentId: string) => {
    setPendingDeleteCommentId(commentId);
    setShowDeleteCommentModal(true);
  };

  const focusCommentInput = () => {
    if (commentInputRef.current) {
      commentInputRef.current.focus();
    }
  };

  const handleReplyTo = (comment: ArticleComment, rootId?: string) => {
    if (!session) {
      showToast('请先登录后再回复', 'info');
      return;
    }
    const link =
      typeof window !== 'undefined'
        ? `${window.location.origin}${window.location.pathname}#comment-${comment.id}`
        : '';
    setReplyToId(rootId || comment.id);
    setReplyToUser(comment.user_name);
    setReplyTargetId(comment.id);
    setReplyPrefix(`> 回复 @${comment.user_name}\n${link ? `> [原评论](${link})\n` : ''}`);
    focusCommentInput();
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
      <div className="min-h-screen bg-app flex flex-col">
        <AppHeader />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-text-3">加载中...</div>
        </div>
        <AppFooter />
      </div>
    );
  }

  if (!article) {
    return (
      <div className="min-h-screen bg-app flex flex-col">
        <AppHeader />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-text-3">文章不存在</div>
        </div>
        <AppFooter />
      </div>
    );
  }

  return (
    <div className={`min-h-screen ${immersiveMode ? 'bg-surface' : 'bg-app'} flex flex-col`}>
      <Head>
        <title>{article?.title ? `${article.title} - Lumina` : '文章详情 - Lumina'}</title>
      </Head>
      <ReadingProgress />
      <AppHeader />
		<section className={`bg-surface ${immersiveMode ? '' : 'border-b border-border'}`}>
			<div className="max-w-7xl mx-auto px-4 py-6">
          <h1 className="text-2xl font-bold text-text-1 text-center mb-3">
            {article.title}
          </h1>
          <div className={`flex flex-wrap gap-4 text-sm text-text-2 justify-center ${immersiveMode ? '' : 'border-b border-border pb-3'}`}>
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
            <div>
              <span className="font-medium text-text-2">发表时间：</span>
              {article.published_at
                ? new Date(article.published_at).toLocaleDateString('zh-CN')
                : new Date(article.created_at).toLocaleDateString('zh-CN')}
            </div>
            {article.source_url && (
              <div>
                <span className="font-medium text-text-2">来源：</span>
                <a
                  href={article.source_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  跳转
                </a>
              </div>
            )}
          </div>
        </div>
      </section>

			<div
				className={`max-w-7xl w-full mx-auto px-4 ${
					immersiveMode ? 'py-6' : 'py-8'
				} flex-1`}
			>
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
                  {!tocCollapsed && (
                    <TableOfContents
                      items={tocItems}
                      activeId={activeTocId}
                      onSelect={setActiveTocId}
                    />
                  )}
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
                        onClick={() => {
                          setNoteDraft(noteContent);
                          setShowNoteModal(true);
                        }}
                        className="flex items-center justify-center w-8 h-8 rounded-sm text-text-2 hover:text-text-1 hover:bg-muted transition"
                      >
                        <IconNote className="h-4 w-4" />
                      </button>
                      <button
                        onClick={handleToggleVisibility}
                        className="flex items-center justify-center w-8 h-8 rounded-sm text-text-2 hover:text-text-1 hover:bg-muted transition"
                      >
                        {article.is_visible ? <IconEye className="h-4 w-4" /> : <IconEyeOff className="h-4 w-4" />}
                      </button>
                      <button
                        onClick={() => openEditModal(showTranslation && article.content_trans ? 'translation' : 'original')}
                        className="flex items-center justify-center w-8 h-8 rounded-sm text-text-2 hover:text-text-1 hover:bg-muted transition"
                      >
                        <IconEdit className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => setShowDeleteModal(true)}
                        className="flex items-center justify-center w-8 h-8 rounded-sm text-text-2 hover:text-red-600 hover:bg-red-50 transition"
                      >
                        <IconTrash className="h-4 w-4" />
                      </button>
                    </>
                  )}
                  {article.content_trans && (
                    <button
                      onClick={() => setShowTranslation(!showTranslation)}
                      className="flex items-center justify-center w-8 h-8 rounded-sm text-text-2 hover:text-text-1 hover:bg-muted transition text-base"
                    >
                      {showTranslation ? '原文' : '译文'}
                    </button>
                  )}
                  <button
                    onClick={() => setImmersiveMode(!immersiveMode)}
                    className="flex items-center justify-center w-8 h-8 rounded-sm text-text-2 hover:text-text-1 hover:bg-muted transition"
                  >
                    <IconBook className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {noteContent && (
                <div className="note-panel mb-4 rounded-sm p-4 text-sm text-text-2">
                  <div className="note-panel-title text-sm mb-2">批注</div>
                  <div
                    className="prose prose-sm max-w-none"
                    dangerouslySetInnerHTML={{ __html: renderMarkdown(noteContent) }}
                  />
                </div>
              )}
              <div
                ref={contentRef}
                onClick={handleContentClick}
                onMouseOver={handleContentMouseOver}
                onMouseOut={handleContentMouseOut}
                className={`prose prose-sm max-w-none prose-img:cursor-zoom-in prose-img:rounded-lg prose-img:border prose-img:border-gray-200 prose-img:bg-white prose-img:shadow-sm ${
                  immersiveMode
                    ? 'immersive-content'
                    : 'prose-img:max-w-[320px] sm:prose-img:max-w-[420px]'
                }`}
                dangerouslySetInnerHTML={{ __html: renderedHtml }}
              />

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

              {commentsEnabled && !immersiveMode && (
                <section className="mt-10">
                  <div className="bg-surface border border-border rounded-sm p-5">
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-2">
                        <h3 className="text-base font-semibold text-text-1">评论</h3>
                        <span className="text-xs text-text-3">({totalTopComments})</span>
                      </div>
                      {session ? (
                        <div className="flex items-center gap-2 text-xs text-text-3">
                          <span>{session.user.name || '访客'}</span>
                          <div className="relative" ref={userMenuRef}>
                            {session.user.image && (
                              <button
                                type="button"
                                onClick={() => setShowUserMenu(!showUserMenu)}
                                className="focus:outline-none"
                              >
                                <img
                                  src={session.user.image}
                                  alt={session.user.name || '访客'}
                                  className="h-6 w-6 rounded-full object-cover cursor-pointer"
                                />
                              </button>
                            )}
                            {showUserMenu && (
                              <div className="absolute right-0 mt-2 min-w-[120px] rounded-sm border border-border bg-surface shadow-sm text-xs text-text-2 z-10">
                                <button
                                  onClick={() => {
                                    signOut();
                                    setShowUserMenu(false);
                                  }}
                                  className="w-full text-left px-3 py-2 hover:bg-muted hover:text-text-1 transition"
                                >
                                  退出登录
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          {commentProviders.github && (
                            <button
                              onClick={() => signIn('github')}
                              className="px-3 py-1 text-xs rounded-full border border-border text-text-2 hover:text-text-1 hover:bg-muted transition"
                            >
                              GitHub 登录
                            </button>
                          )}
                          {commentProviders.google && (
                            <button
                              onClick={() => signIn('google')}
                              className="px-3 py-1 text-xs rounded-full border border-border text-text-2 hover:text-text-1 hover:bg-muted transition"
                            >
                              Google 登录
                            </button>
                          )}
                          {!commentProviders.github && !commentProviders.google && (
                            <span className="text-xs text-text-3">未配置登录方式</span>
                          )}
                        </div>
                      )}
                    </div>

                    {session && !replyToId && (
                      <div className="mb-5">
                        {replyToId && (
                          <div className="mb-2 flex items-center justify-between rounded-sm border border-border bg-muted px-3 py-2 text-xs text-text-2">
                            <span>
                              回复 {replyToUser ? `@${replyToUser}` : ''}
                            </span>
                            <button
                              onClick={() => {
                                setReplyToId(null);
                                setReplyToUser('');
                                setReplyTargetId(null);
                              }}
                              className="text-text-3 hover:text-text-1 transition"
                            >
                              取消回复
                            </button>
                          </div>
                        )}
                        <textarea
                          ref={commentInputRef}
                          value={commentDraft}
                          onChange={(e) => setCommentDraft(e.target.value)}
                          rows={4}
                          className="w-full px-3 py-2 border border-border rounded-lg bg-surface text-text-1 focus:outline-none focus:ring-2 focus:ring-primary"
                          placeholder="写下你的评论，支持 Markdown"
                        />
                        <div className="flex justify-end mt-2">
                          <button
                            onClick={handleSubmitComment}
                            className="px-4 py-2 text-sm rounded-lg bg-primary text-white hover:opacity-90 transition"
                          >
                            发布评论
                          </button>
                        </div>
                      </div>
                    )}

                    {commentsLoading ? (
                      <div className="text-sm text-text-3">评论加载中...</div>
                    ) : totalTopComments === 0 ? (
                      <div className="text-sm text-text-3">暂无评论</div>
                    ) : (
                      <div className="space-y-4">
                        {pagedTopComments.map((comment) => {
                          const isOwner = session?.user?.id === comment.user_id;
                          const isEditing = editingCommentId === comment.id;
                          const replies = [...comments]
                            .filter((item) => item.reply_to_id === comment.id)
                            .sort(
                              (a, b) =>
                                new Date(b.created_at).getTime() -
                                new Date(a.created_at).getTime(),
                            );
                          const isExpanded = expandedReplies[comment.id] ?? false;
                          return (
                            <div
                              key={comment.id}
                              id={`comment-${comment.id}`}
                              className="border border-border rounded-lg p-4 bg-surface scroll-mt-24"
                            >
                              <div className="flex items-start justify-between gap-2 mb-2">
                                <div className="flex items-center gap-2">
                                  {comment.user_avatar && (
                                    <img
                                      src={comment.user_avatar}
                                      alt={comment.user_name}
                                      className="h-6 w-6 rounded-full object-cover"
                                    />
                                  )}
                                  <div className="text-sm text-text-1">{comment.user_name}</div>
                                  <a
                                    href={`#comment-${comment.id}`}
                                    className="text-xs text-text-3 hover:text-text-1 transition"
                                  >
                                    {new Date(comment.created_at).toLocaleString()}
                                  </a>
                                </div>
                                <div className="flex items-center gap-1.5">
                                  {isEditing ? (
                                    <>
                                       <IconButton
                                        onClick={() => {
                                          setEditingCommentId(null);
                                          setEditingCommentDraft('');
                                          setEditingCommentPrefix('');
                                        }}
                                        variant="danger"
                                        size="sm"
                                        title="取消"
                                        className="rounded-full"
                                      >
                                        ×
                                      </IconButton>
                                      <IconButton
                                        onClick={handleSaveEditComment}
                                        variant="primary"
                                        size="sm"
                                        title="保存"
                                        className="rounded-full"
                                      >
                                        <IconCheck className="h-3.5 w-3.5" />
                                      </IconButton>
                                    </>
                                  ) : (
                                    <>
                                      <IconButton
                                        onClick={() => handleReplyTo(comment)}
                                        variant="ghost"
                                        size="sm"
                                        title="回复"
                                        className="rounded-full"
                                      >
                                        <IconReply className="h-3.5 w-3.5" />
                                      </IconButton>
                                          {isAdmin && (
                                            <IconButton
                                              onClick={() => handleToggleCommentHidden(comment)}
                                              variant="ghost"
                                              size="sm"
                                              title={comment.is_hidden ? "显示" : "隐藏"}
                                              className="rounded-full"
                                            >
                                              {comment.is_hidden ? (
                                                <IconEye className="h-3.5 w-3.5" />
                                              ) : (
                                                <IconEyeOff className="h-3.5 w-3.5" />
                                              )}
                                            </IconButton>
                                          )}
                                          {isOwner && (
                                            <>
                                              <IconButton
                                                onClick={() => handleStartEditComment(comment)}
                                                variant="ghost"
                                                size="sm"
                                                title="编辑"
                                                className="rounded-full"
                                              >
                                                <IconEdit className="h-3.5 w-3.5" />
                                              </IconButton>
                                              <IconButton
                                                onClick={() => openDeleteCommentModal(comment.id)}
                                                variant="danger"
                                                size="sm"
                                                title="删除"
                                                className="rounded-full"
                                              >
                                                <IconTrash className="h-3.5 w-3.5" />
                                              </IconButton>
                                            </>
                                          )}
                                    </>
                                  )}
                                </div>
                              </div>
                              {isEditing ? (
                                <div>
                                  <textarea
                                    value={editingCommentDraft}
                                    onChange={(e) => setEditingCommentDraft(e.target.value)}
                                    rows={4}
                                    className="w-full px-3 py-2 border border-border rounded-lg bg-surface text-text-1 focus:outline-none focus:ring-2 focus:ring-primary"
                                  />
                                </div>
                              ) : (
                                (() => {
                                  const meta = getReplyMeta(comment.content);
                                  const body = extractReplyPrefix(comment.content).body;
                                  return (
                                    <div>
                                      {meta && (
                                        <div className="text-xs text-text-3 mb-2">
                                          <span>回复 @{meta.user}</span>
                                          {meta.link && (
                                            <a
                                              href={meta.link}
                                              className="ml-2 text-text-3 hover:text-text-1 transition underline"
                                            >
                                              原评论
                                            </a>
                                          )}
                                        </div>
                                      )}
                                      <div
                                        className="prose prose-sm max-w-none text-text-2"
                                        style={{ wordBreak: 'break-word', overflowWrap: 'anywhere', whiteSpace: 'normal' }}
                                        dangerouslySetInnerHTML={{ __html: renderMarkdown(body) }}
                                      />
                                    </div>
                                  );
                                })()
                              )}

                              {session && replyTargetId === comment.id && (
                                <div
                                  id={`reply-box-${comment.id}`}
                                  className="mt-3 border border-border rounded-lg p-3 bg-muted"
                                >
                                  <div className="mb-2 text-xs text-text-2">
                                    回复 {replyToUser ? `@${replyToUser}` : ''}
                                  </div>
                                  <textarea
                                    ref={commentInputRef}
                                    value={commentDraft}
                                    onChange={(e) => setCommentDraft(e.target.value)}
                                    rows={3}
                                    className="w-full px-3 py-2 border border-border rounded-lg bg-surface text-text-1 focus:outline-none focus:ring-2 focus:ring-primary"
                                    placeholder="写下你的回复，支持 Markdown"
                                  />
                                  <div className="flex justify-end gap-1.5 mt-2">
                                    <IconButton
                                      onClick={() => {
                                        setReplyToId(null);
                                        setReplyToUser('');
                                        setReplyTargetId(null);
                                        setReplyPrefix('');
                                      }}
                                      variant="ghost"
                                      size="sm"
                                      title="取消"
                                      className="rounded-full"
                                    >
                                      ×
                                    </IconButton>
                                    <IconButton
                                      onClick={handleSubmitComment}
                                      variant="primary"
                                      size="sm"
                                      title="发布"
                                      className="rounded-full"
                                    >
                                      <IconCheck className="h-3.5 w-3.5" />
                                    </IconButton>
                                  </div>
                                </div>
                              )}

                              {replies.length > 0 && (
                                <div className="mt-4 border-t border-border pt-3">
                                  <button
                                    onClick={() =>
                                      setExpandedReplies((prev) => ({
                                        ...prev,
                                        [comment.id]: !isExpanded,
                                      }))
                                    }
                                    className="inline-flex items-center gap-1 text-xs text-text-3 hover:text-text-1 transition"
                                    title={isExpanded ? "收起回复" : "查看回复"}
                                  >
                                    {isExpanded ? (
                                      <IconChevronUp className="h-3.5 w-3.5" />
                                    ) : (
                                      <IconChevronDown className="h-3.5 w-3.5" />
                                    )}
                                    <span>{replies.length}</span>
                                  </button>
                                  {isExpanded && (
                                    <div className="mt-3 space-y-3">
                                      {replies.map((reply) => (
                                        <div
                                          key={reply.id}
                                          id={`comment-${reply.id}`}
                                          className="border border-border rounded-lg p-3 bg-muted"
                                        >
                                          <div className="flex items-start justify-between gap-2 mb-2">
                                            <div className="flex items-center gap-2">
                                              {reply.user_avatar && (
                                                <img
                                                  src={reply.user_avatar}
                                                  alt={reply.user_name}
                                                  className="h-5 w-5 rounded-full object-cover"
                                                />
                                              )}
                                              <div className="text-xs text-text-1">{reply.user_name}</div>
                                              <a
                                                href={`#comment-${reply.id}`}
                                                className="text-xs text-text-3 hover:text-text-1 transition"
                                              >
                                                {new Date(reply.created_at).toLocaleString()}
                                              </a>
                                            </div>
                                            <div className="flex items-center gap-1.5">
                                              {editingCommentId === reply.id ? (
                                                <>
                                                  <IconButton
                                                    onClick={() => {
                                                      setEditingCommentId(null);
                                                      setEditingCommentDraft('');
                                                      setEditingCommentPrefix('');
                                                    }}
                                                    variant="ghost"
                                                    size="sm"
                                                    title="取消"
                                                    className="rounded-full"
                                                  >
                                                    ×
                                                  </IconButton>
                                                  <IconButton
                                                    onClick={handleSaveEditComment}
                                                    variant="primary"
                                                    size="sm"
                                                    title="保存"
                                                    className="rounded-full"
                                                  >
                                                    <IconCheck className="h-3.5 w-3.5" />
                                                  </IconButton>
                                                </>
                                              ) : (
                                                <>
                                                  <IconButton
                                                    onClick={() => handleReplyTo(reply, comment.id)}
                                                    variant="ghost"
                                                    size="sm"
                                                    title="回复"
                                                    className="rounded-full"
                                                  >
                                                    <IconReply className="h-3.5 w-3.5" />
                                                  </IconButton>
                                                {isAdmin && (
                                                  <IconButton
                                                    onClick={() => handleToggleCommentHidden(reply)}
                                                    variant="ghost"
                                                    size="sm"
                                                    title={reply.is_hidden ? "显示" : "隐藏"}
                                                    className="rounded-full"
                                                  >
                                                    {reply.is_hidden ? (
                                                      <IconEye className="h-3.5 w-3.5" />
                                                    ) : (
                                                      <IconEyeOff className="h-3.5 w-3.5" />
                                                    )}
                                                  </IconButton>
                                                )}
                                                {session?.user?.id === reply.user_id && (
                                                  <>
                                                    <IconButton
                                                      onClick={() => handleStartEditComment(reply)}
                                                      variant="ghost"
                                                      size="sm"
                                                      title="编辑"
                                                      className="rounded-full"
                                                    >
                                                      <IconEdit className="h-3.5 w-3.5" />
                                                    </IconButton>
                                                    <IconButton
                                                      onClick={() => openDeleteCommentModal(reply.id)}
                                                      variant="danger"
                                                      size="sm"
                                                      title="删除"
                                                      className="rounded-full"
                                                    >
                                                      <IconTrash className="h-3.5 w-3.5" />
                                                    </IconButton>
                                                  </>
                                                )}
                                                </>
                                              )}
                                            </div>
                                          </div>
                                          {editingCommentId === reply.id ? (
                                            <div>
                                              <textarea
                                                value={editingCommentDraft}
                                                onChange={(e) => setEditingCommentDraft(e.target.value)}
                                                rows={3}
                                                className="w-full px-3 py-2 border border-border rounded-lg bg-surface text-text-1 focus:outline-none focus:ring-2 focus:ring-primary"
                                              />
                                            </div>
                                          ) : (
                                            (() => {
                                              const meta = getReplyMeta(reply.content);
                                              const body = extractReplyPrefix(reply.content).body;
                                              return (
                                                <div>
                                                  {meta && (
                                                    <div className="text-xs text-text-3 mb-2">
                                                      <span>回复 @{meta.user}</span>
                                                      {meta.link && (
                                                        <a
                                                          href={meta.link}
                                                          className="ml-2 text-text-3 hover:text-text-1 transition underline"
                                                        >
                                                          原评论
                                                        </a>
                                                      )}
                                                    </div>
                                                  )}
                                                  <div
                                                    className="prose prose-sm max-w-none text-text-2"
                                                    style={{ wordBreak: 'break-word', overflowWrap: 'anywhere', whiteSpace: 'normal' }}
                                                    dangerouslySetInnerHTML={{ __html: renderMarkdown(body) }}
                                                  />
                                                </div>
                                              );
                                            })()
                                          )}

                                          {session && replyTargetId === reply.id && (
                                            <div
                                              id={`reply-box-${reply.id}`}
                                              className="mt-3 border border-border rounded-lg p-3 bg-surface"
                                            >
                                              <div className="mb-2 text-xs text-text-2">
                                                回复 {replyToUser ? `@${replyToUser}` : ''}
                                              </div>
                                              <textarea
                                                ref={commentInputRef}
                                                value={commentDraft}
                                                onChange={(e) => setCommentDraft(e.target.value)}
                                                rows={3}
                                                className="w-full px-3 py-2 border border-border rounded-lg bg-surface text-text-1 focus:outline-none focus:ring-2 focus:ring-primary"
                                                placeholder="写下你的回复，支持 Markdown"
                                              />
                                              <div className="flex justify-end gap-1.5 mt-2">
                                                <IconButton
                                                  onClick={() => {
                                                    setReplyToId(null);
                                                    setReplyToUser('');
                                                    setReplyTargetId(null);
                                                    setReplyPrefix('');
                                                  }}
                                                  variant="ghost"
                                                  size="sm"
                                                  title="取消"
                                                  className="rounded-full"
                                                >
                                                  ×
                                                </IconButton>
                                                <IconButton
                                                  onClick={handleSubmitComment}
                                                  variant="primary"
                                                  size="sm"
                                                  title="发布"
                                                  className="rounded-full"
                                                >
                                                  <IconCheck className="h-3.5 w-3.5" />
                                                </IconButton>
                                              </div>
                                            </div>
                                          )}
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {totalCommentPages > 1 && (
                      <div className="mt-4 flex items-center justify-between text-xs text-text-3">
                        <Button
                          type="button"
                          onClick={() => setCommentPage((prev) => Math.max(1, prev - 1))}
                          disabled={commentPage === 1}
                          variant="secondary"
                          size="sm"
                        >
                          上一页
                        </Button>
                        <span className="px-4 py-2 text-sm bg-surface border border-border rounded-sm text-text-2">
                          {commentPage} / {totalCommentPages}
                        </span>
                        <Button
                          type="button"
                          onClick={() =>
                            setCommentPage((prev) =>
                              Math.min(totalCommentPages, prev + 1),
                            )
                          }
                          disabled={commentPage === totalCommentPages}
                          variant="secondary"
                          size="sm"
                        >
                          下一页
                        </Button>
                      </div>
                    )}
                  </div>
                </section>
              )}
            </div>

            {!immersiveMode && (
              <aside className={`flex-shrink-0 transition-all duration-300 ${analysisCollapsed ? 'w-12' : 'w-96'}`}>
              <div className="bg-white rounded-lg shadow-sm p-4 sticky top-4 max-h-[calc(100vh-2rem)] overflow-y-auto">
                <div className="flex items-center justify-between mb-4">
                  {!analysisCollapsed && (
                    <div>
                  <h2 className="text-lg font-semibold text-gray-900 inline-flex items-center gap-2">
                    <IconRobot className="h-4 w-4" />
                    <span>AI解读</span>
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

                    {(showKeyPointsSection || showOutlineSection || showQuotesSection) && (
                      <div className="space-y-4">
                        <div className="flex items-center justify-between gap-4">
                          <div className="relative flex-1">
                            <div className="flex items-center gap-2 overflow-x-auto pb-1 pr-6">
                              {aiTabConfigs.filter((tab) => tab.enabled).map((tab) => (
                                <button
                                  key={tab.key}
                                  type="button"
                                  onClick={() => setActiveAiTab(tab.key)}
                                  className={`px-3 py-1.5 text-base font-semibold rounded-sm transition ${
                                    activeAiTab === tab.key
                                      ? 'bg-muted text-text-1'
                                      : 'text-text-2 hover:text-text-1 hover:bg-muted'
                                  }`}
                                >
                                  {tab.label}
                                </button>
                              ))}
                            </div>
                            <div className="pointer-events-none absolute right-0 top-0 h-full w-8 ai-tab-fade" />
                          </div>
                          <div className="flex items-center gap-2 pr-2 shrink-0">
                            {activeStatusBadge && aiStatusLink ? (
                              <Link href={aiStatusLink} className="hover:opacity-80 transition">
                                {activeStatusBadge}
                              </Link>
                            ) : (
                              activeStatusBadge
                            )}
                            {showActiveGenerateButton && activeTabConfig && (
                              <button
                                onClick={activeTabConfig.onGenerate}
                                className="text-text-3 hover:text-primary transition"
                                title={activeTabConfig.content ? '重新生成' : '生成'}
                                type="button"
                              >
                                {activeTabConfig.content ? <IconRefresh className="h-4 w-4" /> : <IconBolt className="h-4 w-4" />}
                              </button>
                            )}
                            {showActiveCopyButton && activeTabConfig && (
                              <button
                                onClick={activeTabConfig.onCopy}
                                className="text-text-3 hover:text-primary transition"
                                title="复制内容"
                                type="button"
                              >
                                <IconCopy className="h-4 w-4" />
                              </button>
                            )}
                          </div>
                        </div>

                        {activeTabConfig && (
                          <AIContentSection
                            title={activeTabConfig.label}
                            content={activeTabConfig.content}
                            status={activeTabConfig.status}
                            onGenerate={activeTabConfig.onGenerate}
                            onCopy={activeTabConfig.onCopy}
                            canEdit={isAdmin}
                            renderMarkdown={activeTabConfig.renderMarkdown}
                            renderMindMap={activeTabConfig.renderMindMap}
                            onMindMapOpen={activeTabConfig.onMindMapOpen}
                            showStatus={isAdmin}
                            statusLink={aiStatusLink}
                            showHeader={false}
                          />
                        )}
                      </div>
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

      {showSelectionToolbar && selectionToolbarPos && isAdmin && (
        <div
          className="fixed z-40"
          style={{ left: selectionToolbarPos.x, top: selectionToolbarPos.y }}
        >
          <button
            onClick={handleStartAnnotation}
            className="w-7 h-7 flex items-center justify-center border border-blue-400 text-blue-600 rounded-full bg-white/80 hover:bg-blue-50 transition"
          >
            <IconEdit className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {hoverAnnotationId && hoverTooltipPos && (
        <div
          className="fixed z-40 pointer-events-none"
          style={{ left: hoverTooltipPos.x, top: hoverTooltipPos.y }}
        >
          <div
            className="annotation-tooltip w-max max-w-[30rem] rounded-md text-xs px-3 py-2 shadow-lg backdrop-blur"
            style={{ transform: 'translate(-50%, calc(-100% - 8px))' }}
          >
            <div className="max-h-[4.5rem] overflow-hidden">
              <div
                className="prose prose-sm max-w-none text-gray-800"
                style={{
                  display: '-webkit-box',
                  WebkitLineClamp: 3,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden',
                  whiteSpace: 'normal',
                  wordBreak: 'break-word',
                  overflowWrap: 'anywhere',
                }}
                dangerouslySetInnerHTML={{
                  __html:
                    renderMarkdown(
                      annotations.find((item) => item.id === hoverAnnotationId)?.comment || ''
                    ) || '',
                }}
              />
            </div>
          </div>
        </div>
      )}

      {showAnnotationView && activeAnnotation && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          onClick={() => setShowAnnotationView(false)}
        >
          <div
            className="bg-white rounded-lg shadow-xl max-w-lg w-full overflow-hidden"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between p-4 border-b">
              <h3 className="text-lg font-semibold text-gray-900">划线批注内容</h3>
              <button
                onClick={() => setShowAnnotationView(false)}
                className="text-gray-500 hover:text-gray-700 text-2xl"
              >
                ×
              </button>
            </div>
            <div className="p-4 text-sm text-gray-700">
              {activeAnnotationText && (
                <div
                  className="mb-3 p-3 bg-gray-50 border border-gray-200 rounded text-xs text-gray-600"
                  dangerouslySetInnerHTML={{ __html: activeAnnotationText }}
                />
              )}
              <div
                className="prose prose-sm max-w-none"
                style={{ wordBreak: 'break-word', overflowWrap: 'anywhere', whiteSpace: 'normal' }}
                dangerouslySetInnerHTML={{
                  __html: renderMarkdown(activeAnnotation.comment),
                }}
              />
            </div>
            <div className="flex justify-end gap-2 p-4 border-t bg-gray-50 rounded-b-lg">
              {isAdmin && (
                <>
                  <button
                    onClick={() => {
                      setActiveAnnotationId(activeAnnotation.id);
                      setPendingAnnotationRange({
                        start: activeAnnotation.start,
                        end: activeAnnotation.end,
                      });
                      setPendingAnnotationText(activeAnnotationText || '');
                      setPendingAnnotationComment(activeAnnotation.comment);
                      setShowAnnotationView(false);
                      setShowAnnotationModal(true);
                    }}
                    className="px-4 py-2 text-blue-600 rounded-lg hover:bg-blue-50 transition"
                  >
                    编辑
                  </button>
                  <button
                    onClick={() => {
                      handleDeleteAnnotation(activeAnnotation.id);
                      setShowAnnotationView(false);
                    }}
                    className="px-4 py-2 text-red-600 rounded-lg hover:bg-red-50 transition"
                  >
                    删除
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {showNoteModal && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          onClick={() => setShowNoteModal(false)}
        >
          <div
            className="bg-white rounded-lg shadow-xl max-w-lg w-full"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between p-4 border-b">
              <h3 className="text-lg font-semibold text-gray-900">批注内容</h3>
              <button
                onClick={() => setShowNoteModal(false)}
                className="text-gray-500 hover:text-gray-700 text-2xl"
              >
                ×
              </button>
            </div>
            <div className="p-4">
              <textarea
                value={noteDraft}
                onChange={(e) => setNoteDraft(e.target.value)}
                rows={6}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="输入批注内容，支持 Markdown"
              />
            </div>
            <div className="flex justify-end gap-2 p-4 border-t bg-gray-50">
              <button
                onClick={() => setShowNoteModal(false)}
                className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition"
              >
                取消
              </button>
              <button
                onClick={handleSaveNoteContent}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}

      {showAnnotationModal && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          onClick={() => setShowAnnotationModal(false)}
        >
          <div
            className="bg-white rounded-lg shadow-xl max-w-lg w-full"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between p-4 border-b">
              <h3 className="text-lg font-semibold text-gray-900">添加划线批注</h3>
              <button
                onClick={() => setShowAnnotationModal(false)}
                className="text-gray-500 hover:text-gray-700 text-2xl"
              >
                ×
              </button>
            </div>
            <div className="p-4 space-y-3">
              <div className="text-xs text-gray-500">已选内容：</div>
              <div className="p-3 bg-gray-50 border border-gray-200 rounded text-sm text-gray-700">
                {pendingAnnotationText || '（无）'}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  划线批注内容
                </label>
                <textarea
                  value={pendingAnnotationComment}
                  onChange={(e) => setPendingAnnotationComment(e.target.value)}
                  rows={4}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="输入划线批注内容"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 p-4 border-t bg-gray-50">
              <button
                onClick={() => setShowAnnotationModal(false)}
                className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition"
              >
                取消
              </button>
              <button
                onClick={handleConfirmAnnotation}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
              >
                {activeAnnotationId ? '保存' : '添加'}
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmModal
        isOpen={showDeleteCommentModal}
        title="删除评论"
        message="确定要删除这条评论吗？此操作不可撤销。"
        confirmText="删除"
        cancelText="取消"
        onConfirm={() => {
          if (pendingDeleteCommentId) {
            handleDeleteComment(pendingDeleteCommentId);
          }
          setShowDeleteCommentModal(false);
          setPendingDeleteCommentId(null);
        }}
        onCancel={() => {
          setShowDeleteCommentModal(false);
          setPendingDeleteCommentId(null);
        }}
      />

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

      <AppFooter />
      <BackToTop />
    </div>
  );
}
