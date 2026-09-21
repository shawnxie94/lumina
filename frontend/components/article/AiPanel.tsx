import type { Dispatch, SetStateAction } from "react";
import { useMemo } from "react";

import Link from "next/link";

import AIContentSection from "@/components/article/AIContentSection";
import {
	TableOfContents,
	type TocItem,
} from "@/components/article/TableOfContents";
import { VersionHistoryActions } from "@/components/article/VersionHistoryModal";
import Button from "@/components/Button";
import ConfirmModal from "@/components/ConfirmModal";
import FormField from "@/components/ui/FormField";
import ModalShell from "@/components/ui/ModalShell";
import SelectField from "@/components/ui/SelectField";
import TextArea from "@/components/ui/TextArea";
import {
	IconBolt,
	IconChevronDown,
	IconCopy,
	IconList,
	IconRefresh,
	IconRobot,
	IconTag,
	IconTrash,
} from "@/components/icons";
import type {
	ArticleDetail,
	ModelAPIConfig,
	PromptConfig,
	SimilarArticleItem,
} from "@/lib/api";
import {
	canManuallyGenerateAIContent,
	isPendingJobStatus,
	type AIContentType,
	type AITabConfig,
	type AITabKey,
} from "@/lib/aiTaskStatus";
import { useI18n } from "@/lib/i18n";

export type ConfigModalMode =
	| "generate"
	| "regenerate_interpretation"
	| "retry_ai_content"
	| "retry_cleaning"
	| "retry_translation";

interface AiPanelProps {
	article: ArticleDetail | null;
	isAdmin: boolean;
	tocItems: TocItem[];
	activeTocId: string;
	setActiveTocId: Dispatch<SetStateAction<string>>;
	tocCollapsed: boolean;
	setTocCollapsed: Dispatch<SetStateAction<boolean>>;
	visibleAiTabs: AITabConfig[];
	activeAiTab: AITabKey;
	handleSelectAiTab: (tabKey: AITabKey) => void;
	activeTabConfig: AITabConfig | undefined;
	activeStatusLink: string;
	showOutlineSection: boolean;
	showQuotesSection: boolean;
	summaryStatusValue: string | null;
	summaryStatusLink: string;
	interpretationStatus: string | null;
	interpretationStatusLink: string;
	interpretationRegenerating: boolean;
	handleRegenerateInterpretation: () => void;
	handleGenerateContent: (contentType: AIContentType) => void;
	handleCopyContent: (content: string | null | undefined) => Promise<void>;
	setEditAIContentType: Dispatch<
		SetStateAction<"summary" | "outline" | "quotes" | null>
	>;
	setEditAIContentDraft: Dispatch<SetStateAction<string>>;
	setShowEditAIContentModal: Dispatch<SetStateAction<boolean>>;
	setPendingDeleteAiContentType: Dispatch<
		SetStateAction<AIContentType | null>
	>;
	setShowDeleteAiContentModal: Dispatch<SetStateAction<boolean>>;
	openVersionHistory: (contentType: AIContentType) => Promise<void>;
	similarLoading: boolean;
	similarStatus: "ready" | "pending" | "disabled";
	similarArticles: SimilarArticleItem[];
	embeddingRefreshing: boolean;
	handleRefreshEmbedding: () => Promise<void>;
	buildArticleHref: (slug: string) => string;
}

function AiPanel({
	article,
	isAdmin,
	tocItems,
	activeTocId,
	setActiveTocId,
	tocCollapsed,
	setTocCollapsed,
	visibleAiTabs,
	activeAiTab,
	handleSelectAiTab,
	activeTabConfig,
	activeStatusLink,
	showOutlineSection,
	showQuotesSection,
	summaryStatusValue,
	summaryStatusLink,
	interpretationStatus,
	interpretationStatusLink,
	interpretationRegenerating,
	handleRegenerateInterpretation,
	handleGenerateContent,
	handleCopyContent,
	setEditAIContentType,
	setEditAIContentDraft,
	setShowEditAIContentModal,
	setPendingDeleteAiContentType,
	setShowDeleteAiContentModal,
	openVersionHistory,
	similarLoading,
	similarStatus,
	similarArticles,
	embeddingRefreshing,
	handleRefreshEmbedding,
	buildArticleHref,
}: AiPanelProps) {
	const { t, language } = useI18n();

	const showSummarySection = isAdmin || Boolean(article?.ai_analysis?.summary);

	const aiUpdatedAt =
		isAdmin && article?.ai_analysis?.updated_at
			? new Date(article.ai_analysis.updated_at).toLocaleString(
					language === "en" ? "en-US" : "zh-CN",
				)
			: "";

	const activeStatusBadge = isAdmin
		? getAiTabStatusBadge(activeTabConfig?.status)
		: null;
	const showActiveGenerateButton =
		isAdmin &&
		canManuallyGenerateAIContent(
			activeTabConfig?.status,
			activeTabConfig?.content,
		);
	const showActiveCopyButton =
		Boolean(activeTabConfig?.content) && activeTabConfig?.canCopy !== false;
	const showActiveDeleteButton =
		isAdmin &&
		Boolean(activeTabConfig?.content) &&
		Boolean(activeTabConfig?.key) &&
		!isPendingJobStatus(activeTabConfig?.status);

	return (
		<div className="bg-surface rounded-sm shadow-sm border border-border p-4">
			<div className="space-y-6">
				{tocItems.length > 0 && (
					<div>
						<div className="mb-3 flex items-center justify-between gap-2">
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
						</div>
						{!tocCollapsed && (
							<TableOfContents
								items={tocItems}
								activeId={activeTocId}
								onSelect={setActiveTocId}
							/>
						)}
					</div>
				)}

				<div>
					<div className="flex items-center justify-between mb-2">
						<h2 className="text-lg font-semibold text-text-1 inline-flex items-center gap-2">
							<IconRobot className="h-4 w-4" />
							<span>{t("AI解读")}</span>
						</h2>
						<div className="flex items-center gap-2">
							{isAdmin &&
								(interpretationStatusLink && getAiTabStatusBadge(interpretationStatus) ? (
									<Link
										href={interpretationStatusLink}
										className="hover:opacity-80 transition"
									>
										{getAiTabStatusBadge(interpretationStatus)}
									</Link>
								) : (
									getAiTabStatusBadge(interpretationStatus)
								))}
							{aiUpdatedAt && (
								<span className="text-xs text-text-3">{aiUpdatedAt}</span>
							)}
							{isAdmin && (
								<button
									type="button"
									onClick={handleRegenerateInterpretation}
									disabled={
										interpretationRegenerating ||
										isPendingJobStatus(interpretationStatus)
									}
									className="text-text-3 hover:text-primary transition disabled:opacity-50"
									title={t("重新生成 AI 解读")}
									aria-label={t("重新生成 AI 解读")}
								>
									<IconRefresh
										className={`h-4 w-4 ${
											interpretationRegenerating ? "animate-spin" : ""
										}`}
									/>
								</button>
							)}
						</div>
					</div>
				</div>

				{isAdmin &&
					(article?.ai_analysis?.interpretation_error ||
						article?.ai_analysis?.error_message) && (
						<div className="p-3 bg-danger-soft border border-danger-soft rounded-lg">
							<p className="text-danger-ink text-sm whitespace-pre-wrap break-words">
								{article.ai_analysis.interpretation_error ||
									article.ai_analysis.error_message}
							</p>
						</div>
					)}

				{showSummarySection && (
					<AIContentSection
						title={t("摘要")}
						content={article?.ai_analysis?.summary}
						status={summaryStatusValue}
						onGenerate={() => handleGenerateContent("summary")}
						onCopy={() => handleCopyContent(article?.ai_analysis?.summary)}
						canEdit={isAdmin}
						canUpdate={isAdmin && Boolean(article?.ai_analysis?.summary)}
						onUpdate={(content) => {
							setEditAIContentType("summary");
							setEditAIContentDraft(content);
							setShowEditAIContentModal(true);
						}}
						showStatus={isAdmin}
						statusLink={summaryStatusLink}
						extraActions={
							<VersionHistoryActions
								contentType="summary"
								isAdmin={isAdmin}
								aiAnalysis={article?.ai_analysis}
								onOpenHistory={openVersionHistory}
							/>
						}
					/>
				)}

				{(showOutlineSection || showQuotesSection) && (
					<div className="space-y-4">
						<div className="flex flex-wrap items-center justify-between gap-2">
							<div className="relative min-w-0 flex-1">
								<div className="flex items-center gap-1.5 overflow-x-auto pb-1 pr-3">
									{visibleAiTabs.map((tab) => (
										<button
											key={tab.key}
											type="button"
											onClick={() => handleSelectAiTab(tab.key)}
											className={`shrink-0 min-w-[3.9rem] whitespace-nowrap px-2.5 py-1.5 text-base font-semibold text-center rounded-sm transition ${
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
							<div className="ml-auto flex shrink-0 items-center gap-1.5 pr-1">
								{activeStatusBadge && activeStatusLink ? (
									<Link
										href={activeStatusLink}
										className="hover:opacity-80 transition"
									>
										{activeStatusBadge}
									</Link>
								) : (
									activeStatusBadge
								)}
								{activeTabConfig ? (
									<VersionHistoryActions
										contentType={activeTabConfig.key}
										isAdmin={isAdmin}
										aiAnalysis={article?.ai_analysis}
										onOpenHistory={openVersionHistory}
									/>
								) : null}
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
										title={activeTabConfig.copyTitle || t("复制内容")}
										aria-label={activeTabConfig.copyTitle || t("复制内容")}
										type="button"
									>
										<IconCopy className="h-4 w-4" />
									</button>
								)}
								{showActiveDeleteButton && activeTabConfig && (
									<button
										onClick={() => {
											setPendingDeleteAiContentType(activeTabConfig.key);
											setShowDeleteAiContentModal(true);
										}}
										className="text-text-3 hover:text-danger-ink transition"
										title={t("删除内容")}
										aria-label={t("删除内容")}
										type="button"
									>
										<IconTrash className="h-4 w-4" />
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
								copyTitle={activeTabConfig.copyTitle}
								canEdit={isAdmin}
								renderMarkdown={activeTabConfig.renderMarkdown}
								renderMindMap={activeTabConfig.renderMindMap}
								onMindMapOpen={activeTabConfig.onMindMapOpen}
								canCopy={activeTabConfig.canCopy}
								customContent={activeTabConfig.customContent}
								showStatus={isAdmin}
								statusLink={activeStatusLink}
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
									{similarArticles.map((item) => {
										const displayTitle = item.title_trans?.trim() || item.title;
										return (
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
														title={displayTitle}
													>
														{displayTitle}
													</Link>
												</div>
											</div>
										);
								})}
							</div>
						)}
					</div>
				)}
			</div>
		</div>
	);

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
			partial_completed: {
				bg: "bg-warning-soft",
				text: "text-warning-ink",
				label: t("部分完成"),
			},
			skipped: {
				bg: "bg-muted",
				text: "text-text-3",
				label: t("已跳过"),
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
}

export default AiPanel;

interface AiConfigModalProps {
	showConfigModal: boolean;
	setShowConfigModal: Dispatch<SetStateAction<boolean>>;
	configModalMode: ConfigModalMode;
	handleConfigModalSubmit: () => Promise<void>;
	selectedModelConfigId: string;
	setSelectedModelConfigId: Dispatch<SetStateAction<string>>;
	selectedPromptConfigId: string;
	setSelectedPromptConfigId: Dispatch<SetStateAction<string>>;
	modelConfigs: ModelAPIConfig[];
	promptConfigs: PromptConfig[];
}

function AiConfigModal({
	showConfigModal,
	setShowConfigModal,
	configModalMode,
	handleConfigModalSubmit,
	selectedModelConfigId,
	setSelectedModelConfigId,
	selectedPromptConfigId,
	setSelectedPromptConfigId,
	modelConfigs,
	promptConfigs,
}: AiConfigModalProps) {
	const { t } = useI18n();
	const selectableModelConfigs = useMemo(
		() => modelConfigs.filter((config) => config.model_type !== "vector"),
		[modelConfigs],
	);

	return (
		<ModalShell
			isOpen={showConfigModal}
			onClose={() => setShowConfigModal(false)}
			title={
				configModalMode === "generate"
					? t("选择生成配置")
					: configModalMode === "retry_ai_content"
						? t("选择重试配置")
						: configModalMode === "regenerate_interpretation"
							? t("选择文章解读配置")
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
						{configModalMode === "generate"
							? t("生成")
							: configModalMode === "regenerate_interpretation"
								? t("重新生成")
								: t("提交重试")}
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

			{configModalMode !== "regenerate_interpretation" && (
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
			)}
		</div>
	</ModalShell>
	);

}

interface DeleteAiContentModalProps {
	showDeleteAiContentModal: boolean;
	pendingDeleteAiContentType: AIContentType | null;
	handleDeleteAIContent: (contentType: AIContentType) => Promise<void>;
	setShowDeleteAiContentModal: Dispatch<SetStateAction<boolean>>;
	setPendingDeleteAiContentType: Dispatch<
		SetStateAction<AIContentType | null>
	>;
}

function DeleteAiContentModal({
	showDeleteAiContentModal,
	pendingDeleteAiContentType,
	handleDeleteAIContent,
	setShowDeleteAiContentModal,
	setPendingDeleteAiContentType,
}: DeleteAiContentModalProps) {
	const { t } = useI18n();

	return (
		<ConfirmModal
			isOpen={showDeleteAiContentModal}
			title={t("删除 AI 解读")}
			message={t("确定要删除当前 AI 解读内容吗？此操作不可撤销。")}
			confirmText={t("删除")}
			cancelText={t("取消")}
			onConfirm={async () => {
				if (pendingDeleteAiContentType) {
					await handleDeleteAIContent(pendingDeleteAiContentType);
				}
				setShowDeleteAiContentModal(false);
				setPendingDeleteAiContentType(null);
			}}
			onCancel={() => {
				setShowDeleteAiContentModal(false);
				setPendingDeleteAiContentType(null);
			}}
		/>
	);

}

interface EditAIContentModalProps {
	showEditAIContentModal: boolean;
	setShowEditAIContentModal: Dispatch<SetStateAction<boolean>>;
	editAIContentType: "summary" | "outline" | "quotes" | null;
	setEditAIContentType: Dispatch<
		SetStateAction<"summary" | "outline" | "quotes" | null>
	>;
	editAIContentDraft: string;
	setEditAIContentDraft: Dispatch<SetStateAction<string>>;
	handleUpdateAIContent: (
		contentType: "summary" | "outline" | "quotes",
		content: string,
	) => Promise<void>;
}

function EditAIContentModal({
	showEditAIContentModal,
	setShowEditAIContentModal,
	editAIContentType,
	setEditAIContentType,
	editAIContentDraft,
	setEditAIContentDraft,
	handleUpdateAIContent,
}: EditAIContentModalProps) {
	const { t } = useI18n();

	return (
		<ModalShell
			isOpen={showEditAIContentModal}
			onClose={() => {
				setShowEditAIContentModal(false);
				setEditAIContentType(null);
			}}
			title={t("编辑内容")}
			widthClassName="max-w-2xl"
		>
			<div className="space-y-4">
				<TextArea
					value={editAIContentDraft}
					onChange={(e) => setEditAIContentDraft(e.target.value)}
					placeholder={t("请输入内容")}
					rows={10}
					className="w-full"
				/>
				<div className="flex justify-end gap-2">
					<Button
						variant="secondary"
						onClick={() => {
							setShowEditAIContentModal(false);
							setEditAIContentType(null);
						}}
					>
						{t("取消")}
					</Button>
					<Button
						variant="primary"
						onClick={async () => {
							if (editAIContentType && editAIContentDraft.trim()) {
								await handleUpdateAIContent(editAIContentType, editAIContentDraft.trim());
								setShowEditAIContentModal(false);
								setEditAIContentType(null);
							}
						}}
					>
						{t("保存")}
					</Button>
				</div>
			</div>
		</ModalShell>
	);

}

export { AiConfigModal, DeleteAiContentModal, EditAIContentModal };
