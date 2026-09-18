import type { Dispatch, SetStateAction } from "react";

import Button from "@/components/Button";
import ConfirmModal from "@/components/ConfirmModal";
import IconButton from "@/components/IconButton";
import FormField from "@/components/ui/FormField";
import ModalShell from "@/components/ui/ModalShell";
import SelectField from "@/components/ui/SelectField";
import TextArea from "@/components/ui/TextArea";
import {
	IconBolt,
	IconEdit,
	IconRefresh,
	IconTrash,
} from "@/components/icons";
import {
	NOTE_RECOMMENDATION_LEVEL_OPTIONS,
	normalizeNoteRecommendationLevel,
	renderMarkdown,
	type ArticleAnnotation,
	type NoteRecommendationLevel,
} from "@/lib/articleAnnotations";
import { normalizeDigestNoteForDisplay } from "@/lib/articleDigest";
import { useI18n } from "@/lib/i18n";
import { sanitizeRichHtml } from "@/lib/safeHtml";

interface AnnotationXyPosition {
	x: number;
	y: number;
}

interface NotePanelProps {
	noteContent: string;
	isAdmin: boolean;
	setShowDeleteNoteModal: Dispatch<SetStateAction<boolean>>;
}

function NotePanel({
	noteContent,
	isAdmin,
	setShowDeleteNoteModal,
}: NotePanelProps) {
	const { t } = useI18n();

	return (
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
					__html: renderMarkdown(normalizeDigestNoteForDisplay(noteContent)),
				}}
			/>
		</div>
	);
}

interface AnnotationNotesLayerProps {
	showSelectionToolbar: boolean;
	selectionToolbarPos: AnnotationXyPosition | null;
	isAdmin: boolean;
	handleStartAnnotation: () => void;
	hoverAnnotationId: string;
	hoverTooltipPos: AnnotationXyPosition | null;
	annotations: ArticleAnnotation[];
	showAnnotationView: boolean;
	activeAnnotation: ArticleAnnotation | undefined;
	setShowAnnotationView: Dispatch<SetStateAction<boolean>>;
	setActiveAnnotationId: Dispatch<SetStateAction<string>>;
	setPendingAnnotationRange: Dispatch<
		SetStateAction<{ start: number; end: number } | null>
	>;
	activeAnnotationText: string;
	setPendingAnnotationText: Dispatch<SetStateAction<string>>;
	setPendingAnnotationComment: Dispatch<SetStateAction<string>>;
	setShowAnnotationModal: Dispatch<SetStateAction<boolean>>;
	setPendingDeleteAnnotationId: Dispatch<SetStateAction<string | null>>;
	setShowDeleteAnnotationModal: Dispatch<SetStateAction<boolean>>;
	showNoteModal: boolean;
	closeNoteModal: () => void;
	noteContent: string;
	setShowDeleteNoteModal: Dispatch<SetStateAction<boolean>>;
	handleSaveNoteContent: () => Promise<void>;
	noteRecommendationDraftLevel: NoteRecommendationLevel;
	setNoteRecommendationDraftLevel: Dispatch<
		SetStateAction<NoteRecommendationLevel>
	>;
	handleDigestPrefill: () => Promise<void>;
	digestPrefilling: boolean;
	noteDraft: string;
	setNoteDraft: Dispatch<SetStateAction<string>>;
	setNoteDraftDirty: Dispatch<SetStateAction<boolean>>;
	showAnnotationModal: boolean;
	handleConfirmAnnotation: () => Promise<void>;
	activeAnnotationId: string;
	pendingAnnotationText: string;
	pendingAnnotationComment: string;
	showDeleteNoteModal: boolean;
	handleDeleteNoteContent: () => Promise<void>;
	showDeleteAnnotationModal: boolean;
	pendingDeleteAnnotationId: string | null;
	handleDeleteAnnotation: (id: string) => Promise<void>;
}

function AnnotationNotesLayer({
	showSelectionToolbar,
	selectionToolbarPos,
	isAdmin,
	handleStartAnnotation,
	hoverAnnotationId,
	hoverTooltipPos,
	annotations,
	showAnnotationView,
	activeAnnotation,
	setShowAnnotationView,
	setActiveAnnotationId,
	setPendingAnnotationRange,
	activeAnnotationText,
	setPendingAnnotationText,
	setPendingAnnotationComment,
	setShowAnnotationModal,
	setPendingDeleteAnnotationId,
	setShowDeleteAnnotationModal,
	showNoteModal,
	closeNoteModal,
	noteContent,
	setShowDeleteNoteModal,
	handleSaveNoteContent,
	noteRecommendationDraftLevel,
	setNoteRecommendationDraftLevel,
	handleDigestPrefill,
	digestPrefilling,
	noteDraft,
	setNoteDraft,
	setNoteDraftDirty,
	showAnnotationModal,
	handleConfirmAnnotation,
	activeAnnotationId,
	pendingAnnotationText,
	pendingAnnotationComment,
	showDeleteNoteModal,
	handleDeleteNoteContent,
	showDeleteAnnotationModal,
	pendingDeleteAnnotationId,
	handleDeleteAnnotation,
}: AnnotationNotesLayerProps) {
	const { t } = useI18n();

	return (
		<>
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
					onClose={closeNoteModal}
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
								onClick={closeNoteModal}
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
					<div className="space-y-3">
						<FormField label={t("推荐等级")}>
							<SelectField
								value={noteRecommendationDraftLevel}
								onChange={(value) =>
									setNoteRecommendationDraftLevel(
										normalizeNoteRecommendationLevel(String(value)),
									)
								}
								className="w-full"
								options={NOTE_RECOMMENDATION_LEVEL_OPTIONS.map((item) => ({
									value: item.value,
									label: t(item.label),
								}))}
								showSearch={false}
							/>
						</FormField>
						<div>
							<div className="mb-1.5 flex items-center justify-between gap-2">
								<label className="block text-sm text-text-2">
									{t("批注正文")}
								</label>
								<button
									type="button"
									onClick={() => void handleDigestPrefill()}
									disabled={digestPrefilling}
									className="flex items-center justify-center w-8 h-8 rounded-sm text-text-2 hover:text-primary hover:bg-muted transition disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35"
									title={
										digestPrefilling ? t("生成中...") : t("AI 生成批注")
									}
									aria-label={
										digestPrefilling ? t("生成中...") : t("AI 生成批注")
									}
								>
									{digestPrefilling ? (
										<IconRefresh className="h-4 w-4 animate-spin" />
									) : (
										<IconBolt className="h-4 w-4" />
									)}
								</button>
							</div>
							<TextArea
								value={noteDraft}
								onChange={(e) => {
									setNoteDraft(e.target.value);
									setNoteDraftDirty(true);
								}}
								rows={10}
								placeholder={
									digestPrefilling
										? t("批注生成中，可先关闭弹窗，完成后会保留草稿")
										: t("输入批注内容，支持 Markdown")
								}
								disabled={digestPrefilling}
							/>
						</div>
					</div>
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
		</>
	);
}

export { NotePanel };
export default AnnotationNotesLayer;
