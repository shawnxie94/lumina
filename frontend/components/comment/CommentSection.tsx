import {
  type MouseEvent as ReactMouseEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { Session } from "next-auth";

import Button from "@/components/Button";
import IconButton from "@/components/IconButton";
import { useToast } from "@/components/Toast";
import {
  IconCheck,
  IconChevronDown,
  IconChevronUp,
  IconEdit,
  IconEye,
  IconEyeOff,
  IconRefresh,
  IconReply,
  IconTrash,
} from "@/components/icons";
import TextArea from "@/components/ui/TextArea";
import type { ArticleComment, ReviewComment } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { renderSafeMarkdown } from "@/lib/safeHtml";

export type CommentType = ArticleComment | ReviewComment;

type CommentProviders = {
  github: boolean;
  google: boolean;
};

type CommentLocation = {
  topCommentId: string;
  page: number;
};

type CommentNavigationState = {
  page: number;
  expandIds: string[];
};

export function extractReplyPrefix(content: string): {
  prefix: string;
  body: string;
} {
  if (!content) return { prefix: "", body: "" };
  const lines = content.split("\n");
  const prefixLines: string[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (
      line.startsWith("> 回复 @") ||
      line.startsWith("> Reply @") ||
      line.startsWith("> [原评论](") ||
      line.startsWith("> [Original Comment](") ||
      line.startsWith("> [原评论链接](") ||
      line.startsWith("> [Original Comment Link](")
    ) {
      prefixLines.push(line);
      index += 1;
      continue;
    }
    if (prefixLines.length > 0 && line.trim() === "") {
      index += 1;
      break;
    }
    break;
  }

  if (prefixLines.length === 0) {
    return { prefix: "", body: content };
  }

  return {
    prefix: prefixLines.join("\n"),
    body: lines.slice(index).join("\n"),
  };
}

export function extractCommentBody(content: string): string {
  if (!content) return "";
  const { body } = extractReplyPrefix(content);
  return body.trim() || content;
}

export function extractCommentIdFromHash(hash: string): string {
  const match = hash.match(/^#comment-(.+)$/);
  return match ? match[1] : "";
}

export function extractCommentIdFromLink(link: string): string {
  if (!link) return "";
  if (link.startsWith("#")) {
    return extractCommentIdFromHash(link);
  }
  try {
    const url = new URL(link, "http://localhost");
    return extractCommentIdFromHash(url.hash);
  } catch {
    return "";
  }
}

export function getReplyMeta(
  content: string,
): { user: string; link: string } | null {
  if (!content) return null;
  const { prefix } = extractReplyPrefix(content);
  if (!prefix) return null;
  const userMatch = prefix.match(/> (回复|Reply) @(.+)/);
  const linkMatch = prefix.match(
    /\[(原评论|Original Comment|原评论链接|Original Comment Link)\]\((.+)\)/,
  );
  const user = userMatch ? userMatch[2].trim() : "";
  const link = linkMatch ? linkMatch[2].trim() : "";
  if (!user && !link) return null;
  return { user, link };
}

export function collectReplyAncestorIds(
  commentId: string,
  comments: CommentType[],
): string[] {
  if (!commentId || comments.length === 0) return [];
  const byId = new Map(comments.map((comment) => [comment.id, comment]));
  const ancestors: string[] = [];
  const visited = new Set<string>();
  let current = byId.get(commentId);

  while (current?.reply_to_id) {
    if (visited.has(current.id)) break;
    visited.add(current.id);
    ancestors.unshift(current.reply_to_id);
    current = byId.get(current.reply_to_id);
  }

  return ancestors;
}

export function collectReplyThreadIds(
  commentId: string,
  comments: CommentType[],
): string[] {
  if (!commentId) return [];
  return [...collectReplyAncestorIds(commentId, comments), commentId];
}

export function collectCommentDescendantIds(
  commentId: string,
  comments: CommentType[],
): string[] {
  if (!commentId || comments.length === 0) return [];
  const byParent = new Map<string, string[]>();
  comments.forEach((comment) => {
    if (!comment.reply_to_id) return;
    const items = byParent.get(comment.reply_to_id) || [];
    items.push(comment.id);
    byParent.set(comment.reply_to_id, items);
  });

  const descendants: string[] = [];
  const queue = [...(byParent.get(commentId) || [])];
  while (queue.length > 0) {
    const currentId = queue.shift();
    if (!currentId || descendants.includes(currentId)) continue;
    descendants.push(currentId);
    queue.push(...(byParent.get(currentId) || []));
  }

  return descendants;
}

export function resolveCommentLocation(
  commentId: string,
  comments: CommentType[],
  pageSize: number,
): CommentLocation | null {
  if (!commentId || comments.length === 0) return null;
  const ancestors = collectReplyAncestorIds(commentId, comments);
  const topCommentId = ancestors[0] || commentId;
  const topComments = [...comments]
    .filter((comment) => !comment.reply_to_id)
    .sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    );
  const topIndex = topComments.findIndex((comment) => comment.id === topCommentId);
  if (topIndex < 0) return null;
  return {
    topCommentId,
    page: Math.floor(topIndex / pageSize) + 1,
  };
}

export function resolveCommentNavigationState(
  commentId: string,
  comments: CommentType[],
  pageSize: number,
): CommentNavigationState | null {
  if (!commentId) return null;
  const location = resolveCommentLocation(commentId, comments, pageSize);
  if (!location) return null;
  return {
    page: location.page,
    expandIds: collectReplyAncestorIds(commentId, comments),
  };
}

interface CommentSectionProps {
  comments: CommentType[];
  session: Session | null;
  isAdmin: boolean;
  onSubmitComment: (
    content: string,
    replyToId?: string | null,
  ) => Promise<CommentType | void>;
  onUpdateComment: (commentId: string, content: string) => Promise<void>;
  onDeleteComment: (commentId: string) => Promise<void>;
  onToggleHidden?: (commentId: string, isHidden: boolean) => Promise<void>;
  loading?: boolean;
  className?: string;
  pageSize?: number;
  displayCommentCount?: number;
  commentProviders?: CommentProviders;
  onSignIn?: (provider: string) => void;
  onSignOut?: () => void;
  initialExpandedReplyIds?: string[];
}

interface CommentItemProps {
  comment: CommentType;
  session: Session | null;
  isAdmin: boolean;
  isReply?: boolean;
  isEditing: boolean;
  isHighlighted: boolean;
  isUpdating: boolean;
  isDeleting: boolean;
  isToggling: boolean;
  commentSubmitting: boolean;
  onReply: (comment: CommentType) => void;
  onEdit: (comment: CommentType) => void;
  onCancelEdit: () => void;
  onSaveEdit: () => void;
  onDelete: (commentId: string) => void;
  onToggleHidden?: (comment: CommentType) => void;
  renderCommentBody: (comment: CommentType, isReply: boolean) => React.ReactNode;
  replyBox?: React.ReactNode;
  repliesList?: React.ReactNode;
}

function CommentItem({
  comment,
  session,
  isAdmin,
  isReply = false,
  isEditing,
  isHighlighted,
  isUpdating,
  isDeleting,
  isToggling,
  commentSubmitting,
  onReply,
  onEdit,
  onCancelEdit,
  onSaveEdit,
  onDelete,
  onToggleHidden,
  renderCommentBody,
  replyBox,
  repliesList,
}: CommentItemProps) {
  const { t } = useI18n();
  const isOwner = session?.user?.id === comment.user_id;
  const canDelete = isOwner || isAdmin;

  const avatarImage = (
    <img
      src={comment.user_avatar || ""}
      alt={comment.user_name}
      className={
        isReply
          ? "h-5 w-5 rounded-full object-cover"
          : "h-6 w-6 rounded-full object-cover hover:ring-2 hover:ring-primary/40 transition"
      }
      width={isReply ? 20 : 24}
      height={isReply ? 20 : 24}
      loading="lazy"
      decoding="async"
    />
  );

  const avatar = comment.user_avatar ? (
    comment.user_github_url ? (
      <a
        href={comment.user_github_url}
        target="_blank"
        rel="noopener noreferrer"
        title={`${comment.user_name} (GitHub)`}
      >
        {avatarImage}
      </a>
    ) : (
      avatarImage
    )
  ) : null;

  return (
    <div
      id={`comment-${comment.id}`}
      className={`border border-border rounded-lg transition-colors duration-700 ${
        isReply
          ? `bg-muted p-3 ${isHighlighted ? "ring-2 ring-primary/35 bg-primary-soft/30" : ""}`
          : `bg-surface p-4 scroll-mt-24 ${isHighlighted ? "ring-2 ring-primary/40 bg-primary-soft/35" : ""}`
      }`}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-2">
          {avatar}
          <div className={`text-text-1 ${isReply ? "text-xs" : "text-sm"}`}>
            {comment.user_name}
          </div>
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
                onClick={onCancelEdit}
                variant="danger"
                size="sm"
                title={t("取消")}
                disabled={isUpdating}
                className="rounded-full"
              >
                ×
              </IconButton>
              <IconButton
                onClick={onSaveEdit}
                variant="primary"
                size="sm"
                title={isUpdating ? t("保存中...") : t("保存")}
                loading={isUpdating}
                disabled={isUpdating}
                className="rounded-full"
              >
                <IconCheck className="h-3.5 w-3.5" />
              </IconButton>
            </>
          ) : (
            <>
              <IconButton
                onClick={() => onReply(comment)}
                variant="ghost"
                size="sm"
                title={t("回复")}
                disabled={commentSubmitting || isUpdating || isDeleting}
                className="rounded-full"
              >
                <IconReply className="h-3.5 w-3.5" />
              </IconButton>
              {isAdmin && onToggleHidden ? (
                <IconButton
                  onClick={() => onToggleHidden(comment)}
                  variant="ghost"
                  size="sm"
                  title={
                    isToggling
                      ? t("处理中...")
                      : comment.is_hidden
                        ? t("显示")
                        : t("隐藏")
                  }
                  loading={isToggling}
                  disabled={isToggling || isDeleting}
                  className="rounded-full"
                >
                  {comment.is_hidden ? (
                    <IconEye className="h-3.5 w-3.5" />
                  ) : (
                    <IconEyeOff className="h-3.5 w-3.5" />
                  )}
                </IconButton>
              ) : null}
              {isOwner ? (
                <IconButton
                  onClick={() => onEdit(comment)}
                  variant="ghost"
                  size="sm"
                  title={t("编辑")}
                  disabled={isDeleting || isToggling || isUpdating}
                  className="rounded-full"
                >
                  <IconEdit className="h-3.5 w-3.5" />
                </IconButton>
              ) : null}
              {canDelete ? (
                <IconButton
                  onClick={() => onDelete(comment.id)}
                  variant="danger"
                  size="sm"
                  title={isDeleting ? t("删除中...") : t("删除")}
                  loading={isDeleting}
                  disabled={isDeleting || isUpdating || isToggling}
                  className="rounded-full"
                >
                  <IconTrash className="h-3.5 w-3.5" />
                </IconButton>
              ) : null}
            </>
          )}
        </div>
      </div>
      {renderCommentBody(comment, isReply)}
      {replyBox}
      {repliesList}
    </div>
  );
}

export default function CommentSection({
  comments,
  session,
  isAdmin,
  onSubmitComment,
  onUpdateComment,
  onDeleteComment,
  onToggleHidden,
  loading = false,
  className = "",
  pageSize = 5,
  displayCommentCount,
  commentProviders,
  onSignIn,
  onSignOut,
  initialExpandedReplyIds,
}: CommentSectionProps) {
  const { t } = useI18n();
  const { showToast } = useToast();
  const commentInputRef = useRef<HTMLTextAreaElement>(null);
  const userMenuRef = useRef<HTMLDivElement | null>(null);

  const [commentDraft, setCommentDraft] = useState("");
  const [commentSubmitting, setCommentSubmitting] = useState(false);
  const [replyToId, setReplyToId] = useState<string | null>(null);
  const [replyToUser, setReplyToUser] = useState("");
  const [replyTargetId, setReplyTargetId] = useState<string | null>(null);
  const [replyPrefix, setReplyPrefix] = useState("");
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editingCommentDraft, setEditingCommentDraft] = useState("");
  const [editingCommentPrefix, setEditingCommentPrefix] = useState("");
  const [expandedReplies, setExpandedReplies] = useState<Record<string, boolean>>(
    () =>
      Object.fromEntries(
        (initialExpandedReplyIds || []).map((commentId) => [commentId, true]),
      ),
  );
  const [commentPage, setCommentPage] = useState(1);
  const [commentUpdatingIds, setCommentUpdatingIds] = useState<Set<string>>(
    new Set(),
  );
  const [commentDeletingIds, setCommentDeletingIds] = useState<Set<string>>(
    new Set(),
  );
  const [commentTogglingIds, setCommentTogglingIds] = useState<Set<string>>(
    new Set(),
  );
  const [pendingScrollId, setPendingScrollId] = useState<string | null>(null);
  const [highlightedCommentId, setHighlightedCommentId] = useState<string | null>(
    null,
  );
  const [showUserMenu, setShowUserMenu] = useState(false);

  const providers = commentProviders ?? { github: false, google: false };

  const sortedTopComments = useMemo(
    () =>
      [...comments]
        .filter((comment) => !comment.reply_to_id)
        .sort(
          (a, b) =>
            new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
        ),
    [comments],
  );

  const repliesByParent = useMemo<Record<string, CommentType[]>>(() => {
    const grouped: Record<string, CommentType[]> = {};
    comments.forEach((comment) => {
      if (!comment.reply_to_id) return;
      if (!grouped[comment.reply_to_id]) {
        grouped[comment.reply_to_id] = [];
      }
      grouped[comment.reply_to_id].push(comment);
    });
    Object.values(grouped).forEach((replyList) => {
      replyList.sort(
        (a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      );
    });
    return grouped;
  }, [comments]);

  const totalTopComments = sortedTopComments.length;
  const visibleCommentCount =
    typeof displayCommentCount === "number" ? displayCommentCount : totalTopComments;
  const totalCommentPages = Math.max(
    1,
    Math.ceil(totalTopComments / pageSize),
  );

  const pagedTopComments = useMemo(() => {
    const start = (commentPage - 1) * pageSize;
    return sortedTopComments.slice(start, start + pageSize);
  }, [commentPage, pageSize, sortedTopComments]);

  useEffect(() => {
    if (commentPage > totalCommentPages) {
      setCommentPage(totalCommentPages);
    }
  }, [commentPage, totalCommentPages]);

  useEffect(() => {
    if (typeof document === "undefined" || !pendingScrollId) return;
    const target = document.getElementById(`comment-${pendingScrollId}`);
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    const timer = window.setTimeout(() => setPendingScrollId(null), 1000);
    return () => window.clearTimeout(timer);
  }, [pendingScrollId, comments]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const commentId = extractCommentIdFromHash(window.location.hash);
    if (!commentId) return;
    const navigation = resolveCommentNavigationState(commentId, comments, pageSize);
    if (!navigation) return;
    if (commentPage !== navigation.page) {
      setCommentPage(navigation.page);
    }
    if (navigation.expandIds.length > 0) {
      setExpandedReplies((prev) => {
        const next = { ...prev };
        navigation.expandIds.forEach((id) => {
          next[id] = true;
        });
        return next;
      });
    }
    setPendingScrollId(commentId);
    setHighlightedCommentId(commentId);
  }, [commentPage, comments, pageSize]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleHashChange = () => {
      const commentId = extractCommentIdFromHash(window.location.hash);
      if (!commentId) return;
      const navigation = resolveCommentNavigationState(commentId, comments, pageSize);
      if (!navigation) return;
      if (commentPage !== navigation.page) {
        setCommentPage(navigation.page);
      }
      if (navigation.expandIds.length > 0) {
        setExpandedReplies((prev) => {
          const next = { ...prev };
          navigation.expandIds.forEach((id) => {
            next[id] = true;
          });
          return next;
        });
      }
      setPendingScrollId(commentId);
      setHighlightedCommentId(commentId);
    };

    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, [commentPage, comments, pageSize]);

  useEffect(() => {
    if (!highlightedCommentId) return;
    const timer = window.setTimeout(() => {
      setHighlightedCommentId((prev) =>
        prev === highlightedCommentId ? null : prev,
      );
    }, 5000);
    return () => window.clearTimeout(timer);
  }, [highlightedCommentId]);

  useEffect(() => {
    if (typeof document === "undefined" || !showUserMenu) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (!userMenuRef.current?.contains(event.target as Node)) {
        setShowUserMenu(false);
      }
    };
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [showUserMenu]);

  useEffect(() => {
    if (typeof document === "undefined" || !replyTargetId) return;
    const timer = window.setTimeout(() => {
      const target = document.getElementById(`reply-box-${replyTargetId}`);
      if (target) {
        target.scrollIntoView({ behavior: "smooth", block: "center" });
      }
      commentInputRef.current?.focus();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [replyTargetId]);

  const cancelReply = () => {
    setReplyToId(null);
    setReplyToUser("");
    setReplyTargetId(null);
    setReplyPrefix("");
  };

  const cancelEdit = () => {
    setEditingCommentId(null);
    setEditingCommentDraft("");
    setEditingCommentPrefix("");
  };

  const handleReplyTo = (comment: CommentType) => {
    if (!session) {
      showToast(t("请先登录后再回复"), "info");
      return;
    }
    const link =
      typeof window !== "undefined"
        ? `${window.location.origin}${window.location.pathname}#comment-${comment.id}`
        : "";
    setReplyToId(comment.id);
    setReplyToUser(comment.user_name);
    setReplyTargetId(comment.id);
    const expandedIds = collectReplyThreadIds(comment.id, comments);
    if (expandedIds.length > 0) {
      setExpandedReplies((prev) => {
        const next = { ...prev };
        expandedIds.forEach((id) => {
          next[id] = true;
        });
        return next;
      });
    }
    setReplyPrefix(
      `> ${t("回复")} @${comment.user_name}\n${
        link ? `> [${t("原评论")}](${link})\n` : ""
      }`,
    );
    commentInputRef.current?.focus();
  };

  const handleStartEdit = (comment: CommentType) => {
    const parsed = extractReplyPrefix(comment.content);
    setEditingCommentId(comment.id);
    setEditingCommentPrefix(parsed.prefix);
    setEditingCommentDraft(parsed.body);
  };

  const handleSaveEdit = async () => {
    if (!editingCommentId || !editingCommentDraft.trim()) {
      showToast(t("请输入评论内容"), "info");
      return;
    }
    const currentEditingId = editingCommentId;
    if (commentUpdatingIds.has(currentEditingId)) return;
    setCommentUpdatingIds((prev) => new Set(prev).add(currentEditingId));
    try {
      const nextContent = editingCommentPrefix
        ? `${editingCommentPrefix}\n${editingCommentDraft.trim()}`
        : editingCommentDraft.trim();
      await onUpdateComment(currentEditingId, nextContent);
      cancelEdit();
    } finally {
      setCommentUpdatingIds((prev) => {
        const next = new Set(prev);
        next.delete(currentEditingId);
        return next;
      });
    }
  };

  const handleSubmit = async () => {
    if (commentSubmitting) return;
    const content = replyPrefix ? `${replyPrefix}\n${commentDraft}` : commentDraft;
    if (!content.trim()) {
      showToast(t("请输入评论内容"), "info");
      return;
    }
    setCommentSubmitting(true);
    try {
      const newComment = await onSubmitComment(content.trim(), replyToId);
      setCommentDraft("");
      cancelReply();
      if (newComment?.id) {
        setCommentPage(1);
        setPendingScrollId(newComment.id);
        setHighlightedCommentId(newComment.id);
      }
    } finally {
      setCommentSubmitting(false);
    }
  };

  const handleDelete = async (commentId: string) => {
    setCommentDeletingIds((prev) => new Set(prev).add(commentId));
    try {
      await onDeleteComment(commentId);
    } finally {
      setCommentDeletingIds((prev) => {
        const next = new Set(prev);
        next.delete(commentId);
        return next;
      });
    }
  };

  const handleToggleHidden = async (comment: CommentType) => {
    if (!onToggleHidden) return;
    setCommentTogglingIds((prev) => new Set(prev).add(comment.id));
    try {
      await onToggleHidden(comment.id, !comment.is_hidden);
    } finally {
      setCommentTogglingIds((prev) => {
        const next = new Set(prev);
        next.delete(comment.id);
        return next;
      });
    }
  };

  const handleCommentBodyClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      typeof window === "undefined"
    ) {
      return;
    }

    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    const anchor = target.closest("a");
    if (!(anchor instanceof HTMLAnchorElement)) return;

    const commentId = extractCommentIdFromLink(anchor.getAttribute("href") || "");
    if (!commentId) return;

    const navigation = resolveCommentNavigationState(commentId, comments, pageSize);
    if (!navigation) return;

    event.preventDefault();

    const nextHash = `#comment-${commentId}`;
    const nextUrl = `${window.location.pathname}${window.location.search}${nextHash}`;
    if (window.location.hash !== nextHash) {
      window.history.pushState(null, "", nextUrl);
    } else {
      window.history.replaceState(null, "", nextUrl);
    }

    if (commentPage !== navigation.page) {
      setCommentPage(navigation.page);
    }
    if (navigation.expandIds.length > 0) {
      setExpandedReplies((prev) => {
        const next = { ...prev };
        navigation.expandIds.forEach((id) => {
          next[id] = true;
        });
        return next;
      });
    }
    setPendingScrollId(commentId);
    setHighlightedCommentId(commentId);
  };

  const renderCommentBody = (comment: CommentType, isReply: boolean) => {
    if (editingCommentId === comment.id) {
      return (
        <div>
          <TextArea
            value={editingCommentDraft}
            onChange={(event) => setEditingCommentDraft(event.target.value)}
            rows={isReply ? 3 : 4}
            className="rounded-lg"
            disabled={commentUpdatingIds.has(comment.id)}
          />
        </div>
      );
    }

    const meta = getReplyMeta(comment.content);
    const body = extractCommentBody(comment.content);

    return (
      <div>
        {meta ? (
          <div className="text-xs text-text-3 mb-2">
            <span>
              {t("回复")} @{meta.user}
            </span>
            {meta.link ? (
              <a
                href={meta.link}
                className="ml-2 text-text-3 hover:text-text-1 transition underline"
              >
                {t("原评论")}
              </a>
            ) : null}
          </div>
        ) : null}
        <div onClickCapture={handleCommentBodyClick}>
          <div
            className="prose prose-sm max-w-none text-text-2"
            style={{
              wordBreak: "break-word",
              overflowWrap: "anywhere",
              whiteSpace: "normal",
            }}
            dangerouslySetInnerHTML={{ __html: renderSafeMarkdown(body) }}
          />
        </div>
      </div>
    );
  };

  const renderReplyBox = (targetId: string, useSurfaceBackground = false) => {
    if (!session || replyTargetId !== targetId) return null;
    return (
      <div
        id={`reply-box-${targetId}`}
        className={`mt-3 border border-border rounded-lg p-3 ${
          useSurfaceBackground ? "bg-surface" : "bg-muted"
        }`}
      >
        <div className="mb-2 text-xs text-text-2">
          {t("回复")} {replyToUser ? `@${replyToUser}` : ""}
        </div>
        <TextArea
          ref={commentInputRef}
          value={commentDraft}
          onChange={(event) => setCommentDraft(event.target.value)}
          rows={3}
          className="rounded-lg"
          placeholder={t("写下你的回复，支持 Markdown")}
          disabled={commentSubmitting}
        />
        <div className="flex justify-end gap-1.5 mt-2">
          <IconButton
            onClick={cancelReply}
            variant="ghost"
            size="sm"
            title={t("取消")}
            disabled={commentSubmitting}
            className="rounded-full"
          >
            ×
          </IconButton>
          <IconButton
            onClick={handleSubmit}
            variant="primary"
            size="sm"
            title={commentSubmitting ? t("发布中...") : t("发布")}
            loading={commentSubmitting}
            disabled={commentSubmitting}
            className="rounded-full"
          >
            <IconCheck className="h-3.5 w-3.5" />
          </IconButton>
        </div>
      </div>
    );
  };

  const renderReplies = (parentId: string): React.ReactNode => {
    const directReplies = repliesByParent[parentId] || [];
    if (directReplies.length === 0) return null;

    return (
      <div className="mt-3 border-l border-border pl-3 ml-1 space-y-3">
        {directReplies.map((reply) => {
          const descendantCount = collectCommentDescendantIds(reply.id, comments).length;
          const isExpanded = expandedReplies[reply.id] ?? false;
          const replyToggleLabel = `${
            isExpanded ? t("收起回复") : t("查看回复")
          } (${descendantCount})`;

          return (
            <CommentItem
              key={reply.id}
              comment={reply}
              session={session}
              isAdmin={isAdmin}
              isReply
              isEditing={editingCommentId === reply.id}
              isHighlighted={highlightedCommentId === reply.id}
              isUpdating={commentUpdatingIds.has(reply.id)}
              isDeleting={commentDeletingIds.has(reply.id)}
              isToggling={commentTogglingIds.has(reply.id)}
              commentSubmitting={commentSubmitting}
              onReply={(comment) => handleReplyTo(comment)}
              onEdit={handleStartEdit}
              onCancelEdit={cancelEdit}
              onSaveEdit={handleSaveEdit}
              onDelete={handleDelete}
              onToggleHidden={
                onToggleHidden ? handleToggleHidden : undefined
              }
              renderCommentBody={renderCommentBody}
              replyBox={renderReplyBox(reply.id, true)}
              repliesList={
                descendantCount > 0 ? (
                  <div className="mt-3 border-t border-border pt-3">
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedReplies((prev) => ({
                          ...prev,
                          [reply.id]: !isExpanded,
                        }))
                      }
                      className="inline-flex items-center gap-1 text-xs text-text-3 hover:text-text-1 transition"
                      title={replyToggleLabel}
                      aria-label={replyToggleLabel}
                    >
                      {isExpanded ? (
                        <IconChevronUp className="h-3.5 w-3.5" />
                      ) : (
                        <IconChevronDown className="h-3.5 w-3.5" />
                      )}
                      <span>{replyToggleLabel}</span>
                    </button>
                        {isExpanded ? renderReplies(reply.id) : null}
                  </div>
                ) : null
              }
            />
          );
        })}
      </div>
    );
  };

  return (
    <div className={className}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <h3 className="text-base font-semibold text-text-1">{t("评论")}</h3>
          <span className="text-xs text-text-3">({visibleCommentCount})</span>
        </div>
        {session ? (
          <div className="flex items-center gap-2 text-xs text-text-3">
            <span>{session.user?.name || t("访客")}</span>
            <div className="relative" ref={userMenuRef}>
              {session.user?.image ? (
                <button
                  type="button"
                  onClick={() => setShowUserMenu((prev) => !prev)}
                  className="focus:outline-none"
                >
                  <img
                    src={session.user.image}
                    alt={session.user?.name || t("访客")}
                    className="h-6 w-6 rounded-full object-cover cursor-pointer"
                    width={24}
                    height={24}
                    loading="lazy"
                    decoding="async"
                  />
                </button>
              ) : null}
              {showUserMenu ? (
                <div className="absolute right-0 mt-2 min-w-[120px] rounded-sm border border-border bg-surface shadow-sm text-xs text-text-2 z-10">
                  <button
                    type="button"
                    onClick={() => {
                      onSignOut?.();
                      setShowUserMenu(false);
                    }}
                    className="w-full text-left px-3 py-2 hover:bg-muted hover:text-text-1 transition"
                  >
                    {t("退出登录")}
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            {providers.github ? (
              <button
                type="button"
                onClick={() => onSignIn?.("github")}
                className="px-3 py-1 text-xs rounded-full border border-border text-text-2 hover:text-text-1 hover:bg-muted transition"
              >
                {t("GitHub 登录")}
              </button>
            ) : null}
            {providers.google ? (
              <button
                type="button"
                onClick={() => onSignIn?.("google")}
                className="px-3 py-1 text-xs rounded-full border border-border text-text-2 hover:text-text-1 hover:bg-muted transition"
              >
                {t("Google 登录")}
              </button>
            ) : null}
            {!providers.github && !providers.google ? (
              <span className="text-xs text-text-3">{t("未配置登录方式")}</span>
            ) : null}
          </div>
        )}
      </div>

      {session ? (
        <div className="mb-5">
          {replyToId ? (
            <div className="mb-2 flex items-center justify-between rounded-sm border border-border bg-muted px-3 py-2 text-xs text-text-2">
              <span>
                {t("回复")} {replyToUser ? `@${replyToUser}` : ""}
              </span>
              <button
                type="button"
                onClick={cancelReply}
                disabled={commentSubmitting}
                className="text-text-3 hover:text-text-1 transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {t("取消回复")}
              </button>
            </div>
          ) : null}
          <TextArea
            ref={commentInputRef}
            value={commentDraft}
            onChange={(event) => setCommentDraft(event.target.value)}
            rows={4}
            className="rounded-lg"
            placeholder={t("写下你的评论，支持 Markdown")}
            disabled={commentSubmitting}
          />
          <div className="mt-2 flex justify-end">
            <Button
              type="button"
              onClick={handleSubmit}
              variant="primary"
              size="sm"
              loading={commentSubmitting}
              disabled={commentSubmitting}
            >
              {t("发布评论")}
            </Button>
          </div>
        </div>
      ) : null}

      {loading ? (
        <div
          className="inline-flex items-center gap-2 text-sm text-text-3"
          aria-live="polite"
        >
          <IconRefresh className="h-3.5 w-3.5 animate-spin" />
          <span>{t("评论加载中...")}</span>
        </div>
      ) : totalTopComments === 0 ? (
        <div className="text-sm text-text-3">{t("暂无评论")}</div>
      ) : (
        <div className="space-y-4">
          {pagedTopComments.map((comment) => {
            const descendantCount = collectCommentDescendantIds(comment.id, comments).length;
            const isExpanded = expandedReplies[comment.id] ?? false;
            const replyToggleLabel = `${
              isExpanded ? t("收起回复") : t("查看回复")
            } (${descendantCount})`;

            return (
              <CommentItem
                key={comment.id}
                comment={comment}
                session={session}
                isAdmin={isAdmin}
                isEditing={editingCommentId === comment.id}
                isHighlighted={highlightedCommentId === comment.id}
                isUpdating={commentUpdatingIds.has(comment.id)}
                isDeleting={commentDeletingIds.has(comment.id)}
                isToggling={commentTogglingIds.has(comment.id)}
                commentSubmitting={commentSubmitting}
                onReply={handleReplyTo}
                onEdit={handleStartEdit}
                onCancelEdit={cancelEdit}
                onSaveEdit={handleSaveEdit}
                onDelete={handleDelete}
                onToggleHidden={
                  onToggleHidden ? handleToggleHidden : undefined
                }
                renderCommentBody={renderCommentBody}
                replyBox={renderReplyBox(comment.id)}
                repliesList={
                  descendantCount > 0 ? (
                    <div className="mt-4 border-t border-border pt-3">
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedReplies((prev) => ({
                            ...prev,
                            [comment.id]: !isExpanded,
                          }))
                        }
                        className="inline-flex items-center gap-1 text-xs text-text-3 hover:text-text-1 transition"
                        title={replyToggleLabel}
                        aria-label={replyToggleLabel}
                      >
                        {isExpanded ? (
                          <IconChevronUp className="h-3.5 w-3.5" />
                        ) : (
                          <IconChevronDown className="h-3.5 w-3.5" />
                        )}
                        <span>{replyToggleLabel}</span>
                      </button>
                      {isExpanded ? renderReplies(comment.id) : null}
                    </div>
                  ) : null
                }
              />
            );
          })}
        </div>
      )}

      {totalCommentPages > 1 ? (
        <div className="mt-4 flex items-center justify-between text-xs text-text-3">
          <Button
            type="button"
            onClick={() => setCommentPage((prev) => Math.max(1, prev - 1))}
            disabled={commentPage === 1}
            variant="secondary"
            size="sm"
          >
            {t("上一页")}
          </Button>
          <span className="px-4 py-2 text-sm bg-surface border border-border rounded-sm text-text-2">
            {commentPage} / {totalCommentPages}
          </span>
          <Button
            type="button"
            onClick={() =>
              setCommentPage((prev) => Math.min(totalCommentPages, prev + 1))
            }
            disabled={commentPage === totalCommentPages}
            variant="secondary"
            size="sm"
          >
            {t("下一页")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
