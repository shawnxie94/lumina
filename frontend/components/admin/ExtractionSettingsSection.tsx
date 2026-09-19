import type { Dispatch, SetStateAction } from "react";
import Button from "@/components/Button";
import CheckboxInput from "@/components/ui/CheckboxInput";
import SelectField from "@/components/ui/SelectField";
import TextInput from "@/components/ui/TextInput";
import type { ExtractionSettings } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

export type ExtractionSubSection = "parser" | "post-processing";

type ExtractionSettingsSectionProps = {
	extractionSettings: ExtractionSettings;
	setExtractionSettings: Dispatch<SetStateAction<ExtractionSettings>>;
	extractionSettingsLoading: boolean;
	extractionSettingsSaving: boolean;
	extractionSubSection: ExtractionSubSection;
	handleSaveExtractionSettings: () => Promise<void>;
};

export default function ExtractionSettingsSection({
	extractionSettings,
	setExtractionSettings,
	extractionSettingsLoading,
	extractionSettingsSaving,
	extractionSubSection,
	handleSaveExtractionSettings,
}: ExtractionSettingsSectionProps) {
	const { t } = useI18n();

	return (
		<div className="bg-surface rounded-sm shadow-sm border border-border p-6 w-full min-w-0">
			<div className="mb-6 flex flex-wrap items-start justify-between gap-3">
				<div className="space-y-1">
					<h2 className="text-lg font-semibold text-text-1">
						{extractionSubSection === "parser"
							? t("解析器配置")
							: t("后处理")}
					</h2>
					<p className="text-sm text-text-3">
						{extractionSubSection === "parser"
							? t("配置正文解析优先级和 Jina Reader 调用参数")
							: t("配置文章解析完成后默认触发的自动处理任务")}
					</p>
				</div>
				<Button
					onClick={handleSaveExtractionSettings}
					disabled={extractionSettingsSaving}
					variant="primary"
				>
					{extractionSettingsSaving ? t("保存中") : t("保存配置")}
				</Button>
			</div>

			{extractionSettingsLoading ? (
				<div className="rounded-sm border border-border bg-muted px-4 py-8 text-center text-sm text-text-3">
					{t("加载中")}
				</div>
			) : (
				<div className="space-y-5">
					{extractionSubSection === "parser" && (
						<div className="space-y-5">
							<div>
								<label htmlFor="extraction-prefer-mode" className="block text-sm text-text-2 mb-1">
									{t("解析优先级")}
								</label>
								<SelectField
									id="extraction-prefer-mode"
									value={extractionSettings.jina_reader_prefer_mode}
									onChange={(value) => {
										const preferMode =
											value as ExtractionSettings["jina_reader_prefer_mode"];
										setExtractionSettings((prev) => ({
											...prev,
											jina_reader_prefer_mode: preferMode,
											jina_reader_enabled:
												preferMode !== "local_only",
										}));
									}}
									className="w-full"
									popupClassName="select-modern-dropdown"
									options={[
										{ value: "jina_first", label: t("Jina 优先") },
										{ value: "local_first", label: t("本地优先") },
										{ value: "local_only", label: t("仅本地解析") },
									]}
								/>
							</div>

							<div className="grid grid-cols-1 md:grid-cols-4 gap-4">
								<div>
									<label htmlFor="extraction-jina-base-url" className="block text-sm text-text-2 mb-1">
										{t("Jina Reader 地址")}
									</label>
									<TextInput
										id="extraction-jina-base-url"
										value={extractionSettings.jina_reader_base_url}
										onChange={(e) =>
											setExtractionSettings((prev) => ({
												...prev,
												jina_reader_base_url: e.target.value,
											}))
										}
										placeholder="https://r.jina.ai"
									/>
								</div>
								<div>
									<label htmlFor="extraction-jina-api-key" className="block text-sm text-text-2 mb-1">
										{t("Jina API Key")}
									</label>
									<TextInput
										id="extraction-jina-api-key"
										type="password"
										value={extractionSettings.jina_reader_api_key}
										onChange={(e) =>
											setExtractionSettings((prev) => ({
												...prev,
												jina_reader_api_key: e.target.value,
											}))
										}
										placeholder={t("可选")}
									/>
								</div>
								<div>
									<label htmlFor="extraction-jina-timeout" className="block text-sm text-text-2 mb-1">
										{t("超时秒数")}
									</label>
									<TextInput
										id="extraction-jina-timeout"
										type="number"
										min={3}
										max={60}
										value={extractionSettings.jina_reader_timeout_seconds}
										onChange={(e) =>
											setExtractionSettings((prev) => ({
												...prev,
												jina_reader_timeout_seconds: Math.min(
													60,
													Math.max(3, Number(e.target.value || 15)),
												),
											}))
										}
									/>
								</div>
								<div>
									<label htmlFor="extraction-jina-token-budget" className="block text-sm text-text-2 mb-1">
										{t("Token 上限")}
									</label>
									<TextInput
										id="extraction-jina-token-budget"
										type="number"
										min={0}
										value={extractionSettings.jina_reader_token_budget ?? ""}
										onChange={(e) => {
											const value = Number(e.target.value || 0);
											setExtractionSettings((prev) => ({
												...prev,
												jina_reader_token_budget:
													value > 0 ? value : null,
											}));
										}}
										placeholder={t("不限制")}
									/>
								</div>
							</div>
						</div>
					)}

					{extractionSubSection === "post-processing" && (
						<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
							{[
								["auto_translation_enabled", t("自动翻译")],
								["auto_ai_classification_enabled", t("自动分类")],
								["auto_ai_summary_enabled", t("自动摘要")],
								["auto_ai_outline_enabled", t("自动大纲")],
								["auto_ai_quotes_enabled", t("自动金句")],
							].map(([key, label]) => (
								<label
									key={key}
									htmlFor={`extraction-toggle-${key}`}
									className="flex items-center justify-between rounded-sm border border-border bg-surface px-3 py-2 text-sm text-text-2"
								>
									<span>{label}</span>
									<CheckboxInput
										id={`extraction-toggle-${key}`}
										checked={Boolean(
											extractionSettings[
												key as keyof ExtractionSettings
											],
										)}
										onChange={(e) =>
											setExtractionSettings((prev) => ({
												...prev,
												[key]: e.target.checked,
											}))
										}
										className="h-4 w-4"
									/>
								</label>
							))}
						</div>
					)}
				</div>
			)}
		</div>
	);
}
