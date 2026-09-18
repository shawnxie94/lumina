import type { Dispatch, SetStateAction } from "react";

import { MindMapTree } from "@/components/article/MindMap";
import { IconClock, IconRefresh } from "@/components/icons";
import ModalShell from "@/components/ui/ModalShell";
import type { AIContentVersion, ArticleDetail } from "@/lib/api";
import { shouldShowAiHistoryButton } from "@/lib/aiHistoryVisibility";
import {
	formatVersionSourceLabel,
	getAiContentLabel,
	type AIContentType,
} from "@/lib/aiTaskStatus";
import { useI18n } from "@/lib/i18n";
import { parseMindMapOutline } from "@/lib/mindMap";
import { renderSafeMarkdown } from "@/lib/safeHtml";

interface VersionHistoryActionsProps {
	contentType: AIContentType;
	isAdmin: boolean;
	aiAnalysis: ArticleDetail["ai_analysis"] | null | undefined;
	onOpenHistory: (contentType: AIContentType) => Promise<void>;
}

function VersionHistoryActions({
	contentType,
	isAdmin,
	aiAnalysis,
	onOpenHistory,
}: VersionHistoryActionsProps) {
	const { t } = useI18n();

	return (
		<>
			{shouldShowAiHistoryButton(isAdmin, contentType, aiAnalysis) && (
				<button
					type="button"
					onClick={() => {
						void onOpenHistory(contentType);
					}}
					className="text-text-3 hover:text-primary transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35"
					title={t("历史")}
					aria-label={t("历史")}
				>
					<IconClock className="h-4 w-4" />
				</button>
			)}
		</>
	);
}

interface VersionHistoryModalProps {
	showVersionHistoryModal: boolean;
	setShowVersionHistoryModal: Dispatch<SetStateAction<boolean>>;
	historyContentType: AIContentType;
	versionHistoryLoading: Partial<Record<AIContentType, boolean>>;
	historyVersions: AIContentVersion[];
	previewVersionIds: Partial<Record<AIContentType, string | null>>;
	setPreviewVersionIds: Dispatch<
		SetStateAction<Partial<Record<AIContentType, string | null>>>
	>;
	previewVersion: AIContentVersion | null;
	setPendingRollbackVersion: Dispatch<
		SetStateAction<
			{ contentType: AIContentType; versionId: string } | null
		>
	>;
	setShowRollbackVersionModal: Dispatch<SetStateAction<boolean>>;
}

function VersionHistoryModal({
	showVersionHistoryModal,
	setShowVersionHistoryModal,
	historyContentType,
	versionHistoryLoading,
	historyVersions,
	previewVersionIds,
	setPreviewVersionIds,
	previewVersion,
	setPendingRollbackVersion,
	setShowRollbackVersionModal,
}: VersionHistoryModalProps) {
	const { t, language } = useI18n();

	const renderHistoryPreview = (
		contentType: AIContentType,
		version: AIContentVersion | null,
	) => {
		if (!version) return null;
		if (contentType === "outline") {
			const tree = parseMindMapOutline(version.content_text || "");
			if (!tree) {
				return (
					<div className="max-h-[420px] overflow-auto rounded-lg border border-border bg-surface p-3 text-sm whitespace-pre-wrap text-text-2">
						{version.content_text || t("暂无内容")}
					</div>
				);
			}
			return (
				<div className="max-h-[420px] overflow-auto rounded-lg border border-border bg-surface p-4">
					<MindMapTree
						node={tree}
						compact
						defaultExpandedDepth={2}
						showToolbar
					/>
				</div>
			);
		}

		return (
			<div
				className="prose prose-sm max-w-none rounded-lg border border-border bg-surface p-3 text-text-2"
				dangerouslySetInnerHTML={{
					__html: renderSafeMarkdown(version.content_text || ""),
				}}
			/>
		);
	};

	return (
		<ModalShell
			isOpen={showVersionHistoryModal}
			onClose={() => setShowVersionHistoryModal(false)}
			title={`${getAiContentLabel(historyContentType, t)} · ${t("版本历史")}`}
			widthClassName="max-w-4xl"
			panelClassName="flex h-[min(90vh,48rem)] flex-col"
			bodyClassName="min-h-0 flex-1 overflow-hidden p-4"
		>
			<div className="grid h-full min-h-0 gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
				<div className="min-h-0 overflow-y-auto space-y-3">
					<div className="text-xs text-text-3">
						{versionHistoryLoading[historyContentType]
							? t("加载中")
							: historyVersions.length > 0
								? `${historyVersions.length} ${t("个版本")}`
								: t("暂无历史版本")}
					</div>
					<div className="space-y-2">
						{historyVersions.map((version) => {
							const isPreview =
								previewVersionIds[historyContentType] === version.id;
							return (
								<div
									key={version.id}
									onClick={() =>
										setPreviewVersionIds((prev) => ({
											...prev,
											[historyContentType]: version.id,
										}))
									}
									onKeyDown={(event) => {
										if (event.key === "Enter" || event.key === " ") {
											event.preventDefault();
											setPreviewVersionIds((prev) => ({
												...prev,
												[historyContentType]: version.id,
											}));
										}
									}}
									role="button"
									tabIndex={0}
									className={`cursor-pointer rounded-lg border p-3 transition ${
										version.is_current
											? "border-success-soft bg-success-soft"
											: isPreview
												? "border-primary/35 bg-primary-soft/20"
												: "border-border bg-muted"
									}`}
								>
									<div className="flex items-center justify-between gap-2">
										<div>
											<div className="text-sm font-medium text-text-1">
												v{version.version_number}
												{version.is_current ? ` · ${t("当前版本")}` : ""}
											</div>
											<div className="mt-1 text-xs text-text-3">
												{formatVersionSourceLabel(
													version.created_by_mode,
													t,
												)} ·{" "}
												{new Date(version.created_at).toLocaleString(
													language === "en" ? "en-US" : "zh-CN",
												)}
											</div>
										</div>
										{!version.is_current && (
											<button
												type="button"
												onClick={(event) => {
													event.stopPropagation();
													setPendingRollbackVersion({
														contentType: historyContentType,
														versionId: version.id,
													});
													setShowRollbackVersionModal(true);
												}}
												className="text-text-3 hover:text-primary transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35"
												title={t("回滚为当前版本")}
												aria-label={t("回滚为当前版本")}
											>
												<IconRefresh className="h-4 w-4" />
											</button>
										)}
									</div>
								</div>
							);
						})}
					</div>
				</div>
				<div className="min-h-0 overflow-y-auto rounded-lg border border-border bg-muted p-4">
					{previewVersion ? (
						<div className="space-y-3">
							<div className="flex items-center justify-between gap-2">
								<h3 className="text-sm font-medium text-text-1">
									{t("预览")} · v{previewVersion.version_number}
								</h3>
								<span className="text-xs text-text-3">
									{formatVersionSourceLabel(
										previewVersion.created_by_mode,
										t,
									)}
								</span>
							</div>
							{renderHistoryPreview(historyContentType, previewVersion)}
						</div>
					) : (
						<div className="flex h-full min-h-[240px] items-center justify-center text-sm text-text-3">
							{t("选择一个历史版本进行预览")}
						</div>
					)}
				</div>
			</div>
		</ModalShell>
	);
}

export { VersionHistoryActions };
export default VersionHistoryModal;
