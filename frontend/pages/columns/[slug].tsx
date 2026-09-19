import type { GetServerSideProps } from "next";
import Link from "next/link";
import { useRouter } from "next/router";
import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	type ChangeEvent,
	type ClipboardEvent,
} from "react";

import { useSession } from "next-auth/react";

import AppFooter from "@/components/AppFooter";
import AppHeader from "@/components/AppHeader";
import ConfirmModal from "@/components/ConfirmModal";
import ColumnEditPanel from "@/components/columns/ColumnEditPanel";
import ColumnDetailArticle from "@/components/columns/ColumnDetailArticle";
import ColumnSidebar from "@/components/columns/ColumnSidebar";
import ReviewReferenceInsertPanel from "@/components/ReviewReferenceInsertPanel";
import TopicInsertPanel from "@/components/TopicInsertPanel";
import SeoHead from "@/components/SeoHead";
import { BackToTop } from "@/components/BackToTop";
import ArticleLightbox from "@/components/article/ArticleLightbox";
import ArticleMetaRow from "@/components/article/ArticleMetaRow";
import { ReadingProgress } from "@/components/article/ReadingProgress";
import type { TocItem } from "@/components/article/TableOfContents";
import { collectCommentDescendantIds } from "@/components/comment/CommentSection";
import { useToast } from "@/components/Toast";
import {
	IconBook,
	IconEdit,
	IconEye,
} from "@/components/icons";
import { useAuth } from "@/contexts/AuthContext";
import {
	buildColumnEditorDraftKey,
	clearEditorDraft,
	isColumnEditorDraftDirty,
	isEditorDraftFresh,
	readEditorDraft,
	writeEditorDraft,
	type ColumnEditorDraftPayload,
} from "@/lib/editorDraft";
import { useBasicSettings } from "@/contexts/BasicSettingsContext";
import { useReading } from "@/contexts/ReadingContext";
import {
	commentAdminApi,
	commentSettingsApi,
	mediaApi,
	normalizeMediaHtml,
	resolveMediaUrl,
	reviewApi,
	reviewCommentApi,
	storageSettingsApi,
	type BasicSettings,
	type ReviewComment,
	type ReviewIssue,
} from "@/lib/api";
import {
	buildMarkdownFromMediaLink,
	extractMarkdownImageUrls,
	extractMediaLinkFromHtml,
	extractMediaLinkFromText,
	insertTextAtCursor,
	replaceMarkdownImageUrl,
} from "@/lib/articleMedia";
import { toDateInputValue } from "@/lib/aiTaskStatus";
import { useI18n } from "@/lib/i18n";
import {
	buildCanonicalUrl,
	buildMetaDescription,
	resolveSeoAssetUrl,
} from "@/lib/seo";
import {
	detectReviewReferenceCommand,
	type ReviewReferenceCommandMatch,
} from "@/lib/reviewReference";
import {
	formatDate,
	getReviewViewStorageKey,
	isLikelyInternalMediaUrl,
	materializeReviewArticlePlaceholders,
	replaceTextRange,
	runWithConcurrency,
	VIEW_COUNT_DEDUPE_WINDOW_MS,
	type EditorSelectionRange,
} from "@/lib/reviewDetail";
import { materializeTopicPlaceholders } from "@/lib/topicPlaceholders";
import {
	fetchServerBasicSettings,
	fetchServerReview,
	resolveRequestOrigin,
} from "@/lib/serverApi";
import {
	downloadMarkdownFile,
	resolveDetailExportFilename,
	resolveReviewDetailExportMarkdown,
} from "@/lib/detailMarkdownExport";
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
	const [columnDraftHint, setColumnDraftHint] = useState<{
		updatedAt: number;
		payload: ColumnEditorDraftPayload;
	} | null>(null);
	const [columnDraftSavedAt, setColumnDraftSavedAt] = useState<number | null>(
		null,
	);
	const columnDraftHydratedRef = useRef(false);
	const [saving, setSaving] = useState(false);
	const [publishing, setPublishing] = useState(false);
	const [immersiveMode, setImmersiveMode] = useState(false);
	const [isMobile, setIsMobile] = useState(false);
	const [mediaStorageEnabled, setMediaStorageEnabled] = useState(false);
	const [mediaStorageLoading, setMediaStorageLoading] = useState(false);
	const [mediaUploading, setMediaUploading] = useState(false);
	const [showReferenceInsertPanel, setShowReferenceInsertPanel] = useState(false);
	const [showTopicInsertPanel, setShowTopicInsertPanel] = useState(false);
	const [referenceCommandRange, setReferenceCommandRange] =
		useState<ReviewReferenceCommandMatch | null>(null);

	const [comments, setComments] = useState<ReviewComment[]>([]);
	const [commentsLoading, setCommentsLoading] = useState(false);
	const [commentsEnabled, setCommentsEnabled] = useState(true);
	const [commentSettingsLoaded, setCommentSettingsLoaded] = useState(false);
	const [commentProviders, setCommentProviders] = useState<CommentProviders>({
		github: false,
		google: false,
	});
	const [showDeleteIssueModal, setShowDeleteIssueModal] = useState(false);
	const [tocItems, setTocItems] = useState<TocItem[]>([]);
	const [activeTocId, setActiveTocId] = useState("");
	const [tocCollapsed, setTocCollapsed] = useState(false);
	const [lightboxImages, setLightboxImages] = useState<string[]>([]);
	const [lightboxIndex, setLightboxIndex] = useState(0);

	const contentRef = useRef<HTMLDivElement | null>(null);
	const editContentRef = useRef<HTMLTextAreaElement | null>(null);
	const previewRef = useRef<HTMLDivElement | null>(null);
	const activeHeadingMapRef = useRef<Map<string, number>>(new Map());
	const referenceSelectionRef = useRef<EditorSelectionRange>({ start: 0, end: 0 });

	const lightboxImage = lightboxImages[lightboxIndex] || null;

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
				const index = Math.max(0, images.indexOf(clickedSrc));
				setLightboxImages(images);
				setLightboxIndex(index);
			}
		}
	}, []);

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

	// biome-ignore lint/correctness/useExhaustiveDependencies: 仅在 edit 参数出现时进入编辑态一次，补齐 initialReview/router 全量依赖会重复进入并反复改写 URL
	useEffect(() => {
		if (!isAdmin || !router.isReady) return;
		const editQuery = router.query.edit;
		const shouldEdit =
			editQuery === "1" ||
			editQuery === "true" ||
			(Array.isArray(editQuery) && (editQuery[0] === "1" || editQuery[0] === "true"));
		if (!shouldEdit) return;
		setTitle(initialReview.title);
		setPublishedAt(toDateInputValue(initialReview.published_at || initialReview.created_at));
		setTopImage(initialReview.top_image || "");
		setMarkdownContent(initialReview.markdown_content || "");
		setIsEditing(true);
		const nextQuery = { ...router.query };
		delete nextQuery.edit;
		void router.replace(
			{ pathname: router.pathname, query: nextQuery },
			undefined,
			{ shallow: true },
		);
	// eslint-disable-next-line react-hooks/exhaustive-deps -- enter edit mode once when edit query is present
	}, [initialReview.id, isAdmin, router.isReady, router.query.edit]);

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

	// biome-ignore lint/correctness/useExhaustiveDependencies: review.id/内容字段是刻意信号，正文渲染后从 DOM 重建目录
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
	const html = useMemo(() => {
		const materialized = materializeTopicPlaceholders(
			materializeReviewArticlePlaceholders(
				review.rendered_markdown || review.markdown_content || "",
				review.article_sections_markdown,
				review.article_placeholder_blocks,
			),
		);
		return renderSafeMarkdown(materialized, {
			enableMediaEmbed: true,
		});
	}, [
		review.article_placeholder_blocks,
		review.article_sections_markdown,
		review.markdown_content,
		review.rendered_markdown,
	]);
	const editPreviewMarkdown = useMemo(() => {
		return materializeTopicPlaceholders(
			materializeReviewArticlePlaceholders(
				markdownContent || "",
				review.article_sections_markdown,
				review.article_placeholder_blocks,
			),
		);
	}, [
		markdownContent,
		review.article_placeholder_blocks,
		review.article_sections_markdown,
	]);
	const editPreviewHtml = useMemo(
		() =>
			normalizeMediaHtml(renderSafeMarkdown(editPreviewMarkdown, {
				enableMediaEmbed: true,
			})),
		[editPreviewMarkdown],
	);

	const canonicalUrl = buildCanonicalUrl(siteOrigin, `/columns/${review.slug}`);
	const seoDescription = buildMetaDescription(review.summary || t("专栏"));
	const seoImageUrl = resolveSeoAssetUrl(
		siteOrigin,
		review.top_image || siteSettings.site_logo_url || "/logo.png",
	);
	const publisherLogoUrl = resolveSeoAssetUrl(
		siteOrigin,
		siteSettings.site_logo_url || "/logo.png",
	);
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
				name: t("专栏"),
				item: buildCanonicalUrl(siteOrigin, "/columns"),
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

	const displayCommentCount =
		commentSettingsLoaded && commentsEnabled && review.status === "published"
			? comments.length
			: (review.comment_count ?? 0);
	const showTitleViewStat = (review.view_count ?? 0) > 0;
	const showTitleCommentStat = displayCommentCount > 0;

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


	const buildColumnEditorBaseline = useCallback(
		(source: ReviewIssue = review): ColumnEditorDraftPayload => ({
			title: source.title || "",
			publishedAt: toDateInputValue(source.published_at || source.created_at),
			topImage: source.top_image || "",
			markdownContent: source.markdown_content || "",
		}),
		[review],
	);

	const applyColumnEditorDraft = useCallback((draft: ColumnEditorDraftPayload) => {
		setTitle(draft.title);
		setPublishedAt(draft.publishedAt);
		setTopImage(draft.topImage);
		setMarkdownContent(draft.markdownContent);
	}, []);

	const clearColumnEditorDraftState = useCallback(() => {
		clearEditorDraft(buildColumnEditorDraftKey(review.id));
		setColumnDraftHint(null);
		setColumnDraftSavedAt(null);
	}, [review.id]);

	const openEditMode = () => {
		const baseline = buildColumnEditorBaseline(review);
		columnDraftHydratedRef.current = false;
		setColumnDraftHint(null);
		setColumnDraftSavedAt(null);
		applyColumnEditorDraft(baseline);

		const draftKey = buildColumnEditorDraftKey(review.id);
		const stored = readEditorDraft<ColumnEditorDraftPayload>(draftKey);
		if (
			stored &&
			isEditorDraftFresh(stored, { sourceUpdatedAt: review.updated_at }) &&
			isColumnEditorDraftDirty(stored.payload, baseline)
		) {
			setColumnDraftHint({
				updatedAt: stored.updatedAt,
				payload: stored.payload,
			});
		} else if (stored && !isColumnEditorDraftDirty(stored.payload, baseline)) {
			clearEditorDraft(draftKey);
		}

		setIsEditing(true);
		requestAnimationFrame(() => {
			columnDraftHydratedRef.current = true;
		});
	};

	const closeEditMode = () => {
		// Keep local draft for recovery; only reset the in-memory form.
		resetEditDraft(review);
		setShowReferenceInsertPanel(false);
		setReferenceCommandRange(null);
		setColumnDraftHint(null);
		setIsEditing(false);
	};

	const rememberEditorSelection = (target: HTMLTextAreaElement) => {
		referenceSelectionRef.current = {
			start: target.selectionStart ?? target.value.length,
			end: target.selectionEnd ?? target.value.length,
		};
	};

	const restoreEditorSelection = (range?: EditorSelectionRange) => {
		const target = editContentRef.current;
		if (!target) return;
		const nextRange = range || referenceSelectionRef.current;
		requestAnimationFrame(() => {
			target.focus();
			target.setSelectionRange(nextRange.start, nextRange.end);
		});
	};

	const handleCloseReferenceInsertPanel = () => {
		setShowReferenceInsertPanel(false);
		const fallbackRange = referenceCommandRange
			? {
					start: referenceCommandRange.end,
					end: referenceCommandRange.end,
				}
			: referenceSelectionRef.current;
		setReferenceCommandRange(null);
		restoreEditorSelection(fallbackRange);
	};

	const handleInsertReference = (insertedMarkdown: string) => {
		const target = editContentRef.current;
		if (!target) return;
		const range = referenceCommandRange
			? {
					start: referenceCommandRange.lineStart,
					end: referenceCommandRange.lineEnd,
				}
			: referenceSelectionRef.current;
		setShowReferenceInsertPanel(false);
		setReferenceCommandRange(null);
		replaceTextRange(target, range, insertedMarkdown, setMarkdownContent);
	};

	const handleMarkdownContentChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
		const nextValue = event.target.value;
		setMarkdownContent(nextValue);
		rememberEditorSelection(event.target);
		if (showReferenceInsertPanel) return;
		const match = detectReviewReferenceCommand(
			nextValue,
			event.target.selectionStart ?? nextValue.length,
		);
		if (!match) return;
		setReferenceCommandRange(match);
		setShowReferenceInsertPanel(true);
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


	useEffect(() => {
		if (!isEditing || !columnDraftHydratedRef.current) return;
		const baseline = buildColumnEditorBaseline(review);
		const draft: ColumnEditorDraftPayload = {
			title,
			publishedAt,
			topImage,
			markdownContent,
		};
		const draftKey = buildColumnEditorDraftKey(review.id);
		if (!isColumnEditorDraftDirty(draft, baseline)) {
			clearEditorDraft(draftKey);
			setColumnDraftSavedAt(null);
			return;
		}
		const timer = window.setTimeout(() => {
			const written = writeEditorDraft(draftKey, draft, {
				sourceUpdatedAt: review.updated_at,
			});
			if (written) {
				setColumnDraftSavedAt(written.updatedAt);
			}
		}, 500);
		return () => window.clearTimeout(timer);
	}, [
		buildColumnEditorBaseline,
		isEditing,
		markdownContent,
		publishedAt,
		review,
		title,
		topImage,
	]);

	useEffect(() => {
		if (!isEditing) return;
		const baseline = buildColumnEditorBaseline(review);
		const draft: ColumnEditorDraftPayload = {
			title,
			publishedAt,
			topImage,
			markdownContent,
		};
		const dirty = isColumnEditorDraftDirty(draft, baseline);
		const handleBeforeUnload = (event: BeforeUnloadEvent) => {
			if (!dirty) return;
			event.preventDefault();
			event.returnValue = "";
		};
		window.addEventListener("beforeunload", handleBeforeUnload);
		return () => window.removeEventListener("beforeunload", handleBeforeUnload);
	}, [
		buildColumnEditorBaseline,
		isEditing,
		markdownContent,
		publishedAt,
		review,
		title,
		topImage,
	]);

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
			clearColumnEditorDraftState();
			resetEditDraft(next);
			setIsEditing(false);
			showToast(t("专栏文章已保存"), "success");
		} catch (error) {
			console.error("Failed to save review issue:", error);
			showToast(t("专栏文章保存失败"), "error");
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
				showToast(t("专栏文章已撤回"), "success");
			} else {
				await reviewApi.publishIssue(review.id);
				showToast(t("专栏文章已发布"), "success");
			}
			const previousSlug = review.slug;
			const next = await refreshAdminReview(review.id);
			if (next.slug && next.slug !== previousSlug) {
				await router.replace(`/columns/${next.slug}`);
			}
		} catch (error) {
			console.error("Failed to toggle review issue publish status:", error);
			showToast(t("专栏文章发布状态更新失败"), "error");
		} finally {
			setPublishing(false);
		}
	};

	const handleDeleteIssue = async () => {
		if (!review.id) return;
		try {
			await reviewApi.deleteIssue(review.id);
			showToast(t("专栏文章已删除"), "success");
			await router.push("/columns");
		} catch (error) {
			console.error("Failed to delete review issue:", error);
			showToast(t("专栏文章删除失败"), "error");
		}
	};

	const handleExportMarkdown = useCallback(() => {
		try {
			const content = resolveReviewDetailExportMarkdown({
				origin: siteOrigin,
				title: review.title,
				topImage: review.top_image,
				renderedMarkdown: review.rendered_markdown,
				markdownContent: review.markdown_content,
			});
			const filename = resolveDetailExportFilename("review", review.slug);
			downloadMarkdownFile(filename, content);
			showToast(t("导出成功"), "success");
		} catch (error) {
			console.error("Failed to export review markdown:", error);
			showToast(t("导出失败"), "error");
		}
	}, [review, showToast, siteOrigin, t]);

	// Comment handlers for CommentSection
	const handleSubmitComment = async (content: string, replyToId?: string | null) => {
		if (!session || review.status !== "published") return;
		const data = await reviewCommentApi.createReviewComment(
			review.slug,
			content,
			replyToId,
		);
		setComments((prev) =>
			[...prev, data].sort((left, right) =>
				left.created_at.localeCompare(right.created_at),
			),
		);
		showToast(t("评论发布成功"), "success");
		return data;
	};

	const handleUpdateComment = async (commentId: string, content: string) => {
		const data = await reviewCommentApi.updateComment(commentId, content);
		setComments((prev) =>
			prev.map((item) => (item.id === data.id ? data : item)),
		);
		showToast(t("评论已更新"), "success");
	};

	const handleDeleteComment = async (commentId: string) => {
		if (isAdmin) {
			await commentAdminApi.delete(commentId, "review");
		} else {
			await reviewCommentApi.deleteComment(commentId);
		}
		setComments((prev) => {
			const idsToRemove = new Set([
				commentId,
				...collectCommentDescendantIds(commentId, prev),
			]);
			return prev.filter((item) => !idsToRemove.has(item.id));
		});
		showToast(t("评论已删除"), "success");
	};

	const handleToggleCommentHidden = async (commentId: string, isHidden: boolean) => {
		const data = await reviewCommentApi.toggleHidden(commentId, isHidden);
		setComments((prev) =>
			prev.map((item) =>
				item.id === commentId
					? { ...item, is_hidden: data.is_hidden, updated_at: data.updated_at }
					: item,
			),
		);
		showToast(
			data.is_hidden ? t("评论已隐藏") : t("评论已显示"),
			"success",
		);
	};

	return (
		<>
			<div
				className={`min-h-screen ${immersiveMode ? "bg-surface" : "bg-app"} flex flex-col`}
			>
			<SeoHead
				title={`${siteName} - ${(isEditing ? title : review.title) || review.title}`}
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
							<Link href="/columns" className="hover:text-primary hover:underline">
								{t("专栏")}
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
										<span className="font-medium text-text-2"></span>
										{""}
									</div>
								</div>
								<ArticleMetaRow
									className="sr-only"
									publishedAt={review.published_at}
									createdAt={review.created_at}
									items={[
										<div key="template">{review.template?.name || t("专栏")}</div>,
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
					<ColumnEditPanel
						review={review}
						title={title}
						setTitle={setTitle}
						publishedAt={publishedAt}
						setPublishedAt={setPublishedAt}
						topImage={topImage}
						setTopImage={setTopImage}
						markdownContent={markdownContent}
						saving={saving}
						columnDraftHint={columnDraftHint}
						columnDraftSavedAt={columnDraftSavedAt}
						setColumnDraftHint={setColumnDraftHint}
						setColumnDraftSavedAt={setColumnDraftSavedAt}
						clearColumnEditorDraftState={clearColumnEditorDraftState}
						applyColumnEditorDraft={applyColumnEditorDraft}
						showToast={showToast}
						closeEditMode={closeEditMode}
						handleSave={handleSave}
						mediaStorageEnabled={mediaStorageEnabled}
						mediaStorageLoading={mediaStorageLoading}
						mediaUploading={mediaUploading}
						setShowTopicInsertPanel={setShowTopicInsertPanel}
						editContentRef={editContentRef}
						previewRef={previewRef}
						handleTopImagePaste={handleTopImagePaste}
						handleConvertTopImage={handleConvertTopImage}
						handleBatchConvertMarkdownImages={handleBatchConvertMarkdownImages}
						handleMarkdownContentChange={handleMarkdownContentChange}
						handleEditPaste={handleEditPaste}
						rememberEditorSelection={rememberEditorSelection}
						editPreviewTopImageUrl={editPreviewTopImageUrl}
						fallbackTopImageUrl={fallbackTopImageUrl}
						editPreviewHtml={editPreviewHtml}
					/>
				) : (
					<div className="flex flex-col gap-6 lg:flex-row">
							<ColumnDetailArticle
								review={review}
								immersiveMode={immersiveMode}
								setImmersiveMode={setImmersiveMode}
								isAdmin={isAdmin}
								router={router}
								currentTopImageUrl={currentTopImageUrl}
								contentRef={contentRef}
								handleContentClick={handleContentClick}
								html={html}
								handleExportMarkdown={handleExportMarkdown}
								openEditMode={openEditMode}
								handlePublishToggle={handlePublishToggle}
								publishing={publishing}
								setShowDeleteIssueModal={setShowDeleteIssueModal}
								commentsEnabled={commentsEnabled}
								comments={comments}
								session={session}
								commentsLoading={commentsLoading}
								displayCommentCount={displayCommentCount}
								commentProviders={commentProviders}
								handleSubmitComment={handleSubmitComment}
								handleUpdateComment={handleUpdateComment}
								handleDeleteComment={handleDeleteComment}
								handleToggleCommentHidden={handleToggleCommentHidden}
							/>

						{!immersiveMode ? (
							<ColumnSidebar
								review={review}
								templateDescriptionText={templateDescriptionText}
								tocItems={tocItems}
								activeTocId={activeTocId}
								tocCollapsed={tocCollapsed}
								setTocCollapsed={setTocCollapsed}
								handleTocSelect={handleTocSelect}
								recentReviews={recentReviews}
							/>
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
				isOpen={showDeleteIssueModal}
				title={t("删除专栏文章")}
				message={t("确定要删除这篇专栏文章吗？此操作不可撤销。")}
				confirmText={t("删除")}
				cancelText={t("取消")}
				onConfirm={handleDeleteIssue}
				onCancel={() => setShowDeleteIssueModal(false)}
			/>
			<ReviewReferenceInsertPanel
				isOpen={showReferenceInsertPanel}
				onClose={handleCloseReferenceInsertPanel}
				onInsert={handleInsertReference}
				selectedArticleIds={review.selected_article_ids || []}
			/>
			<TopicInsertPanel
				isOpen={showTopicInsertPanel}
				onClose={() => setShowTopicInsertPanel(false)}
				onInsert={(markdown) => {
					const target = editContentRef.current;
					if (!target) {
						setMarkdownContent((prev) => `${prev}${prev.endsWith("\n") ? "" : "\n"}${markdown}`);
						setShowTopicInsertPanel(false);
						return;
					}
					const start = target.selectionStart ?? target.value.length;
					const endPos = target.selectionEnd ?? start;
					const next = `${target.value.slice(0, start)}${markdown}${target.value.slice(endPos)}`;
					setMarkdownContent(next);
					setShowTopicInsertPanel(false);
					window.requestAnimationFrame(() => {
						const cursor = start + markdown.length;
						target.focus();
						target.setSelectionRange(cursor, cursor);
					});
				}}
			/>


			{lightboxImage && (
				<ArticleLightbox
					images={lightboxImages}
					index={lightboxIndex}
					onClose={closeLightbox}
					onShift={shiftLightbox}
				/>
			)}

			<AppFooter />
		</>
	);
}
