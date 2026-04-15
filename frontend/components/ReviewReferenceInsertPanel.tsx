import { useEffect, useMemo, useState } from "react";

import ReviewReferenceSelectionPreview from "@/components/ReviewReferenceSelectionPreview";
import {
	IconLink,
	IconNote,
	IconSearch,
} from "@/components/icons";
import Button from "@/components/Button";
import ModalShell from "@/components/ui/ModalShell";
import TextInput from "@/components/ui/TextInput";
import { articleApi } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import {
	buildReviewArticlePlaceholder,
	resolveReviewReferenceSource,
} from "@/lib/reviewReference";

type ReviewReferenceArticleOption = Awaited<
	ReturnType<typeof articleApi.searchArticles>
>[number];

interface ReviewReferenceInsertPanelProps {
	isOpen: boolean;
	onClose: () => void;
	onInsert: (markdown: string) => void;
	selectedArticleIds?: string[];
}

type ReviewReferenceViewMode = "list" | "preview";

export default function ReviewReferenceInsertPanel({
	isOpen,
	onClose,
	onInsert,
	selectedArticleIds = [],
}: ReviewReferenceInsertPanelProps) {
	const { t } = useI18n();
	const [query, setQuery] = useState("");
	const [results, setResults] = useState<ReviewReferenceArticleOption[]>([]);
	const [searchLoading, setSearchLoading] = useState(false);
	const [searchError, setSearchError] = useState("");
	const [previewLoading, setPreviewLoading] = useState(false);
	const [previewError, setPreviewError] = useState("");
	const [previewMarkdown, setPreviewMarkdown] = useState("");
	const [previewArticle, setPreviewArticle] =
		useState<ReviewReferenceArticleOption | null>(null);
	const [viewMode, setViewMode] = useState<ReviewReferenceViewMode>("list");

	useEffect(() => {
		if (!isOpen) {
			setQuery("");
			setResults([]);
			setSearchLoading(false);
			setSearchError("");
			setPreviewLoading(false);
			setPreviewError("");
			setPreviewMarkdown("");
			setPreviewArticle(null);
			setViewMode("list");
		}
	}, [isOpen]);

	useEffect(() => {
		if (!isOpen || viewMode !== "list") return;
		const trimmedQuery = query.trim();
		if (!trimmedQuery) {
			setResults([]);
			setSearchError("");
			return;
		}

		let disposed = false;
		const timer = window.setTimeout(async () => {
			setSearchLoading(true);
			setSearchError("");
			try {
				const response = await articleApi.searchArticles(trimmedQuery);
				if (!disposed) {
					setResults(response);
				}
			} catch (error) {
				console.error("Failed to search review reference articles:", error);
				if (!disposed) {
					setResults([]);
					setSearchError(t("引用文章搜索失败"));
				}
			} finally {
				if (!disposed) {
					setSearchLoading(false);
				}
			}
		}, 250);

		return () => {
			disposed = true;
			window.clearTimeout(timer);
		};
	}, [isOpen, query, t, viewMode]);

	const previewArticleTitle = useMemo(() => {
		if (!previewArticle) return "";
		return previewArticle.display_title || previewArticle.title;
	}, [previewArticle]);

	const selectedArticleIdSet = useMemo(
		() => new Set(selectedArticleIds),
		[selectedArticleIds],
	);

	const handleInsertArticleReference = (article: ReviewReferenceArticleOption) => {
		onInsert(buildReviewArticlePlaceholder(article.slug));
	};

	const handleOpenContentReference = async (
		article: ReviewReferenceArticleOption,
	) => {
		setPreviewArticle(article);
		setViewMode("preview");
		setPreviewLoading(true);
		setPreviewError("");
		setPreviewMarkdown("");
		try {
			const detail = await articleApi.getArticle(article.slug);
			const source = resolveReviewReferenceSource(
				detail.content_trans,
				detail.content_md,
			);
			if (!source) {
				setPreviewError(t("未检测到可引用的正文内容"));
				return;
			}
			setPreviewMarkdown(source);
		} catch (error) {
			console.error("Failed to load review reference article detail:", error);
			setPreviewError(t("引用内容加载失败"));
		} finally {
			setPreviewLoading(false);
		}
	};

	const handleReturnToList = () => {
		setViewMode("list");
		setPreviewLoading(false);
		setPreviewError("");
		setPreviewMarkdown("");
		setPreviewArticle(null);
	};

	return (
		<ModalShell
			isOpen={isOpen}
			onClose={onClose}
			title={t("插入引用")}
			widthClassName="max-w-6xl"
			bodyClassName="space-y-4 p-4 lg:p-5"
		>
			{viewMode === "preview" && previewArticle ? (
				<div className="space-y-4">
					<div className="flex flex-wrap items-start justify-between gap-3">
						<div className="text-lg font-medium leading-7 text-text-1">
							{previewArticleTitle}
						</div>
						<Button variant="ghost" size="sm" onClick={handleReturnToList}>
							{t("返回列表")}
						</Button>
					</div>

					<p className="text-xs leading-5 text-text-3">
						{t("拖动鼠标选择正文后插入引用")}
					</p>

					{previewLoading ? (
						<div className="rounded-sm border border-border bg-muted/20 px-4 py-6 text-sm text-text-3">
							{t("加载引用内容中...")}
						</div>
					) : previewError ? (
						<div className="space-y-2 rounded-sm border border-border bg-muted/20 p-4 text-sm text-text-3">
							<div>{previewError}</div>
							<div className="text-xs">{t("请选择正文中的内容后再插入")}</div>
						</div>
					) : (
						<ReviewReferenceSelectionPreview
							articleTitle={previewArticleTitle}
							articleSlug={previewArticle.slug}
							markdown={previewMarkdown}
							onInsert={onInsert}
						/>
					)}
				</div>
			) : (
				<div className="space-y-4">
					<div className="space-y-1">
						<div className="text-sm font-medium text-text-1">{t("搜索文章")}</div>
						<p className="text-xs leading-5 text-text-3">
							{t("搜索文章后，直接选择插入文章引用，或进入正文预览挑选内容引用")}
						</p>
					</div>

					<div className="relative">
						<IconSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-3" />
						<TextInput
							value={query}
							onChange={(event) => setQuery(event.target.value)}
							placeholder={t("搜索文章标题...")}
							className="pl-9"
						/>
					</div>

					{searchError ? <div className="text-sm text-danger">{searchError}</div> : null}

					<div className="max-h-[68vh] overflow-hidden rounded-sm border border-border bg-muted/30">
						{searchLoading ? (
							<div className="px-4 py-3 text-sm text-text-3">{t("搜索中...")}</div>
						) : results.length > 0 ? (
							<div className="divide-y divide-border overflow-y-auto">
								{results.map((article) => {
									const isInCurrentReview = selectedArticleIdSet.has(article.id);
									return (
										<div
											key={article.id}
											className="flex items-start gap-3 px-4 py-3"
										>
											<div className="min-w-0 flex-1 space-y-1">
												<div className="flex items-center gap-2">
													<div className="truncate text-sm font-medium text-text-1">
														{article.display_title || article.title}
													</div>
													{isInCurrentReview ? (
														<span className="shrink-0 rounded-full bg-primary-soft px-2 py-0.5 text-[11px] font-medium text-primary-ink">
															{t("已选入本期")}
														</span>
													) : null}
												</div>
												{article.display_title &&
												article.display_title !== article.title ? (
													<div className="truncate text-xs text-text-3">
														{article.title}
													</div>
												) : null}
											</div>

											<div className="flex shrink-0 items-center gap-1">
												<button
													type="button"
													title={t("插入文章引用")}
													aria-label={t("插入文章引用")}
													onClick={() => handleInsertArticleReference(article)}
													className="inline-flex h-8 w-8 items-center justify-center rounded-sm border border-border bg-surface text-text-2 transition hover:border-primary/40 hover:bg-primary-soft hover:text-primary-ink"
												>
													<IconLink className="h-4 w-4" />
												</button>
												<button
													type="button"
													title={t("插入内容引用")}
													aria-label={t("插入内容引用")}
													onClick={() => {
														void handleOpenContentReference(article);
													}}
													className="inline-flex h-8 w-8 items-center justify-center rounded-sm border border-border bg-surface text-text-2 transition hover:border-primary/40 hover:bg-primary-soft hover:text-primary-ink"
												>
													<IconNote className="h-4 w-4" />
												</button>
											</div>
										</div>
									);
								})}
							</div>
						) : query.trim() ? (
							<div className="px-4 py-3 text-sm text-text-3">
								{t("未找到匹配的文章")}
							</div>
						) : (
							<div className="px-4 py-3 text-sm text-text-3">
								{t("输入关键词搜索文章")}
							</div>
						)}
					</div>
				</div>
			)}
		</ModalShell>
	);
}
