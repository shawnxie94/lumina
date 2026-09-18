import type { Dispatch, SetStateAction } from "react";
import Button from "@/components/Button";
import CheckboxInput from "@/components/ui/CheckboxInput";
import FormField from "@/components/ui/FormField";
import IconButton from "@/components/IconButton";
import ModalShell from "@/components/ui/ModalShell";
import SectionToggleButton from "@/components/ui/SectionToggleButton";
import SelectField from "@/components/ui/SelectField";
import StatusTag from "@/components/ui/StatusTag";
import TextArea from "@/components/ui/TextArea";
import TextInput from "@/components/ui/TextInput";
import {
	IconCopy,
	IconEdit,
	IconLink,
	IconList,
	IconTrash,
} from "@/components/icons";
import type { ModelAPIConfig } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { formatPrice } from "@/components/admin/formatting";

const CURRENCY_OPTIONS = [
	{ value: "", labelKey: "默认" },
	{ value: "USD", labelKey: "美元 (USD)" },
	{ value: "CNY", labelKey: "人民币 (CNY)" },
	{ value: "HKD", labelKey: "港币 (HKD)" },
	{ value: "EUR", labelKey: "欧元 (EUR)" },
	{ value: "JPY", labelKey: "日元 (JPY)" },
];

const MODEL_API_TYPE_OPTIONS = [
	{ value: "chat_completions" as const, label: "Chat Completions API" },
	{ value: "responses" as const, label: "Responses API" },
];

const formatModelAPITypeLabel = (apiType: string | null | undefined) => {
	if (apiType === "responses") {
		return "Responses API";
	}
	return "Chat Completions API";
};

type ModelApiFormData = {
	name: string;
	base_url: string;
	api_key: string;
	provider: string;
	model_name: string;
	model_type: string;
	api_type: "chat_completions" | "responses";
	thinking_level:
		| "disabled"
		| "auto"
		| "low"
		| "medium"
		| "high"
		| "adaptive";
	price_input_per_1k: string;
	price_output_per_1k: string;
	currency: string;
	context_window_tokens: string;
	reserve_output_tokens: string;
	is_enabled: boolean;
	is_default: boolean;
};

type ModelApiSettingsSectionProps = {
	modelLoading: boolean;
	filteredModelAPIConfigs: ModelAPIConfig[];
	modelCategory: "general" | "vector";
	showModelAPIModal: boolean;
	setShowModelAPIModal: Dispatch<SetStateAction<boolean>>;
	editingModelAPIConfig: ModelAPIConfig | null;
	modelAPIFormData: ModelApiFormData;
	setModelAPIFormData: Dispatch<SetStateAction<ModelApiFormData>>;
	modelAPISaving: boolean;
	modelOptions: string[];
	modelOptionsLoading: boolean;
	modelOptionsError: string;
	modelNameManual: boolean;
	setModelNameManual: Dispatch<SetStateAction<boolean>>;
	showModelAPIAdvanced: boolean;
	setShowModelAPIAdvanced: Dispatch<SetStateAction<boolean>>;
	showModelAPITestModal: boolean;
	setShowModelAPITestModal: Dispatch<SetStateAction<boolean>>;
	modelAPITestConfig: ModelAPIConfig | null;
	modelAPITestPrompt: string;
	setModelAPITestPrompt: Dispatch<SetStateAction<string>>;
	modelAPITestResult: string;
	modelAPITestRaw: string;
	modelAPITestError: string;
	modelAPITestLoading: boolean;
	handleCreateModelAPINew: () => void;
	handleTestModelAPI: (config: ModelAPIConfig) => void;
	handleEditModelAPI: (config: ModelAPIConfig) => void;
	handleDeleteModelAPI: (id: string) => Promise<void>;
	handleSaveModelAPI: () => Promise<void>;
	handleRunModelAPITest: () => Promise<void>;
	handleCopyMaskedValue: (value: string) => Promise<void>;
};

export default function ModelApiSettingsSection({
	modelLoading,
	filteredModelAPIConfigs,
	modelCategory,
	showModelAPIModal,
	setShowModelAPIModal,
	editingModelAPIConfig,
	modelAPIFormData,
	setModelAPIFormData,
	modelAPISaving,
	modelOptions,
	modelOptionsLoading,
	modelOptionsError,
	modelNameManual,
	setModelNameManual,
	showModelAPIAdvanced,
	setShowModelAPIAdvanced,
	showModelAPITestModal,
	setShowModelAPITestModal,
	modelAPITestConfig,
	modelAPITestPrompt,
	setModelAPITestPrompt,
	modelAPITestResult,
	modelAPITestRaw,
	modelAPITestError,
	modelAPITestLoading,
	handleCreateModelAPINew,
	handleTestModelAPI,
	handleEditModelAPI,
	handleDeleteModelAPI,
	handleSaveModelAPI,
	handleRunModelAPITest,
	handleCopyMaskedValue,
}: ModelApiSettingsSectionProps) {
	const { t } = useI18n();

	return (
		<>
			{modelLoading ? (
			<div className="rounded-sm border border-border bg-muted px-4 py-8 text-center text-sm text-text-3">
				{t("加载中...")}
			</div>
			) : filteredModelAPIConfigs.length === 0 ? (
			<div className="rounded-sm border border-border bg-muted px-4 py-8 text-center text-sm text-text-3">
				<div className="mb-4">
					{t("暂无")}
					{t(modelCategory === "vector" ? "向量" : "通用")}
					{t("模型配置")}
				</div>
				<Button
					onClick={handleCreateModelAPINew}
					variant="primary"
				>
					{t("创建配置")}
				</Button>
			</div>
			) : (
			<div className="space-y-4">
				{[...filteredModelAPIConfigs]
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
												{t("名称")}：
											</span>
											<span>{config.name}</span>
										</div>
										<div>
											<span className="font-medium">
												{t("API地址")}：
											</span>
											<code className="px-2 py-1 bg-muted rounded text-xs">
												{config.base_url}
											</code>
										</div>
										<div>
											<span className="font-medium">
												{t("模型名称")}：
											</span>
											<code className="px-2 py-1 bg-muted rounded text-xs">
												{config.model_name}
											</code>
										</div>
										<div>
											<span className="font-medium">
												{t("模型类型")}：
											</span>
											<span>
												{config.model_type || "general"}
											</span>
										</div>
										<div>
											<span className="font-medium">
												{t("API类型")}：
											</span>
											<span>
												{formatModelAPITypeLabel(config.api_type)}
											</span>
										</div>
										{(config.model_type || "general") !==
											"vector" && (
											<>
												<div>
													<span className="font-medium">
														{t("计费")}：
													</span>
													<span>
														{t("输入")}{" "}
														{formatPrice(config.price_input_per_1k)}
														/ {t("输出")}{" "}
														{formatPrice(
															config.price_output_per_1k,
														)}
														{config.currency
															? ` ${config.currency}`
															: ""}
													</span>
												</div>
												{(config.context_window_tokens != null ||
													config.reserve_output_tokens != null) && (
													<div>
														<span className="font-medium">
															{t("上下文预算")}：
														</span>
														<span>
															{config.context_window_tokens != null
																? `${t("窗口")} ${config.context_window_tokens}`
																: `${t("窗口")} -`}
															{" / "}
															{config.reserve_output_tokens != null
																? `${t("预留")} ${config.reserve_output_tokens}`
																: `${t("预留")} -`}
														</span>
													</div>
												)}
											</>
										)}
										<div>
											<span className="font-medium">
												{t("API密钥")}：
											</span>
											<code className="px-2 py-1 bg-muted rounded text-xs">
												{config.api_key.slice(0, 8)}***
											</code>
										</div>
									</div>
								</div>

								<div className="flex gap-1">
									<IconButton
										onClick={() => handleTestModelAPI(config)}
										variant="primary"
										size="sm"
										title={t("测试连接")}
									>
										<IconLink className="h-4 w-4" />
									</IconButton>
									<IconButton
										onClick={() => handleEditModelAPI(config)}
										variant="primary"
										size="sm"
										title={t("编辑")}
									>
										<IconEdit className="h-4 w-4" />
									</IconButton>
									<IconButton
										onClick={() =>
											handleDeleteModelAPI(config.id)
										}
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
		{showModelAPIModal && (
			<ModalShell
				isOpen={showModelAPIModal}
				onClose={() => setShowModelAPIModal(false)}
				title={
					editingModelAPIConfig
						? t("编辑模型API配置")
						: t("创建新模型API配置")
				}
				widthClassName="max-w-2xl"
				panelClassName="max-h-[90vh] overflow-y-auto"
				headerClassName="border-b border-border p-6"
				bodyClassName="space-y-4 p-6"
				footerClassName="border-t border-border bg-muted p-6"
				footer={
					<div className="flex justify-end gap-2">
						<Button
							onClick={() => setShowModelAPIModal(false)}
							variant="secondary"
						>
							{t("取消")}
						</Button>
						<Button
							onClick={handleSaveModelAPI}
							variant="primary"
							loading={modelAPISaving}
							disabled={modelAPISaving}
						>
							{editingModelAPIConfig ? t("保存") : t("创建")}
						</Button>
					</div>
				}
			>
				<FormField label={t("配置名称")} required>
					<TextInput
						type="text"
						value={modelAPIFormData.name}
						onChange={(e) =>
							setModelAPIFormData({
								...modelAPIFormData,
								name: e.target.value,
							})
						}
						placeholder={t("OpenAI GPT-4o")}
						required
					/>
				</FormField>

				<FormField label={t("API地址（Base URL）")}>
					<TextInput
						type="text"
						value={modelAPIFormData.base_url}
						onChange={(e) =>
							setModelAPIFormData({
								...modelAPIFormData,
								base_url: e.target.value,
							})
						}
						placeholder={t("https://api.openai.com/v1")}
					/>
				</FormField>

				<FormField label={t("服务提供方")}>
					<SelectField
						value={modelAPIFormData.provider}
						onChange={(value) =>
							setModelAPIFormData({
								...modelAPIFormData,
								provider: value,
							})
						}
						className="w-full"
						popupClassName="select-modern-dropdown"
						options={[
							{ value: "openai", label: t("OpenAI 兼容") },
							{ value: "jina", label: "JinaAI" },
						]}
					/>
				</FormField>

				<FormField label={t("思考等级")}>
					<SelectField
						value={modelAPIFormData.thinking_level}
						onChange={(value) =>
							setModelAPIFormData({
								...modelAPIFormData,
								thinking_level: value as typeof modelAPIFormData.thinking_level,
							})
						}
						className="w-full"
						popupClassName="select-modern-dropdown"
						options={[
							{ value: "disabled", label: t("关闭") },
							{ value: "auto", label: t("自动") },
							{ value: "low", label: "Low" },
							{ value: "medium", label: "Medium" },
							{ value: "high", label: "High" },
							{ value: "adaptive", label: "Adaptive" },
						]}
					/>
				</FormField>

				<FormField label={t("API类型")}>
					<SelectField
						value={modelAPIFormData.api_type}
						onChange={(value) =>
							setModelAPIFormData({
								...modelAPIFormData,
								api_type: value as "chat_completions" | "responses",
							})
						}
						className="w-full"
						popupClassName="select-modern-dropdown"
						options={MODEL_API_TYPE_OPTIONS.map((option) => ({
							value: option.value,
							label: option.label,
						}))}
					/>
				</FormField>

				<FormField label={t("API密钥")} required>
					<div className="flex flex-wrap items-center gap-2">
						<TextInput
							type="password"
							value={modelAPIFormData.api_key}
							onChange={(e) =>
								setModelAPIFormData({
									...modelAPIFormData,
									api_key: e.target.value,
								})
							}
							placeholder={t("sk-...")}
							required
							className="flex-1"
						/>
						<IconButton
							type="button"
							onClick={() =>
								handleCopyMaskedValue(modelAPIFormData.api_key)
							}
							variant="secondary"
							size="md"
							title={t("复制")}
							disabled={!modelAPIFormData.api_key}
						>
							<IconCopy className="h-4 w-4" />
						</IconButton>
					</div>
				</FormField>

				<FormField label={t("模型名称")} required>
					{modelNameManual ? (
						<div className="flex items-center gap-2">
							<div className="flex-1 min-w-0">
								<TextInput
									type="text"
									value={modelAPIFormData.model_name}
									onChange={(e) =>
										setModelAPIFormData({
											...modelAPIFormData,
											model_name: e.target.value,
										})
									}
									placeholder={t("手动输入模型名称")}
									required
								/>
							</div>
							<Button
								type="button"
								onClick={() => setModelNameManual(false)}
								variant="secondary"
								size="sm"
								title={t("切换为选择")}
								className="shrink-0"
							>
								<IconList className="h-4 w-4" />
							</Button>
						</div>
					) : (
						<div className="flex items-center gap-2">
							<div className="flex-1 min-w-0">
								<SelectField
									value={modelAPIFormData.model_name || undefined}
									onChange={(value) =>
										setModelAPIFormData({
											...modelAPIFormData,
											model_name: value,
										})
									}
									className="w-full"
									popupClassName="select-modern-dropdown"
									placeholder={t("请选择模型")}
									options={modelOptions.map((model) => ({
										value: model,
										label: model,
									}))}
									loading={modelOptionsLoading}
								/>
							</div>
							<Button
								type="button"
								onClick={() => setModelNameManual(true)}
								variant="secondary"
								size="sm"
								title={t("手动输入")}
								className="shrink-0"
							>
								<IconEdit className="h-4 w-4" />
							</Button>
						</div>
					)}
					{modelOptionsError && (
						<p className="mt-2 text-xs text-danger">{modelOptionsError}</p>
					)}
				</FormField>

				{modelAPIFormData.model_type !== "vector" && (
					<div className="rounded-lg border border-border">
						<SectionToggleButton
							label={t("高级设置（可选）")}
							expanded={showModelAPIAdvanced}
							onToggle={() =>
								setShowModelAPIAdvanced(!showModelAPIAdvanced)
							}
							expandedIndicator={t("收起")}
							collapsedIndicator={t("展开")}
						/>
						{showModelAPIAdvanced && (
							<div className="space-y-4 border-t border-border p-4">
								<div className="grid grid-cols-1 gap-4 md:grid-cols-2">
									<FormField label={t("输入单价（每 1K tokens）")}>
										<TextInput
											type="number"
											step="0.00001"
											value={modelAPIFormData.price_input_per_1k}
											onChange={(e) =>
												setModelAPIFormData({
													...modelAPIFormData,
													price_input_per_1k: e.target.value,
												})
											}
											placeholder={t("0.00000")}
										/>
									</FormField>
									<FormField label={t("输出单价（每 1K tokens）")}>
										<TextInput
											type="number"
											step="0.00001"
											value={modelAPIFormData.price_output_per_1k}
											onChange={(e) =>
												setModelAPIFormData({
													...modelAPIFormData,
													price_output_per_1k: e.target.value,
												})
											}
											placeholder={t("0.00000")}
										/>
									</FormField>
								</div>

									<FormField label={t("币种")}>
										<SelectField
										value={modelAPIFormData.currency || ""}
										onChange={(value) =>
											setModelAPIFormData({
												...modelAPIFormData,
												currency: value,
											})
										}
										className="w-full"
										popupClassName="select-modern-dropdown"
										options={CURRENCY_OPTIONS.map((option) => ({
											...option,
											label: t(option.labelKey),
										}))}
										/>
									</FormField>

									<div className="grid grid-cols-1 gap-4 md:grid-cols-2">
										<FormField label={t("上下文窗口（tokens）")}>
											<TextInput
												type="number"
												min="1"
												value={modelAPIFormData.context_window_tokens}
												onChange={(e) =>
													setModelAPIFormData({
														...modelAPIFormData,
														context_window_tokens: e.target.value,
													})
												}
												placeholder={t("例如 128000")}
											/>
										</FormField>
										<FormField label={t("输出预留（tokens）")}>
											<TextInput
												type="number"
												min="0"
												value={modelAPIFormData.reserve_output_tokens}
												onChange={(e) =>
													setModelAPIFormData({
														...modelAPIFormData,
														reserve_output_tokens: e.target.value,
													})
												}
												placeholder={t("例如 16000")}
											/>
										</FormField>
									</div>
									<p className="text-xs text-text-3">
										{t(
											"留空表示不启用清洗分块预算能力；需与提示词中的分块参数搭配使用。",
										)}
									</p>
								</div>
							)}
						</div>
				)}

				<div className="flex items-center gap-4">
					<label className="flex flex-wrap items-center gap-2">
						<CheckboxInput
							checked={modelAPIFormData.is_enabled}
							onChange={(e) =>
								setModelAPIFormData({
									...modelAPIFormData,
									is_enabled: e.target.checked,
								})
							}
						/>
						<span className="text-sm text-text-2">{t("启用此配置")}</span>
					</label>

					{modelAPIFormData.model_type !== "vector" && (
						<label className="flex flex-wrap items-center gap-2">
							<CheckboxInput
								checked={modelAPIFormData.is_default}
								onChange={(e) =>
									setModelAPIFormData({
										...modelAPIFormData,
										is_default: e.target.checked,
									})
								}
							/>
							<span className="text-sm text-text-2">
								{t("设为默认配置")}
							</span>
						</label>
					)}
				</div>
			</ModalShell>
		)}

		{showModelAPITestModal && (
			<ModalShell
				isOpen={showModelAPITestModal}
				onClose={() => setShowModelAPITestModal(false)}
				title={t("模型连接测试")}
				widthClassName="max-w-2xl"
				panelClassName="max-h-[90vh] overflow-y-auto"
				headerClassName="border-b border-border p-6"
				bodyClassName="space-y-4 p-6"
				footerClassName="border-t border-border bg-muted p-6"
				footer={
					<div className="flex justify-end gap-2">
						<Button
							onClick={() => setShowModelAPITestModal(false)}
							variant="secondary"
						>
							{t("关闭")}
						</Button>
						<Button
							onClick={handleRunModelAPITest}
							variant="primary"
							disabled={modelAPITestLoading}
						>
							{modelAPITestLoading ? t("调用中...") : t("开始测试")}
						</Button>
					</div>
				}
			>
				{modelAPITestConfig && (
					<p className="text-sm text-text-3">
						{modelAPITestConfig.name} · {modelAPITestConfig.model_name}
					</p>
				)}

				<FormField label={t("测试输入")}>
					<TextArea
						value={modelAPITestPrompt}
						onChange={(e) => setModelAPITestPrompt(e.target.value)}
						rows={4}
						placeholder={t("请输入要发送给模型的内容")}
					/>
				</FormField>

				<div>
					<label className="mb-2 block text-sm font-medium text-text-2">
						{t("返回结果")}
					</label>
					<div className="min-h-[120px] w-full rounded-lg border border-border bg-muted p-4 text-sm text-text-1 whitespace-pre-wrap">
						{modelAPITestLoading
							? t("调用中...")
							: modelAPITestError
								? modelAPITestError
								: modelAPITestResult || t("暂无返回")}
					</div>
				</div>

				{modelAPITestError && (
					<div>
						<label className="mb-2 block text-sm font-medium text-text-2">
							{t("原始响应")}
						</label>
						<pre className="max-h-64 w-full overflow-y-auto rounded-lg border border-border bg-muted p-4 text-xs text-text-1 whitespace-pre-wrap">
							{modelAPITestRaw || t("暂无原始响应")}
						</pre>
					</div>
				)}
			</ModalShell>
		)}
		</>
	);
}
