import type { GetServerSideProps } from "next";
import Link from "next/link";
import { useRouter } from "next/router";
import { useCallback, useEffect, useMemo, useRef, useState, type ClipboardEvent } from "react";

import { signIn, signOut, useSession } from "next-auth/react";

import AppFooter from "@/components/AppFooter";
import AppHeader from "@/components/AppHeader";
import Button from "@/components/Button";
import ConfirmModal from "@/components/ConfirmModal";
import IconButton from "@/components/IconButton";
import ReviewManualGenerateModal from "@/components/ReviewManualGenerateModal";
import SeoHead from "@/components/SeoHead";
import { BackToTop } from "@/components/BackToTop";
import ArticleMetaRow from "@/components/article/ArticleMetaRow";
import { useToast } from "@/components/Toast";
import {
	IconBook,
	IconCheck,
	IconChevronDown,
	IconChevronRight,
	IconChevronUp,
	IconClock,
	IconDoc,
	IconEdit,
	IconEye,
	IconEyeOff,
	IconLink,
	IconList,
	IconRefresh,
	IconReply,
	IconTag,
	IconTrash,
} from "@/components/icons";
import FormField from "@/components/ui/FormField";
import TextArea from "@/components/ui/TextArea";
import TextInput from "@/components/ui/TextInput";
import { useAuth } from "@/contexts/AuthContext";
import { useBasicSettings } from "@/contexts/BasicSettingsContext";
import { useReading } from "@/contexts/ReadingContext";
import {
	commentSettingsApi,
	getApiBaseUrl,
	mediaApi,
	resolveMediaUrl,
	reviewApi,
	reviewCommentApi,
	storageSettingsApi,
	type BasicSettings,
	type ReviewComment,
	type ReviewIssue,
} from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import {
	buildCanonicalUrl,
	buildMetaDescription,
	resolveSeoAssetUrl,
} from "@/lib/seo";
import {
	fetchServerBasicSettings,
	fetchServerReview,
	resolveRequestOrigin,
} from "@/lib/serverApi";
import { renderSafeMarkdown } from "@/lib/safeHtml";

interface ReviewDetailPageProps {
	initialBasicSettings: BasicSettings;
	initialReview: ReviewIssue;
	siteOrigin: string;
}

interface CommentProviders {
	github: boolean;
	google: boolean;
}

interface ReplyMeta {
	user: string;
	link: string;
}

interface TocItem {
	id: string;
	text: string;
	level: number;
}

type PastedMediaKind = "image" | "video" | "audio" | "book";

interface PastedMediaLink {
	kind: PastedMediaKind;
	url: string;
}

const REVIEW_ARTICLE_SECTIONS_PLACEHOLDER = "{{review_article_sections}}";
const IMAGE_LINK_PATTERN = /\.(png|jpe?g|gif|webp|svg|bmp|avif)(\?.*)?$/i;
const VIDEO_LINK_PATTERN = /\.(mp4|webm|mov|m4v|ogv|ogg)(\?.*)?$/i;
const AUDIO_LINK_PATTERN = /\.(mp3|wav|m4a|aac|ogg|flac|opus)(\?.*)?$/i;
const BOOK_LINK_PATTERN = /\.(pdf|epub|mobi)(\?.*)?$/i;
const VIDEO_HOST_PATTERN = /(youtube\.com|youtu\.be|bilibili\.com|vimeo\.com)/i;
const VIEW_COUNT_DEDUPE_WINDOW_MS = 24 * 60 * 60 * 1000;

const syncScrollPosition = (from: HTMLElement, to: HTMLElement) => {
	const fromScrollable = from.scrollHeight - from.clientHeight;
	if (fromScrollable <= 0) {
		to.scrollTop = 0;
		return;
	}
	const ratio = from.scrollTop / fromScrollable;
	const toScrollable = Math.max(0, to.scrollHeight - to.clientHeight);
	to.scrollTop = ratio * toScrollable;
};

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

function cleanupPastedUrl(url: string): string {
	return (url || "")
		.trim()
		.replace(/^<|>$/g, "")
		.replace(/[),.;:!?]+$/, "");
}

function detectMediaKindFromUrl(url: string): PastedMediaKind | null {
	const normalized = cleanupPastedUrl(url);
	if (!normalized || !/^https?:\/\//i.test(normalized)) return null;
	if (IMAGE_LINK_PATTERN.test(normalized)) return "image";
	if (AUDIO_LINK_PATTERN.test(normalized)) return "audio";
	if (VIDEO_LINK_PATTERN.test(normalized)) return "video";
	if (VIDEO_HOST_PATTERN.test(normalized)) return "video";
	if (BOOK_LINK_PATTERN.test(normalized)) return "book";
	return null;
}

function buildMarkdownFromMediaLink(
	link: PastedMediaLink,
	t: (key: string) => string,
): string {
	if (link.kind === "image") {
		return `![](${link.url})`;
	}
	if (link.kind === "video") {
		return `[▶ ${t("视频")}](${link.url})`;
	}
	if (link.kind === "audio") {
		return `[🎧 ${t("音频")}](${link.url})`;
	}
	return `[📚 ${t("书籍")}](${link.url})`;
}

function toPastedMediaLink(url?: string | null): PastedMediaLink | null {
	const normalized = cleanupPastedUrl(url || "");
	const kind = detectMediaKindFromUrl(normalized);
	if (!kind) return null;
	return { kind, url: normalized };
}

function extractMediaLinkFromHtml(html: string): PastedMediaLink | null {
	if (!html) return null;
	try {
		const doc = new DOMParser().parseFromString(html, "text/html");
		const candidates = [
			doc.querySelector("img")?.getAttribute("src"),
			doc.querySelector("video")?.getAttribute("src"),
			doc.querySelector("video source")?.getAttribute("src"),
			doc.querySelector("audio")?.getAttribute("src"),
			doc.querySelector("audio source")?.getAttribute("src"),
			doc.querySelector("iframe")?.getAttribute("src"),
			doc.querySelector("a")?.getAttribute("href"),
		];
		for (const candidate of candidates) {
			const link = toPastedMediaLink(candidate);
			if (link) return link;
		}
		return null;
	} catch {
		return null;
	}
}

function extractMediaLinkFromText(text: string): PastedMediaLink | null {
	if (!text) return null;
	const trimmed = text.trim();
	if (!trimmed) return null;
	if (/!\[[^\]]*\]\([^)]+\)/.test(trimmed)) return null;
	if (/\[[^\]]+\]\([^)]+\)/.test(trimmed)) return null;
	const urlMatch = trimmed.match(/https?:\/\/[^\s)]+/);
	if (!urlMatch?.[0]) return null;
	return toPastedMediaLink(urlMatch[0]);
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

const getReviewViewStorageKey = (slug: string): string =>
	`review_view_count_tracked:${slug}`;

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

function materializeReviewArticlePlaceholders(
	markdown: string,
	articleSectionsMarkdown: string | undefined,
	articlePlaceholderBlocks: Record<string, string> | undefined,
): string {
	const sectionMarkdown = (articleSectionsMarkdown || "").trim();
	let nextMarkdown = (markdown || "").replace(
		REVIEW_ARTICLE_SECTIONS_PLACEHOLDER,
		sectionMarkdown,
	);
	if (!articlePlaceholderBlocks) return nextMarkdown;
	for (const [slug, block] of Object.entries(articlePlaceholderBlocks)) {
		if (!slug) continue;
		const placeholder = `{{${slug}}}`;
		nextMarkdown = nextMarkdown.split(placeholder).join(block || "");
	}
	return nextMarkdown;
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
					onClick={(event) => {
						event.preventDefault();
						onSelect(item.id);
					}}
					className={`block truncate rounded px-2 py-1 text-xs transition ${
						activeId === item.id
							? "bg-primary-soft font-semibold text-primary-ink"
							: "text-text-2 hover:bg-muted hover:text-text-1"
					}`}
					style={{ paddingLeft: `${(item.level - 1) * 8 + 8}px` }}
				>
					{item.text}
				</a>
			))}
		</nav>
	);
}

export const getServerSideProps: GetServerSideProps<ReviewDetailPageProps> = async ({
	params,
	req,
}) => {
	const siteOrigin = resolveRequestOrigin(req);
	const slug = String(params?.slug || "");
	if (!slug) {
		return { notFound: true };
	}
	try {
		const [initialBasicSettings, initialReview] = await Promise.all([
			fetchServerBasicSettings(req),
			fetchServerReview(req, slug),
		]);
		return {
			props: {
				initialBasicSettings,
				initialReview,
				siteOrigin,
			},
		};
	} catch {
		return { notFound: true };
	}
};

function formatDateTime(value: string | null | undefined, language: "zh-CN" | "en") {
	if (!value) return "";
	return new Date(value).toLocaleString(language === "en" ? "en-US" : "zh-CN");
}

function formatDate(value: string | null | undefined, language: "zh-CN" | "en") {
	if (!value) return "";
	return new Date(value).toLocaleDateString(language === "en" ? "en-US" : "zh-CN");
}

function formatReviewRange(
	windowStart: string | null | undefined,
	windowEnd: string | null | undefined,
) {
	if (!windowStart || !windowEnd) return "";
	const start = windowStart.slice(0, 10);
	const endDate = new Date(windowEnd);
	if (Number.isNaN(endDate.getTime())) {
		return `${start} - ${windowEnd.slice(0, 10)}`;
	}
	endDate.setDate(endDate.getDate() - 1);
	const end = endDate.toISOString().slice(0, 10);
	return `${start} - ${end}`;
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
			line.startsWith("> [原评论](") ||
			line.startsWith("> [Original Comment](")
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

function getReplyMeta(content: string): ReplyMeta | null {
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
		<div className="fixed top-0 left-0 right-0 z-50 h-1 bg-muted">
			<div
				className="h-full bg-primary transition-all duration-150"
				style={{ width: `${progress}%` }}
			/>
		</div>
	);
}

export default function ReviewDetailPage({
	initialBasicSettings,
	initialReview,
	siteOrigin,
}: ReviewDetailPageProps) {
	const router = useRouter();
	const { data: session } = useSession();
	const { basicSettings } = useBasicSettings();
	const { isAdmin } = useAuth();
	const { addArticle, setIsHidden } = useReading();
	const { t, language } = useI18n();
	const { showToast } = useToast();

	const [review, setReview] = useState<ReviewIssue>(initialReview);
	const [title, setTitle] = useState(initialReview.title);
	const [markdownContent, setMarkdownContent] = useState(
		initialReview.markdown_content || "",
	);
	const [publishedAt, setPublishedAt] = useState(
		toDateInputValue(initialReview.published_at || initialReview.created_at),
	);
	const [topImage, setTopImage] = useState(initialReview.top_image || "");
	const [isEditing, setIsEditing] = useState(false);
	const [saving, setSaving] = useState(false);
	const [publishing, setPublishing] = useState(false);
	const [immersiveMode, setImmersiveMode] = useState(false);
	const [isMobile, setIsMobile] = useState(false);
	const [mediaStorageEnabled, setMediaStorageEnabled] = useState(false);
	const [mediaStorageLoading, setMediaStorageLoading] = useState(false);
	const [mediaUploading, setMediaUploading] = useState(false);

	const [comments, setComments] = useState<ReviewComment[]>([]);
	const [commentsLoading, setCommentsLoading] = useState(false);
	const [commentsEnabled, setCommentsEnabled] = useState(true);
	const [commentSettingsLoaded, setCommentSettingsLoaded] = useState(false);
	const [commentProviders, setCommentProviders] = useState<CommentProviders>({
		github: false,
		google: false,
	});
	const [commentDraft, setCommentDraft] = useState("");
	const [commentSubmitting, setCommentSubmitting] = useState(false);
	const [replyToId, setReplyToId] = useState<string | null>(null);
	const [replyToUser, setReplyToUser] = useState("");
	const [replyTargetId, setReplyTargetId] = useState<string | null>(null);
	const [replyPrefix, setReplyPrefix] = useState("");
	const [expandedReplies, setExpandedReplies] = useState<Record<string, boolean>>({});
	const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
	const [editingCommentDraft, setEditingCommentDraft] = useState("");
	const [editingCommentPrefix, setEditingCommentPrefix] = useState("");
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
	const [showDeleteCommentModal, setShowDeleteCommentModal] = useState(false);
	const [pendingDeleteCommentId, setPendingDeleteCommentId] = useState<
		string | null
	>(null);
	const [showDeleteIssueModal, setShowDeleteIssueModal] = useState(false);
	const [showRegenerateModal, setShowRegenerateModal] = useState(false);
	const [showUserMenu, setShowUserMenu] = useState(false);
	const [tocItems, setTocItems] = useState<TocItem[]>([]);
	const [activeTocId, setActiveTocId] = useState("");
	const [tocCollapsed, setTocCollapsed] = useState(false);
	const [lightboxImages, setLightboxImages] = useState<string[]>([]);
	const [lightboxIndex, setLightboxIndex] = useState(0);

	const commentPageSize = 5;
	const commentInputRef = useRef<HTMLTextAreaElement | null>(null);
	const userMenuRef = useRef<HTMLDivElement | null>(null);
	const contentRef = useRef<HTMLDivElement | null>(null);
	const editContentRef = useRef<HTMLTextAreaElement | null>(null);
	const previewRef = useRef<HTMLDivElement | null>(null);
	const activeHeadingMapRef = useRef<Map<string, number>>(new Map());

	const lightboxImage = lightboxImages[lightboxIndex] || null;
	const hasLightboxMultiple = lightboxImages.length > 1;

	const closeLightbox = useCallback(() => {
		setLightboxImages([]);
		setLightboxIndex(0);
	}, []);

	const shiftLightbox = useCallback((direction: -1 | 1) => {
		if (lightboxImages.length <= 1) return;
		setLightboxIndex((prev) => {
			const next = prev + direction;
			if (next < 0) return lightboxImages.length - 1;
			if (next >= lightboxImages.length) return 0;
			return next;
		});
	}, [lightboxImages.length]);

	const handleContentClick = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
		const target = event.target as HTMLElement | null;
		if (!target) return;
		if (target.tagName === "IMG") {
			const img = target as HTMLImageElement;
			const clickedSrc = img.currentSrc || img.src || "";
			if (clickedSrc) {
				const imageList = contentRef.current
					? Array.from(contentRef.current.querySelectorAll("img"))
							.map((node) => {
								const imageNode = node as HTMLImageElement;
								return imageNode.currentSrc || imageNode.src || "";
							})
							.filter(Boolean)
					: [];
				const uniqueImages = Array.from(new Set(imageList));
				const images = uniqueImages.length > 0 ? uniqueImages : [clickedSrc];
				const index = Math.max(0, images.findIndex((src) => src === clickedSrc));
				setLightboxImages(images);
				setLightboxIndex(index);
			}
		}
	}, [contentRef]);

	useEffect(() => {
		if (!lightboxImage) return;
		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				closeLightbox();
			} else if (e.key === "ArrowLeft") {
				shiftLightbox(-1);
			} else if (e.key === "ArrowRight") {
				shiftLightbox(1);
			}
		};
		document.addEventListener("keydown", handleKeyDown);
		return () => document.removeEventListener("keydown", handleKeyDown);
	}, [lightboxImage, shiftLightbox, closeLightbox]);

	useEffect(() => {
		setReview(initialReview);
		setTitle(initialReview.title);
		setMarkdownContent(initialReview.markdown_content || "");
		setPublishedAt(toDateInputValue(initialReview.published_at || initialReview.created_at));
		setTopImage(initialReview.top_image || "");
		setIsEditing(false);
	}, [initialReview]);

	useEffect(() => {
		const templateId = review.template?.id;
		const currentDescription = (review.template?.description || "").trim();
		if (!isAdmin || !templateId || currentDescription) return;

		let disposed = false;
		const hydrateTemplateDescription = async () => {
			try {
				const templates = await reviewApi.getTemplates();
				if (disposed) return;
				const matched = templates.find((item) => item.id === templateId);
				const nextDescription = (matched?.description || "").trim();
				if (!nextDescription) return;
				setReview((prev) => {
					if (!prev.template || prev.template.id !== templateId) return prev;
					return {
						...prev,
						template: {
							...prev.template,
							description: nextDescription,
						},
					};
				});
			} catch (error) {
				console.error("Failed to hydrate review template description:", error);
			}
		};

		void hydrateTemplateDescription();
		return () => {
			disposed = true;
		};
	}, [isAdmin, review.template?.description, review.template?.id]);

	useEffect(() => {
		if (!isAdmin) return;
		let disposed = false;
		const loadMediaSettings = async () => {
			setMediaStorageLoading(true);
			try {
				const data = await storageSettingsApi.getSettings();
				if (disposed) return;
				setMediaStorageEnabled(Boolean(data.media_storage_enabled));
			} catch (error) {
				if (!disposed) {
					console.error("Failed to fetch storage settings:", error);
					showToast(t("存储配置加载失败"), "error");
				}
			} finally {
				if (!disposed) {
					setMediaStorageLoading(false);
				}
			}
		};
		void loadMediaSettings();
		return () => {
			disposed = true;
		};
	}, [isAdmin, showToast, t]);

	useEffect(() => {
		const handleClickOutside = (event: MouseEvent) => {
			if (
				userMenuRef.current &&
				!userMenuRef.current.contains(event.target as Node)
			) {
				setShowUserMenu(false);
			}
		};
		document.addEventListener("mousedown", handleClickOutside);
		return () => document.removeEventListener("mousedown", handleClickOutside);
	}, []);

	useEffect(() => {
		if (typeof window === "undefined") return;
		const media = window.matchMedia("(max-width: 1023px)");
		const handleChange = (event?: MediaQueryListEvent) => {
			setIsMobile(event ? event.matches : media.matches);
		};
		handleChange();
		media.addEventListener("change", handleChange);
		return () => media.removeEventListener("change", handleChange);
	}, []);

	useEffect(() => {
		setIsHidden(isEditing);
		return () => setIsHidden(false);
	}, [isEditing, setIsHidden]);

	useEffect(() => {
		if (!review?.id || !review?.slug || !review?.title) return;
		addArticle({
			id: review.id,
			slug: review.slug,
			title: review.title,
			type: "review",
		});
	}, [addArticle, review?.id, review?.slug, review?.title]);

	useEffect(() => {
		if (typeof window === "undefined") return;
		if (!review?.slug) return;
		const storageKey = getReviewViewStorageKey(review.slug);
		const lastTrackedAt = Number(window.localStorage.getItem(storageKey) || "0");
		const now = Date.now();
		if (Number.isFinite(lastTrackedAt) && now - lastTrackedAt < VIEW_COUNT_DEDUPE_WINDOW_MS) {
			return;
		}
		void reviewApi
			.recordReviewView(review.slug)
			.then((result) => {
				window.localStorage.setItem(storageKey, String(now));
				setReview((prev) =>
					prev && prev.slug === review.slug
						? { ...prev, view_count: result.view_count }
						: prev,
				);
			})
			.catch((error) => {
				console.error("Failed to record review view:", error);
			});
	}, [review?.slug]);

	useEffect(() => {
		let disposed = false;
		const loadCommentSettings = async () => {
			try {
				const data = await commentSettingsApi.getPublicSettings();
				if (disposed) return;
				setCommentsEnabled(Boolean(data.comments_enabled));
				setCommentProviders(data.providers);
			} catch (error) {
				if (disposed) return;
				console.error("Failed to fetch comment settings:", error);
			} finally {
				if (!disposed) {
					setCommentSettingsLoaded(true);
				}
			}
		};
		loadCommentSettings();
		return () => {
			disposed = true;
		};
	}, []);

	useEffect(() => {
		if (review.status !== "published" || !commentSettingsLoaded || !commentsEnabled) {
			setComments([]);
			setCommentsLoading(false);
			return;
		}
		let disposed = false;
		const loadComments = async () => {
			setCommentsLoading(true);
			try {
				const data = await reviewCommentApi.getReviewComments(review.slug);
				if (!disposed) {
					setComments(data);
				}
			} catch (error) {
				if (!disposed) {
					console.error("Failed to fetch review comments:", error);
					showToast(t("评论加载失败"), "error");
				}
			} finally {
				if (!disposed) {
					setCommentsLoading(false);
				}
			}
		};
		loadComments();
		return () => {
			disposed = true;
		};
	}, [commentSettingsLoaded, commentsEnabled, review.slug, review.status, showToast, t]);

	useEffect(() => {
		setCommentPage(1);
	}, [review.id]);

	useEffect(() => {
		if (!contentRef.current) return;
		const rafId = requestAnimationFrame(() => {
			if (!contentRef.current) return;
			const headings = contentRef.current.querySelectorAll("h1, h2, h3, h4, h5, h6");
			const items: TocItem[] = [];
			headings.forEach((heading, index) => {
				const id = `review-heading-${index}`;
				heading.id = id;
				items.push({
					id,
					text: heading.textContent || "",
					level: Number.parseInt(heading.tagName[1] || "1", 10),
				});
			});
			setTocItems(items);
			setActiveTocId(items[0]?.id || "");
		});
		return () => cancelAnimationFrame(rafId);
	}, [review.id, review.markdown_content, review.rendered_markdown]);

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
						(left, right) => left[1] - right[1],
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
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape" && immersiveMode) {
				setImmersiveMode(false);
			}
		};
		document.addEventListener("keydown", handleKeyDown);
		return () => document.removeEventListener("keydown", handleKeyDown);
	}, [immersiveMode]);

	const siteSettings = basicSettings.site_name ? basicSettings : initialBasicSettings;
	const siteName = siteSettings.site_name || "Lumina";
	const fallbackTopImageUrl = useMemo(
		() => resolveMediaUrl(siteSettings.site_logo_url || "/logo.png"),
		[siteSettings.site_logo_url],
	);
	const currentTopImageUrl = useMemo(
		() => resolveMediaUrl(review.top_image || ""),
		[review.top_image],
	);
	const editPreviewTopImageUrl = useMemo(
		() => resolveMediaUrl(topImage || siteSettings.site_logo_url || "/logo.png"),
		[topImage, siteSettings.site_logo_url],
	);
	const html = useMemo(
		() =>
			renderSafeMarkdown(review.rendered_markdown || review.markdown_content || "", {
				enableMediaEmbed: true,
			}),
		[review.markdown_content, review.rendered_markdown],
	);
	const editPreviewMarkdown = useMemo(() => {
		return materializeReviewArticlePlaceholders(
			markdownContent || "",
			review.article_sections_markdown,
			review.article_placeholder_blocks,
		);
	}, [
		markdownContent,
		review.article_placeholder_blocks,
		review.article_sections_markdown,
	]);
	const editPreviewHtml = useMemo(
		() =>
			renderSafeMarkdown(editPreviewMarkdown, {
				enableMediaEmbed: true,
			}),
		[editPreviewMarkdown],
	);

	const canonicalUrl = buildCanonicalUrl(siteOrigin, `/reviews/${review.slug}`);
	const seoDescription = buildMetaDescription(review.summary || t("周期回顾"));
	const seoImageUrl = resolveSeoAssetUrl(
		siteOrigin,
		review.top_image || siteSettings.site_logo_url || "/logo.png",
	);
	const publisherLogoUrl = resolveSeoAssetUrl(
		siteOrigin,
		siteSettings.site_logo_url || "/logo.png",
	);
	const templateCategoryText = useMemo(() => {
		const categoryNames = review.template?.category_names || [];
		return categoryNames.length > 0 ? categoryNames.join("、") : t("全部分类");
	}, [review.template?.category_names, t]);
	const recentReviews = useMemo(() => review.recent_reviews || [], [review.recent_reviews]);
	const templateDescriptionText = useMemo(
		() => (review.template?.description || "").trim(),
		[review.template?.description],
	);
	const breadcrumbStructuredData = {
		"@context": "https://schema.org",
		"@type": "BreadcrumbList",
		itemListElement: [
			{
				"@type": "ListItem",
				position: 1,
				name: t("主页"),
				item: buildCanonicalUrl(siteOrigin, "/"),
			},
			{
				"@type": "ListItem",
				position: 2,
				name: t("回顾"),
				item: buildCanonicalUrl(siteOrigin, "/reviews"),
			},
			{
				"@type": "ListItem",
				position: 3,
				name: review.title,
				item: canonicalUrl,
			},
		],
	};
	const reviewStructuredData = {
		"@context": "https://schema.org",
		"@type": "BlogPosting",
		headline: review.title,
		description: seoDescription,
		mainEntityOfPage: canonicalUrl,
		url: canonicalUrl,
		image: seoImageUrl || undefined,
		datePublished: review.published_at || review.created_at,
		dateModified: review.updated_at,
		articleSection: review.template?.name || undefined,
		about: review.category_names.length > 0 ? review.category_names : undefined,
		publisher: {
			"@type": "Organization",
			name: siteName,
			logo: publisherLogoUrl
				? {
						"@type": "ImageObject",
						url: publisherLogoUrl,
					}
				: undefined,
		},
		author: {
			"@type": "Organization",
			name: siteName,
		},
	};

	const sortedTopComments = useMemo(
		() =>
			[...comments]
				.filter((comment) => !comment.reply_to_id)
				.sort((left, right) =>
					left.created_at.localeCompare(right.created_at),
				),
		[comments],
	);

	const repliesByParent = useMemo(() => {
		const grouped: Record<string, ReviewComment[]> = {};
		comments.forEach((comment) => {
			if (!comment.reply_to_id) return;
			if (!grouped[comment.reply_to_id]) {
				grouped[comment.reply_to_id] = [];
			}
			grouped[comment.reply_to_id].push(comment);
		});
		Object.values(grouped).forEach((items) =>
			items.sort((left, right) => left.created_at.localeCompare(right.created_at)),
		);
		return grouped;
	}, [comments]);

	const totalCommentPages = Math.max(
		1,
		Math.ceil(sortedTopComments.length / commentPageSize),
	);
	const pagedTopComments = useMemo(() => {
		const start = (commentPage - 1) * commentPageSize;
		return sortedTopComments.slice(start, start + commentPageSize);
	}, [commentPage, sortedTopComments]);

	useEffect(() => {
		if (commentPage > totalCommentPages) {
			setCommentPage(totalCommentPages);
		}
	}, [commentPage, totalCommentPages]);

	const displayCommentCount =
		commentSettingsLoaded && commentsEnabled && review.status === "published"
			? comments.length
			: (review.comment_count ?? 0);
	const showTitleViewStat = (review.view_count ?? 0) > 0;
	const showTitleCommentStat = displayCommentCount > 0;

	const resetReplyState = () => {
		setReplyToId(null);
		setReplyToUser("");
		setReplyTargetId(null);
		setReplyPrefix("");
	};

	const refreshAdminReview = async (issueId: string) => {
		const next = await reviewApi.getIssue(issueId);
		setReview(next);
		setTitle(next.title);
		setPublishedAt(toDateInputValue(next.published_at || next.created_at));
		setTopImage(next.top_image || "");
		setMarkdownContent(next.markdown_content || "");
		return next;
	};

	const resetEditDraft = (nextReview: ReviewIssue) => {
		setTitle(nextReview.title);
		setPublishedAt(toDateInputValue(nextReview.published_at || nextReview.created_at));
		setTopImage(nextReview.top_image || "");
		setMarkdownContent(nextReview.markdown_content || "");
	};

	const openEditMode = () => {
		resetEditDraft(review);
		setIsEditing(true);
	};

	const closeEditMode = () => {
		resetEditDraft(review);
		setIsEditing(false);
	};

	const handleOpenRegenerateModal = () => {
		if (!review.template?.id) {
			showToast(t("当前回顾未关联模板无法重新生成"), "error");
			return;
		}
		setShowRegenerateModal(true);
	};

	const handleTocSelect = (id: string) => {
		setActiveTocId(id);
		if (typeof window !== "undefined") {
			window.history.replaceState(null, "", `#${id}`);
		}
		const target = document.getElementById(id);
		if (!target) return;
		target.scrollIntoView({ behavior: "smooth", block: "center" });
	};

	const isLikelyInternalMediaUrl = (url: string): boolean => {
		const trimmed = url.trim();
		if (!trimmed) return false;
		if (
			trimmed.startsWith("/media/") ||
			trimmed.startsWith("/backend/media/")
		) {
			return true;
		}
		if (typeof window === "undefined") return false;
		try {
			const apiOrigin = new URL(getApiBaseUrl(), window.location.origin).origin;
			const parsed = new URL(trimmed);
			const isInternalPath =
				parsed.pathname.startsWith("/media/") ||
				parsed.pathname.startsWith("/backend/media/");
			return isInternalPath && parsed.origin === apiOrigin;
		} catch {
			return false;
		}
	};

	const handleEditPaste = async (event: ClipboardEvent<HTMLTextAreaElement>) => {
		const clipboard = event.clipboardData;
		if (!clipboard || !review.id) return;
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
				const result = await mediaApi.upload(
					{ reviewIssueId: review.id },
					imageFile,
				);
				insertTextAtCursor(target, `![](${result.url})`, setMarkdownContent);
				showToast(t("图片已上传"));
			} catch (error: any) {
				console.error("Failed to upload review image:", error);
				showToast(error?.response?.data?.detail || t("图片上传失败"), "error");
			} finally {
				setMediaUploading(false);
			}
			return;
		}

		const htmlContent = clipboard.getData("text/html");
		const text = clipboard.getData("text/plain");
		const mediaLink =
			extractMediaLinkFromHtml(htmlContent) || extractMediaLinkFromText(text);
		if (!mediaLink) return;

		event.preventDefault();
		if (mediaLink.kind === "video" || mediaLink.kind === "audio") {
			insertTextAtCursor(
				target,
				buildMarkdownFromMediaLink(mediaLink, t),
				setMarkdownContent,
			);
			return;
		}

		if (!mediaStorageEnabled) {
			insertTextAtCursor(
				target,
				buildMarkdownFromMediaLink(mediaLink, t),
				setMarkdownContent,
			);
			return;
		}

		setMediaUploading(true);
		try {
			const ingestKind = mediaLink.kind === "book" ? "book" : "image";
			const result = await mediaApi.ingest(
				{ reviewIssueId: review.id },
				mediaLink.url,
				ingestKind,
			);
			if (mediaLink.kind === "image") {
				insertTextAtCursor(target, `![](${result.url})`, setMarkdownContent);
			} else {
				insertTextAtCursor(
					target,
					buildMarkdownFromMediaLink({ kind: "book", url: result.url }, t),
					setMarkdownContent,
				);
			}
			showToast(mediaLink.kind === "book" ? t("书籍已转存") : t("图片已转存"));
		} catch (error: any) {
			console.error("Failed to ingest review media:", error);
			showToast(
				error?.response?.data?.detail ||
					(mediaLink.kind === "book" ? t("书籍转存失败") : t("图片转存失败")),
				"error",
			);
		} finally {
			setMediaUploading(false);
		}
	};

	const handleConvertTopImage = async () => {
		if (!review.id) return;
		if (!topImage.trim()) {
			showToast(t("请先填写头图 URL"), "info");
			return;
		}
		if (!mediaStorageEnabled) {
			showToast(t("未开启本地图片存储"), "info");
			return;
		}
		setMediaUploading(true);
		try {
			const result = await mediaApi.ingest(
				{ reviewIssueId: review.id },
				topImage.trim(),
			);
			setTopImage(result.url);
			showToast(t("头图已转存"));
		} catch (error: any) {
			console.error("Failed to ingest review top image:", error);
			showToast(error?.response?.data?.detail || t("头图转存失败"), "error");
		} finally {
			setMediaUploading(false);
		}
	};

	const handleTopImagePaste = (event: ClipboardEvent<HTMLInputElement>) => {
		const text = event.clipboardData?.getData("text/plain") || "";
		if (text.trim()) {
			event.preventDefault();
			setTopImage(text.trim());
		}
	};

	const handleBatchConvertMarkdownImages = async () => {
		if (!review.id) return;
		if (!markdownContent.trim()) {
			showToast(t("内容为空，无法扫描"), "info");
			return;
		}
		if (!mediaStorageEnabled) {
			showToast(t("未开启本地图片存储"), "info");
			return;
		}
		if (mediaUploading) return;

		const urls = extractMarkdownImageUrls(markdownContent).filter(
			(url) => !isLikelyInternalMediaUrl(url),
		);
		if (urls.length === 0) {
			showToast(t("未发现外链图片"), "info");
			return;
		}

		setMediaUploading(true);
		let nextContent = markdownContent;
		try {
			await runWithConcurrency(urls, 4, async (url) => {
				try {
					const result = await mediaApi.ingest(
						{ reviewIssueId: review.id },
						url,
					);
					nextContent = replaceMarkdownImageUrl(nextContent, url, result.url);
				} catch (error) {
					console.error("Failed to ingest review markdown image:", error);
				}
			});
			setMarkdownContent(nextContent);
			showToast(t("图片转存完成"));
		} finally {
			setMediaUploading(false);
		}
	};

	const handleSave = async () => {
		if (!review.id) return;
		setSaving(true);
		try {
			const next = await reviewApi.updateIssue(review.id, {
				title,
				published_at: publishedAt || null,
				top_image: topImage || null,
				markdown_content: markdownContent,
			});
			setReview(next);
			resetEditDraft(next);
			setIsEditing(false);
			showToast(t("回顾已保存"), "success");
		} catch (error) {
			console.error("Failed to save review issue:", error);
			showToast(t("回顾保存失败"), "error");
		} finally {
			setSaving(false);
		}
	};

	const handlePublishToggle = async () => {
		if (!review.id) return;
		setPublishing(true);
		try {
			if (review.status === "published") {
				await reviewApi.unpublishIssue(review.id);
				showToast(t("回顾已撤回"), "success");
			} else {
				await reviewApi.publishIssue(review.id);
				showToast(t("回顾已发布"), "success");
			}
			const previousSlug = review.slug;
			const next = await refreshAdminReview(review.id);
			if (next.slug && next.slug !== previousSlug) {
				await router.replace(`/reviews/${next.slug}`);
			}
		} catch (error) {
			console.error("Failed to toggle review issue publish status:", error);
			showToast(t("回顾发布状态更新失败"), "error");
		} finally {
			setPublishing(false);
		}
	};

	const handleDeleteIssue = async () => {
		if (!review.id) return;
		try {
			await reviewApi.deleteIssue(review.id);
			showToast(t("回顾已删除"), "success");
			await router.push("/reviews");
		} catch (error) {
			console.error("Failed to delete review issue:", error);
			showToast(t("回顾删除失败"), "error");
		}
	};

	const handleSubmitComment = async () => {
		if (commentSubmitting || !session || review.status !== "published") return;
		const finalContent = replyPrefix
			? `${replyPrefix}\n${commentDraft}`
			: commentDraft;
		if (!finalContent.trim()) {
			showToast(t("评论内容不能为空"), "error");
			return;
		}

		setCommentSubmitting(true);
		try {
			const data = await reviewCommentApi.createReviewComment(
				review.slug,
				finalContent,
				replyToId,
			);
			setComments((prev) =>
				[...prev, data].sort((left, right) =>
					left.created_at.localeCompare(right.created_at),
				),
			);
			setCommentDraft("");
			resetReplyState();
			showToast(t("评论发布成功"), "success");
		} catch (error) {
			console.error("Failed to submit review comment:", error);
			showToast(
				error instanceof Error ? error.message : t("发布评论失败"),
				"error",
			);
		} finally {
			setCommentSubmitting(false);
		}
	};

	const handleReplyTo = (comment: ReviewComment, rootId?: string) => {
		if (!session) {
			showToast(t("请先登录后再回复"), "info");
			return;
		}
		const origin =
			typeof window !== "undefined"
				? `${window.location.origin}${window.location.pathname}#comment-${comment.id}`
				: `#comment-${comment.id}`;
		setReplyToId(rootId || comment.id);
		setReplyToUser(comment.user_name);
		setReplyTargetId(comment.id);
		setReplyPrefix(`> ${t("回复")} @${comment.user_name}\n> [${t("原评论")}](${origin})\n`);
		setCommentDraft("");
		setTimeout(() => commentInputRef.current?.focus(), 0);
	};

	const handleStartEditComment = (comment: ReviewComment) => {
		const parsed = extractReplyPrefix(comment.content);
		setEditingCommentId(comment.id);
		setEditingCommentPrefix(parsed.prefix);
		setEditingCommentDraft(parsed.body);
	};

	const handleSaveEditComment = async () => {
		if (!editingCommentId || commentUpdatingIds.has(editingCommentId)) return;
		const nextContent = editingCommentPrefix
			? `${editingCommentPrefix}\n\n${editingCommentDraft}`.trim()
			: editingCommentDraft.trim();
		if (!nextContent) {
			showToast(t("评论内容不能为空"), "error");
			return;
		}
		setCommentUpdatingIds((prev) => new Set(prev).add(editingCommentId));
		try {
			const data = await reviewCommentApi.updateComment(editingCommentId, nextContent);
			setComments((prev) =>
				prev.map((item) => (item.id === data.id ? data : item)),
			);
			setEditingCommentId(null);
			setEditingCommentDraft("");
			setEditingCommentPrefix("");
			showToast(t("评论已更新"), "success");
		} catch (error) {
			console.error("Failed to update review comment:", error);
			showToast(
				error instanceof Error ? error.message : t("更新评论失败"),
				"error",
			);
		} finally {
			setCommentUpdatingIds((prev) => {
				const next = new Set(prev);
				next.delete(editingCommentId);
				return next;
			});
		}
	};

	const openDeleteCommentModal = (commentId: string) => {
		setPendingDeleteCommentId(commentId);
		setShowDeleteCommentModal(true);
	};

	const handleDeleteComment = async () => {
		if (!pendingDeleteCommentId || commentDeletingIds.has(pendingDeleteCommentId)) {
			return;
		}
		const targetId = pendingDeleteCommentId;
		setCommentDeletingIds((prev) => new Set(prev).add(targetId));
		try {
			await reviewCommentApi.deleteComment(targetId);
			setComments((prev) =>
				prev.filter(
					(item) => item.id !== targetId && item.reply_to_id !== targetId,
				),
			);
			showToast(t("评论已删除"), "success");
			setShowDeleteCommentModal(false);
			setPendingDeleteCommentId(null);
		} catch (error) {
			console.error("Failed to delete review comment:", error);
			showToast(
				error instanceof Error ? error.message : t("删除评论失败"),
				"error",
			);
		} finally {
			setCommentDeletingIds((prev) => {
				const next = new Set(prev);
				next.delete(targetId);
				return next;
			});
		}
	};

	const handleToggleCommentHidden = async (comment: ReviewComment) => {
		if (commentTogglingIds.has(comment.id)) return;
		setCommentTogglingIds((prev) => new Set(prev).add(comment.id));
		try {
			const data = await reviewCommentApi.toggleHidden(
				comment.id,
				!comment.is_hidden,
			);
			setComments((prev) =>
				prev.map((item) =>
					item.id === comment.id
						? { ...item, is_hidden: data.is_hidden, updated_at: data.updated_at }
						: item,
				),
			);
			showToast(
				data.is_hidden ? t("评论已隐藏") : t("评论已显示"),
				"success",
			);
		} catch (error) {
			console.error("Failed to toggle review comment visibility:", error);
			showToast(t("评论可见性更新失败"), "error");
		} finally {
			setCommentTogglingIds((prev) => {
				const next = new Set(prev);
				next.delete(comment.id);
				return next;
			});
		}
	};

	const renderCommentBody = (comment: ReviewComment) => {
		const meta = getReplyMeta(comment.content);
		const body = extractReplyPrefix(comment.content).body;
		return (
			<div>
				{meta && (
					<div className="mb-2 text-xs text-text-3">
						<span>
							{t("回复")} @{meta.user}
						</span>
						{meta.link && (
							<a
								href={meta.link}
								className="ml-2 text-text-3 underline transition hover:text-text-1"
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
					dangerouslySetInnerHTML={{ __html: renderSafeMarkdown(body) }}
				/>
			</div>
		);
	};

	return (
		<>
			<div
				className={`min-h-screen ${immersiveMode ? "bg-surface" : "bg-app"} flex flex-col`}
			>
			<SeoHead
				title={`${(isEditing ? title : review.title) || review.title} - ${siteName}`}
				description={seoDescription}
				canonicalUrl={canonicalUrl}
				imageUrl={seoImageUrl}
				type="article"
				siteName={siteName}
				publishedTime={
					(isEditing ? publishedAt : review.published_at) || review.created_at
				}
				modifiedTime={review.updated_at}
				structuredData={[breadcrumbStructuredData, reviewStructuredData]}
			/>
			<ReadingProgress />
			<AppHeader />

			{!isEditing ? (
				<section className={`bg-surface ${immersiveMode ? "" : "border-b border-border"}`}>
					<div className="mx-auto max-w-7xl px-4 py-5 sm:py-6">
						<nav aria-label="Breadcrumb" className="sr-only">
							<Link href="/" className="hover:text-primary hover:underline">
								{t("主页")}
							</Link>
							<span>/</span>
							<Link href="/reviews" className="hover:text-primary hover:underline">
								{t("回顾")}
							</Link>
							<span>/</span>
							<span>{review.title}</span>
						</nav>

						<div className="mb-3 flex justify-center">
							<div className="inline-flex max-w-full flex-wrap items-center justify-center gap-x-2 gap-y-1">
								<h1 className="text-center text-2xl font-bold text-text-1">
									{review.title}
								</h1>
								{showTitleViewStat || showTitleCommentStat ? (
									<div className="inline-flex items-center gap-1.5 text-xs font-semibold leading-none text-text-3 sm:text-sm">
										{showTitleViewStat ? (
											<span className="inline-flex items-center gap-0.5">
												<IconEye className="h-4 w-4 shrink-0" />
												<span>{review.view_count}</span>
											</span>
										) : null}
										{showTitleCommentStat ? (
											<span className="inline-flex items-center gap-0.5">
												<IconEdit className="h-4 w-4 shrink-0" />
												<span>{displayCommentCount}</span>
											</span>
										) : null}
									</div>
								) : null}
								{review.status === "draft" && isAdmin ? (
									<span className="inline-flex items-center rounded-sm bg-warning-soft px-2 py-0.5 text-xs text-warning-ink">
										{t("草稿")}
									</span>
								) : null}
							</div>
						</div>

						{immersiveMode ? (
							<div className="mx-auto mt-3 w-full max-w-4xl border-t border-border-strong" />
						) : (
							<>
								<div className="flex flex-wrap items-center justify-center gap-3 text-sm text-text-2">
									<div>
										<span className="font-medium text-text-2">{t("发表时间")}：</span>
										{formatDate(review.published_at || review.created_at, language)}
									</div>
									<div>
										<span className="font-medium text-text-2">{t("本期范围")}：</span>
										{formatReviewRange(review.window_start, review.window_end)}
									</div>
								</div>
								<ArticleMetaRow
									className="sr-only"
									publishedAt={review.published_at}
									createdAt={review.created_at}
									items={[
										<div key="template">{review.template?.name || t("回顾模板")}</div>,
									]}
								/>
							</>
						)}
					</div>
				</section>
			) : null}

			<div
				className={`mx-auto flex-1 w-full ${
					isEditing ? "max-w-none px-0" : "max-w-7xl px-4"
				} ${
					isEditing ? "py-0" : immersiveMode ? "py-6" : "py-6 sm:py-8"
				}`}
			>
				{isEditing && isAdmin ? (
					<section className="overflow-hidden bg-surface">
						<div className="border-b border-border px-5 py-3 sm:px-6">
							<div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
								<div>
									<h2 className="inline-flex items-center gap-2 text-lg font-semibold text-text-1">
										<IconEdit className="h-4 w-4" />
										<span>{t("编辑回顾")}</span>
									</h2>
								</div>
								<div className="flex flex-wrap items-center gap-2">
									<Button variant="secondary" onClick={closeEditMode} disabled={saving}>
										{t("取消")}
									</Button>
									<Button variant="primary" loading={saving} onClick={handleSave}>
										{t("保存")}
									</Button>
								</div>
							</div>
						</div>
						<div className="grid min-h-[calc(100vh-65px)] grid-cols-1 xl:grid-cols-2">
							<div className="min-h-0 border-b border-border xl:border-b-0 xl:border-r">
								<div className="space-y-4 px-5 py-4 sm:px-6">
									<FormField label={t("标题")}>
										<TextInput
											value={title}
											onChange={(event) => setTitle(event.target.value)}
										/>
									</FormField>
									<div className="grid grid-cols-1 gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
										<FormField label={t("发表时间")}>
											<TextInput
												type="date"
												value={publishedAt}
												onChange={(event) => setPublishedAt(event.target.value)}
											/>
										</FormField>
										<FormField
											label={
												<span className="inline-flex items-center gap-2">
													<span>{t("头图 URL")}</span>
													{!mediaStorageEnabled ? (
														<span className="text-xs font-normal text-text-3">
															{t("未开启本地存储，头图将保持外链")}
														</span>
													) : null}
												</span>
											}
										>
											<div className="flex gap-2">
												<TextInput
													value={topImage}
													onChange={(event) => setTopImage(event.target.value)}
													onPaste={handleTopImagePaste}
													placeholder={t("输入图片 URL")}
													className="flex-1"
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
									<div className="min-h-0">
										<div className="mb-2 flex items-center justify-between gap-2">
											<div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm text-text-2">
												<span>{t("内容（Markdown）")}</span>
												<span className="text-danger">*</span>
												<span className="text-xs font-normal text-text-3">
													{t("支持全部文章占位符 {{review_article_sections}} 和单篇文章占位符 {{article_slug}}。")}
												</span>
												{!mediaStorageEnabled ? (
													<span className="text-xs font-normal text-text-3">
														{t("未开启本地存储，外链将保持不变")}
													</span>
												) : null}
											</div>
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
										<TextArea
											ref={editContentRef}
											rows={26}
											value={markdownContent}
											onChange={(event) => setMarkdownContent(event.target.value)}
											onPaste={handleEditPaste}
											onScroll={() => {
												if (!editContentRef.current || !previewRef.current) return;
												syncScrollPosition(editContentRef.current, previewRef.current);
											}}
											className="min-h-[520px] resize-none font-mono"
											placeholder={t("在此输入 Markdown 内容...")}
										/>
									</div>
								</div>
							</div>
							<div
								ref={previewRef}
								onScroll={() => {
									if (!editContentRef.current || !previewRef.current) return;
									syncScrollPosition(previewRef.current, editContentRef.current);
								}}
								className="max-h-[calc(100vh-180px)] overflow-y-auto bg-muted/70"
							>
								<div className="min-h-full bg-surface">
									<div className="relative aspect-[21/9] w-full overflow-hidden border-b border-border bg-muted">
										<img
											src={editPreviewTopImageUrl || fallbackTopImageUrl || ""}
											alt={title || review.title}
											className="h-full w-full object-cover"
										/>
									</div>
									<article className="px-5 py-6 sm:px-6">
										<div
											className="article-prose prose prose-sm max-w-none break-words overflow-x-auto prose-img:rounded-lg prose-img:border prose-img:border-border prose-img:bg-surface prose-img:shadow-sm prose-img:max-w-full lg:prose-img:max-w-[420px]"
											dangerouslySetInnerHTML={{ __html: editPreviewHtml }}
										/>
									</article>
								</div>
							</div>
						</div>
					</section>
				) : (
					<div className="flex flex-col gap-6 lg:flex-row">
						<article
							className={`flex-1 min-w-0 w-full bg-surface ${
								immersiveMode
									? ""
									: "mx-auto max-w-4xl rounded-sm border border-border p-4 shadow-sm sm:p-6 lg:mx-0"
							}`}
						>
							{!immersiveMode ? (
								<div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
									<div className="flex flex-wrap items-center gap-2">
										<h2 className="inline-flex items-center gap-2 text-lg font-semibold text-text-1">
											<IconDoc className="h-4 w-4" />
											<span>{t("内容")}</span>
										</h2>
									</div>
									<div className="flex flex-wrap items-center gap-2">
										{isAdmin ? (
											<>
												<IconButton
													onClick={openEditMode}
													variant="ghost"
													size="md"
													title={t("编辑回顾")}
													className="rounded-sm"
												>
													<IconEdit className="h-4 w-4" />
												</IconButton>
												{review.status !== "published" ? (
													<IconButton
														onClick={handleOpenRegenerateModal}
														variant="ghost"
														size="md"
														title={t("重新生成回顾")}
														className="rounded-sm"
													>
														<IconRefresh className="h-4 w-4" />
													</IconButton>
												) : null}
												<IconButton
													onClick={handlePublishToggle}
													variant="ghost"
													size="md"
													title={
														review.status === "published"
															? t("返回草稿")
															: t("发布回顾")
													}
													loading={publishing}
													disabled={publishing}
													className="rounded-sm"
												>
													{review.status === "published" ? (
														<IconEyeOff className="h-4 w-4" />
													) : (
														<IconEye className="h-4 w-4" />
													)}
												</IconButton>
												<IconButton
													onClick={() => setShowDeleteIssueModal(true)}
													variant="danger"
													size="md"
													title={t("删除回顾")}
													className="rounded-sm"
												>
													<IconTrash className="h-4 w-4" />
												</IconButton>
											</>
										) : null}
										<button
											type="button"
											onClick={() => setImmersiveMode(true)}
											className="flex h-8 w-8 items-center justify-center rounded-sm text-text-2 transition hover:bg-muted hover:text-text-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35"
											title={t("进入沉浸模式")}
											aria-label={t("进入沉浸模式")}
										>
											<IconBook className="h-4 w-4" />
										</button>
									</div>
								</div>
							) : null}

							{currentTopImageUrl ? (
								<div className="mb-6 overflow-hidden rounded-sm border border-border bg-muted">
									<img
										src={currentTopImageUrl}
										alt={review.title}
										className="aspect-video w-full object-cover"
									/>
								</div>
							) : null}

							<div
								ref={contentRef}
								onClick={handleContentClick}
								className={`article-prose prose prose-sm max-w-none break-words overflow-x-auto prose-img:cursor-zoom-in prose-img:rounded-lg prose-img:border prose-img:border-border prose-img:bg-surface prose-img:shadow-sm ${
									immersiveMode
										? "immersive-content"
										: "prose-img:max-w-full lg:prose-img:max-w-[420px]"
								}`}
								dangerouslySetInnerHTML={{ __html: html }}
							/>

							{!immersiveMode && review.status === "published" ? (
								<div className="mt-6 flex flex-col gap-3 text-sm sm:flex-row sm:items-center sm:justify-between">
									<button
										type="button"
										onClick={() =>
											review.prev_review &&
											router.push(`/reviews/${review.prev_review.slug}`)
										}
										disabled={!review.prev_review}
										className={`rounded-lg px-3 py-2 text-left transition ${
											review.prev_review
												? "bg-muted text-text-2 hover:bg-surface hover:text-text-1"
												: "cursor-not-allowed bg-muted text-text-3"
										}`}
										title={review.prev_review?.title || t("无上一篇")}
									>
										<span className="block">← {t("上一篇")}</span>
										{review.prev_review ? (
											<span className="block text-xs text-text-3">
												{(review.prev_review?.title || "").length > 24
													? `${(review.prev_review?.title || "").slice(0, 24)}...`
													: review.prev_review?.title || ""}
											</span>
										) : null}
									</button>
									<button
										type="button"
										onClick={() =>
											review.next_review &&
											router.push(`/reviews/${review.next_review.slug}`)
										}
										disabled={!review.next_review}
										className={`rounded-lg px-3 py-2 text-right transition ${
											review.next_review
												? "bg-muted text-text-2 hover:bg-surface hover:text-text-1"
												: "cursor-not-allowed bg-muted text-text-3"
										}`}
										title={review.next_review?.title || t("无下一篇")}
									>
										<span className="block">{t("下一篇")} →</span>
										{review.next_review ? (
											<span className="block text-xs text-text-3">
												{(review.next_review?.title || "").length > 24
													? `${(review.next_review?.title || "").slice(0, 24)}...`
													: review.next_review?.title || ""}
											</span>
										) : null}
									</button>
								</div>
							) : null}

							{!immersiveMode &&
							review.status === "published" &&
							commentsEnabled ? (
								<section className="mt-10">
									<div className="rounded-sm border border-border bg-surface p-5">
										<div className="mb-4 flex items-center justify-between">
											<div className="flex items-center gap-2">
												<h3 className="text-base font-semibold text-text-1">{t("评论")}</h3>
												<span className="text-xs text-text-3">({displayCommentCount})</span>
											</div>
											{session ? (
												<div className="flex items-center gap-2 text-xs text-text-3">
													<span>{session?.user?.name || t("访客")}</span>
													<div className="relative" ref={userMenuRef}>
														{session?.user?.image ? (
															<button
																type="button"
																onClick={() => setShowUserMenu((prev) => !prev)}
																className="focus:outline-none"
															>
																<img
																	src={session.user.image || ""}
																	alt={session.user.name || t("访客")}
																	className="h-6 w-6 rounded-full object-cover"
																	width={24}
																	height={24}
																	loading="lazy"
																	decoding="async"
																/>
															</button>
														) : null}
														{showUserMenu ? (
															<div className="absolute right-0 mt-2 min-w-[120px] rounded-sm border border-border bg-surface text-xs text-text-2 shadow-sm z-10">
																<button
																	type="button"
																	onClick={() => {
																		signOut();
																		setShowUserMenu(false);
																	}}
																	className="w-full px-3 py-2 text-left transition hover:bg-muted hover:text-text-1"
																>
																	{t("退出登录")}
																</button>
															</div>
														) : null}
													</div>
												</div>
											) : (
												<div className="flex items-center gap-2">
													{commentProviders.github ? (
														<button
															type="button"
															onClick={() => signIn("github")}
															className="rounded-full border border-border px-3 py-1 text-xs text-text-2 transition hover:bg-muted hover:text-text-1"
														>
															{t("GitHub 登录")}
														</button>
													) : null}
													{commentProviders.google ? (
														<button
															type="button"
															onClick={() => signIn("google")}
															className="rounded-full border border-border px-3 py-1 text-xs text-text-2 transition hover:bg-muted hover:text-text-1"
														>
															{t("Google 登录")}
														</button>
													) : null}
													{!commentProviders.github && !commentProviders.google ? (
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
															onClick={resetReplyState}
															disabled={commentSubmitting}
															className="text-text-3 transition hover:text-text-1 disabled:cursor-not-allowed disabled:opacity-50"
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
										) : null}

										{commentsLoading ? (
											<div className="inline-flex items-center gap-2 text-sm text-text-3" aria-live="polite">
												<IconRefresh className="h-3.5 w-3.5 animate-spin" />
												<span>{t("评论加载中...")}</span>
											</div>
										) : sortedTopComments.length === 0 ? (
											<div className="text-sm text-text-3">{t("暂无评论")}</div>
										) : (
											<div className="space-y-4">
												{pagedTopComments.map((comment) => {
													const isOwner = session?.user?.id === comment.user_id;
													const isEditing = editingCommentId === comment.id;
													const replies = repliesByParent[comment.id] || [];
													const isExpanded = expandedReplies[comment.id] ?? false;
													const isUpdatingComment = commentUpdatingIds.has(comment.id);
													const isDeletingComment = commentDeletingIds.has(comment.id);
													const isTogglingComment = commentTogglingIds.has(comment.id);
													const replyToggleLabel = `${isExpanded ? t("收起回复") : t("查看回复")} (${replies.length})`;

													return (
														<div
															key={comment.id}
															id={`comment-${comment.id}`}
															className="rounded-lg border border-border bg-surface p-4 scroll-mt-24"
														>
															<div className="mb-2 flex items-start justify-between gap-2">
																<div className="flex items-center gap-2">
																	{comment.user_avatar ? (
																		<img
																			src={comment.user_avatar}
																			alt={comment.user_name}
																			className="h-6 w-6 rounded-full object-cover"
																			width={24}
																			height={24}
																			loading="lazy"
																			decoding="async"
																		/>
																	) : null}
																	<div className="text-sm text-text-1">{comment.user_name}</div>
																	<a
																		href={`#comment-${comment.id}`}
																		className="text-xs text-text-3 transition hover:text-text-1"
																	>
																		{formatDateTime(comment.created_at, language)}
																	</a>
																	{comment.is_hidden ? (
																		<span className="rounded-sm bg-warning-soft px-2 py-0.5 text-[11px] text-warning-ink">
																			{t("已隐藏")}
																		</span>
																	) : null}
																</div>
																<div className="flex items-center gap-1.5">
																	<button
																		type="button"
																		onClick={() => handleReplyTo(comment)}
																		className="text-xs text-text-3 transition hover:text-text-1"
																	>
																		{t("回复")}
																	</button>
																	{isOwner ? (
																		<button
																			type="button"
																			onClick={() => handleStartEditComment(comment)}
																			className="text-xs text-text-3 transition hover:text-text-1"
																		>
																			{t("编辑")}
																		</button>
																	) : null}
																	{isAdmin ? (
																		<button
																			type="button"
																			onClick={() => handleToggleCommentHidden(comment)}
																			disabled={isTogglingComment}
																			className="text-xs text-text-3 transition hover:text-text-1 disabled:cursor-not-allowed disabled:opacity-50"
																		>
																			{comment.is_hidden ? t("显示") : t("隐藏")}
																		</button>
																	) : null}
																	{isOwner || isAdmin ? (
																		<button
																			type="button"
																			onClick={() => openDeleteCommentModal(comment.id)}
																			disabled={isDeletingComment}
																			className="text-xs text-text-3 transition hover:text-danger-ink disabled:cursor-not-allowed disabled:opacity-50"
																		>
																			{t("删除")}
																		</button>
																	) : null}
																</div>
															</div>
															{isEditing ? (
																<div>
																	<TextArea
																		value={editingCommentDraft}
																		onChange={(event) => setEditingCommentDraft(event.target.value)}
																		rows={4}
																		className="rounded-lg"
																		disabled={isUpdatingComment}
																	/>
																	<div className="mt-2 flex justify-end gap-2">
																		<Button
																			type="button"
																			variant="secondary"
																			size="sm"
																			onClick={() => {
																				setEditingCommentId(null);
																				setEditingCommentDraft("");
																				setEditingCommentPrefix("");
																			}}
																			disabled={isUpdatingComment}
																		>
																			{t("取消")}
																		</Button>
																		<Button
																			type="button"
																			variant="primary"
																			size="sm"
																			onClick={handleSaveEditComment}
																			loading={isUpdatingComment}
																			disabled={isUpdatingComment}
																		>
																			{t("保存")}
																		</Button>
																	</div>
																</div>
															) : (
																renderCommentBody(comment)
															)}
															{replies.length > 0 ? (
																<div className="mt-4 border-t border-border pt-3">
																	<button
																		type="button"
																		onClick={() =>
																			setExpandedReplies((prev) => ({
																				...prev,
																				[comment.id]: !isExpanded,
																			}))
																		}
																		className="inline-flex items-center gap-1 text-xs text-text-3 transition hover:text-text-1"
																	>
																		{isExpanded ? (
																			<IconChevronUp className="h-3.5 w-3.5" />
																		) : (
																			<IconChevronDown className="h-3.5 w-3.5" />
																		)}
																		<span>{replyToggleLabel}</span>
																	</button>
																	{isExpanded ? (
																		<div className="mt-3 space-y-3">
																			{replies.map((reply) => {
																				const isReplyOwner = session?.user?.id === reply.user_id;
																				const isReplyEditing = editingCommentId === reply.id;
																				const isUpdatingReply = commentUpdatingIds.has(reply.id);
																				const isDeletingReply = commentDeletingIds.has(reply.id);
																				const isTogglingReply = commentTogglingIds.has(reply.id);

																				return (
																					<div
																						key={reply.id}
																						id={`comment-${reply.id}`}
																						className="rounded-lg border border-border bg-muted/40 p-3"
																					>
																						<div className="mb-2 flex items-start justify-between gap-2">
																							<div className="flex items-center gap-2">
																								{reply.user_avatar ? (
																									<img
																										src={reply.user_avatar}
																										alt={reply.user_name}
																										className="h-5 w-5 rounded-full object-cover"
																										width={20}
																										height={20}
																										loading="lazy"
																										decoding="async"
																									/>
																								) : null}
																								<div className="text-sm text-text-1">{reply.user_name}</div>
																								<a
																									href={`#comment-${reply.id}`}
																									className="text-xs text-text-3 transition hover:text-text-1"
																								>
																									{formatDateTime(reply.created_at, language)}
																								</a>
																								{reply.is_hidden ? (
																									<span className="rounded-sm bg-warning-soft px-2 py-0.5 text-[11px] text-warning-ink">
																										{t("已隐藏")}
																									</span>
																								) : null}
																							</div>
																							<div className="flex items-center gap-1.5">
																								<button
																									type="button"
																									onClick={() => handleReplyTo(reply, comment.id)}
																									className="text-xs text-text-3 transition hover:text-text-1"
																								>
																									{t("回复")}
																								</button>
																								{isReplyOwner ? (
																									<button
																										type="button"
																										onClick={() => handleStartEditComment(reply)}
																										className="text-xs text-text-3 transition hover:text-text-1"
																									>
																										{t("编辑")}
																									</button>
																								) : null}
																								{isAdmin ? (
																									<button
																										type="button"
																										onClick={() => handleToggleCommentHidden(reply)}
																										disabled={isTogglingReply}
																										className="text-xs text-text-3 transition hover:text-text-1 disabled:cursor-not-allowed disabled:opacity-50"
																									>
																										{reply.is_hidden ? t("显示") : t("隐藏")}
																									</button>
																								) : null}
																								{isReplyOwner || isAdmin ? (
																									<button
																										type="button"
																										onClick={() => openDeleteCommentModal(reply.id)}
																										disabled={isDeletingReply}
																										className="text-xs text-text-3 transition hover:text-danger-ink disabled:cursor-not-allowed disabled:opacity-50"
																									>
																										{t("删除")}
																									</button>
																								) : null}
																							</div>
																						</div>
																						{isReplyEditing ? (
																							<div>
																								<TextArea
																									value={editingCommentDraft}
																									onChange={(event) => setEditingCommentDraft(event.target.value)}
																									rows={3}
																									className="rounded-lg"
																									disabled={isUpdatingReply}
																								/>
																								<div className="mt-2 flex justify-end gap-2">
																									<Button
																										type="button"
																										variant="secondary"
																										size="sm"
																										onClick={() => {
																											setEditingCommentId(null);
																											setEditingCommentDraft("");
																											setEditingCommentPrefix("");
																										}}
																										disabled={isUpdatingReply}
																									>
																										{t("取消")}
																									</Button>
																									<Button
																										type="button"
																										variant="primary"
																										size="sm"
																										onClick={handleSaveEditComment}
																										loading={isUpdatingReply}
																										disabled={isUpdatingReply}
																									>
																										{t("保存")}
																									</Button>
																								</div>
																							</div>
																						) : (
																							renderCommentBody(reply)
																						)}
																					</div>
																				);
																			})}
																		</div>
																	) : null}
																</div>
															) : null}
														</div>
													);
												})}
												{totalCommentPages > 1 ? (
													<div className="flex items-center justify-end gap-2 pt-2 text-xs text-text-3">
														<button
															type="button"
															onClick={() => setCommentPage((prev) => Math.max(1, prev - 1))}
															disabled={commentPage <= 1}
															className="rounded-sm border border-border px-2 py-1 transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
														>
															{t("上一页")}
														</button>
														<span>
															{commentPage} / {totalCommentPages}
														</span>
														<button
															type="button"
															onClick={() =>
																setCommentPage((prev) =>
																	Math.min(totalCommentPages, prev + 1),
																)
															}
															disabled={commentPage >= totalCommentPages}
															className="rounded-sm border border-border px-2 py-1 transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
														>
															{t("下一页")}
														</button>
													</div>
												) : null}
											</div>
										)}
									</div>
								</section>
							) : null}
						</article>

						{!immersiveMode ? (
							<aside className="flex-shrink-0 w-full lg:w-[420px]">
								<div className="max-h-none overflow-visible lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto">
									<section className="rounded-sm border border-border bg-surface p-4 shadow-sm">
										<div className="flex items-center gap-2">
											<IconTag className="h-4 w-4 text-text-2" />
											<h3 className="text-lg font-semibold text-text-1">{t("模版信息")}</h3>
										</div>
										<div className="mt-4 space-y-2 text-sm leading-6 text-text-2">
											<div>
												<span className="font-medium text-text-1">{t("名称")}：</span>
												{review.template?.id ? (
													<Link
														href={`/reviews?template_id=${review.template.id}`}
														className="break-words text-primary hover:underline"
													>
														{review.template?.name || t("未命名模板")}
													</Link>
												) : (
													<span className="break-words">
														{review.template?.name || t("未命名模板")}
													</span>
												)}
											</div>
											<div>
												<span className="font-medium text-text-1">{t("分类")}：</span>
												<span>{templateCategoryText}</span>
											</div>
											<div>
												<span className="font-medium text-text-1">{t("描述")}：</span>
												<span className="whitespace-normal break-words text-text-2">
													{templateDescriptionText || t("暂无描述")}
												</span>
											</div>
										</div>

										{tocItems.length > 0 ? (
											<div className="mt-5">
												<div className="mb-3 flex items-center justify-between">
													<div className="inline-flex items-center gap-2">
														<IconList className="h-4 w-4 text-text-2" />
														<h3 className="text-lg font-semibold text-text-1">{t("目录")}</h3>
													</div>
													<button
														type="button"
														onClick={() => setTocCollapsed((prev) => !prev)}
														className="text-text-3 transition hover:text-primary"
														title={tocCollapsed ? t("展开目录") : t("收起目录")}
														aria-label={tocCollapsed ? t("展开目录") : t("收起目录")}
													>
														<IconChevronDown
															className={`h-4 w-4 transition-transform duration-200 ${
																tocCollapsed ? "" : "rotate-180"
															}`}
														/>
													</button>
												</div>
												{!tocCollapsed ? (
													<TableOfContents
														items={tocItems}
														activeId={activeTocId}
														onSelect={handleTocSelect}
													/>
												) : null}
											</div>
										) : null}

										<div className="mt-5">
											<div className="mb-3 flex items-center gap-2">
												<IconClock className="h-4 w-4 text-text-2" />
												<h3 className="text-lg font-semibold text-text-1">{t("相关内容")}</h3>
											</div>
											{recentReviews.length === 0 ? (
												<div className="text-sm text-text-3">{t("暂无相关内容")}</div>
											) : (
												<div className="space-y-2 text-sm text-text-2">
													{recentReviews.map((item) => (
														<div key={item.id} className="flex items-start gap-2">
															<span className="text-text-3">·</span>
															<div className="min-w-0">
																<Link
																	href={`/reviews/${item.slug}`}
																	className="line-clamp-2 text-sm font-medium leading-6 text-text-2 transition hover:text-text-1"
																	target="_blank"
																	rel="noreferrer"
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
									</section>
								</div>
							</aside>
						) : null}
					</div>
				)}
				{immersiveMode && !isMobile ? (
					<button
						type="button"
						onClick={() => setImmersiveMode(false)}
						className="fixed right-6 top-1/2 z-50 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-surface text-text-2 shadow-lg transition hover:bg-muted hover:text-text-1"
						title={`${t("退出沉浸模式")} (Esc)`}
						aria-label={`${t("退出沉浸模式")} (Esc)`}
					>
						<IconBook className="h-5 w-5" />
					</button>
				) : null}
				<BackToTop />
			</div>
		</div>
			<ConfirmModal
				isOpen={showDeleteCommentModal}
				title={t("删除评论")}
				message={t("删除后无法恢复确认继续吗")}
				confirmText={t("删除")}
				cancelText={t("取消")}
				onConfirm={handleDeleteComment}
				onCancel={() => {
					setShowDeleteCommentModal(false);
					setPendingDeleteCommentId(null);
				}}
			/>
			<ConfirmModal
				isOpen={showDeleteIssueModal}
				title={t("删除回顾")}
				message={t("确定要删除这篇回顾吗？此操作不可撤销。")}
				confirmText={t("删除")}
				cancelText={t("取消")}
				onConfirm={handleDeleteIssue}
				onCancel={() => setShowDeleteIssueModal(false)}
			/>
			<ReviewManualGenerateModal
				isOpen={showRegenerateModal}
				onClose={() => setShowRegenerateModal(false)}
				initialTemplateId={review.template?.id || undefined}
				initialDateStart={toDateInputValue(review.window_start)}
				initialDateEnd={(() => {
					const value = toDateInputValue(review.window_end);
					if (!value) return "";
					const date = new Date(`${value}T00:00:00`);
					if (Number.isNaN(date.getTime())) return "";
					date.setDate(date.getDate() - 1);
					return date.toISOString().slice(0, 10);
				})()}
				initialSelectedArticleIds={review.selected_article_ids || []}
				lockTemplateSelection
				title={t("重新生成回顾")}
			/>

			{lightboxImage && (
				<div
					className="fixed inset-0 z-[70] bg-black/75 backdrop-blur-[1px]"
					onClick={closeLightbox}
					role="dialog"
					aria-modal="true"
					aria-label={t("预览")}
				>
					<div
						className="relative flex h-full w-full items-center justify-center p-4 sm:p-6"
						onClick={(event) => event.stopPropagation()}
					>
						<button
							type="button"
							onClick={closeLightbox}
							className="absolute right-4 top-4 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-black/35 text-white transition hover:bg-black/55"
							aria-label={t("关闭")}
						>
							×
						</button>
						<div className="absolute left-4 top-4 z-10 rounded-full bg-black/35 px-3 py-1 text-xs text-white">
							{lightboxIndex + 1} / {lightboxImages.length}
						</div>
						{hasLightboxMultiple && (
							<button
								type="button"
								onClick={() => shiftLightbox(-1)}
								className="absolute left-3 sm:left-4 top-1/2 z-10 -translate-y-1/2 flex h-11 w-11 items-center justify-center rounded-full bg-black/35 text-white transition hover:bg-black/55"
								aria-label={t("上一篇")}
							>
								<IconChevronRight className="h-6 w-6 rotate-180" />
							</button>
						)}
						<img
							src={lightboxImage}
							alt={t("预览")}
							className="max-h-[92vh] w-auto max-w-[96vw] object-contain"
							decoding="async"
						/>
						{hasLightboxMultiple && (
							<button
								type="button"
								onClick={() => shiftLightbox(1)}
								className="absolute right-3 sm:right-4 top-1/2 z-10 -translate-y-1/2 flex h-11 w-11 items-center justify-center rounded-full bg-black/35 text-white transition hover:bg-black/55"
								aria-label={t("下一篇")}
							>
								<IconChevronRight className="h-6 w-6" />
							</button>
						)}
					</div>
				</div>
			)}

			<AppFooter />
		</>
	);
}
