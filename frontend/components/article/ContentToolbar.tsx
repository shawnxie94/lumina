import type { Dispatch, ReactNode, RefObject, SetStateAction } from "react";

import Link from "next/link";

import IconButton from "@/components/IconButton";
import {
	IconBolt,
	IconBook,
	IconChevronDown,
	IconDoc,
	IconEdit,
	IconGlobe,
	IconNote,
	IconRefresh,
} from "@/components/icons";
import type { ArticleDetail } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

export const PDF_HEIGHT_SCALE_MIN = 0.4;
export const PDF_HEIGHT_SCALE_MAX = 2.2;

interface ContentTaskStatusItem {
	key: string;
	label: string;
	status: string | null;
	link: string;
}

interface MoreActionItem {
	key: string;
	label: string;
	danger: boolean;
	icon: ReactNode;
	onClick: () => void;
}

interface ContentToolbarProps {
	immersiveMode: boolean;
	setImmersiveMode: Dispatch<SetStateAction<boolean>>;
	isAdmin: boolean;
	contentTaskStatusItems: ContentTaskStatusItem[];
	article: ArticleDetail;
	handleRetryTranslation: () => Promise<void>;
	handleRetryCleaning: () => Promise<void>;
	isCleaningBusy: boolean;
	showTranslation: boolean;
	setShowTranslation: Dispatch<SetStateAction<boolean>>;
	hasPdfEmbed: boolean;
	pdfHeightScale: number;
	decreasePdfHeight: () => void;
	increasePdfHeight: () => void;
	resetPdfHeight: () => void;
	openNoteModal: () => void;
	showMoreActions: boolean;
	setShowMoreActions: Dispatch<SetStateAction<boolean>>;
	openEditModal: (mode: "original" | "translation") => void;
	moreActionItems: MoreActionItem[];
	moreActionsRef: RefObject<HTMLDivElement>;
}

function ContentToolbar({
	immersiveMode,
	setImmersiveMode,
	isAdmin,
	contentTaskStatusItems,
	article,
	handleRetryTranslation,
	handleRetryCleaning,
	isCleaningBusy,
	showTranslation,
	setShowTranslation,
	hasPdfEmbed,
	pdfHeightScale,
	decreasePdfHeight,
	increasePdfHeight,
	resetPdfHeight,
	openNoteModal,
	showMoreActions,
	setShowMoreActions,
	openEditModal,
	moreActionItems,
	moreActionsRef,
}: ContentToolbarProps) {
	const { t } = useI18n();

	return (
		<>
			{!immersiveMode && (
				<div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
					<div className="flex flex-wrap items-center gap-2">
						<h2 className="text-lg font-semibold text-text-1 inline-flex items-center gap-2">
							<IconDoc className="h-4 w-4" />
							<span>{t("内容")}</span>
						</h2>
						{isAdmin &&
							contentTaskStatusItems.map((item) => {
								const statusLabel =
									item.status === "pending"
										? t("等待处理")
										: item.status === "processing"
											? t("处理中")
											: item.status === "failed"
												? t("失败")
												: item.status || t("未知");
								const statusClassName =
									item.status === "pending"
										? "bg-muted text-text-2"
										: item.status === "processing"
											? "bg-info-soft text-info-ink"
											: item.status === "failed"
												? "bg-danger-soft text-danger-ink"
												: "bg-muted text-text-2";
								const badgeNode = (
									<span
										className={`px-2 py-0.5 rounded text-xs ${statusClassName}`}
									>
										{item.label}：{statusLabel}
									</span>
								);
								return item.link ? (
									<Link
										key={item.key}
										href={item.link}
										className="hover:opacity-80 transition"
									>
										{badgeNode}
									</Link>
								) : (
									<span key={item.key}>{badgeNode}</span>
								);
							})}
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
								<IconButton
									onClick={handleRetryCleaning}
									disabled={isCleaningBusy}
									loading={isCleaningBusy}
									variant="ghost"
									size="md"
									title={
										isCleaningBusy
											? t("优化中")
											: article.ai_analysis?.error_message ||
												t("AI 优化正文")
									}
									aria-label={t("AI 优化正文")}
									className="rounded-sm"
								>
									<IconBolt className="h-4 w-4" />
								</IconButton>
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
							{immersiveMode && hasPdfEmbed && (
								<div className="inline-flex h-8 items-center rounded-sm border border-border bg-muted text-text-2">
									<button
										type="button"
										onClick={decreasePdfHeight}
										disabled={pdfHeightScale <= PDF_HEIGHT_SCALE_MIN}
										className="h-full px-2 text-sm hover:bg-surface disabled:cursor-not-allowed disabled:opacity-50 transition"
										title={t("缩短PDF高度")}
										aria-label={t("缩短PDF高度")}
									>
										−
									</button>
									<span className="min-w-[52px] px-1 text-center text-xs tabular-nums">
										{Math.round(pdfHeightScale * 100)}%
									</span>
									<button
										type="button"
										onClick={increasePdfHeight}
										disabled={pdfHeightScale >= PDF_HEIGHT_SCALE_MAX}
										className="h-full px-2 text-sm hover:bg-surface disabled:cursor-not-allowed disabled:opacity-50 transition"
										title={t("拉长PDF高度")}
										aria-label={t("拉长PDF高度")}
									>
										+
									</button>
									<button
										type="button"
										onClick={resetPdfHeight}
										className="h-full border-l border-border px-2 text-xs hover:bg-surface transition"
										title={t("重置PDF高度")}
										aria-label={t("重置PDF高度")}
									>
										{t("重置")}
									</button>
								</div>
							)}
							{isAdmin && (
								<button
									type="button"
									onClick={openNoteModal}
									className="flex items-center justify-center w-8 h-8 rounded-sm text-text-2 hover:text-text-1 hover:bg-muted transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35"
									title={t("编辑批注")}
									aria-label={t("编辑批注")}
								>
									<IconNote className="h-4 w-4" />
								</button>
							)}
							{isAdmin && (
								<button
									type="button"
									onClick={() => {
										setShowMoreActions(false);
										openEditModal(
											showTranslation && article.content_trans
												? "translation"
												: "original",
										);
									}}
									className="flex items-center justify-center w-8 h-8 rounded-sm text-text-2 hover:text-text-1 hover:bg-muted transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35"
									title={t("编辑文章")}
									aria-label={t("编辑文章")}
								>
									<IconEdit className="h-4 w-4" />
								</button>
							)}
							{article && moreActionItems.length > 0 && (
								<div className="relative" ref={moreActionsRef}>
									<button
										type="button"
										onClick={() => setShowMoreActions((prev) => !prev)}
										className="inline-flex items-center gap-1 h-8 px-2 rounded-sm text-text-2 hover:text-text-1 hover:bg-muted transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35"
										aria-haspopup="menu"
										aria-expanded={showMoreActions}
										aria-label={t("更多")}
										title={t("更多")}
									>
										<span className="text-xs">{t("更多")}</span>
										<IconChevronDown
											className={`h-3.5 w-3.5 transition-transform ${
												showMoreActions ? "rotate-180" : ""
											}`}
										/>
									</button>
									{showMoreActions && (
										<div
											role="menu"
											className="absolute right-0 top-10 min-w-[156px] rounded-sm border border-border bg-surface shadow-md p-1 z-20"
										>
											{moreActionItems.map((item) => (
												<button
													key={item.key}
													type="button"
													role="menuitem"
													onClick={() => {
														setShowMoreActions(false);
														item.onClick();
													}}
													className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-sm text-sm transition ${
														item.danger
															? "text-danger-ink hover:bg-danger-soft"
															: "text-text-2 hover:text-text-1 hover:bg-muted"
													}`}
												>
													{item.icon}
													<span>{item.label}</span>
												</button>
											))}
										</div>
									)}
								</div>
							)}
						</div>
					</div>
			)}
		</>
	);
}

export default ContentToolbar;
