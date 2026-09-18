import type { Dispatch, SetStateAction } from "react";
import Button from "@/components/Button";
import CheckboxInput from "@/components/ui/CheckboxInput";
import SelectField from "@/components/ui/SelectField";
import type { ModelAPIConfig, RecommendationSettings } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

type RecommendationSettingsSectionProps = {
	recommendationSettings: RecommendationSettings;
	setRecommendationSettings: Dispatch<SetStateAction<RecommendationSettings>>;
	recommendationSettingsLoading: boolean;
	recommendationSettingsSaving: boolean;
	recommendationEmbeddingRefreshing: boolean;
	modelAPIConfigs: ModelAPIConfig[];
	handleSaveRecommendationSettings: () => Promise<void>;
	handleRefreshRecommendationEmbeddings: () => Promise<void>;
};

export default function RecommendationSettingsSection({
	recommendationSettings,
	setRecommendationSettings,
	recommendationSettingsLoading,
	recommendationSettingsSaving,
	recommendationEmbeddingRefreshing,
	modelAPIConfigs,
	handleSaveRecommendationSettings,
	handleRefreshRecommendationEmbeddings,
}: RecommendationSettingsSectionProps) {
	const { t } = useI18n();

	return (
		<div className="bg-surface rounded-sm shadow-sm border border-border p-6 w-full min-w-0">
			<div className="mb-6 flex flex-wrap items-start justify-between gap-3">
				<div className="space-y-1">
					<h2 className="text-lg font-semibold text-text-1">
						{t("文章推荐配置")}
					</h2>
					<p className="text-sm text-text-3">
						{t("控制相似文章推荐与向量化模型")}
					</p>
				</div>
				<div className="flex flex-wrap items-center gap-2">
					<Button
						onClick={handleRefreshRecommendationEmbeddings}
						disabled={
							recommendationSettingsLoading ||
							recommendationEmbeddingRefreshing ||
							recommendationSettingsSaving ||
							!recommendationSettings.recommendation_model_config_id
						}
						variant="secondary"
					>
						{recommendationEmbeddingRefreshing
							? t("提交中")
							: t("全量刷新向量")}
					</Button>
					<Button
						onClick={handleSaveRecommendationSettings}
						disabled={recommendationSettingsSaving}
						variant="primary"
					>
						{recommendationSettingsSaving
							? t("保存中")
							: t("保存配置")}
					</Button>
				</div>
			</div>

			{recommendationSettingsLoading ? (
				<div className="rounded-sm border border-border bg-muted px-4 py-8 text-center text-sm text-text-3">
					{t("加载中")}
				</div>
			) : (
				<div className="space-y-4">
					<div className="flex items-center justify-between border border-border rounded-sm p-4 bg-surface">
						<div>
							<div className="text-sm font-medium text-text-1">
								{t("开启文章推荐")}
							</div>
							<div className="text-xs text-text-3 mt-1">
								{t("基于向量相似度生成相似文章列表")}
							</div>
						</div>
						<label className="inline-flex items-center gap-2 text-sm text-text-2 cursor-pointer">
							<CheckboxInput
								checked={
									recommendationSettings.recommendations_enabled
								}
								onChange={(e) =>
									setRecommendationSettings((prev) => ({
										...prev,
										recommendations_enabled: e.target.checked,
									}))
								}
								className="h-4 w-4"
							/>
							<span>
								{recommendationSettings.recommendations_enabled
									? t("已开启")
									: t("已关闭")}
							</span>
						</label>
					</div>

					<div>
						<label className="block text-sm text-text-2 mb-1">
							{t("向量化模型")}
						</label>
						{modelAPIConfigs.filter(
							(config) =>
								(config.model_type || "general") === "vector",
						).length === 0 && (
							<div className="text-xs text-text-3 mb-2">
								{t(
									"暂无向量模型配置，请在模型API配置中设置模型类型为向量。",
								)}
							</div>
						)}
						<SelectField
							value={
								recommendationSettings.recommendation_model_config_id ||
								""
							}
							onChange={(value) =>
								setRecommendationSettings((prev) => ({
									...prev,
									recommendation_model_config_id: value,
								}))
							}
							className="w-full"
							popupClassName="select-modern-dropdown"
							options={[
								{
									value: "",
									label: t("请选择远程向量模型"),
								},
								...modelAPIConfigs
									.filter(
										(config) =>
											(config.model_type || "general") === "vector",
									)
									.map((config) => ({
										value: config.id,
										label: `${config.name} (${config.model_name})`,
									})),
							]}
						/>
						<div className="text-xs text-text-3 mt-2">
							{t(
								"文章推荐仅支持远程向量模型；未配置时将无法生成推荐。",
							)}
						</div>
					</div>
				</div>
			)}
		</div>
	);
}
