import type {
	ChangeEvent,
	ClipboardEvent,
	Dispatch,
	RefObject,
	SetStateAction,
} from "react";

import Button from "@/components/Button";
import IconButton from "@/components/IconButton";
import FormField from "@/components/ui/FormField";
import TextArea from "@/components/ui/TextArea";
import TextInput from "@/components/ui/TextInput";
import { IconEdit, IconLink } from "@/components/icons";
import type { ReviewIssue } from "@/lib/api";
import {
	formatEditorDraftTime,
	type ColumnEditorDraftPayload,
} from "@/lib/editorDraft";
import { useI18n } from "@/lib/i18n";
import { syncScrollPosition } from "@/lib/reviewDetail";

export interface ColumnDraftHintState {
	updatedAt: number;
	payload: ColumnEditorDraftPayload;
}

interface ColumnEditPanelProps {
	review: ReviewIssue;
	title: string;
	setTitle: Dispatch<SetStateAction<string>>;
	publishedAt: string;
	setPublishedAt: Dispatch<SetStateAction<string>>;
	topImage: string;
	setTopImage: Dispatch<SetStateAction<string>>;
	markdownContent: string;
	saving: boolean;
	columnDraftHint: ColumnDraftHintState | null;
	columnDraftSavedAt: number | null;
	setColumnDraftHint: Dispatch<SetStateAction<ColumnDraftHintState | null>>;
	setColumnDraftSavedAt: Dispatch<SetStateAction<number | null>>;
	clearColumnEditorDraftState: () => void;
	applyColumnEditorDraft: (draft: ColumnEditorDraftPayload) => void;
	showToast: (message: string, type?: "success" | "error" | "info") => void;
	closeEditMode: () => void;
	handleSave: () => Promise<void>;
	mediaStorageEnabled: boolean;
	mediaStorageLoading: boolean;
	mediaUploading: boolean;
	editContentRef: RefObject<HTMLTextAreaElement>;
	previewRef: RefObject<HTMLDivElement>;
	handleTopImagePaste: (event: ClipboardEvent<HTMLInputElement>) => void;
	handleConvertTopImage: () => Promise<void>;
	handleBatchConvertMarkdownImages: () => Promise<void>;
	handleMarkdownContentChange: (event: ChangeEvent<HTMLTextAreaElement>) => void;
	handleEditPaste: (event: ClipboardEvent<HTMLTextAreaElement>) => Promise<void>;
	rememberEditorSelection: (target: HTMLTextAreaElement) => void;
	editPreviewTopImageUrl: string;
	fallbackTopImageUrl: string;
	editPreviewHtml: string;
}

function ColumnEditPanel({
	review,
	title,
	setTitle,
	publishedAt,
	setPublishedAt,
	topImage,
	setTopImage,
	markdownContent,
	saving,
	columnDraftHint,
	columnDraftSavedAt,
	setColumnDraftHint,
	setColumnDraftSavedAt,
	clearColumnEditorDraftState,
	applyColumnEditorDraft,
	showToast,
	closeEditMode,
	handleSave,
	mediaStorageEnabled,
	mediaStorageLoading,
	mediaUploading,
	editContentRef,
	previewRef,
	handleTopImagePaste,
	handleConvertTopImage,
	handleBatchConvertMarkdownImages,
	handleMarkdownContentChange,
	handleEditPaste,
	rememberEditorSelection,
	editPreviewTopImageUrl,
	fallbackTopImageUrl,
	editPreviewHtml,
}: ColumnEditPanelProps) {
	const { t, language } = useI18n();

	return (
		<section className="overflow-hidden bg-surface">
			<div className="border-b border-border px-5 py-3 sm:px-6">
				<div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
					<div className="flex min-w-0 flex-1 flex-wrap items-center gap-3">
						<h2 className="inline-flex shrink-0 items-center gap-2 text-lg font-semibold text-text-1">
							<IconEdit className="h-4 w-4" />
							<span>{t("编辑专栏文章")}</span>
						</h2>
						{(columnDraftHint || columnDraftSavedAt) ? (
							<div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2">
								{columnDraftHint ? (
									<>
										<span className="min-w-0 text-xs text-text-3 sm:text-sm">
											{t("发现未保存的本地草稿")}
											{` · ${formatEditorDraftTime(columnDraftHint.updatedAt, language)}`}
										</span>
										<div className="flex items-center gap-2">
											<Button
												variant="secondary"
												size="sm"
												onClick={() => {
													clearColumnEditorDraftState();
													showToast(t("已丢弃本地草稿"));
												}}
											>
												{t("丢弃本地草稿")}
											</Button>
											<Button
												variant="primary"
												size="sm"
												onClick={() => {
													applyColumnEditorDraft(columnDraftHint.payload);
													setColumnDraftSavedAt(columnDraftHint.updatedAt);
													setColumnDraftHint(null);
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
										{columnDraftSavedAt
											? ` · ${formatEditorDraftTime(columnDraftSavedAt, language)}`
											: ""}
									</span>
								)}
							</div>
						) : null}
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
										{t("支持单篇文章占位符 {{article_slug}}，可在正文中通过 /ref 插入引用。")}
									</span>
									<span className="text-xs font-normal text-text-3">
										{t("输入 /ref 可打开引用插入。")}
									</span>
									{!mediaStorageEnabled ? (
										<span className="text-xs font-normal text-text-3">
										{t("未开启本地存储，外链将保持不变")}
									</span>
								) : null}
							</div>
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
								ref={editContentRef}
								rows={26}
								value={markdownContent}
								onChange={handleMarkdownContentChange}
								onPaste={handleEditPaste}
								onClick={(event) => rememberEditorSelection(event.currentTarget)}
								onKeyUp={(event) => rememberEditorSelection(event.currentTarget)}
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
	);
}

export default ColumnEditPanel;
