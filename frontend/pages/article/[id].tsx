import Head from "next/head";
import { useState, useEffect, useRef, useCallback, useMemo } from "react";

import { useRouter } from "next/router";
import Link from "next/link";

import {
	articleApi,
	categoryApi,
	commentApi,
	commentSettingsApi,
	mediaApi,
	storageSettingsApi,
	normalizeMediaHtml,
	resolveMediaUrl,
	type ArticleComment,
	type ArticleDetail,
	type Category,
	type ModelAPIConfig,
	type PromptConfig,
	type SimilarArticleItem,
} from "@/lib/api";
import AppFooter from "@/components/AppFooter";
import AppHeader from "@/components/AppHeader";
import Button from "@/components/Button";
import IconButton from "@/components/IconButton";
import FormField from "@/components/ui/FormField";
import ModalShell from "@/components/ui/ModalShell";
import SelectField from "@/components/ui/SelectField";
import TextArea from "@/components/ui/TextArea";
import TextInput from "@/components/ui/TextInput";
import { useToast } from "@/components/Toast";
import ConfirmModal from "@/components/ConfirmModal";
import { BackToTop } from "@/components/BackToTop";
import {
	IconBolt,
	IconBook,
	IconCopy,
	IconDoc,
	IconEdit,
	IconEye,
	IconEyeOff,
	IconLink,
	IconList,
	IconNote,
	IconRefresh,
	IconRobot,
	IconTrash,
	IconCheck,
	IconReply,
	IconChevronDown,
	IconChevronUp,
	IconTag,
	IconGlobe,
} from "@/components/icons";
import { useAuth } from "@/contexts/AuthContext";
import { useBasicSettings } from "@/contexts/BasicSettingsContext";
import { useReading } from "@/contexts/ReadingContext";
import { useI18n } from "@/lib/i18n";
import { renderSafeMarkdown, sanitizeRichHtml } from "@/lib/safeHtml";
import { signIn, signOut, useSession } from "next-auth/react";

// 轮询间隔（毫秒）
const POLLING_INTERVAL = 3000;
const SIMILAR_ARTICLE_LIMIT = 5;
type AIContentType = "summary" | "key_points" | "outline" | "quotes";
type ConfigModalMode =
	| "generate"
	| "retry_ai_content"
	| "retry_cleaning"
	| "retry_translation";

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
	if (typeof input === "string") {
		return { title: input };
	}
	if (!input || typeof input !== "object") return null;
	const record = input as { title?: unknown; children?: unknown };
	const title = typeof record.title === "string" ? record.title : "";
	const childrenRaw = Array.isArray(record.children) ? record.children : [];
	const children = childrenRaw
		.map((child) => normalizeMindMapNode(child))
		.filter((node): node is MindMapNode =>
			Boolean(node && (node.title || node.children?.length)),
		);
	return { title, children };
}

function parseMindMapOutline(content: string): MindMapNode | null {
	try {
		const parsed = JSON.parse(content) as unknown;
		if (Array.isArray(parsed)) {
			const children = parsed
				.map((child) => normalizeMindMapNode(child))
				.filter((node): node is MindMapNode => Boolean(node));
			return { title: "", children };
		}
		return normalizeMindMapNode(parsed);
	} catch {
		return null;
	}
}

function extractReplyPrefix(content: string): { prefix: string; body: string } {
	if (!content) return { prefix: "", body: "" };
	const lines = content.split("\n");
	const prefixLines: string[] = [];
	let index = 0;
	while (index < lines.length) {
		const line = lines[index];
		if (
			line.startsWith("> 回复 @") ||
			line.startsWith("> Reply @") ||
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

function getReplyMeta(content: string): { user: string; link: string } | null {
	if (!content) return null;
	const { prefix } = extractReplyPrefix(content);
	if (!prefix) return null;
	const userMatch = prefix.match(/> (回复|Reply) @(.+)/);
	const linkMatch = prefix.match(/\[(原评论|Original Comment)\]\((.+)\)/);
	const user = userMatch ? userMatch[2].trim() : "";
	const link = linkMatch ? linkMatch[2].trim() : "";
	if (!user && !link) return null;
	return { user, link };
}

function toDateInputValue(value?: string | null): string {
	const raw = (value || "").trim();
	if (!raw) return "";
	const match = raw.match(/^(\d{4}-\d{2}-\d{2})/);
	if (match) return match[1];
	const parsed = new Date(raw);
	if (Number.isNaN(parsed.getTime())) return "";
	const year = parsed.getFullYear();
	const month = String(parsed.getMonth() + 1).padStart(2, "0");
	const day = String(parsed.getDate()).padStart(2, "0");
	return `${year}-${month}-${day}`;
}

function splitArticleAuthors(value?: string | null): string[] {
	if (!value) return [];
	const authors = value
		.split(",")
		.map((item) => item.trim())
		.filter(Boolean);
	return Array.from(new Set(authors));
}

function extractImageUrlFromHtml(html: string): string | null {
	if (!html) return null;
	const doc = new DOMParser().parseFromString(html, "text/html");
	const img = doc.querySelector("img");
	const src = img?.getAttribute("src");
	return src || null;
}

function extractImageUrlFromText(text: string): string | null {
	if (!text) return null;
	const trimmed = text.trim();
	if (!trimmed) return null;
	if (trimmed.includes("![](")) return null;
	const urlMatch = trimmed.match(/https?:\/\/[^\s)]+/);
	const url = urlMatch ? urlMatch[0] : "";
	if (!url) return null;
	if (/\.(png|jpe?g|gif|webp|svg|bmp|avif)(\?.*)?$/i.test(url)) {
		return url;
	}
	return null;
}

function insertTextAtCursor(
	target: HTMLTextAreaElement,
	text: string,
	onChange: (value: string) => void,
) {
	const start = target.selectionStart ?? target.value.length;
	const end = target.selectionEnd ?? target.value.length;
	const nextValue = `${target.value.slice(0, start)}${text}${target.value.slice(end)}`;
	onChange(nextValue);
	requestAnimationFrame(() => {
		const cursor = start + text.length;
		target.setSelectionRange(cursor, cursor);
		target.focus();
	});
}

function extractMarkdownImageUrls(markdown: string): string[] {
	if (!markdown) return [];
	const pattern = /!\[[^\]]*\]\((\S+?)(?:\s+"[^"]*")?\)/g;
	const urls: string[] = [];
	let match: RegExpExecArray | null = null;
	while ((match = pattern.exec(markdown)) !== null) {
		const url = match[1];
		if (url && url.startsWith("http")) {
			urls.push(url);
		}
	}
	return Array.from(new Set(urls));
}

function replaceMarkdownImageUrl(
	markdown: string,
	originalUrl: string,
	nextUrl: string,
): string {
	const escaped = originalUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const pattern = new RegExp(
		`!\\[([^\\]]*)\\]\\(${escaped}(\\s+\\"[^\\"]*\\")?\\)`,
		"g",
	);
	return markdown.replace(pattern, (_match, alt, titlePart) => {
		const title = titlePart || "";
		return `![${alt}](${nextUrl}${title})`;
	});
}

async function runWithConcurrency<T>(
	items: T[],
	limit: number,
	worker: (item: T) => Promise<void>,
) {
	const queue = [...items];
	const workers = Array.from({ length: Math.min(limit, queue.length) }).map(
		async () => {
			while (queue.length > 0) {
				const item = queue.shift();
				if (!item) return;
				await worker(item);
			}
		},
	);
	await Promise.all(workers);
}

function MindMapTree({
	node,
	isRoot = false,
	compact = false,
	depth = 0,
}: {
	node: MindMapNode;
	isRoot?: boolean;
	compact?: boolean;
	depth?: number;
}) {
	const hasTitle = node.title && node.title.trim().length > 0;
	const hasChildren = Boolean(node.children && node.children.length > 0);
	const containerClass = isRoot
		? compact
			? "space-y-2"
			: "space-y-4"
		: compact
			? "pl-3 border-l border-border space-y-2"
			: "pl-5 border-l border-border space-y-4";

	const palette = [
		"border-info-soft bg-info-soft text-info-ink",
		"border-success-soft bg-success-soft text-success-ink",
		"border-warning-soft bg-warning-soft text-warning-ink",
		"border-primary-soft bg-primary-soft text-primary-ink",
	];
	const colorClass = palette[depth % palette.length];

	return (
		<div className={containerClass}>
			{hasTitle && (
				<div
					className={
						isRoot
							? ""
							: compact
								? "flex items-start gap-2 -ml-3"
								: "flex items-start gap-3 -ml-5"
					}
				>
					{!isRoot && (
						<span
							className={
								compact
									? "mt-2 h-1.5 w-1.5 rounded-full bg-border"
									: "mt-2 h-2 w-2 rounded-full bg-border"
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
				<div className={compact ? "space-y-2" : "space-y-5"}>
					{node.children?.map((child, index) => (
						<MindMapTree
							key={`${child.title}-${index}`}
							node={child}
							compact={compact}
							depth={depth + 1}
						/>
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
	const { t, language } = useI18n();
	const getStatusBadge = () => {
		if (!status) return null;
		const statusConfig: Record<
			string,
			{ bg: string; text: string; label: string }
		> = {
			pending: { bg: "bg-muted", text: "text-text-2", label: t("等待处理") },
			processing: {
				bg: "bg-info-soft",
				text: "text-info-ink",
				label: t("生成中..."),
			},
			completed: {
				bg: "bg-success-soft",
				text: "text-success-ink",
				label: t("已完成"),
			},
			failed: {
				bg: "bg-danger-soft",
				text: "text-danger-ink",
				label: t("失败"),
			},
		};
		const config = statusConfig[status];
		if (!config) return null;
		return (
			<span
				className={`px-2 py-0.5 rounded text-xs ${config.bg} ${config.text}`}
			>
				{config.label}
			</span>
		);
	};

	const showGenerateButton =
		canEdit && (!status || status === "completed" || status === "failed");
	const statusBadge = showStatus ? getStatusBadge() : null;

	return (
		<div>
			{showHeader && (
				<div className="flex items-center justify-between gap-4 mb-2">
					<div className="flex items-center gap-2 pr-2">
						<h3 className="font-semibold text-text-1">{title}</h3>
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
								className="text-text-3 hover:text-primary transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35"
								title={content ? t("重新生成") : t("生成")}
								aria-label={content ? t("重新生成") : t("生成")}
								type="button"
							>
								{content ? (
									<IconRefresh className="h-4 w-4" />
								) : (
									<IconBolt className="h-4 w-4" />
								)}
							</button>
						)}
						{content && (
							<button
								onClick={onCopy}
								className="text-text-3 hover:text-primary transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35"
								title={t("复制内容")}
								aria-label={t("复制内容")}
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
							<div className="rounded-lg border border-border bg-muted p-2">
								<div
									onClick={onMindMapOpen}
									className="cursor-zoom-in"
									role="button"
									tabIndex={0}
									onKeyDown={(event) => {
										if (event.key === "Enter" || event.key === " ") {
											onMindMapOpen?.();
										}
									}}
								>
									<div className="overflow-hidden relative">
										<div className="inline-block">
											<MindMapTree node={tree} isRoot compact />
										</div>
										<div className="absolute top-1 right-1 text-xs text-text-3 bg-surface/80 px-2 py-0.5 rounded">
											{t("点击放大")}
										</div>
									</div>
								</div>
							</div>
						) : (
							<div className="text-text-2 text-sm whitespace-pre-wrap">
								{content}
							</div>
						);
					})()
				) : renderMarkdown ? (
					<div
						className="prose prose-sm max-w-none rounded-lg border border-border bg-muted p-3 text-text-2"
						dangerouslySetInnerHTML={{ __html: renderSafeMarkdown(content) }}
					/>
				) : (
					<div className="text-text-2 text-sm whitespace-pre-wrap">
						{content}
					</div>
				)
			) : showStatus ? (
				<p className="text-text-3 text-sm">
					{status === "processing" ? t("正在生成...") : t("未生成")}
				</p>
			) : null}
		</div>
	);
}

interface TocItem {
	id: string;
	text: string;
	level: number;
}

function TableOfContents({
	items,
	activeId,
	onSelect,
}: {
	items: TocItem[];
	activeId: string;
	onSelect: (id: string) => void;
}) {
	if (items.length === 0) return null;

	return (
		<nav className="border-l-2 border-border pl-2 space-y-1">
			{items.map((item) => (
				<a
					key={item.id}
					href={`#${item.id}`}
					onClick={() => onSelect(item.id)}
					className={`block text-xs truncate rounded px-2 py-1 transition ${
						activeId === item.id
							? "text-primary-ink font-semibold bg-primary-soft"
							: "text-text-2 hover:text-text-1 hover:bg-muted"
					}`}
					style={{ paddingLeft: `${(item.level - 1) * 8 + 8}px` }}
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
			const docHeight =
				document.documentElement.scrollHeight - window.innerHeight;
			const scrollPercent = docHeight > 0 ? (scrollTop / docHeight) * 100 : 0;
			setProgress(Math.min(100, Math.max(0, scrollPercent)));
		};

		window.addEventListener("scroll", handleScroll, { passive: true });
		handleScroll();
		return () => window.removeEventListener("scroll", handleScroll);
	}, []);

	return (
		<div className="fixed top-0 left-0 right-0 h-1 bg-muted z-50">
			<div
				className="h-full bg-primary transition-all duration-150"
				style={{ width: `${progress}%` }}
			/>
		</div>
	);
}

function createAnnotationId() {
	if (typeof crypto !== "undefined" && crypto.randomUUID) {
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

function getRangeSnippet(
	root: HTMLElement,
	start: number,
	end: number,
	context = 40,
) {
	if (start >= end) return "";
	const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
	let current = walker.nextNode();
	let offset = 0;
	let fullText = "";

	while (current) {
		const node = current as Text;
		fullText += node.data;
		current = walker.nextNode();
	}

	const safeStart = Math.max(0, start);
	const safeEnd = Math.min(fullText.length, end);
	const left = Math.max(0, safeStart - context);
	const right = Math.min(fullText.length, safeEnd + context);
	const prefix = left > 0 ? "…" : "";
	const suffix = right < fullText.length ? "…" : "";
	const before = fullText.slice(left, safeStart);
	const middle = fullText.slice(safeStart, safeEnd);
	const after = fullText.slice(safeEnd, right);
	return `${prefix}${before}<mark class="annotation-highlight">${middle}</mark>${after}${suffix}`.trim();
}

function applyAnnotations(html: string, annotations: ArticleAnnotation[]) {
	if (!annotations || annotations.length === 0) return html;
	if (typeof window === "undefined") return html;

	const sorted = [...annotations].sort((a, b) => a.start - b.start);
	const parser = new DOMParser();
	const doc = parser.parseFromString(html, "text/html");

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
			const mark = doc.createElement("mark");
			mark.className = "annotation-highlight";
			mark.setAttribute("data-annotation-id", annotation.id);
			mark.textContent = middle;
			frag.appendChild(mark);
			if (after) frag.appendChild(doc.createTextNode(after));
			node.replaceWith(frag);
		});
	});

	return doc.body.innerHTML;
}

function renderMarkdown(content: string) {
	return renderSafeMarkdown(content);
}

interface ArticleNeighbor {
	id: string;
	slug: string;
	title: string;
}

interface ArticleAnnotation {
	id: string;
	start: number;
	end: number;
	comment: string;
}

interface CommentLocation {
	topCommentId: string;
	page: number;
}

const getQueryValue = (value: string | string[] | undefined): string => {
	if (Array.isArray(value)) return value[0] || "";
	return value || "";
};

const decodeQueryValue = (value: string): string => {
	if (!value) return "";
	try {
		return decodeURIComponent(value);
	} catch {
		return value;
	}
};

const resolveCommentLocation = (
	commentId: string,
	items: ArticleComment[],
	pageSize: number,
): CommentLocation | null => {
	if (!commentId || items.length === 0) return null;

	const byId = new Map(items.map((item) => [item.id, item]));
	const target = byId.get(commentId);
	if (!target) return null;

	let topCommentId = target.id;
	let current: ArticleComment | undefined = target;
	const visited = new Set<string>();

	while (current?.reply_to_id) {
		if (visited.has(current.id)) break;
		visited.add(current.id);
		const parent = byId.get(current.reply_to_id);
		if (!parent) break;
		topCommentId = parent.id;
		current = parent;
	}

	const topComments = [...items]
		.filter((comment) => !comment.reply_to_id)
		.sort(
			(a, b) =>
				new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
		);

	const topIndex = topComments.findIndex(
		(comment) => comment.id === topCommentId,
	);
	if (topIndex < 0) return null;

	return {
		topCommentId,
		page: Math.floor(topIndex / pageSize) + 1,
	};
};

export default function ArticleDetailPage() {
	const router = useRouter();
	const { showToast } = useToast();
	const { isAdmin } = useAuth();
	const { t, language } = useI18n();
	const { basicSettings } = useBasicSettings();
	const { addArticle, setIsHidden } = useReading();
	const { data: session } = useSession();
	const { id } = router.query;
	const listReturnHref = useMemo(() => {
		const rawFrom = getQueryValue(router.query.from);
		const decodedFrom = decodeQueryValue(rawFrom);
		if (!decodedFrom || !decodedFrom.startsWith("/list")) {
			return "/list";
		}
		return decodedFrom;
	}, [router.query.from]);

	const buildArticleHref = useCallback(
		(slug: string) =>
			`/article/${slug}?from=${encodeURIComponent(listReturnHref)}`,
		[listReturnHref],
	);

	const [article, setArticle] = useState<ArticleDetail | null>(null);
	const [loading, setLoading] = useState(true);
	const [showTranslation, setShowTranslation] = useState(true);
	const [analysisCollapsed, setAnalysisCollapsed] = useState(false);
	const [activeAiTab, setActiveAiTab] = useState<
		"key_points" | "outline" | "quotes"
	>("key_points");

	const [showConfigModal, setShowConfigModal] = useState(false);
	const [configModalMode, setConfigModalMode] =
		useState<ConfigModalMode>("generate");
	const [configModalContentType, setConfigModalContentType] =
		useState<string>("");
	const [modelConfigs, setModelConfigs] = useState<ModelAPIConfig[]>([]);
	const [promptConfigs, setPromptConfigs] = useState<PromptConfig[]>([]);
	const [selectedModelConfigId, setSelectedModelConfigId] =
		useState<string>("");
	const [selectedPromptConfigId, setSelectedPromptConfigId] =
		useState<string>("");
	const [categories, setCategories] = useState<Category[]>([]);
	const [categoriesLoading, setCategoriesLoading] = useState(false);

	const [showEditModal, setShowEditModal] = useState(false);
	const [editMode, setEditMode] = useState<"original" | "translation">(
		"original",
	);
	const [editTitle, setEditTitle] = useState("");
	const [editAuthor, setEditAuthor] = useState("");
	const [editPublishedAt, setEditPublishedAt] = useState("");
	const [editCategoryId, setEditCategoryId] = useState("");
	const [editTopImage, setEditTopImage] = useState("");
	const [editContent, setEditContent] = useState("");
	const [saving, setSaving] = useState(false);
	const editTextareaRef = useRef<HTMLTextAreaElement>(null);
	const editPreviewRef = useRef<HTMLDivElement>(null);
	const [mediaStorageEnabled, setMediaStorageEnabled] = useState(false);
	const [mediaStorageLoading, setMediaStorageLoading] = useState(false);
	const [mediaUploading, setMediaUploading] = useState(false);

	const [noteContent, setNoteContent] = useState("");
	const [noteDraft, setNoteDraft] = useState("");
	const [showNoteModal, setShowNoteModal] = useState(false);
	const [annotations, setAnnotations] = useState<ArticleAnnotation[]>([]);
	const [activeAnnotationId, setActiveAnnotationId] = useState<string>("");
	const [showAnnotationView, setShowAnnotationView] = useState(false);
	const [pendingAnnotationRange, setPendingAnnotationRange] = useState<{
		start: number;
		end: number;
	} | null>(null);
	const [pendingAnnotationText, setPendingAnnotationText] = useState("");
	const [pendingAnnotationComment, setPendingAnnotationComment] = useState("");
	const [showAnnotationModal, setShowAnnotationModal] = useState(false);
	const [activeAnnotationText, setActiveAnnotationText] = useState("");
	const [annotationEditDraft, setAnnotationEditDraft] = useState("");
	const [showSelectionToolbar, setShowSelectionToolbar] = useState(false);
	const [selectionToolbarPos, setSelectionToolbarPos] = useState<{
		x: number;
		y: number;
	} | null>(null);
	const [hoverAnnotationId, setHoverAnnotationId] = useState<string>("");
	const [hoverTooltipPos, setHoverTooltipPos] = useState<{
		x: number;
		y: number;
	} | null>(null);
	const [comments, setComments] = useState<ArticleComment[]>([]);
	const [commentsLoading, setCommentsLoading] = useState(false);
	const [commentDraft, setCommentDraft] = useState("");
	const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
	const [editingCommentDraft, setEditingCommentDraft] = useState("");
	const [editingCommentPrefix, setEditingCommentPrefix] = useState("");
	const [commentsEnabled, setCommentsEnabled] = useState(true);
	const [commentSettingsLoaded, setCommentSettingsLoaded] = useState(false);
	const [commentProviders, setCommentProviders] = useState({
		github: false,
		google: false,
	});
	const [showUserMenu, setShowUserMenu] = useState(false);
	const userMenuRef = useRef<HTMLDivElement | null>(null);
	const commentInputRef = useRef<HTMLTextAreaElement | null>(null);
	const [replyToId, setReplyToId] = useState<string | null>(null);
	const [replyToUser, setReplyToUser] = useState<string>("");
	const [replyTargetId, setReplyTargetId] = useState<string | null>(null);
	const [replyPrefix, setReplyPrefix] = useState<string>("");
	const [pendingScrollId, setPendingScrollId] = useState<string | null>(null);
	const [highlightedCommentId, setHighlightedCommentId] = useState<
		string | null
	>(null);
	const [commentSubmitting, setCommentSubmitting] = useState(false);
	const [commentUpdatingIds, setCommentUpdatingIds] = useState<Set<string>>(
		new Set(),
	);
	const [commentDeletingIds, setCommentDeletingIds] = useState<Set<string>>(
		new Set(),
	);
	const [commentTogglingIds, setCommentTogglingIds] = useState<Set<string>>(
		new Set(),
	);
	const [commentPage, setCommentPage] = useState(1);
	const commentPageSize = 5;
	const [pendingDeleteCommentId, setPendingDeleteCommentId] = useState<
		string | null
	>(null);
	const [showDeleteCommentModal, setShowDeleteCommentModal] = useState(false);
	const [pendingDeleteAnnotationId, setPendingDeleteAnnotationId] = useState<
		string | null
	>(null);
	const [showDeleteAnnotationModal, setShowDeleteAnnotationModal] =
		useState(false);
	const [showDeleteNoteModal, setShowDeleteNoteModal] = useState(false);
	const [expandedReplies, setExpandedReplies] = useState<
		Record<string, boolean>
	>({});

	const [showDeleteModal, setShowDeleteModal] = useState(false);
	const [tocItems, setTocItems] = useState<TocItem[]>([]);
	const [activeTocId, setActiveTocId] = useState("");
	const [tocCollapsed, setTocCollapsed] = useState(false);
	const activeHeadingMapRef = useRef<Map<string, number>>(new Map());
	const [immersiveMode, setImmersiveMode] = useState(false);
	const [isMobile, setIsMobile] = useState(false);
	const [showAiPanel, setShowAiPanel] = useState(false);
	const [lightboxImage, setLightboxImage] = useState<string | null>(null);
	const [mindMapOpen, setMindMapOpen] = useState(false);
	const [prevArticle, setPrevArticle] = useState<ArticleNeighbor | null>(null);
	const [nextArticle, setNextArticle] = useState<ArticleNeighbor | null>(null);
	const [similarArticles, setSimilarArticles] = useState<SimilarArticleItem[]>(
		[],
	);
	const [similarStatus, setSimilarStatus] = useState<
		"ready" | "pending" | "disabled"
	>("ready");
	const [similarLoading, setSimilarLoading] = useState(false);
	const [embeddingRefreshing, setEmbeddingRefreshing] = useState(false);
	const contentRef = useRef<HTMLDivElement>(null);
	const pollingRef = useRef<NodeJS.Timeout | null>(null);
	const similarPollingRef = useRef<NodeJS.Timeout | null>(null);

	const needsPolling = useCallback((data: ArticleDetail | null): boolean => {
		if (!data) return false;
		const pendingStatuses = ["pending", "processing"];
		if (pendingStatuses.includes(data.status)) return true;
		if (pendingStatuses.includes(data.translation_status || "")) return true;
		if (data.ai_analysis) {
			const {
				summary_status,
				key_points_status,
				outline_status,
				quotes_status,
			} = data.ai_analysis;
			if (pendingStatuses.includes(summary_status || "")) return true;
			if (pendingStatuses.includes(key_points_status || "")) return true;
			if (pendingStatuses.includes(outline_status || "")) return true;
			if (pendingStatuses.includes(quotes_status || "")) return true;
		}
		return false;
	}, []);

	const renderedHtml = useMemo(() => {
		if (!article) return "";
		const baseHtml =
			showTranslation && article.content_trans
				? renderMarkdown(article.content_trans)
				: article.content_md
					? renderMarkdown(article.content_md)
					: sanitizeRichHtml(article.content_html || "");
		const normalizedHtml = sanitizeRichHtml(normalizeMediaHtml(baseHtml));
		const htmlWithAnnotations = immersiveMode
			? normalizedHtml
			: applyAnnotations(normalizedHtml, annotations);
		return sanitizeRichHtml(htmlWithAnnotations);
	}, [article, annotations, showTranslation, immersiveMode]);

	const authorItems = useMemo(
		() => splitArticleAuthors(article?.author),
		[article?.author],
	);
	const fallbackTopImageUrl = useMemo(
		() => resolveMediaUrl(basicSettings.site_logo_url || "/logo.png"),
		[basicSettings.site_logo_url],
	);
	const editPreviewTopImageUrl = useMemo(
		() => resolveMediaUrl(editTopImage || basicSettings.site_logo_url || "/logo.png"),
		[editTopImage, basicSettings.site_logo_url],
	);
	const selectableModelConfigs = useMemo(
		() => modelConfigs.filter((config) => config.model_type !== "vector"),
		[modelConfigs],
	);

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

	const sortedRepliesByParent = useMemo<
		Record<string, ArticleComment[]>
	>(() => {
		const grouped: Record<string, ArticleComment[]> = {};
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
	const totalCommentPages = Math.max(
		1,
		Math.ceil(totalTopComments / commentPageSize),
	);

	const pagedTopComments = useMemo(() => {
		const start = (commentPage - 1) * commentPageSize;
		return sortedTopComments.slice(start, start + commentPageSize);
	}, [sortedTopComments, commentPage]);

	const focusCommentById = useCallback(
		(
			commentId: string,
			sourceComments: ArticleComment[] = comments,
			notifyMissing = false,
		): boolean => {
			const location = resolveCommentLocation(
				commentId,
				sourceComments,
				commentPageSize,
			);
			if (!location) {
				if (notifyMissing) {
					showToast(t("原评论不存在"), "info");
				}
				return false;
			}

			if (commentPage !== location.page) {
				setCommentPage(location.page);
			}
			if (location.topCommentId !== commentId) {
				setExpandedReplies((prev) =>
					prev[location.topCommentId]
						? prev
						: { ...prev, [location.topCommentId]: true },
				);
			}
			setPendingScrollId(commentId);
			return true;
		},
		[comments, commentPage, showToast, t],
	);

	useEffect(() => {
		if (commentPage > totalCommentPages) {
			setCommentPage(totalCommentPages);
		}
	}, [commentPage, totalCommentPages]);

	useEffect(() => {
		if (isMobile) {
			setShowAiPanel(false);
		}
	}, [id, isMobile]);

	useEffect(() => {
		const handleClickOutside = (event: MouseEvent) => {
			if (
				userMenuRef.current &&
				!userMenuRef.current.contains(event.target as Node)
			) {
				setShowUserMenu(false);
			}
		};
		if (showUserMenu) {
			document.addEventListener("mousedown", handleClickOutside);
		}
		return () => {
			document.removeEventListener("mousedown", handleClickOutside);
		};
	}, [showUserMenu]);

	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			if (showAnnotationModal) {
				setShowAnnotationModal(false);
				return;
			}
			if (showDeleteNoteModal) {
				setShowDeleteNoteModal(false);
				return;
			}
			if (showNoteModal) {
				setShowNoteModal(false);
				return;
			}
			if (showEditModal) {
				setShowEditModal(false);
				return;
			}
			if (showConfigModal) {
				setShowConfigModal(false);
				return;
			}
			if (showAnnotationView) {
				setShowAnnotationView(false);
				return;
			}
			if (showDeleteCommentModal) {
				setShowDeleteCommentModal(false);
				setPendingDeleteCommentId(null);
				return;
			}
			if (showDeleteAnnotationModal) {
				setShowDeleteAnnotationModal(false);
				setPendingDeleteAnnotationId(null);
				return;
			}
			if (showDeleteModal) {
				setShowDeleteModal(false);
				return;
			}
			if (immersiveMode) {
				setImmersiveMode(false);
			}
		};
		document.addEventListener("keydown", handleKeyDown);
		return () => {
			document.removeEventListener("keydown", handleKeyDown);
		};
	}, [
		immersiveMode,
		showAnnotationModal,
		showDeleteNoteModal,
		showNoteModal,
		showEditModal,
		showConfigModal,
		showAnnotationView,
		showDeleteCommentModal,
		showDeleteAnnotationModal,
		showDeleteModal,
	]);

	useEffect(() => {
		setIsHidden(immersiveMode || isMobile || showAiPanel);
	}, [immersiveMode, isMobile, showAiPanel, setIsHidden]);

	useEffect(() => {
		if (typeof window === "undefined") return;
		const media = window.matchMedia("(max-width: 1023px)");
		const handleChange = (event?: MediaQueryListEvent) => {
			const matches = event ? event.matches : media.matches;
			setIsMobile(matches);
			if (matches) {
				setImmersiveMode(true);
				setTocCollapsed(true);
			}
			if (!matches) {
				setShowAiPanel(false);
			}
		};
		handleChange();
		media.addEventListener("change", handleChange);
		return () => {
			media.removeEventListener("change", handleChange);
		};
	}, []);

	useEffect(() => {
		if (!article) return;
		const detectImageLayout = () => {
			if (!contentRef.current) return;

			const markPortraitImages = (images: Element[]) => {
				images.forEach((img) => {
					const htmlImg = img as HTMLImageElement;
					const markAsPortrait = () => {
						const aspectRatio = htmlImg.naturalWidth / htmlImg.naturalHeight;
						if (aspectRatio < 1) {
							htmlImg.setAttribute("data-aspect-ratio", "portrait");
						}
					};

					if (htmlImg.complete) {
						markAsPortrait();
					} else {
						htmlImg.addEventListener("load", markAsPortrait);
					}
				});
			};

			const paragraphs = contentRef.current.querySelectorAll("p");
			paragraphs.forEach((p) => {
				const images = p.querySelectorAll("img");
				if (images.length > 1) {
					markPortraitImages(Array.from(images));
				}
			});

			const allImages = contentRef.current.querySelectorAll("img");
			allImages.forEach((img, index) => {
				const prevImg = allImages[index - 1];
				const nextImg = allImages[index + 1];

				const isConsecutive = (a: Element, b: Element) => {
					if (!a || !b) return false;
					const aParent = a.parentElement;
					const bParent = b.parentElement;
					if (aParent === bParent && aParent?.tagName === "P") return false;

					let current = aParent?.nextElementSibling;
					while (current) {
						if (current === bParent) return true;
						if (current.tagName !== "P") break;
						const hasImg = current.querySelector("img");
						if (!hasImg) break;
						current = current.nextElementSibling;
					}
					return false;
				};

				const hasConsecutiveNeighbor =
					isConsecutive(img, nextImg) || isConsecutive(prevImg, img);

				if (hasConsecutiveNeighbor) {
					const htmlImg = img as HTMLImageElement;
					const markAsPortrait = () => {
						const aspectRatio = htmlImg.naturalWidth / htmlImg.naturalHeight;
						if (aspectRatio < 1) {
							htmlImg.setAttribute("data-aspect-ratio", "portrait");
						}
					};

					if (htmlImg.complete) {
						markAsPortrait();
					} else {
						htmlImg.addEventListener("load", markAsPortrait);
					}
				}
			});
		};
		setTimeout(detectImageLayout, 300);
	}, [article, renderedHtml]);

	useEffect(() => {
		if (id) {
			fetchArticle();
		}
		return () => {
			if (pollingRef.current) {
				clearInterval(pollingRef.current);
			}
			if (similarPollingRef.current) {
				clearInterval(similarPollingRef.current);
			}
		};
	}, [id]);

	useEffect(() => {
		if (!article?.slug) return;
		if (similarPollingRef.current) {
			clearInterval(similarPollingRef.current);
			similarPollingRef.current = null;
		}
		if (similarStatus !== "pending") return;
		similarPollingRef.current = setInterval(() => {
			fetchSimilarArticles(article);
		}, 5000);
		return () => {
			if (similarPollingRef.current) {
				clearInterval(similarPollingRef.current);
				similarPollingRef.current = null;
			}
		};
	}, [article?.slug, similarStatus]);

	useEffect(() => {
		if (id && commentsEnabled && commentSettingsLoaded) {
			fetchComments();
		}
	}, [id, commentsEnabled, commentSettingsLoaded]);

	useEffect(() => {
		fetchCommentSettings();
	}, []);

	useEffect(() => {
		if (!showEditModal || categories.length > 0 || categoriesLoading) return;
		const fetchCategories = async () => {
			setCategoriesLoading(true);
			try {
				const data = await categoryApi.getCategories();
				setCategories(data);
			} catch (error) {
				console.error("Failed to fetch categories:", error);
			} finally {
				setCategoriesLoading(false);
			}
		};
		fetchCategories();
	}, [showEditModal, categories.length, categoriesLoading]);

	useEffect(() => {
		if (!showEditModal || !isAdmin) return;
		fetchStorageSettings();
	}, [showEditModal, isAdmin]);

	useEffect(() => {
		const handleHashChange = () => {
			if (typeof window === "undefined") return;
			const hash = window.location.hash || "";
			if (!hash.startsWith("#comment-")) return;
			const commentId = hash.slice("#comment-".length);
			focusCommentById(commentId);
		};

		handleHashChange();
		window.addEventListener("hashchange", handleHashChange);
		return () => window.removeEventListener("hashchange", handleHashChange);
	}, [focusCommentById]);

	useEffect(() => {
		if (!replyTargetId) return;
		const handleScroll = () => {
			const target = document.getElementById(`reply-box-${replyTargetId}`);
			if (target) {
				target.scrollIntoView({ behavior: "smooth", block: "center" });
			}
			focusCommentInput();
		};
		const timer = window.setTimeout(handleScroll, 0);
		return () => window.clearTimeout(timer);
	}, [replyTargetId]);

	useEffect(() => {
		if (!pendingScrollId) return;
		const targetCommentId = pendingScrollId;
		const handleScroll = () => {
			const target = document.getElementById(`comment-${targetCommentId}`);
			if (!target) return;
			target.scrollIntoView({ behavior: "smooth", block: "center" });
			setHighlightedCommentId(targetCommentId);
			setPendingScrollId(null);
		};
		const timer = window.setTimeout(handleScroll, 120);
		return () => window.clearTimeout(timer);
	}, [pendingScrollId, commentPage, comments, expandedReplies]);

	useEffect(() => {
		if (!highlightedCommentId) return;
		const timer = window.setTimeout(() => {
			setHighlightedCommentId((prev) =>
				prev === highlightedCommentId ? null : prev,
			);
		}, 1800);
		return () => window.clearTimeout(timer);
	}, [highlightedCommentId]);

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
					console.error("Polling failed:", error);
				}
			}, POLLING_INTERVAL);
		}
	}, [article, id, needsPolling]);

	useEffect(() => {
		if (!article) return;
		setNoteContent(article.note_content || "");
		setNoteDraft(article.note_content || "");
		if (article.note_annotations) {
			try {
				const parsed = JSON.parse(
					article.note_annotations,
				) as ArticleAnnotation[];
				setAnnotations(parsed || []);
			} catch {
				setAnnotations([]);
			}
		} else {
			setAnnotations([]);
		}
	}, [article?.id]);

	useEffect(() => {
		if (article?.id && article?.title && article?.slug) {
			addArticle({ id: article.id, slug: article.slug, title: article.title });
		}
	}, [article?.id, article?.slug, article?.title, addArticle]);

	useEffect(() => {
		if (!contentRef.current) return;

		// 使用 requestAnimationFrame 确保 DOM 已更新
		const rafId = requestAnimationFrame(() => {
			if (!contentRef.current) return;

			const headings = contentRef.current.querySelectorAll(
				"h1, h2, h3, h4, h5, h6",
			);
			const items: TocItem[] = [];

			headings.forEach((heading, index) => {
				const id = `heading-${index}`;
				heading.id = id;
				items.push({
					id,
					text: heading.textContent || "",
					level: parseInt(heading.tagName[1]),
				});
			});

			setTocItems(items);
			setActiveTocId(items[0]?.id || "");
		});

		return () => cancelAnimationFrame(rafId);
	}, [renderedHtml]);

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
					const nextActive = Array.from(activeMap.entries()).sort(
						(a, b) => a[1] - b[1],
					)[0]?.[0];
					if (nextActive) {
						setActiveTocId(nextActive);
					}
				}
			},
			{ rootMargin: "-80px 0px -80% 0px", threshold: [0, 0.1, 0.5] },
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
			if (event.key === "Escape") {
				setLightboxImage(null);
			}
		};
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
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
			fetchSimilarArticles(data);
		} catch (error) {
			console.error("Failed to fetch article:", error);
			showToast(t("加载文章失败"), "error");
		} finally {
			setLoading(false);
		}
	};

	const fetchSimilarArticles = async (detail: ArticleDetail) => {
		if (!detail?.slug) return;
		setSimilarLoading(true);
		try {
			const result = await articleApi.getSimilarArticles(
				detail.slug,
				SIMILAR_ARTICLE_LIMIT,
			);
			setSimilarStatus(result.status);
			setSimilarArticles(result.items || []);
		} catch (error) {
			console.error("Failed to fetch similar articles:", error);
			setSimilarStatus("ready");
			setSimilarArticles([]);
		} finally {
			setSimilarLoading(false);
		}
	};

	const handleRefreshEmbedding = async () => {
		if (!article?.slug) return;
		setEmbeddingRefreshing(true);
		try {
			await articleApi.generateArticleEmbedding(article.slug);
			setSimilarStatus("pending");
			showToast(t("已提交向量化任务"));
		} catch (error: any) {
			console.error("Failed to refresh embedding:", error);
			showToast(error?.response?.data?.detail || t("提交向量化失败"), "error");
		} finally {
			setEmbeddingRefreshing(false);
		}
	};

	const fetchComments = async () => {
		if (!id) return;
		setCommentsLoading(true);
		try {
			const data = await commentApi.getArticleComments(id as string);
			setComments(data);
			const hash = typeof window !== "undefined" ? window.location.hash : "";
			if (hash.startsWith("#comment-")) {
				const commentId = hash.slice("#comment-".length);
				focusCommentById(commentId, data, true);
			}
		} catch (error) {
			console.error("Failed to fetch comments:", error);
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
			console.error("Failed to fetch comment settings:", error);
			setCommentsEnabled(true);
		} finally {
			setCommentSettingsLoaded(true);
		}
	};

	const openMindMap = () => {
		setMindMapOpen(true);
	};

	const handleContentClick = (event: React.MouseEvent<HTMLDivElement>) => {
		const target = event.target as HTMLElement | null;
		if (!target) return;
		if (target.tagName === "IMG") {
			const img = target as HTMLImageElement;
			if (img.src) {
				setLightboxImage(img.src);
			}
			return;
		}
		const mark = target.closest(
			"mark[data-annotation-id]",
		) as HTMLElement | null;
		if (mark) {
			const annotationId = mark.getAttribute("data-annotation-id") || "";
			const annotation = annotations.find((item) => item.id === annotationId);
			if (!isAdmin && !annotation?.comment) {
				return;
			}
			setActiveAnnotationId(annotationId);
			if (contentRef.current) {
				if (annotation) {
					setActiveAnnotationText(
						sanitizeRichHtml(
							getRangeSnippet(
								contentRef.current,
								annotation.start,
								annotation.end,
							),
						),
					);
					setAnnotationEditDraft(annotation.comment);
				} else {
					setActiveAnnotationText("");
				}
			}
			setShowAnnotationView(true);
		}
	};

	const handleContentMouseOver = (event: React.MouseEvent<HTMLDivElement>) => {
		const target = event.target as HTMLElement | null;
		if (!target) return;
		const mark = target.closest(
			"mark[data-annotation-id]",
		) as HTMLElement | null;
		if (!mark) return;
		const annotationId = mark.getAttribute("data-annotation-id") || "";
		if (!annotationId) return;
		const annotation = annotations.find((item) => item.id === annotationId);
		if (!annotation?.comment) return;
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
		const mark = target.closest(
			"mark[data-annotation-id]",
		) as HTMLElement | null;
		if (mark) {
			setHoverAnnotationId("");
			setHoverTooltipPos(null);
		}
	};

	const showSummarySection = isAdmin || Boolean(article?.ai_analysis?.summary);
	const showKeyPointsSection =
		isAdmin || Boolean(article?.ai_analysis?.key_points);
	const showOutlineSection = isAdmin || Boolean(article?.ai_analysis?.outline);
	const showQuotesSection = isAdmin || Boolean(article?.ai_analysis?.quotes);
	const aiUpdatedAt =
		isAdmin && article?.ai_analysis?.updated_at
			? new Date(article.ai_analysis.updated_at).toLocaleString(
					language === "en" ? "en-US" : "zh-CN",
				)
			: "";

	const aiTabConfigs = [
		{
			key: "key_points" as const,
			label: t("总结"),
			enabled: showKeyPointsSection,
			content: article?.ai_analysis?.key_points,
			status: article?.ai_analysis?.key_points_status,
			renderMarkdown: true,
			renderMindMap: false,
			onMindMapOpen: undefined,
			onGenerate: () => handleGenerateContent("key_points"),
			onCopy: () => handleCopyContent(article?.ai_analysis?.key_points),
		},
		{
			key: "outline" as const,
			label: t("大纲"),
			enabled: showOutlineSection,
			content: article?.ai_analysis?.outline,
			status: article?.ai_analysis?.outline_status,
			renderMarkdown: false,
			renderMindMap: true,
			onMindMapOpen: openMindMap,
			onGenerate: () => handleGenerateContent("outline"),
			onCopy: () => handleCopyContent(article?.ai_analysis?.outline),
		},
		{
			key: "quotes" as const,
			label: t("金句"),
			enabled: showQuotesSection,
			content: article?.ai_analysis?.quotes,
			status: article?.ai_analysis?.quotes_status,
			renderMarkdown: true,
			renderMindMap: false,
			onMindMapOpen: undefined,
			onGenerate: () => handleGenerateContent("quotes"),
			onCopy: () => handleCopyContent(article?.ai_analysis?.quotes),
		},
	];

	const activeTabConfig =
		aiTabConfigs.find((tab) => tab.key === activeAiTab) ??
		aiTabConfigs.find((tab) => tab.enabled);
	const aiStatusLink = article?.title
		? `/admin/monitoring/tasks?article_title=${encodeURIComponent(article.title)}`
		: "";
	const activeStatusBadge = isAdmin
		? getAiTabStatusBadge(activeTabConfig?.status)
		: null;
	const showActiveGenerateButton =
		isAdmin &&
		(!activeTabConfig?.status ||
			activeTabConfig.status === "completed" ||
			activeTabConfig.status === "failed");
	const showActiveCopyButton = Boolean(activeTabConfig?.content);

	const aiPanelContent = (
		<div className="bg-surface rounded-lg shadow-sm border border-border p-4">
			<div className="flex items-center justify-between mb-4">
				{tocItems.length > 0 && (
					<>
						<h2 className="text-lg font-semibold text-text-1 inline-flex items-center gap-2">
							<IconList className="h-4 w-4" />
							<span>{t("目录")}</span>
						</h2>
						<button
							type="button"
							onClick={() => setTocCollapsed(!tocCollapsed)}
							className="text-text-3 hover:text-primary transition"
							title={tocCollapsed ? t("展开目录") : t("收起目录")}
							aria-label={tocCollapsed ? t("展开目录") : t("收起目录")}
						>
							<IconChevronDown
								className={`h-4 w-4 transition-transform duration-200 ${
									tocCollapsed ? "" : "rotate-180"
								}`}
							/>
						</button>
					</>
				)}
			</div>

			<div className="space-y-6">
				{tocItems.length > 0 && !tocCollapsed && (
					<TableOfContents
						items={tocItems}
						activeId={activeTocId}
						onSelect={setActiveTocId}
					/>
				)}

				<div>
					<div className="flex items-center justify-between mb-2">
						<h2 className="text-lg font-semibold text-text-1 inline-flex items-center gap-2">
							<IconRobot className="h-4 w-4" />
							<span>{t("AI解读")}</span>
						</h2>
						{aiUpdatedAt && (
							<span className="text-xs text-text-3">{aiUpdatedAt}</span>
						)}
					</div>
				</div>

				{isAdmin && article?.ai_analysis?.error_message && (
					<div className="p-3 bg-danger-soft border border-danger-soft rounded-lg">
						<p className="text-danger-ink text-sm">
							{article.ai_analysis.error_message}
						</p>
					</div>
				)}

				{showSummarySection && (
					<AIContentSection
						title={t("摘要")}
						content={article?.ai_analysis?.summary}
						status={
							article?.ai_analysis?.summary_status ||
							(article?.status === "completed" ? "completed" : article?.status)
						}
						onGenerate={() => handleGenerateContent("summary")}
						onCopy={() => handleCopyContent(article?.ai_analysis?.summary)}
						canEdit={isAdmin}
						showStatus={isAdmin}
						statusLink={aiStatusLink}
					/>
				)}

				{(showKeyPointsSection || showOutlineSection || showQuotesSection) && (
					<div className="space-y-4">
						<div className="flex items-center justify-between gap-4">
							<div className="relative flex-1">
								<div className="flex items-center gap-2 overflow-x-auto pb-1 pr-6">
									{aiTabConfigs
										.filter((tab) => tab.enabled)
										.map((tab) => (
											<button
												key={tab.key}
												type="button"
												onClick={() => setActiveAiTab(tab.key)}
												className={`px-3 py-1.5 text-base font-semibold rounded-sm transition ${
													activeAiTab === tab.key
														? "bg-muted text-text-1"
														: "text-text-2 hover:text-text-1 hover:bg-muted"
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
									<Link
										href={aiStatusLink}
										className="hover:opacity-80 transition"
									>
										{activeStatusBadge}
									</Link>
								) : (
									activeStatusBadge
								)}
								{showActiveGenerateButton && activeTabConfig && (
									<button
										onClick={activeTabConfig.onGenerate}
										className="text-text-3 hover:text-primary transition"
										title={activeTabConfig.content ? t("重新生成") : t("生成")}
										aria-label={
											activeTabConfig.content ? t("重新生成") : t("生成")
										}
										type="button"
									>
										{activeTabConfig.content ? (
											<IconRefresh className="h-4 w-4" />
										) : (
											<IconBolt className="h-4 w-4" />
										)}
									</button>
								)}
								{showActiveCopyButton && activeTabConfig && (
									<button
										onClick={activeTabConfig.onCopy}
										className="text-text-3 hover:text-primary transition"
										title={t("复制内容")}
										aria-label={t("复制内容")}
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

				{(isAdmin ||
					similarLoading ||
					similarStatus === "pending" ||
					similarStatus === "disabled" ||
					similarArticles.length > 0) && (
					<div className="pt-4 border-t border-border">
						<div className="flex items-center justify-between mb-2">
							<h2 className="text-lg font-semibold text-text-1 inline-flex items-center gap-2">
								<IconTag className="h-4 w-4" />
								<span>{t("推荐阅读")}</span>
							</h2>
							{isAdmin && (
								<button
									onClick={handleRefreshEmbedding}
									className="text-text-3 hover:text-primary transition disabled:opacity-50"
									title={t("重新生成向量")}
									aria-label={t("重新生成向量")}
									type="button"
									disabled={embeddingRefreshing}
								>
									<IconRefresh className="h-4 w-4" />
								</button>
							)}
						</div>
						{similarLoading ? (
							<div
								className="inline-flex items-center gap-2 text-sm text-text-3"
								aria-live="polite"
							>
								<IconRefresh className="h-3.5 w-3.5 animate-spin" />
								<span>{t("文章加载中...")}</span>
							</div>
						) : similarStatus === "pending" ? (
							<div className="text-sm text-text-3" aria-live="polite">
								{t("文章生成中...")}
							</div>
						) : similarStatus === "disabled" ? (
							<div className="text-sm text-text-3" aria-live="polite">
								{t("文章推荐暂不可用")}
							</div>
						) : similarArticles.length === 0 ? (
							<div className="text-sm text-text-3" aria-live="polite">
								{t("暂无推荐文章")}
							</div>
						) : (
							<div className="space-y-2 text-sm text-text-2">
								{similarArticles.map((item) => (
									<div key={item.id} className="flex items-start gap-2">
										<span className="text-text-3">·</span>
										<div className="min-w-0 flex items-center gap-2">
											{item.category_name && (
												<span
													className="shrink-0 rounded px-2 py-0.5 text-xs"
													style={{
														backgroundColor: item.category_color
															? `${item.category_color}20`
															: "var(--bg-muted)",
														color: item.category_color || "var(--text-2)",
													}}
												>
													{item.category_name}
												</span>
											)}
											<Link
												href={buildArticleHref(item.slug)}
												className="hover:text-text-1 transition truncate"
												title={item.title}
											>
												{item.title}
											</Link>
										</div>
									</div>
								))}
							</div>
						)}
					</div>
				)}
			</div>
		</div>
	);

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
		document.addEventListener("selectionchange", handleSelection);
		return () => {
			document.removeEventListener("selectionchange", handleSelection);
		};
	}, []);

	function getAiTabStatusBadge(status?: string | null) {
		if (!status) return null;
		const statusConfig: Record<
			string,
			{ bg: string; text: string; label: string }
		> = {
			pending: { bg: "bg-muted", text: "text-text-2", label: t("等待处理") },
			processing: {
				bg: "bg-info-soft",
				text: "text-info-ink",
				label: t("生成中..."),
			},
			completed: {
				bg: "bg-success-soft",
				text: "text-success-ink",
				label: t("已完成"),
			},
			failed: {
				bg: "bg-danger-soft",
				text: "text-danger-ink",
				label: t("失败"),
			},
		};
		const config = statusConfig[status];
		if (!config) return null;
		return (
			<span
				className={`px-2 py-0.5 rounded text-xs ${config.bg} ${config.text}`}
			>
				{config.label}
			</span>
		);
	}

	useEffect(() => {
		const availableTabs: Array<"key_points" | "outline" | "quotes"> = [];
		if (showKeyPointsSection) availableTabs.push("key_points");
		if (showOutlineSection) availableTabs.push("outline");
		if (showQuotesSection) availableTabs.push("quotes");
		if (availableTabs.length === 0) return;
		if (!availableTabs.includes(activeAiTab)) {
			setActiveAiTab(availableTabs[0]);
		}
	}, [
		activeAiTab,
		showKeyPointsSection,
		showOutlineSection,
		showQuotesSection,
	]);

	const fetchConfigs = async (promptType: string) => {
		try {
			const [models, prompts] = await Promise.all([
				articleApi.getModelAPIConfigs(),
				articleApi.getPromptConfigs(),
			]);
			setModelConfigs(models.filter((m: ModelAPIConfig) => m.is_enabled));
			setPromptConfigs(
				prompts.filter(
					(p: PromptConfig) => p.is_enabled && p.type === promptType,
				),
			);
		} catch (error) {
			console.error("Failed to fetch configs:", error);
		}
	};

	const openConfigModal = (options: {
		mode: ConfigModalMode;
		promptType: string;
		contentType?: AIContentType;
	}) => {
		setConfigModalMode(options.mode);
		setConfigModalContentType(options.contentType || "");
		setSelectedModelConfigId("");
		setSelectedPromptConfigId("");
		fetchConfigs(options.promptType);
		setShowConfigModal(true);
	};

	const handleConfigModalSubmit = async () => {
		if (!id || !article) return;
		setShowConfigModal(false);

		try {
			if (
				configModalMode === "generate" ||
				configModalMode === "retry_ai_content"
			) {
				await articleApi.generateAIContent(
					id as string,
					configModalContentType,
					selectedModelConfigId || undefined,
					selectedPromptConfigId || undefined,
				);
				if (article.ai_analysis) {
					setArticle({
						...article,
						ai_analysis: {
							...article.ai_analysis,
							[`${configModalContentType}_status`]: "pending",
						},
					});
				}
				showToast(
					configModalMode === "generate"
						? t("已提交生成请求")
						: t("已提交重试请求"),
				);
				return;
			}

			if (configModalMode === "retry_cleaning") {
				await articleApi.retryArticleWithConfig(
					id as string,
					selectedModelConfigId || undefined,
					selectedPromptConfigId || undefined,
				);
				setArticle({
					...article,
					status: "pending",
					ai_analysis: article.ai_analysis
						? { ...article.ai_analysis, error_message: null }
						: null,
				});
				showToast(t("已重新提交清洗任务"));
				return;
			}

			await articleApi.retryTranslationWithConfig(
				id as string,
				selectedModelConfigId || undefined,
				selectedPromptConfigId || undefined,
			);
			setArticle({
				...article,
				translation_status: "pending",
				translation_error: null,
			});
			showToast(t("已重新提交翻译请求"));
		} catch (error: any) {
			console.error("Failed to submit config modal:", error);
			const fallbackError =
				configModalMode === "generate"
					? t("生成失败")
					: configModalMode === "retry_ai_content"
						? t("重试失败")
					: configModalMode === "retry_cleaning"
						? t("重试清洗失败")
						: t("重试翻译失败");
			showToast(error.response?.data?.detail || fallbackError, "error");
		}
	};

	const handleRetryTranslation = async () => {
		if (!id || !article) return;
		openConfigModal({
			mode: "retry_translation",
			promptType: "translation",
		});
	};

	const handleRetryCleaning = async () => {
		if (!id || !article) return;
		openConfigModal({
			mode: "retry_cleaning",
			promptType: "content_cleaning",
		});
	};

	const handleGenerateContent = (contentType: AIContentType) => {
		if (!id || !article) return;
		const aiAnalysis = article.ai_analysis;
		const statusMap: Record<AIContentType, string | null | undefined> = {
			summary: aiAnalysis?.summary_status,
			key_points: aiAnalysis?.key_points_status,
			outline: aiAnalysis?.outline_status,
			quotes: aiAnalysis?.quotes_status,
		};
		const contentMap: Record<AIContentType, string | null | undefined> = {
			summary: aiAnalysis?.summary,
			key_points: aiAnalysis?.key_points,
			outline: aiAnalysis?.outline,
			quotes: aiAnalysis?.quotes,
		};
		const status = statusMap[contentType];
		const hasContent = Boolean(contentMap[contentType]);
		const isRetryContent =
			status === "failed" || status === "completed" || hasContent;
		openConfigModal({
			mode: isRetryContent ? "retry_ai_content" : "generate",
			promptType: contentType,
			contentType,
		});
	};

	const handleDelete = async () => {
		if (!id) return;

		try {
			await articleApi.deleteArticle(id as string);
			showToast(t("删除成功"));
			router.push(listReturnHref);
		} catch (error) {
			console.error("Failed to delete article:", error);
			showToast(t("删除失败"), "error");
		}
	};

	const handleToggleVisibility = async () => {
		if (!id || !article) return;

		try {
			await articleApi.updateArticleVisibility(
				id as string,
				!article.is_visible,
			);
			setArticle({ ...article, is_visible: !article.is_visible });
			showToast(article.is_visible ? t("已设为不可见") : t("已设为可见"));
		} catch (error) {
			console.error("Failed to toggle visibility:", error);
			showToast(t("操作失败"), "error");
		}
	};

	const handleCopyContent = async (content: string | null | undefined) => {
		if (!content) return;
		try {
			await navigator.clipboard.writeText(content);
			showToast(t("已复制"));
		} catch (error) {
			console.error("Failed to copy:", error);
			showToast(t("复制失败"), "error");
		}
	};

	const saveNotes = async (
		nextNotes: string,
		nextAnnotations: ArticleAnnotation[],
	) => {
		if (!article) return;
		try {
			await articleApi.updateArticleNotes(article.slug, {
				note_content: nextNotes,
				annotations: nextAnnotations,
			});
		} catch (error) {
			console.error("Failed to save notes:", error);
			showToast(t("保存失败"), "error");
		}
	};

	const handleSaveNoteContent = async () => {
		setNoteContent(noteDraft);
		setShowNoteModal(false);
		await saveNotes(noteDraft, annotations);
		showToast(t("已保存批注"));
	};

	const handleStartAnnotation = () => {
		if (!contentRef.current) return;
		const selection = window.getSelection();
		if (!selection || selection.rangeCount === 0) {
			showToast(t("请先选择需要划线的文字"), "info");
			return;
		}
		const range = selection.getRangeAt(0);
		if (range.collapsed) {
			showToast(t("请先选择需要划线的文字"), "info");
			return;
		}
		if (!contentRef.current.contains(range.commonAncestorContainer)) {
			showToast(t("请选择正文中的文字"), "info");
			return;
		}
		const { start, end } = getRangeOffsets(contentRef.current, range);
		if (start === end) {
			showToast(t("请选择正文中的文字"), "info");
			return;
		}
		setPendingAnnotationRange({ start, end });
		setPendingAnnotationText(range.toString());
		setPendingAnnotationComment("");
		setShowAnnotationModal(true);
		setShowSelectionToolbar(false);
		selection.removeAllRanges();
	};

	const handleConfirmAnnotation = async () => {
		if (!pendingAnnotationRange) return;
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
		setActiveAnnotationId("");
		await saveNotes(noteContent, next);
		showToast(existingId ? t("已更新划线批注") : t("已添加划线批注"));
	};

	const handleDeleteAnnotation = async (id: string) => {
		const next = annotations.filter((item) => item.id !== id);
		setAnnotations(next);
		if (activeAnnotationId === id) {
			setActiveAnnotationId("");
		}
		await saveNotes(noteContent, next);
		showToast(t("已删除划线批注"));
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
		showToast(t("已更新划线批注"));
	};

	const handleSubmitComment = async () => {
		if (commentSubmitting) return;
		const content = replyPrefix
			? `${replyPrefix}\n${commentDraft}`
			: commentDraft;
		if (!content.trim()) {
			showToast(t("请输入评论内容"), "info");
			return;
		}
		setCommentSubmitting(true);
		try {
			const data = await commentApi.createArticleComment(
				id as string,
				content.trim(),
				replyToId,
			);
			setComments((prev) => [data, ...prev]);
			setCommentPage(1);
			setCommentDraft("");
			setReplyToId(null);
			setReplyToUser("");
			setReplyTargetId(null);
			setReplyPrefix("");
			setPendingScrollId(data.id);
			showToast(t("评论已发布"));
		} catch (error: any) {
			showToast(error?.message || t("发布评论失败"), "error");
		} finally {
			setCommentSubmitting(false);
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
			const data = await commentApi.updateComment(
				currentEditingId,
				nextContent,
			);
			setComments((prev) =>
				prev.map((item) =>
					item.id === data.id
						? { ...item, content: data.content, updated_at: data.updated_at }
						: item,
				),
			);
			setEditingCommentId(null);
			setEditingCommentDraft("");
			setEditingCommentPrefix("");
			showToast(t("评论已更新"));
		} catch (error: any) {
			showToast(error?.message || t("更新评论失败"), "error");
		} finally {
			setCommentUpdatingIds((prev) => {
				const next = new Set(prev);
				next.delete(currentEditingId);
				return next;
			});
		}
	};

	const handleDeleteComment = async (commentId: string) => {
		if (commentDeletingIds.has(commentId)) return;
		setCommentDeletingIds((prev) => new Set(prev).add(commentId));
		try {
			await commentApi.deleteComment(commentId);
			setComments((prev) => prev.filter((item) => item.id !== commentId));
			showToast(t("评论已删除"));
		} catch (error: any) {
			showToast(error?.message || t("删除评论失败"), "error");
		} finally {
			setCommentDeletingIds((prev) => {
				const next = new Set(prev);
				next.delete(commentId);
				return next;
			});
		}
	};

	const handleToggleCommentHidden = async (comment: ArticleComment) => {
		if (commentTogglingIds.has(comment.id)) return;
		setCommentTogglingIds((prev) => new Set(prev).add(comment.id));
		try {
			const data = await commentApi.toggleHidden(
				comment.id,
				!comment.is_hidden,
			);
			setComments((prev) =>
				prev.map((item) =>
					item.id === comment.id
						? {
								...item,
								is_hidden: data.is_hidden,
								updated_at: data.updated_at,
							}
						: item,
				),
			);
			showToast(data.is_hidden ? t("评论已隐藏") : t("评论已显示"));
		} catch (error: any) {
			showToast(error?.message || t("操作失败"), "error");
		} finally {
			setCommentTogglingIds((prev) => {
				const next = new Set(prev);
				next.delete(comment.id);
				return next;
			});
		}
	};

	const openDeleteCommentModal = (commentId: string) => {
		if (commentDeletingIds.has(commentId)) return;
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
			showToast(t("请先登录后再回复"), "info");
			return;
		}
		const link =
			typeof window !== "undefined"
				? `${window.location.origin}${window.location.pathname}#comment-${comment.id}`
				: "";
		setReplyToId(rootId || comment.id);
		setReplyToUser(comment.user_name);
		setReplyTargetId(comment.id);
		setReplyPrefix(
			`> ${t("回复")} @${comment.user_name}\n${
				link ? `> [${t("原评论")}](${link})\n` : ""
			}`,
		);
		focusCommentInput();
	};

	const fetchStorageSettings = async () => {
		if (!isAdmin) return;
		setMediaStorageLoading(true);
		try {
			const data = await storageSettingsApi.getSettings();
			setMediaStorageEnabled(Boolean(data.media_storage_enabled));
		} catch (error) {
			console.error("Failed to fetch storage settings:", error);
			showToast(t("存储配置加载失败"), "error");
		} finally {
			setMediaStorageLoading(false);
		}
	};

	const handleEditPaste = async (
		event: React.ClipboardEvent<HTMLTextAreaElement>,
	) => {
		const clipboard = event.clipboardData;
		if (!clipboard || !article?.id) return;
		const target = event.currentTarget;

		const files = Array.from(clipboard.files || []);
		const imageFile = files.find((file) => file.type.startsWith("image/"));
		if (imageFile) {
			if (!mediaStorageEnabled) {
				showToast(t("未开启本地图片存储，无法上传图片"), "info");
				return;
			}
			event.preventDefault();
			setMediaUploading(true);
			try {
				const result = await mediaApi.upload(article.id, imageFile);
				if (target) {
					insertTextAtCursor(target, `![](${result.url})`, setEditContent);
				}
				showToast(t("图片已上传"));
			} catch (error: any) {
				console.error("Failed to upload image:", error);
				showToast(error?.response?.data?.detail || t("图片上传失败"), "error");
			} finally {
				setMediaUploading(false);
			}
			return;
		}

		const html = clipboard.getData("text/html");
		const text = clipboard.getData("text/plain");
		const imageUrl =
			extractImageUrlFromHtml(html) || extractImageUrlFromText(text);
		if (!imageUrl) return;

		event.preventDefault();
		if (!mediaStorageEnabled) {
			if (target) {
				insertTextAtCursor(target, `![](${imageUrl})`, setEditContent);
			}
			return;
		}

		setMediaUploading(true);
		try {
			const result = await mediaApi.ingest(article.id, imageUrl);
			if (target) {
				insertTextAtCursor(target, `![](${result.url})`, setEditContent);
			}
			showToast(t("图片已转存"));
		} catch (error: any) {
			console.error("Failed to ingest image:", error);
			showToast(error?.response?.data?.detail || t("图片转存失败"), "error");
		} finally {
			setMediaUploading(false);
		}
	};

	const handleConvertTopImage = async () => {
		if (!article?.id) return;
		if (!editTopImage.trim()) {
			showToast(t("请先填写头图 URL"), "info");
			return;
		}
		if (!mediaStorageEnabled) {
			showToast(t("未开启本地图片存储"), "info");
			return;
		}
		setMediaUploading(true);
		try {
			const result = await mediaApi.ingest(article.id, editTopImage.trim());
			setEditTopImage(result.url);
			showToast(t("头图已转存"));
		} catch (error: any) {
			console.error("Failed to ingest top image:", error);
			showToast(error?.response?.data?.detail || t("头图转存失败"), "error");
		} finally {
			setMediaUploading(false);
		}
	};

	const handleTopImagePaste = (
		event: React.ClipboardEvent<HTMLInputElement>,
	) => {
		const text = event.clipboardData?.getData("text/plain") || "";
		if (text.trim()) {
			event.preventDefault();
			setEditTopImage(text.trim());
		}
	};

	const handleDeleteNoteContent = async () => {
		try {
			setNoteDraft("");
			setNoteContent("");
			await saveNotes("", annotations);
			showToast(t("批注已删除"));
			setShowNoteModal(false);
		} catch (error) {
			console.error("Failed to delete notes:", error);
			showToast(t("删除失败"), "error");
		}
	};

	const handleBatchConvertMarkdownImages = async () => {
		if (!article?.id) return;
		if (!editContent.trim()) {
			showToast(t("内容为空，无法扫描"), "info");
			return;
		}
		if (!mediaStorageEnabled) {
			showToast(t("未开启本地图片存储"), "info");
			return;
		}
		if (mediaUploading) return;

		const urls = extractMarkdownImageUrls(editContent).filter(
			(url) => !url.includes("/media/"),
		);
		if (urls.length === 0) {
			showToast(t("未发现外链图片"), "info");
			return;
		}

		setMediaUploading(true);
		let nextContent = editContent;
		try {
			await runWithConcurrency(urls, 4, async (url) => {
				try {
					const result = await mediaApi.ingest(article.id, url);
					nextContent = replaceMarkdownImageUrl(nextContent, url, result.url);
				} catch (error: any) {
					console.error("Failed to ingest image:", error);
				}
			});
			setEditContent(nextContent);
			showToast(t("图片转存完成"));
		} finally {
			setMediaUploading(false);
		}
	};

	const openEditModal = (mode: "original" | "translation") => {
		if (!article) return;
		setEditMode(mode);
		setEditTitle(article.title || "");
		setEditAuthor(article.author || "");
		setEditPublishedAt(toDateInputValue(article.published_at));
		setEditCategoryId(article.category?.id || "");
		setEditTopImage(article.top_image || "");
		setEditContent(
			mode === "translation"
				? article.content_trans || ""
				: article.content_md || "",
		);
		setShowEditModal(true);
	};

	const handleSaveEdit = async () => {
		if (!id || !article) return;
		setSaving(true);

		try {
			const updateData: {
				title?: string;
				author?: string;
				published_at?: string | null;
				category_id?: string | null;
				top_image?: string;
				content_md?: string;
				content_trans?: string;
			} = {
				title: editTitle,
				author: editAuthor,
				published_at: editPublishedAt || null,
				category_id: editCategoryId || null,
				top_image: editTopImage,
			};

			if (editMode === "translation") {
				updateData.content_trans = editContent;
			} else {
				updateData.content_md = editContent;
			}

			await articleApi.updateArticle(id as string, updateData);
			showToast(t("保存成功"));
			setShowEditModal(false);
			fetchArticle();
		} catch (error: any) {
			console.error("Failed to save article:", error);
			showToast(error.response?.data?.detail || t("保存失败"), "error");
		} finally {
			setSaving(false);
		}
	};

	if (loading) {
		return (
			<div className="min-h-screen bg-app flex flex-col">
				<AppHeader />
				<div className="flex-1 flex items-center justify-center">
					<div
						className="inline-flex items-center gap-2 text-text-3"
						aria-live="polite"
					>
						<IconRefresh className="h-4 w-4 animate-spin" />
						<span>{t("加载中...")}</span>
					</div>
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
					<div className="text-text-3">{t("文章不存在")}</div>
				</div>
				<AppFooter />
			</div>
		);
	}

	return (
		<div
			className={`min-h-screen ${immersiveMode ? "bg-surface" : "bg-app"} flex flex-col`}
		>
			<Head>
				<title>
					{article?.title
						? `${article.title} - ${basicSettings.site_name || "Lumina"}`
						: `${t("文章详情")} - ${basicSettings.site_name || "Lumina"}`}
				</title>
			</Head>
			<ReadingProgress />
			<AppHeader />
			<section
				className={`bg-surface ${immersiveMode ? "" : "border-b border-border"}`}
			>
				<div className="max-w-7xl mx-auto px-4 py-5 sm:py-6">
					<h1 className="text-2xl font-bold text-text-1 text-center mb-3">
						{article.title}
					</h1>
					<div
						className={`flex flex-wrap gap-4 text-sm text-text-2 justify-center ${immersiveMode ? "" : "border-b border-border pb-3"}`}
					>
						{article.category && (
							<div>
								<span className="font-medium text-text-2">{t("分类")}：</span>
								<Link
									href={`/list?category_id=${article.category.id}`}
									className="inline-flex items-center gap-1"
								>
									<span className="text-primary hover:underline">
										{article.category.name}
									</span>
								</Link>
							</div>
						)}
							{authorItems.length > 0 && (
								<div>
									<span className="font-medium text-text-2">{t("作者")}：</span>
									<span className="inline-flex flex-wrap items-center gap-1">
										{authorItems.map((authorName, index) => (
											<span key={`${authorName}-${index}`} className="inline-flex items-center gap-1">
												{index > 0 && <span className="text-text-3">,</span>}
												<Link
													href={`/list?author=${encodeURIComponent(authorName)}`}
													className="text-primary hover:underline"
												>
													{authorName}
												</Link>
											</span>
										))}
									</span>
								</div>
							)}
						<div>
							<span className="font-medium text-text-2">{t("发表时间")}：</span>
							{article.published_at
								? new Date(article.published_at).toLocaleDateString(
										language === "en" ? "en-US" : "zh-CN",
									)
								: new Date(article.created_at).toLocaleDateString(
										language === "en" ? "en-US" : "zh-CN",
									)}
						</div>
						{article.source_url && (
							<div>
								<span className="font-medium text-text-2">{t("来源")}：</span>
								<a
									href={article.source_url}
									target="_blank"
									rel="noopener noreferrer"
									className="text-primary hover:underline"
								>
									{t("跳转")}
								</a>
							</div>
						)}
					</div>
				</div>
			</section>

			<div
				className={`max-w-7xl w-full mx-auto px-4 ${
					immersiveMode ? "py-6" : "py-6 sm:py-8"
				} flex-1`}
			>
				<div className="flex flex-col lg:flex-row gap-6">
					<div
						className={`flex-1 w-full bg-surface ${immersiveMode ? "" : "rounded-sm shadow-sm border border-border p-4 sm:p-6 max-w-4xl mx-auto lg:mx-0"}`}
					>
						{!immersiveMode && (
							<div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
								<div className="flex flex-wrap items-center gap-2">
									<h2 className="text-lg font-semibold text-text-1 inline-flex items-center gap-2">
										<IconDoc className="h-4 w-4" />
										<span>{t("内容")}</span>
									</h2>
									{isAdmin && article.status === "failed" && (
										<button
											type="button"
											onClick={handleRetryCleaning}
											className="flex items-center gap-1 px-2 py-0.5 rounded text-xs text-danger-ink bg-danger-soft hover:bg-danger-soft transition"
											title={
												article.ai_analysis?.error_message || t("重新清洗")
											}
											aria-label={t("重试清洗")}
										>
											<IconRefresh className="h-3.5 w-3.5" />
											{t("重试清洗")}
										</button>
									)}
									{isAdmin && article.translation_status === "failed" && (
										<button
											type="button"
											onClick={handleRetryTranslation}
											className="flex items-center gap-1 px-2 py-0.5 rounded text-xs text-warning-ink bg-warning-soft hover:bg-warning-soft transition"
											title={article.translation_error || t("重新翻译")}
											aria-label={t("翻译失败")}
										>
											<IconRefresh className="h-3.5 w-3.5" />
											{t("翻译失败")}
										</button>
									)}
								</div>
								<div className="flex flex-wrap items-center gap-2">
									{isAdmin && (
										<>
											<button
												type="button"
												onClick={() => {
													setNoteDraft(noteContent);
													setShowNoteModal(true);
												}}
												className="flex items-center justify-center w-8 h-8 rounded-sm text-text-2 hover:text-text-1 hover:bg-muted transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35"
												title={t("编辑批注")}
												aria-label={t("编辑批注")}
											>
												<IconNote className="h-4 w-4" />
											</button>
											<button
												type="button"
												onClick={handleToggleVisibility}
												className="flex items-center justify-center w-8 h-8 rounded-sm text-text-2 hover:text-text-1 hover:bg-muted transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35"
												title={
													article.is_visible ? t("设为隐藏") : t("设为显示")
												}
												aria-label={
													article.is_visible ? t("设为隐藏") : t("设为显示")
												}
											>
												{article.is_visible ? (
													<IconEye className="h-4 w-4" />
												) : (
													<IconEyeOff className="h-4 w-4" />
												)}
											</button>
											<button
												type="button"
												onClick={() =>
													openEditModal(
														showTranslation && article.content_trans
															? "translation"
															: "original",
													)
												}
												className="flex items-center justify-center w-8 h-8 rounded-sm text-text-2 hover:text-text-1 hover:bg-muted transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35"
												title={t("编辑文章")}
												aria-label={t("编辑文章")}
											>
												<IconEdit className="h-4 w-4" />
											</button>
											<button
												type="button"
												onClick={() => setShowDeleteModal(true)}
												className="flex items-center justify-center w-8 h-8 rounded-sm text-text-2 hover:text-danger-ink hover:bg-danger-soft transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger"
												title={t("删除文章")}
												aria-label={t("删除文章")}
											>
												<IconTrash className="h-4 w-4" />
											</button>
										</>
									)}
									{article.content_trans && (
										<button
											type="button"
											onClick={() => setShowTranslation(!showTranslation)}
											className="flex items-center justify-center w-8 h-8 rounded-sm text-text-2 hover:text-text-1 hover:bg-muted transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35"
											title={showTranslation ? t("显示原文") : t("显示译文")}
											aria-label={
												showTranslation ? t("显示原文") : t("显示译文")
											}
										>
											<IconGlobe className="h-4 w-4" />
										</button>
									)}
									<button
										type="button"
										onClick={() => setImmersiveMode(!immersiveMode)}
										className="flex items-center justify-center w-8 h-8 rounded-sm text-text-2 hover:text-text-1 hover:bg-muted transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35"
										title={
											immersiveMode ? t("退出沉浸模式") : t("进入沉浸模式")
										}
										aria-label={
											immersiveMode ? t("退出沉浸模式") : t("进入沉浸模式")
										}
									>
										<IconBook className="h-4 w-4" />
									</button>
								</div>
							</div>
						)}

						{noteContent && !immersiveMode && (
							<div className="note-panel mb-4 rounded-sm p-4 text-sm text-text-2">
								<div className="flex items-center justify-between mb-2">
									<div className="note-panel-title text-sm">{t("批注")}</div>
									{isAdmin && (
										<IconButton
											onClick={() => setShowDeleteNoteModal(true)}
											variant="ghost"
											size="sm"
											title={t("删除批注")}
											className="rounded-full"
										>
											<IconTrash className="h-3.5 w-3.5" />
										</IconButton>
									)}
								</div>
								<div
									className="prose prose-sm max-w-none"
									dangerouslySetInnerHTML={{
										__html: renderMarkdown(noteContent),
									}}
								/>
							</div>
						)}
						<div
							ref={contentRef}
							onClick={handleContentClick}
							onMouseOver={handleContentMouseOver}
							onMouseOut={handleContentMouseOut}
							className={`prose prose-sm max-w-none break-words overflow-x-auto prose-img:cursor-zoom-in prose-img:rounded-lg prose-img:border prose-img:border-border prose-img:bg-surface prose-img:shadow-sm ${
								immersiveMode
									? "immersive-content"
									: "prose-img:max-w-full lg:prose-img:max-w-[420px]"
							}`}
							dangerouslySetInnerHTML={{ __html: renderedHtml }}
						/>

						<div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mt-6 text-sm">
							<button
								type="button"
								onClick={() =>
									prevArticle && router.push(buildArticleHref(prevArticle.slug))
								}
								disabled={!prevArticle}
								className={`px-3 py-2 rounded-lg transition text-left ${
									prevArticle
										? "bg-muted text-text-2 hover:bg-surface hover:text-text-1"
										: "bg-muted text-text-3 cursor-not-allowed"
								}`}
								title={prevArticle ? prevArticle.title : t("无上一篇")}
							>
								<span className="block">← {t("上一篇")}</span>
								{prevArticle && (
									<span className="block text-xs text-text-3">
										{prevArticle.title.length > 20
											? `${prevArticle.title.slice(0, 20)}...`
											: prevArticle.title}
									</span>
								)}
							</button>
							<button
								type="button"
								onClick={() =>
									nextArticle && router.push(buildArticleHref(nextArticle.slug))
								}
								disabled={!nextArticle}
								className={`px-3 py-2 rounded-lg transition text-right ${
									nextArticle
										? "bg-muted text-text-2 hover:bg-surface hover:text-text-1"
										: "bg-muted text-text-3 cursor-not-allowed"
								}`}
								title={nextArticle ? nextArticle.title : t("无下一篇")}
							>
								<span className="block">{t("下一篇")} →</span>
								{nextArticle && (
									<span className="block text-xs text-text-3">
										{nextArticle.title.length > 20
											? `${nextArticle.title.slice(0, 20)}...`
											: nextArticle.title}
									</span>
								)}
							</button>
						</div>

						{commentsEnabled && !immersiveMode && (
							<section className="mt-10">
								<div className="bg-surface border border-border rounded-sm p-5">
									<div className="flex items-center justify-between mb-4">
										<div className="flex items-center gap-2">
											<h3 className="text-base font-semibold text-text-1">
												{t("评论")}
											</h3>
											<span className="text-xs text-text-3">
												({totalTopComments})
											</span>
										</div>
										{session ? (
											<div className="flex items-center gap-2 text-xs text-text-3">
												<span>{session.user.name || t("访客")}</span>
												<div className="relative" ref={userMenuRef}>
													{session.user.image && (
														<button
															type="button"
															onClick={() => setShowUserMenu(!showUserMenu)}
															className="focus:outline-none"
														>
															<img
																src={session.user.image}
																alt={session.user.name || t("访客")}
																className="h-6 w-6 rounded-full object-cover cursor-pointer"
																width={24}
																height={24}
																loading="lazy"
																decoding="async"
															/>
														</button>
													)}
													{showUserMenu && (
														<div className="absolute right-0 mt-2 min-w-[120px] rounded-sm border border-border bg-surface shadow-sm text-xs text-text-2 z-10">
															<button
																type="button"
																onClick={() => {
																	signOut();
																	setShowUserMenu(false);
																}}
																className="w-full text-left px-3 py-2 hover:bg-muted hover:text-text-1 transition"
															>
																{t("退出登录")}
															</button>
														</div>
													)}
												</div>
											</div>
										) : (
											<div className="flex items-center gap-2">
												{commentProviders.github && (
													<button
														type="button"
														onClick={() => signIn("github")}
														className="px-3 py-1 text-xs rounded-full border border-border text-text-2 hover:text-text-1 hover:bg-muted transition"
													>
														{t("GitHub 登录")}
													</button>
												)}
												{commentProviders.google && (
													<button
														type="button"
														onClick={() => signIn("google")}
														className="px-3 py-1 text-xs rounded-full border border-border text-text-2 hover:text-text-1 hover:bg-muted transition"
													>
														{t("Google 登录")}
													</button>
												)}
												{!commentProviders.github &&
													!commentProviders.google && (
														<span className="text-xs text-text-3">
															{t("未配置登录方式")}
														</span>
													)}
											</div>
										)}
									</div>

									{session && (
										<div className="mb-5">
											{replyToId && (
												<div className="mb-2 flex items-center justify-between rounded-sm border border-border bg-muted px-3 py-2 text-xs text-text-2">
													<span>
														{t("回复")} {replyToUser ? `@${replyToUser}` : ""}
													</span>
													<button
														type="button"
														onClick={() => {
															setReplyToId(null);
															setReplyToUser("");
															setReplyTargetId(null);
															setReplyPrefix("");
														}}
														disabled={commentSubmitting}
														className="text-text-3 hover:text-text-1 transition disabled:opacity-50 disabled:cursor-not-allowed"
													>
														{t("取消回复")}
													</button>
												</div>
											)}
											<TextArea
												ref={commentInputRef}
												value={commentDraft}
												onChange={(e) => setCommentDraft(e.target.value)}
												rows={4}
												className="rounded-lg"
												placeholder={t("写下你的评论，支持 Markdown")}
												disabled={commentSubmitting}
											/>
											<div className="mt-2 flex justify-end">
												<Button
													type="button"
													onClick={handleSubmitComment}
													variant="primary"
													size="sm"
													loading={commentSubmitting}
													disabled={commentSubmitting}
												>
													{t("发布评论")}
												</Button>
											</div>
										</div>
									)}

									{commentsLoading ? (
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
												const isOwner = session?.user?.id === comment.user_id;
												const isEditing = editingCommentId === comment.id;
												const replies = sortedRepliesByParent[comment.id] || [];
												const isExpanded = expandedReplies[comment.id] ?? false;
												const isUpdatingComment = commentUpdatingIds.has(
													comment.id,
												);
												const isDeletingComment = commentDeletingIds.has(
													comment.id,
												);
												const isTogglingComment = commentTogglingIds.has(
													comment.id,
												);
												return (
													<div
														key={comment.id}
														id={`comment-${comment.id}`}
														className={`border border-border rounded-lg p-4 bg-surface scroll-mt-24 transition-colors duration-700 ${
															highlightedCommentId === comment.id
																? "ring-2 ring-primary/40 bg-primary-soft/35"
																: ""
														}`}
													>
														<div className="flex items-start justify-between gap-2 mb-2">
															<div className="flex items-center gap-2">
																{comment.user_avatar && (
																	<img
																		src={comment.user_avatar}
																		alt={comment.user_name}
																		className="h-6 w-6 rounded-full object-cover"
																		width={24}
																		height={24}
																		loading="lazy"
																		decoding="async"
																	/>
																)}
																<div className="text-sm text-text-1">
																	{comment.user_name}
																</div>
																<a
																	href={`#comment-${comment.id}`}
																	className="text-xs text-text-3 hover:text-text-1 transition"
																>
																	{new Date(
																		comment.created_at,
																	).toLocaleString()}
																</a>
															</div>
															<div className="flex items-center gap-1.5">
																{isEditing ? (
																	<>
																		<IconButton
																			onClick={() => {
																				setEditingCommentId(null);
																				setEditingCommentDraft("");
																				setEditingCommentPrefix("");
																			}}
																			variant="danger"
																			size="sm"
																			title={t("取消")}
																			disabled={isUpdatingComment}
																			className="rounded-full"
																		>
																			×
																		</IconButton>
																		<IconButton
																			onClick={handleSaveEditComment}
																			variant="primary"
																			size="sm"
																			title={
																				isUpdatingComment
																					? t("保存中...")
																					: t("保存")
																			}
																			loading={isUpdatingComment}
																			disabled={isUpdatingComment}
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
																			title={t("回复")}
																			disabled={
																				commentSubmitting ||
																				isUpdatingComment ||
																				isDeletingComment
																			}
																			className="rounded-full"
																		>
																			<IconReply className="h-3.5 w-3.5" />
																		</IconButton>
																		{isAdmin && (
																			<IconButton
																				onClick={() =>
																					handleToggleCommentHidden(comment)
																				}
																				variant="ghost"
																				size="sm"
																				title={
																					isTogglingComment
																						? t("处理中...")
																						: comment.is_hidden
																							? t("显示")
																							: t("隐藏")
																				}
																				loading={isTogglingComment}
																				disabled={
																					isTogglingComment || isDeletingComment
																				}
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
																					onClick={() =>
																						handleStartEditComment(comment)
																					}
																					variant="ghost"
																					size="sm"
																					title={t("编辑")}
																					disabled={
																						isDeletingComment ||
																						isTogglingComment ||
																						isUpdatingComment
																					}
																					className="rounded-full"
																				>
																					<IconEdit className="h-3.5 w-3.5" />
																				</IconButton>
																				<IconButton
																					onClick={() =>
																						openDeleteCommentModal(comment.id)
																					}
																					variant="danger"
																					size="sm"
																					title={
																						isDeletingComment
																							? t("删除中...")
																							: t("删除")
																					}
																					loading={isDeletingComment}
																					disabled={
																						isDeletingComment ||
																						isUpdatingComment ||
																						isTogglingComment
																					}
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
																<TextArea
																	value={editingCommentDraft}
																	onChange={(e) =>
																		setEditingCommentDraft(e.target.value)
																	}
																	rows={4}
																	className="rounded-lg"
																	disabled={isUpdatingComment}
																/>
															</div>
														) : (
															(() => {
																const meta = getReplyMeta(comment.content);
																const body = extractReplyPrefix(
																	comment.content,
																).body;
																return (
																	<div>
																		{meta && (
																			<div className="text-xs text-text-3 mb-2">
																				<span>
																					{t("回复")} @{meta.user}
																				</span>
																				{meta.link && (
																					<a
																						href={meta.link}
																						className="ml-2 text-text-3 hover:text-text-1 transition underline"
																					>
																						{t("原评论")}
																					</a>
																				)}
																			</div>
																		)}
																		<div
																			className="prose prose-sm max-w-none text-text-2"
																			style={{
																				wordBreak: "break-word",
																				overflowWrap: "anywhere",
																				whiteSpace: "normal",
																			}}
																			dangerouslySetInnerHTML={{
																				__html: renderMarkdown(body),
																			}}
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
																	{t("回复")}{" "}
																	{replyToUser ? `@${replyToUser}` : ""}
																</div>
																<TextArea
																	ref={commentInputRef}
																	value={commentDraft}
																	onChange={(e) =>
																		setCommentDraft(e.target.value)
																	}
																	rows={3}
																	className="rounded-lg"
																	placeholder={t("写下你的回复，支持 Markdown")}
																	disabled={commentSubmitting}
																/>
																<div className="flex justify-end gap-1.5 mt-2">
																	<IconButton
																		onClick={() => {
																			setReplyToId(null);
																			setReplyToUser("");
																			setReplyTargetId(null);
																			setReplyPrefix("");
																		}}
																		variant="ghost"
																		size="sm"
																		title={t("取消")}
																		disabled={commentSubmitting}
																		className="rounded-full"
																	>
																		×
																	</IconButton>
																	<IconButton
																		onClick={handleSubmitComment}
																		variant="primary"
																		size="sm"
																		title={
																			commentSubmitting
																				? t("发布中...")
																				: t("发布")
																		}
																		loading={commentSubmitting}
																		disabled={commentSubmitting}
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
																	type="button"
																	onClick={() =>
																		setExpandedReplies((prev) => ({
																			...prev,
																			[comment.id]: !isExpanded,
																		}))
																	}
																	className="inline-flex items-center gap-1 text-xs text-text-3 hover:text-text-1 transition"
																	title={
																		isExpanded ? t("收起回复") : t("查看回复")
																	}
																	aria-label={
																		isExpanded ? t("收起回复") : t("查看回复")
																	}
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
																		{replies.map((reply) => {
																			const isReplyUpdating =
																				commentUpdatingIds.has(reply.id);
																			const isReplyDeleting =
																				commentDeletingIds.has(reply.id);
																			const isReplyToggling =
																				commentTogglingIds.has(reply.id);
																			return (
																				<div
																					key={reply.id}
																					id={`comment-${reply.id}`}
																					className={`border border-border rounded-lg p-3 bg-muted transition-colors duration-700 ${
																						highlightedCommentId === reply.id
																							? "ring-2 ring-primary/35 bg-primary-soft/30"
																							: ""
																					}`}
																				>
																					<div className="flex items-start justify-between gap-2 mb-2">
																						<div className="flex items-center gap-2">
																							{reply.user_avatar && (
																								<img
																									src={reply.user_avatar}
																									alt={reply.user_name}
																									className="h-5 w-5 rounded-full object-cover"
																									width={20}
																									height={20}
																									loading="lazy"
																									decoding="async"
																								/>
																							)}
																							<div className="text-xs text-text-1">
																								{reply.user_name}
																							</div>
																							<a
																								href={`#comment-${reply.id}`}
																								className="text-xs text-text-3 hover:text-text-1 transition"
																							>
																								{new Date(
																									reply.created_at,
																								).toLocaleString()}
																							</a>
																						</div>
																						<div className="flex items-center gap-1.5">
																							{editingCommentId === reply.id ? (
																								<>
																									<IconButton
																										onClick={() => {
																											setEditingCommentId(null);
																											setEditingCommentDraft(
																												"",
																											);
																											setEditingCommentPrefix(
																												"",
																											);
																										}}
																										variant="ghost"
																										size="sm"
																										title={t("取消")}
																										disabled={isReplyUpdating}
																										className="rounded-full"
																									>
																										×
																									</IconButton>
																									<IconButton
																										onClick={
																											handleSaveEditComment
																										}
																										variant="primary"
																										size="sm"
																										title={
																											isReplyUpdating
																												? t("保存中...")
																												: t("保存")
																										}
																										loading={isReplyUpdating}
																										disabled={isReplyUpdating}
																										className="rounded-full"
																									>
																										<IconCheck className="h-3.5 w-3.5" />
																									</IconButton>
																								</>
																							) : (
																								<>
																									<IconButton
																										onClick={() =>
																											handleReplyTo(
																												reply,
																												comment.id,
																											)
																										}
																										variant="ghost"
																										size="sm"
																										title={t("回复")}
																										disabled={
																											commentSubmitting ||
																											isReplyUpdating ||
																											isReplyDeleting
																										}
																										className="rounded-full"
																									>
																										<IconReply className="h-3.5 w-3.5" />
																									</IconButton>
																									{isAdmin && (
																										<IconButton
																											onClick={() =>
																												handleToggleCommentHidden(
																													reply,
																												)
																											}
																											variant="ghost"
																											size="sm"
																											title={
																												isReplyToggling
																													? t("处理中...")
																													: reply.is_hidden
																														? t("显示")
																														: t("隐藏")
																											}
																											loading={isReplyToggling}
																											disabled={
																												isReplyToggling ||
																												isReplyDeleting
																											}
																											className="rounded-full"
																										>
																											{reply.is_hidden ? (
																												<IconEye className="h-3.5 w-3.5" />
																											) : (
																												<IconEyeOff className="h-3.5 w-3.5" />
																											)}
																										</IconButton>
																									)}
																									{session?.user?.id ===
																										reply.user_id && (
																										<>
																											<IconButton
																												onClick={() =>
																													handleStartEditComment(
																														reply,
																													)
																												}
																												variant="ghost"
																												size="sm"
																												title={t("编辑")}
																												disabled={
																													isReplyDeleting ||
																													isReplyToggling ||
																													isReplyUpdating
																												}
																												className="rounded-full"
																											>
																												<IconEdit className="h-3.5 w-3.5" />
																											</IconButton>
																											<IconButton
																												onClick={() =>
																													openDeleteCommentModal(
																														reply.id,
																													)
																												}
																												variant="danger"
																												size="sm"
																												title={
																													isReplyDeleting
																														? t("删除中...")
																														: t("删除")
																												}
																												loading={
																													isReplyDeleting
																												}
																												disabled={
																													isReplyDeleting ||
																													isReplyUpdating ||
																													isReplyToggling
																												}
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
																							<TextArea
																								value={editingCommentDraft}
																								onChange={(e) =>
																									setEditingCommentDraft(
																										e.target.value,
																									)
																								}
																								rows={3}
																								className="rounded-lg"
																								disabled={isReplyUpdating}
																							/>
																						</div>
																					) : (
																						(() => {
																							const meta = getReplyMeta(
																								reply.content,
																							);
																							const body = extractReplyPrefix(
																								reply.content,
																							).body;
																							return (
																								<div>
																									{meta && (
																										<div className="text-xs text-text-3 mb-2">
																											<span>
																												{t("回复")} @{meta.user}
																											</span>
																											{meta.link && (
																												<a
																													href={meta.link}
																													className="ml-2 text-text-3 hover:text-text-1 transition underline"
																												>
																													{t("原评论")}
																												</a>
																											)}
																										</div>
																									)}
																									<div
																										className="prose prose-sm max-w-none text-text-2"
																										style={{
																											wordBreak: "break-word",
																											overflowWrap: "anywhere",
																											whiteSpace: "normal",
																										}}
																										dangerouslySetInnerHTML={{
																											__html:
																												renderMarkdown(body),
																										}}
																									/>
																								</div>
																							);
																						})()
																					)}

																					{session &&
																						replyTargetId === reply.id && (
																							<div
																								id={`reply-box-${reply.id}`}
																								className="mt-3 border border-border rounded-lg p-3 bg-surface"
																							>
																								<div className="mb-2 text-xs text-text-2">
																									{t("回复")}{" "}
																									{replyToUser
																										? `@${replyToUser}`
																										: ""}
																								</div>
																								<TextArea
																									ref={commentInputRef}
																									value={commentDraft}
																									onChange={(e) =>
																										setCommentDraft(
																											e.target.value,
																										)
																									}
																									rows={3}
																									className="rounded-lg"
																									placeholder={t(
																										"写下你的回复，支持 Markdown",
																									)}
																									disabled={commentSubmitting}
																								/>
																								<div className="flex justify-end gap-1.5 mt-2">
																									<IconButton
																										onClick={() => {
																											setReplyToId(null);
																											setReplyToUser("");
																											setReplyTargetId(null);
																											setReplyPrefix("");
																										}}
																										variant="ghost"
																										size="sm"
																										title={t("取消")}
																										disabled={commentSubmitting}
																										className="rounded-full"
																									>
																										×
																									</IconButton>
																									<IconButton
																										onClick={
																											handleSubmitComment
																										}
																										variant="primary"
																										size="sm"
																										title={
																											commentSubmitting
																												? t("发布中...")
																												: t("发布")
																										}
																										loading={commentSubmitting}
																										disabled={commentSubmitting}
																										className="rounded-full"
																									>
																										<IconCheck className="h-3.5 w-3.5" />
																									</IconButton>
																								</div>
																							</div>
																						)}
																				</div>
																			);
																		})}
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
												onClick={() =>
													setCommentPage((prev) => Math.max(1, prev - 1))
												}
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
													setCommentPage((prev) =>
														Math.min(totalCommentPages, prev + 1),
													)
												}
												disabled={commentPage === totalCommentPages}
												variant="secondary"
												size="sm"
											>
												{t("下一页")}
											</Button>
										</div>
									)}
								</div>
							</section>
						)}
					</div>

					{!immersiveMode && (
						<aside className="flex-shrink-0 w-full lg:w-[420px]">
							<div className="max-h-none overflow-visible lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto">
								{aiPanelContent}
							</div>
						</aside>
					)}
				</div>
			</div>

				{showConfigModal && (
					<ModalShell
						isOpen={showConfigModal}
						onClose={() => setShowConfigModal(false)}
						title={
							configModalMode === "generate"
								? t("选择生成配置")
								: configModalMode === "retry_ai_content"
									? t("选择重试配置")
								: configModalMode === "retry_cleaning"
									? t("选择清洗重试配置")
									: t("选择翻译重试配置")
						}
						widthClassName="max-w-md"
						footer={
							<div className="flex justify-end gap-2">
							<Button
								type="button"
								variant="secondary"
								onClick={() => setShowConfigModal(false)}
							>
								{t("取消")}
							</Button>
								<Button
									type="button"
									variant="primary"
									onClick={handleConfigModalSubmit}
								>
									{configModalMode === "generate" ? t("生成") : t("提交重试")}
								</Button>
							</div>
						}
					>
					<div className="space-y-4">
						<FormField label={t("模型配置")}>
							<SelectField
								value={selectedModelConfigId}
								onChange={(value) => setSelectedModelConfigId(value)}
								className="w-full"
									options={[
										{ value: "", label: t("使用默认配置") },
										...selectableModelConfigs.map((config) => ({
											value: config.id,
											label: `${config.name} (${config.model_name}) · ${
												config.model_type === "vector" ? t("向量") : t("通用")
											}`,
										})),
									]}
								/>
							</FormField>

						<FormField label={t("提示词配置")}>
							<SelectField
								value={selectedPromptConfigId}
								onChange={(value) => setSelectedPromptConfigId(value)}
								className="w-full"
								options={[
									{ value: "", label: t("使用默认配置") },
									...promptConfigs.map((config) => ({
										value: config.id,
										label: config.name,
									})),
								]}
							/>
						</FormField>
					</div>
				</ModalShell>
			)}

			{showEditModal && (
				<div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-2 sm:p-4">
					<div
						className="bg-surface rounded-lg shadow-xl w-full h-[95vh] flex flex-col"
						onClick={(event) => event.stopPropagation()}
					>
						<div className="flex items-center justify-between p-4 border-b border-border flex-shrink-0">
							<h3 className="text-lg font-semibold text-text-1">
								{t("编辑文章")}
							</h3>
							<button
								type="button"
								onClick={() => setShowEditModal(false)}
								className="text-text-3 hover:text-text-1 text-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35"
								aria-label={t("关闭编辑弹窗")}
							>
								×
							</button>
						</div>

						<div className="flex-1 overflow-hidden">
							<div className="grid grid-cols-1 lg:grid-cols-2 h-full">
								{/* 左侧编辑区 */}
								<div className="p-4 flex flex-col h-full border-r border-border">
									<div className="space-y-4 flex-1 flex flex-col">
										<FormField label={t("标题")}>
											<TextInput
												type="text"
												value={editTitle}
												onChange={(e) => setEditTitle(e.target.value)}
											/>
										</FormField>

											<div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
												<FormField label={t("作者")}>
													<TextInput
														type="text"
														value={editAuthor}
														onChange={(e) => setEditAuthor(e.target.value)}
													/>
												</FormField>
												<FormField label={t("发表时间")}>
													<TextInput
														type="date"
														value={editPublishedAt}
														onChange={(e) => setEditPublishedAt(e.target.value)}
													/>
												</FormField>
											</div>
											<div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
												<FormField label={t("分类")}>
													<SelectField
														value={editCategoryId}
														onChange={(value) => setEditCategoryId(value)}
														className="w-full"
														loading={categoriesLoading}
														options={[
															{ value: "", label: t("未分类") },
															...categories.map((category) => ({
																value: category.id,
																label: category.name,
															})),
														]}
													/>
												</FormField>
												<FormField
													label={
														<span className="inline-flex items-center gap-2">
															<span>{t("头图 URL")}</span>
															{!mediaStorageEnabled && (
																<span className="text-xs font-normal text-text-3">
																	{t("未开启本地存储，头图将保持外链")}
																</span>
															)}
														</span>
													}
													htmlFor="edit-top-image"
												>
													<div className="flex gap-2">
														<TextInput
															id="edit-top-image"
															type="text"
															value={editTopImage}
															onChange={(e) => setEditTopImage(e.target.value)}
															onPaste={handleTopImagePaste}
															className="flex-1"
															placeholder={t("输入图片 URL")}
														/>
														<IconButton
															onClick={handleConvertTopImage}
															disabled={
																mediaStorageLoading ||
																mediaUploading ||
																!mediaStorageEnabled
															}
															title={
																mediaStorageEnabled
																	? t("转存为本地文件")
																	: t("未开启本地图片存储")
															}
															variant="ghost"
															size="md"
															className="hover:bg-muted"
														>
															<IconLink className="h-4 w-4" />
														</IconButton>
													</div>
												</FormField>
											</div>

										<div className="flex-1 flex flex-col">
											<div className="mb-1.5 flex items-center justify-between gap-2">
												<span className="flex min-w-0 items-center gap-2 text-sm text-text-2">
													<span>{t("内容（Markdown）")}</span>
													{!mediaStorageEnabled && (
														<span className="text-xs font-normal text-text-3">
															{t("未开启本地存储，外链将保持不变")}
														</span>
													)}
												</span>
												<div className="flex items-center gap-2">
													<IconButton
														onClick={handleBatchConvertMarkdownImages}
														disabled={mediaUploading || !mediaStorageEnabled}
														title={
															mediaStorageEnabled
																? t("扫描并转存外链图片")
																: t("未开启本地图片存储")
														}
														variant="ghost"
														size="md"
														className="hover:bg-muted"
													>
														<IconLink className="h-4 w-4" />
													</IconButton>
												</div>
											</div>

											<TextArea
												ref={editTextareaRef}
												value={editContent}
												onChange={(e) => setEditContent(e.target.value)}
												onPaste={handleEditPaste}
												onScroll={() => {
													if (
														editTextareaRef.current &&
														editPreviewRef.current
													) {
														const textarea = editTextareaRef.current;
														const preview = editPreviewRef.current;
														const scrollRatio =
															textarea.scrollTop /
															(textarea.scrollHeight - textarea.clientHeight);
														preview.scrollTop =
															scrollRatio *
															(preview.scrollHeight - preview.clientHeight);
													}
												}}
												className="flex-1 font-mono resize-none min-h-[200px]"
												placeholder={t("在此输入 Markdown 内容...")}
											/>
										</div>
									</div>

									<div className="flex justify-end gap-2 pt-4 border-t flex-shrink-0">
										<Button
											type="button"
											variant="secondary"
											onClick={() => setShowEditModal(false)}
											disabled={saving}
										>
											{t("取消")}
										</Button>
										<Button
											type="button"
											variant="primary"
											onClick={handleSaveEdit}
											disabled={saving}
										>
											{saving ? t("保存中...") : t("保存")}
										</Button>
									</div>
								</div>

								<div
									ref={editPreviewRef}
									onScroll={() => {
										if (editTextareaRef.current && editPreviewRef.current) {
											const textarea = editTextareaRef.current;
											const preview = editPreviewRef.current;
											const scrollRatio =
												preview.scrollTop /
												(preview.scrollHeight - preview.clientHeight);
											textarea.scrollTop =
												scrollRatio *
												(textarea.scrollHeight - textarea.clientHeight);
										}
									}}
									className="bg-muted overflow-y-auto h-full hidden lg:block"
								>
									<div className="max-w-3xl mx-auto bg-surface min-h-full shadow-sm">
											<div className="relative w-full aspect-[21/9] overflow-hidden">
												<img
													src={editPreviewTopImageUrl || fallbackTopImageUrl}
													alt={editTitle}
													className="w-full h-full object-cover"
													loading="lazy"
													decoding="async"
													onError={(e) => {
														(e.target as HTMLImageElement).style.display = "none";
													}}
												/>
											</div>
										<article className="p-6">
											<div
												className="prose prose-sm max-w-none"
												dangerouslySetInnerHTML={{
													__html: renderSafeMarkdown(editContent || ""),
												}}
											/>
										</article>
									</div>
								</div>
							</div>
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
						type="button"
						onClick={handleStartAnnotation}
						className="w-7 h-7 flex items-center justify-center border border-border text-primary rounded-full bg-surface/80 hover:bg-primary-soft transition"
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
						style={{ transform: "translate(-50%, calc(-100% - 8px))" }}
					>
						<div className="max-h-[4.5rem] overflow-hidden">
							<div
								className="prose prose-sm max-w-none text-text-1"
								style={{
									display: "-webkit-box",
									WebkitLineClamp: 3,
									WebkitBoxOrient: "vertical",
									overflow: "hidden",
									whiteSpace: "normal",
									wordBreak: "break-word",
									overflowWrap: "anywhere",
								}}
								dangerouslySetInnerHTML={{
									__html:
										renderMarkdown(
											annotations.find((item) => item.id === hoverAnnotationId)
												?.comment || "",
										) || "",
								}}
							/>
						</div>
					</div>
				</div>
			)}

			{showAnnotationView && activeAnnotation && (
				<ModalShell
					isOpen={showAnnotationView}
					onClose={() => setShowAnnotationView(false)}
					title={t("划线批注内容")}
					widthClassName="max-w-lg"
					footer={
						isAdmin ? (
							<div className="flex justify-end gap-2">
								<Button
									type="button"
									variant="secondary"
									onClick={() => {
										setActiveAnnotationId(activeAnnotation.id);
										setPendingAnnotationRange({
											start: activeAnnotation.start,
											end: activeAnnotation.end,
										});
										setPendingAnnotationText(activeAnnotationText || "");
										setPendingAnnotationComment(activeAnnotation.comment);
										setShowAnnotationView(false);
										setShowAnnotationModal(true);
									}}
								>
									{t("编辑")}
								</Button>
								<Button
									type="button"
									variant="danger"
									onClick={() => {
										setPendingDeleteAnnotationId(activeAnnotation.id);
										setShowDeleteAnnotationModal(true);
										setShowAnnotationView(false);
									}}
								>
									{t("删除")}
								</Button>
							</div>
						) : null
					}
				>
					<div className="text-sm text-text-2">
						{activeAnnotationText && (
							<div
								className="mb-3 rounded-sm border border-border bg-muted p-3 text-xs text-text-3"
								dangerouslySetInnerHTML={{
									__html: sanitizeRichHtml(activeAnnotationText),
								}}
							/>
						)}
						<div
							className="prose prose-sm max-w-none"
							style={{
								wordBreak: "break-word",
								overflowWrap: "anywhere",
								whiteSpace: "normal",
							}}
							dangerouslySetInnerHTML={{
								__html: renderMarkdown(activeAnnotation.comment),
							}}
						/>
					</div>
				</ModalShell>
			)}

			{showNoteModal && (
				<ModalShell
					isOpen={showNoteModal}
					onClose={() => setShowNoteModal(false)}
					title={t("批注内容")}
					widthClassName="max-w-lg"
					footer={
						<div className="flex justify-end gap-2">
							{isAdmin && noteContent && (
								<Button
									type="button"
									variant="danger"
									onClick={() => setShowDeleteNoteModal(true)}
								>
									{t("删除")}
								</Button>
							)}
							<Button
								type="button"
								variant="secondary"
								onClick={() => setShowNoteModal(false)}
							>
								{t("取消")}
							</Button>
							<Button
								type="button"
								variant="primary"
								onClick={handleSaveNoteContent}
							>
								{t("保存")}
							</Button>
						</div>
					}
				>
					<TextArea
						value={noteDraft}
						onChange={(e) => setNoteDraft(e.target.value)}
						rows={6}
						placeholder={t("输入批注内容，支持 Markdown")}
					/>
				</ModalShell>
			)}

			{showAnnotationModal && (
				<ModalShell
					isOpen={showAnnotationModal}
					onClose={() => setShowAnnotationModal(false)}
					title={t("添加划线批注")}
					widthClassName="max-w-lg"
					footer={
						<div className="flex justify-end gap-2">
							<Button
								type="button"
								variant="secondary"
								onClick={() => setShowAnnotationModal(false)}
							>
								{t("取消")}
							</Button>
							<Button
								type="button"
								variant="primary"
								onClick={handleConfirmAnnotation}
							>
								{activeAnnotationId ? t("保存") : t("添加")}
							</Button>
						</div>
					}
				>
					<div className="space-y-3">
						<div className="text-xs text-text-3">{t("已选内容")}：</div>
						<div className="rounded-sm border border-border bg-muted p-3 text-sm text-text-2">
							{pendingAnnotationText || t("（无）")}
						</div>
						<FormField label={t("划线批注内容")}>
							<TextArea
								value={pendingAnnotationComment}
								onChange={(e) => setPendingAnnotationComment(e.target.value)}
								rows={4}
								placeholder={t("输入划线批注内容")}
							/>
						</FormField>
					</div>
				</ModalShell>
			)}

			<ConfirmModal
				isOpen={showDeleteNoteModal}
				title={t("删除批注")}
				message={t("确定要删除文章开头批注吗？此操作不可撤销。")}
				confirmText={t("删除")}
				cancelText={t("取消")}
				onConfirm={async () => {
					await handleDeleteNoteContent();
					setShowDeleteNoteModal(false);
				}}
				onCancel={() => setShowDeleteNoteModal(false)}
			/>

			<ConfirmModal
				isOpen={showDeleteAnnotationModal}
				title={t("删除批注")}
				message={t("确定要删除这条划线批注吗？此操作不可撤销。")}
				confirmText={t("删除")}
				cancelText={t("取消")}
				onConfirm={async () => {
					if (pendingDeleteAnnotationId) {
						await handleDeleteAnnotation(pendingDeleteAnnotationId);
					}
					setShowDeleteAnnotationModal(false);
					setPendingDeleteAnnotationId(null);
				}}
				onCancel={() => {
					setShowDeleteAnnotationModal(false);
					setPendingDeleteAnnotationId(null);
				}}
			/>

			<ConfirmModal
				isOpen={showDeleteCommentModal}
				title={t("删除评论")}
				message={t("确定要删除这条评论吗？此操作不可撤销。")}
				confirmText={t("删除")}
				cancelText={t("取消")}
				onConfirm={async () => {
					if (pendingDeleteCommentId) {
						await handleDeleteComment(pendingDeleteCommentId);
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
				title={t("删除文章")}
				message={t("确定要删除这篇文章吗？此操作不可撤销。")}
				confirmText={t("删除")}
				cancelText={t("取消")}
				onConfirm={async () => {
					await handleDelete();
					setShowDeleteModal(false);
				}}
				onCancel={() => setShowDeleteModal(false)}
			/>

			<ModalShell
				isOpen={Boolean(lightboxImage)}
				onClose={() => setLightboxImage(null)}
				title={t("预览")}
				widthClassName="max-w-5xl"
				panelClassName="max-h-[90vh]"
				bodyClassName="p-4"
			>
				{lightboxImage ? (
					<div className="flex items-center justify-center">
						<img
							src={lightboxImage}
							alt={t("预览")}
							className="max-h-[78vh] max-w-full rounded-lg shadow-xl"
							decoding="async"
						/>
					</div>
				) : null}
			</ModalShell>

			{mindMapOpen &&
				article?.ai_analysis?.outline &&
				(() => {
					const tree = parseMindMapOutline(article.ai_analysis?.outline || "");
					if (!tree) return null;
					return (
						<ModalShell
							isOpen={mindMapOpen}
							onClose={() => setMindMapOpen(false)}
							title={t("大纲")}
							widthClassName="max-w-6xl"
							panelClassName="max-h-[90vh]"
							bodyClassName="p-0"
						>
							<div className="h-[80vh] overflow-auto p-6">
								<MindMapTree node={tree} isRoot />
							</div>
						</ModalShell>
					);
				})()}

			<AppFooter />
			<BackToTop />

			{isMobile && (
				<>
					<button
						type="button"
						onClick={() => setShowAiPanel(true)}
						className="fixed right-4 top-24 flex items-center justify-center w-10 h-10 rounded-full bg-surface border border-border shadow-lg text-text-2 hover:text-text-1 hover:bg-muted transition z-50"
						title={t("AI")}
					>
						AI
					</button>
					<ModalShell
						isOpen={showAiPanel}
						onClose={() => setShowAiPanel(false)}
						title={t("AI")}
						widthClassName="max-w-sm"
						overlayClassName="items-stretch justify-end bg-black/40 p-0"
						panelClassName="h-full w-[86vw] max-w-sm rounded-none border-l border-border shadow-xl"
						headerClassName="border-b border-border px-4 py-3"
						bodyClassName="overflow-y-auto p-4"
					>
						{aiPanelContent}
					</ModalShell>
				</>
			)}

			{immersiveMode && !isMobile && (
				<button
					type="button"
					onClick={() => setImmersiveMode(false)}
					className="fixed right-6 top-1/2 -translate-y-1/2 flex items-center justify-center w-10 h-10 rounded-full bg-surface border border-border shadow-lg text-text-2 hover:text-text-1 hover:bg-muted transition z-50"
					title={`${t("退出沉浸模式")} (Esc)`}
				>
					<IconBook className="h-5 w-5" />
				</button>
			)}
		</div>
	);
}
