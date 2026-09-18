import type { Dispatch, SetStateAction } from "react";

import Button from "@/components/Button";
import IconButton from "@/components/IconButton";
import ArticleSplitEditorModal from "@/components/article/ArticleSplitEditorModal";
import FormField from "@/components/ui/FormField";
import SelectField from "@/components/ui/SelectField";
import TextInput from "@/components/ui/TextInput";
import { IconLink } from "@/components/icons";
import { normalizeMediaHtml, type Category } from "@/lib/api";
import {
	formatEditorDraftTime,
	type ArticleEditorDraftPayload,
} from "@/lib/editorDraft";
import { useI18n } from "@/lib/i18n";
import { renderSafeMarkdown } from "@/lib/safeHtml";

interface ArticleEditorDraftHint {
	updatedAt: number;
	payload: ArticleEditorDraftPayload;
}

interface ArticleEditModalProps {
	showEditModal: boolean;
	setShowEditModal: Dispatch<SetStateAction<boolean>>;
	editMode: "original" | "translation";
	editTitle: string;
	setEditTitle: Dispatch<SetStateAction<string>>;
	editAuthor: string;
	setEditAuthor: Dispatch<SetStateAction<string>>;
	editPublishedAt: string;
	setEditPublishedAt: Dispatch<SetStateAction<string>>;
	editCategoryId: string;
	setEditCategoryId: Dispatch<SetStateAction<string>>;
	editTopImage: string;
	setEditTopImage: Dispatch<SetStateAction<string>>;
	editContent: string;
	setEditContent: Dispatch<SetStateAction<string>>;
	saving: boolean;
	categories: Category[];
	categoriesLoading: boolean;
	mediaStorageEnabled: boolean;
	mediaStorageLoading: boolean;
	mediaUploading: boolean;
	articleDraftHint: ArticleEditorDraftHint | null;
	articleDraftSavedAt: number | null;
	setArticleDraftHint: Dispatch<SetStateAction<ArticleEditorDraftHint | null>>;
	setArticleDraftSavedAt: Dispatch<SetStateAction<number | null>>;
	applyArticleEditorDraft: (draft: ArticleEditorDraftPayload) => void;
	clearArticleEditorDraftState: (mode?: "original" | "translation") => void;
	handleSaveEdit: () => Promise<void>;
	handleEditPaste: (
		event: React.ClipboardEvent<HTMLTextAreaElement>,
	) => Promise<void>;
	handleConvertTopImage: () => Promise<void>;
	handleTopImagePaste: (event: React.ClipboardEvent<HTMLInputElement>) => void;
	handleBatchConvertMarkdownImages: () => Promise<void>;
	editPreviewTopImageUrl: string;
	fallbackTopImageUrl: string;
	showToast: (message: string, type?: "success" | "error" | "info") => void;
}

function ArticleEditModal({
	showEditModal,
	setShowEditModal,
	editMode,
	editTitle,
	setEditTitle,
	editAuthor,
	setEditAuthor,
	editPublishedAt,
	setEditPublishedAt,
	editCategoryId,
	setEditCategoryId,
	editTopImage,
	setEditTopImage,
	editContent,
	setEditContent,
	saving,
	categories,
	categoriesLoading,
	mediaStorageEnabled,
	mediaStorageLoading,
	mediaUploading,
	articleDraftHint,
	articleDraftSavedAt,
	setArticleDraftHint,
	setArticleDraftSavedAt,
	applyArticleEditorDraft,
	clearArticleEditorDraftState,
	handleSaveEdit,
	handleEditPaste,
	handleConvertTopImage,
	handleTopImagePaste,
	handleBatchConvertMarkdownImages,
	editPreviewTopImageUrl,
	fallbackTopImageUrl,
	showToast,
}: ArticleEditModalProps) {
	const { t, language } = useI18n();

	return (
		<ArticleSplitEditorModal
			isOpen={showEditModal}
			title={t("编辑文章")}
			titleAddon={
				articleDraftHint || articleDraftSavedAt ? (
					<div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
						{articleDraftHint ? (
							<>
								<span className="min-w-0 text-xs text-text-3 sm:text-sm">
									{t("发现未保存的本地草稿")}
									{` · ${formatEditorDraftTime(articleDraftHint.updatedAt, language)}`}
								</span>
								<div className="flex items-center gap-2">
									<Button
										variant="secondary"
										size="sm"
										onClick={() => {
											clearArticleEditorDraftState(editMode);
											showToast(t("已丢弃本地草稿"));
										}}
									>
										{t("丢弃本地草稿")}
									</Button>
									<Button
										variant="primary"
										size="sm"
										onClick={() => {
											applyArticleEditorDraft(articleDraftHint.payload);
											setArticleDraftSavedAt(articleDraftHint.updatedAt);
											setArticleDraftHint(null);
											showToast(t("已恢复本地草稿"));
										}}
									>
										{t("恢复本地草稿")}
									</Button>
								</div>
							</>
						) : (
							<span className="text-xs text-text-3 sm:text-sm">
								{t("已自动暂存")}
								{articleDraftSavedAt
									? ` · ${formatEditorDraftTime(articleDraftSavedAt, language)}`
									: ""}
							</span>
						)}
					</div>
				) : null
			}
			closeAriaLabel={t("关闭编辑弹窗")}
			onClose={() => {
				setShowEditModal(false);
				setArticleDraftHint(null);
			}}
			onSave={handleSaveEdit}
			topFields={(
				<>
					<FormField label={t("标题")}>
						<TextInput
							type="text"
							value={editTitle}
							onChange={(e) => setEditTitle(e.target.value)}
						/>
					</FormField>

					<div className="grid grid-cols-1 md:grid-cols-3 gap-3">
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
					</div>
					<div>
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
				</>
			)}
			contentValue={editContent}
			onContentChange={setEditContent}
			onContentPaste={handleEditPaste}
			extraEditorActions={
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
			}
			contentLabelAddon={
				!mediaStorageEnabled ? (
					<span className="text-xs font-normal text-text-3">
						{t("未开启本地存储，外链将保持不变")}
					</span>
				) : null
			}
			saveText={t("保存")}
			savingText={t("保存中...")}
			isSaving={saving}
			previewImageUrl={editPreviewTopImageUrl || fallbackTopImageUrl || ""}
			previewImageAlt={editTitle}
			previewHtml={normalizeMediaHtml(renderSafeMarkdown(editContent || "", {
				enableMediaEmbed: true,
			}))}
		/>
	);
}

export default ArticleEditModal;
