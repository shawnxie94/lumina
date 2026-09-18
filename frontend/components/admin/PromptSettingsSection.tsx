import type {
	ChangeEvent,
	Dispatch,
	RefObject,
	SetStateAction,
} from "react";
import Button from "@/components/Button";
import CheckboxInput from "@/components/ui/CheckboxInput";
import FormField from "@/components/ui/FormField";
import IconButton from "@/components/IconButton";
import ModalShell from "@/components/ui/ModalShell";
import SectionToggleButton from "@/components/ui/SectionToggleButton";
import SelectableButton from "@/components/ui/SelectableButton";
import SelectField from "@/components/ui/SelectField";
import StatusTag from "@/components/ui/StatusTag";
import TextArea from "@/components/ui/TextArea";
import TextInput from "@/components/ui/TextInput";
import { IconCopy, IconEdit, IconEye, IconTrash } from "@/components/icons";
import type { Category } from "@/components/admin/CategoriesSection";
import type { PromptConfig } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

export type PromptType =
	| "summary"
	| "translation"
	| "outline"
	| "quotes"
	| "content_cleaning"
	| "classification"
	| "digest_prefill";

export const createEmptyPromptFormData = (
	type: PromptType,
): {
	name: string;
	category_id: string;
	type: PromptType;
	prompt: string;
	system_prompt: string;
	temperature: string;
	max_tokens: string;
	top_p: string;
	chunk_size_tokens: string;
	chunk_overlap_tokens: string;
	max_continue_rounds: string;
	model_api_config_id: string;
	is_enabled: boolean;
	is_default: boolean;
} => ({
	name: "",
	category_id: "",
	type,
	prompt: "",
	system_prompt: "",
	temperature: "",
	max_tokens: "",
	top_p: "",
	chunk_size_tokens: "",
	chunk_overlap_tokens: "",
	max_continue_rounds: "",
	model_api_config_id: "",
	is_enabled: true,
	is_default: false,
});

const PROMPT_TYPES = [
	{ value: "content_cleaning" as PromptType, labelKey: "清洗" },
	{ value: "classification" as PromptType, labelKey: "分类" },
	{ value: "summary" as PromptType, labelKey: "摘要" },
	{ value: "translation" as PromptType, labelKey: "翻译" },
	{ value: "outline" as PromptType, labelKey: "大纲" },
	{ value: "quotes" as PromptType, labelKey: "金句" },
	{ value: "digest_prefill" as PromptType, labelKey: "批注" },
];

export const supportsChunkOptionsForPromptType = (
	promptType: string | null | undefined,
): boolean => {
	return promptType === "content_cleaning" || promptType === "translation";
};

type PromptSettingsSectionProps = {
	categories: Category[];
	handleCreatePromptNew: () => void;
	handleDeletePrompt: (id: string) => Promise<void>;
	handleDuplicatePrompt: (config: PromptConfig) => void;
	handleEditPrompt: (config: PromptConfig) => void;
	handleExportPromptConfigs: (scope: "current" | "all") => void;
	handleImportPromptConfigs: (
		event: ChangeEvent<HTMLInputElement>,
	) => Promise<void>;
	handleSavePrompt: () => Promise<void>;
	promptConfigs: PromptConfig[];
	promptFormData: ReturnType<typeof createEmptyPromptFormData>;
	promptImportInputRef: RefObject<HTMLInputElement>;
	promptImporting: boolean;
	promptLoading: boolean;
	promptModalMode: "create" | "edit" | "duplicate";
	promptModelOptions: { value: string; label: string }[];
	promptSaving: boolean;
	promptTypeSupportsChunkOptions: boolean;
	selectedPromptType: PromptType;
	setPromptFormData: Dispatch<
		SetStateAction<ReturnType<typeof createEmptyPromptFormData>>
	>;
	setSelectedPromptType: Dispatch<SetStateAction<PromptType>>;
	setShowPromptAdvanced: Dispatch<SetStateAction<boolean>>;
	setShowPromptModal: Dispatch<SetStateAction<boolean>>;
	setShowPromptPreview: Dispatch<SetStateAction<PromptConfig | null>>;
	showPromptAdvanced: boolean;
	showPromptModal: boolean;
	showPromptPreview: PromptConfig | null;
};

export default function PromptSettingsSection({
	categories,
	handleCreatePromptNew,
	handleDeletePrompt,
	handleDuplicatePrompt,
	handleEditPrompt,
	handleExportPromptConfigs,
	handleImportPromptConfigs,
	handleSavePrompt,
	promptConfigs,
	promptFormData,
	promptImportInputRef,
	promptImporting,
	promptLoading,
	promptModalMode,
	promptModelOptions,
	promptSaving,
	promptTypeSupportsChunkOptions,
	selectedPromptType,
	setPromptFormData,
	setSelectedPromptType,
	setShowPromptAdvanced,
	setShowPromptModal,
	setShowPromptPreview,
	showPromptAdvanced,
	showPromptModal,
	showPromptPreview,
}: PromptSettingsSectionProps) {
	const { t } = useI18n();

	return (
		<>
		<div className="bg-surface rounded-sm shadow-sm border border-border p-6 w-full min-w-0">
			<div className="mb-6 flex flex-wrap items-start justify-between gap-3">
				<div className="space-y-1">
					<h2 className="text-lg font-semibold text-text-1">
						{t("提示词配置列表")}
					</h2>
				</div>
				<div className="flex flex-wrap items-center gap-2">
					<Button
						onClick={() => handleExportPromptConfigs("current")}
						variant="secondary"
						size="sm"
					>
						{t("导出当前")}
					</Button>
					<Button
						onClick={() => handleExportPromptConfigs("all")}
						variant="secondary"
						size="sm"
					>
						{t("导出全部")}
					</Button>
					<Button
						onClick={() => promptImportInputRef.current?.click()}
						variant="secondary"
						size="sm"
						loading={promptImporting}
						disabled={promptImporting}
					>
						{t("导入")}
					</Button>
					<Button onClick={handleCreatePromptNew} variant="primary">
						+ {t("创建配置")}
					</Button>
				</div>
			</div>

			<TextInput
				ref={promptImportInputRef}
				type="file"
				accept="application/json"
				className="hidden"
				onChange={handleImportPromptConfigs}
				disabled={promptImporting}
			/>

			<div className="flex gap-2 mb-6">
				{PROMPT_TYPES.map((type) => (
					<SelectableButton
						key={type.value}
						onClick={() => setSelectedPromptType(type.value)}
						active={selectedPromptType === type.value}
						variant="pill"
					>
						{t(type.labelKey)}
					</SelectableButton>
				))}
			</div>

			{promptLoading ? (
				<div className="rounded-sm border border-border bg-muted px-4 py-8 text-center text-sm text-text-3">
					{t("加载中...")}
				</div>
			) : promptConfigs.filter((c) => c.type === selectedPromptType)
					.length === 0 ? (
				<div className="rounded-sm border border-border bg-muted px-4 py-8 text-center text-sm text-text-3">
					<div className="mb-4">
						{t("暂无")}
						{t(
							PROMPT_TYPES.find(
								(t) => t.value === selectedPromptType,
							)?.labelKey || "",
						)}
						{t("配置")}
					</div>
					<Button onClick={handleCreatePromptNew} variant="primary">
						{t("创建配置")}
					</Button>
				</div>
			) : (
				<div className="space-y-4">
					{[...promptConfigs]
						.filter((c) => c.type === selectedPromptType)
						.sort(
							(a, b) =>
								(b.is_default ? 1 : 0) - (a.is_default ? 1 : 0),
						)
						.map((config) => (
							<div
								key={config.id}
								className="border rounded-lg p-4 hover:shadow-md transition"
							>
								<div className="flex items-start justify-between mb-3">
									<div className="flex-1">
										<div className="flex items-center gap-2 mb-2">
											<h3 className="font-semibold text-text-1">
												{config.name}
											</h3>
											{config.is_default && (
												<StatusTag tone="info" className="ml-2">
													{t("默认")}
												</StatusTag>
											)}
											<StatusTag
												tone={
													config.is_enabled ? "success" : "neutral"
												}
											>
												{config.is_enabled ? t("启用") : t("禁用")}
											</StatusTag>
										</div>

										<div className="space-y-1 text-sm text-text-2">
											<div>
												<span className="font-medium">
													{t("分类")}：
												</span>
												<StatusTag tone="neutral">
													{config.category_name || t("通用")}
												</StatusTag>
											</div>
											{config.model_api_config_name && (
												<div>
													<span className="font-medium">
														{t("关联模型API")}：
													</span>
													<span>
														{config.model_api_config_name}
													</span>
												</div>
											)}
											{config.system_prompt && (
												<div>
													<span className="font-medium">
														{t("系统提示词")}：
													</span>
													<code className="px-2 py-1 bg-muted rounded text-xs block mt-1 max-h-20 overflow-y-auto">
														{config.system_prompt.slice(0, 100)}
														{config.system_prompt.length > 100
															? "..."
															: ""}
													</code>
												</div>
											)}
											<div>
												<span className="font-medium">
													{t("任务要求")}：
												</span>
												<code className="px-2 py-1 bg-muted rounded text-xs block mt-1 max-h-20 overflow-y-auto">
													{config.prompt.slice(0, 100)}
													{config.prompt.length > 100 ? "..." : ""}
												</code>
											</div>
											{(config.system_prompt ||
												config.temperature != null ||
												config.max_tokens != null ||
												config.top_p != null ||
												(supportsChunkOptionsForPromptType(config.type) &&
													(config.chunk_size_tokens != null ||
														config.chunk_overlap_tokens != null ||
														config.max_continue_rounds != null))) && (
												<div className="flex flex-wrap gap-2 pt-1">
													{config.temperature != null && (
														<StatusTag tone="neutral">
															{t("温度")}: {config.temperature}
														</StatusTag>
													)}
													{config.max_tokens != null && (
														<StatusTag tone="neutral">
															{t("最大 Tokens")}:{" "}
															{config.max_tokens}
														</StatusTag>
													)}
													{config.top_p != null && (
														<StatusTag tone="neutral">
															Top P: {config.top_p}
														</StatusTag>
													)}
													{supportsChunkOptionsForPromptType(config.type) &&
														config.chunk_size_tokens != null && (
														<StatusTag tone="neutral">
															{t("分块大小")}: {config.chunk_size_tokens}
														</StatusTag>
													)}
													{supportsChunkOptionsForPromptType(config.type) &&
														config.chunk_overlap_tokens != null && (
														<StatusTag tone="neutral">
															{t("分块重叠")}:{" "}
															{config.chunk_overlap_tokens}
														</StatusTag>
													)}
													{supportsChunkOptionsForPromptType(config.type) &&
														config.max_continue_rounds != null && (
														<StatusTag tone="neutral">
															{t("续写轮次")}:{" "}
															{config.max_continue_rounds}
														</StatusTag>
													)}
												</div>
											)}
										</div>
									</div>

									<div className="flex gap-1">
										<IconButton
											onClick={() => setShowPromptPreview(config)}
											variant="primary"
											size="sm"
											title={t("预览")}
										>
											<IconEye className="h-4 w-4" />
										</IconButton>
										<IconButton
											onClick={() => handleDuplicatePrompt(config)}
											variant="primary"
											size="sm"
											title={t("复制")}
										>
											<IconCopy className="h-4 w-4" />
										</IconButton>
										<IconButton
											onClick={() => handleEditPrompt(config)}
											variant="primary"
											size="sm"
											title={t("编辑")}
										>
											<IconEdit className="h-4 w-4" />
										</IconButton>
										<IconButton
											onClick={() => handleDeletePrompt(config.id)}
											variant="danger"
											size="sm"
											title={t("删除")}
										>
											<IconTrash className="h-4 w-4" />
										</IconButton>
									</div>
								</div>
							</div>
						))}
				</div>
			)}
		</div>
		{showPromptModal && (
			<ModalShell
				isOpen={showPromptModal}
				onClose={() => setShowPromptModal(false)}
				title={
					promptModalMode === "edit"
						? t("编辑提示词配置")
						: promptModalMode === "duplicate"
							? t("复制提示词配置")
							: t("创建新提示词配置")
				}
				widthClassName="max-w-2xl"
				panelClassName="max-h-[90vh] overflow-y-auto"
				headerClassName="border-b border-border p-6"
				bodyClassName="space-y-4 p-6"
				footerClassName="border-t border-border bg-muted p-6"
				footer={
					<div className="flex justify-end gap-2">
						<Button
							onClick={() => setShowPromptModal(false)}
							variant="secondary"
						>
							{t("取消")}
						</Button>
						<Button
							onClick={handleSavePrompt}
							variant="primary"
							loading={promptSaving}
							disabled={promptSaving}
						>
							{promptModalMode === "edit" ? t("保存") : t("创建")}
						</Button>
					</div>
				}
			>
				<FormField label={t("配置名称")} required>
					<TextInput
						type="text"
						value={promptFormData.name}
						onChange={(e) =>
							setPromptFormData({
								...promptFormData,
								name: e.target.value,
							})
						}
						placeholder={t("文章摘要任务要求")}
						required
					/>
				</FormField>

				<FormField label={t("分类")}>
					<SelectField
						value={promptFormData.category_id}
						onChange={(value) =>
							setPromptFormData({
								...promptFormData,
								category_id: value,
							})
						}
						className="w-full"
						popupClassName="select-modern-dropdown"
						options={[
							{ value: "", label: t("通用") },
							...categories.map((cat) => ({
								value: cat.id,
								label: cat.name,
							})),
						]}
					/>
				</FormField>

				<FormField label={t("系统提示词")} required>
					<TextArea
						value={promptFormData.system_prompt}
						onChange={(e) =>
							setPromptFormData({
								...promptFormData,
								system_prompt: e.target.value,
							})
						}
						rows={4}
						placeholder={t(
							"系统级约束，例如：你是一个严谨的内容分析助手...",
						)}
						required
					/>
				</FormField>

				<FormField label={t("任务要求")} required>
					<TextArea
						value={promptFormData.prompt}
						onChange={(e) =>
							setPromptFormData({
								...promptFormData,
								prompt: e.target.value,
							})
						}
						rows={6}
						placeholder={t("请描述生成目标、质量标准和写作要求...")}
						required
					/>
				</FormField>

				<div className="rounded-lg border border-border">
					<SectionToggleButton
						label={t("高级设置（可选）")}
						expanded={showPromptAdvanced}
						onToggle={() => setShowPromptAdvanced(!showPromptAdvanced)}
						expandedIndicator={t("收起")}
						collapsedIndicator={t("展开")}
					/>
					{showPromptAdvanced && (
						<div className="space-y-4 border-t border-border p-4">
							<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
								<FormField label={t("温度")}>
									<TextInput
										type="number"
										step="0.1"
										min="0"
										max="2"
										value={promptFormData.temperature}
										onChange={(e) =>
											setPromptFormData({
												...promptFormData,
												temperature: e.target.value,
											})
										}
										placeholder={t("0.7")}
									/>
								</FormField>

								<FormField label={t("最大 Tokens")}>
									<TextInput
										type="number"
										min="1"
										value={promptFormData.max_tokens}
										onChange={(e) =>
											setPromptFormData({
												...promptFormData,
												max_tokens: e.target.value,
											})
										}
										placeholder={t("1200")}
									/>
								</FormField>

								<FormField label="Top P">
									<TextInput
										type="number"
										step="0.1"
										min="0"
										max="1"
										value={promptFormData.top_p}
										onChange={(e) =>
											setPromptFormData({
												...promptFormData,
												top_p: e.target.value,
											})
										}
										placeholder={t("1.0")}
									/>
								</FormField>
							</div>

							{promptTypeSupportsChunkOptions && (
								<div className="rounded-lg border border-border p-3">
									<div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
										<FormField label={t("分块大小")}>
											<TextInput
												type="number"
												min="1"
												value={promptFormData.chunk_size_tokens}
												onChange={(e) =>
													setPromptFormData({
														...promptFormData,
														chunk_size_tokens: e.target.value,
													})
												}
												placeholder={t("例如 12000")}
											/>
										</FormField>
										<FormField label={t("分块重叠")}>
											<TextInput
												type="number"
												min="0"
												value={promptFormData.chunk_overlap_tokens}
												onChange={(e) =>
													setPromptFormData({
														...promptFormData,
														chunk_overlap_tokens: e.target.value,
													})
												}
												placeholder={t("例如 800")}
											/>
										</FormField>
										<FormField label={t("最多续写轮次")}>
											<TextInput
												type="number"
												min="0"
												value={promptFormData.max_continue_rounds}
												onChange={(e) =>
													setPromptFormData({
														...promptFormData,
														max_continue_rounds: e.target.value,
													})
												}
												placeholder={t("例如 2")}
											/>
										</FormField>
									</div>
									<p className="mt-2 text-xs text-text-3">
										{t(
											"该三项需同时填写；并且关联模型需配置上下文窗口与输出预留，否则后端会拒绝保存。",
										)}
									</p>
										</div>
							)}
						</div>
					)}
				</div>

				<FormField label={t("关联模型API配置（可选）")}>
					<SelectField
						value={promptFormData.model_api_config_id}
						onChange={(value) =>
							setPromptFormData({
								...promptFormData,
								model_api_config_id: value,
							})
						}
						className="w-full"
						popupClassName="select-modern-dropdown"
						options={[
							{ value: "", label: t("使用默认") },
							...promptModelOptions,
						]}
					/>
				</FormField>

				<div className="flex items-center gap-4">
					<label className="flex flex-wrap items-center gap-2">
						<CheckboxInput
							checked={promptFormData.is_enabled}
							onChange={(e) =>
								setPromptFormData({
									...promptFormData,
									is_enabled: e.target.checked,
								})
							}
						/>
						<span className="text-sm text-text-2">{t("启用此配置")}</span>
					</label>

					<label className="flex flex-wrap items-center gap-2">
						<CheckboxInput
							checked={promptFormData.is_default}
							onChange={(e) =>
								setPromptFormData({
									...promptFormData,
									is_default: e.target.checked,
								})
							}
						/>
						<span className="text-sm text-text-2">{t("设为默认配置")}</span>
					</label>
				</div>
		</ModalShell>
	)}
		{showPromptPreview && (
				<ModalShell
					isOpen={Boolean(showPromptPreview)}
					onClose={() => setShowPromptPreview(null)}
					title={`${t("提示词预览")} - ${showPromptPreview.name}`}
					widthClassName="max-w-2xl"
					panelClassName="max-h-[90vh] overflow-y-auto"
					headerClassName="border-b border-border p-6"
					bodyClassName="space-y-4 p-6"
					footerClassName="border-t border-border bg-muted p-6"
					footer={
						<div className="flex justify-end gap-2">
							<Button
								onClick={() => {
									handleDuplicatePrompt(showPromptPreview);
									setShowPromptPreview(null);
								}}
								variant="secondary"
							>
								{t("复制为新配置")}
							</Button>
							<Button
								onClick={() => {
									handleEditPrompt(showPromptPreview);
									setShowPromptPreview(null);
								}}
								variant="primary"
							>
								{t("编辑此配置")}
							</Button>
							<Button
								onClick={() => setShowPromptPreview(null)}
								variant="secondary"
							>
								{t("关闭")}
							</Button>
						</div>
					}
				>
					<div className="flex flex-wrap gap-2">
						<StatusTag tone="info" size="sm">
							{(() => {
								const promptType = PROMPT_TYPES.find(
									(item) => item.value === showPromptPreview.type,
								);
								return promptType?.labelKey
									? t(promptType.labelKey)
									: showPromptPreview.type;
							})()}
						</StatusTag>
						<StatusTag tone="neutral" size="sm">
							{t("分类")}: {showPromptPreview.category_name || t("通用")}
						</StatusTag>
						{showPromptPreview.model_api_config_name && (
							<StatusTag tone="info" size="sm">
								{t("模型")}: {showPromptPreview.model_api_config_name}
							</StatusTag>
						)}
					</div>

					<div>
						<label className="mb-2 block text-sm font-medium text-text-2">
							{t("系统提示词")}
						</label>
						<pre className="w-full rounded-lg border border-border bg-muted p-4 text-sm text-text-1 whitespace-pre-wrap font-mono">
							{showPromptPreview.system_prompt || t("未设置（必填）")}
						</pre>
					</div>

					<div>
						<label className="mb-2 block text-sm font-medium text-text-2">
							{t("提示词")}
						</label>
						<pre className="w-full rounded-lg border border-border bg-muted p-4 text-sm text-text-1 whitespace-pre-wrap font-mono">
							{showPromptPreview.prompt}
						</pre>
					</div>

					<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
						<div className="rounded-lg border border-border bg-muted p-3 text-sm text-text-2">
							<div className="text-xs text-text-3">{t("温度")}</div>
							<div>{showPromptPreview.temperature ?? t("默认")}</div>
						</div>
						<div className="rounded-lg border border-border bg-muted p-3 text-sm text-text-2">
							<div className="text-xs text-text-3">{t("最大 Tokens")}</div>
							<div>{showPromptPreview.max_tokens ?? t("默认")}</div>
						</div>
						<div className="rounded-lg border border-border bg-muted p-3 text-sm text-text-2">
							<div className="text-xs text-text-3">Top P</div>
							<div>{showPromptPreview.top_p ?? t("默认")}</div>
						</div>
						{supportsChunkOptionsForPromptType(showPromptPreview.type) && (
							<>
								<div className="rounded-lg border border-border bg-muted p-3 text-sm text-text-2">
									<div className="text-xs text-text-3">{t("分块大小")}</div>
									<div>{showPromptPreview.chunk_size_tokens ?? t("默认")}</div>
								</div>
								<div className="rounded-lg border border-border bg-muted p-3 text-sm text-text-2">
									<div className="text-xs text-text-3">{t("分块重叠")}</div>
									<div>
										{showPromptPreview.chunk_overlap_tokens ?? t("默认")}
									</div>
								</div>
								<div className="rounded-lg border border-border bg-muted p-3 text-sm text-text-2">
									<div className="text-xs text-text-3">
										{t("最多续写轮次")}
									</div>
									<div>
										{showPromptPreview.max_continue_rounds ?? t("默认")}
									</div>
								</div>
							</>
						)}
					</div>
				</ModalShell>
			)}
		</>
	);
}
