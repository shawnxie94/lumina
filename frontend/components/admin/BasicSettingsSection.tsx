import type { Dispatch, SetStateAction } from "react";
import Button from "@/components/Button";
import CheckboxInput from "@/components/ui/CheckboxInput";
import IconButton from "@/components/IconButton";
import SelectField from "@/components/ui/SelectField";
import TextInput from "@/components/ui/TextInput";
import { IconPlus, IconTrash } from "@/components/icons";
import type { BasicSettings } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

type BasicSettingsSectionProps = {
	basicSettingsForm: BasicSettings;
	setBasicSettingsForm: Dispatch<SetStateAction<BasicSettings>>;
	basicSettingsLoading: boolean;
	basicSettingsSaving: boolean;
	handleSaveBasicSettings: () => Promise<void>;
	handleAddHeaderCustomLink: () => void;
	handleUpdateHeaderCustomLink: (
		index: number,
		field: "label" | "url",
		value: string,
	) => void;
	handleRemoveHeaderCustomLink: (index: number) => void;
};

export default function BasicSettingsSection({
	basicSettingsForm,
	setBasicSettingsForm,
	basicSettingsLoading,
	basicSettingsSaving,
	handleSaveBasicSettings,
	handleAddHeaderCustomLink,
	handleUpdateHeaderCustomLink,
	handleRemoveHeaderCustomLink,
}: BasicSettingsSectionProps) {
	const { t } = useI18n();

	return (
		<div className="bg-surface rounded-sm shadow-sm border border-border p-6 w-full min-w-0">
			<div className="mb-6 flex flex-wrap items-start justify-between gap-3">
				<div className="space-y-1">
					<h2 className="text-lg font-semibold text-text-1">
						{t("基础配置")}
					</h2>
					<p className="text-sm text-text-3">
						{t("配置站点名称与默认语言")}
					</p>
				</div>
				<div className="flex flex-wrap items-center gap-2">
					<Button
						onClick={handleSaveBasicSettings}
						disabled={basicSettingsSaving}
						variant="primary"
					>
						{basicSettingsSaving ? t("保存中") : t("保存配置")}
					</Button>
				</div>
			</div>

			{basicSettingsLoading ? (
				<div className="rounded-sm border border-border bg-muted px-4 py-8 text-center text-sm text-text-3">
					{t("加载中")}
				</div>
			) : (
				<div className="space-y-6">
					<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
						<div>
							<label htmlFor="basic-home-badge-text" className="block text-sm text-text-2 mb-1">
								{t("首页顶部标语")}
							</label>
							<TextInput
								id="basic-home-badge-text"
								value={basicSettingsForm.home_badge_text}
								onChange={(e) =>
									setBasicSettingsForm((prev) => ({
										...prev,
										home_badge_text: e.target.value,
									}))
								}
								placeholder={t(
									"请输入首页顶部标语（留空使用默认）",
								)}
							/>
						</div>
						<div>
							<label htmlFor="basic-site-name" className="block text-sm text-text-2 mb-1">
								{t("站点名称")}
							</label>
							<TextInput
								id="basic-site-name"
								value={basicSettingsForm.site_name}
								onChange={(e) =>
									setBasicSettingsForm((prev) => ({
										...prev,
										site_name: e.target.value,
									}))
								}
								placeholder={t("请输入站点名称")}
							/>
						</div>
					</div>
					<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
						<div>
							<label htmlFor="basic-site-description" className="block text-sm text-text-2 mb-1">
								{t("站点描述")}
							</label>
							<TextInput
								id="basic-site-description"
								value={basicSettingsForm.site_description}
								onChange={(e) =>
									setBasicSettingsForm((prev) => ({
										...prev,
										site_description: e.target.value,
									}))
								}
								placeholder={t("请输入站点描述")}
							/>
						</div>
						<div>
							<label htmlFor="basic-home-tagline-text" className="block text-sm text-text-2 mb-1">
								{t("首页补充文案")}
							</label>
							<TextInput
								id="basic-home-tagline-text"
								value={basicSettingsForm.home_tagline_text}
								onChange={(e) =>
									setBasicSettingsForm((prev) => ({
										...prev,
										home_tagline_text: e.target.value,
									}))
								}
								placeholder={t(
									"请输入首页补充文案（留空使用默认）",
								)}
							/>
						</div>
					</div>
					<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
						<div>
							<label htmlFor="basic-home-primary-button-text" className="block text-sm text-text-2 mb-1">
								{t("首页主按钮文案")}
							</label>
							<TextInput
								id="basic-home-primary-button-text"
								value={basicSettingsForm.home_primary_button_text}
								onChange={(e) =>
									setBasicSettingsForm((prev) => ({
										...prev,
										home_primary_button_text: e.target.value,
									}))
								}
								placeholder={t("请输入按钮文案（留空使用默认）")}
							/>
						</div>
						<div>
							<label htmlFor="basic-home-primary-button-url" className="block text-sm text-text-2 mb-1">
								{t("首页主按钮链接")}
							</label>
							<TextInput
								id="basic-home-primary-button-url"
								value={basicSettingsForm.home_primary_button_url}
								onChange={(e) =>
									setBasicSettingsForm((prev) => ({
										...prev,
										home_primary_button_url: e.target.value,
									}))
								}
								placeholder={t(
									"请输入按钮链接（支持 /path 或 https://，留空使用默认）",
								)}
							/>
						</div>
					</div>
					<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
						<div>
							<label htmlFor="basic-home-secondary-button-text" className="block text-sm text-text-2 mb-1">
								{t("首页副按钮文案")}
							</label>
							<TextInput
								id="basic-home-secondary-button-text"
								value={basicSettingsForm.home_secondary_button_text}
								onChange={(e) =>
									setBasicSettingsForm((prev) => ({
										...prev,
										home_secondary_button_text: e.target.value,
									}))
								}
								placeholder={t("请输入按钮文案（留空使用默认）")}
							/>
						</div>
						<div>
							<label htmlFor="basic-home-secondary-button-url" className="block text-sm text-text-2 mb-1">
								{t("首页副按钮链接")}
							</label>
							<TextInput
								id="basic-home-secondary-button-url"
								value={basicSettingsForm.home_secondary_button_url}
								onChange={(e) =>
									setBasicSettingsForm((prev) => ({
										...prev,
										home_secondary_button_url: e.target.value,
									}))
								}
								placeholder={t(
									"请输入按钮链接（支持 /path 或 https://，留空使用默认）",
								)}
							/>
						</div>
					</div>
					<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
						<div>
							<label htmlFor="basic-site-logo-url" className="block text-sm text-text-2 mb-1">
								{t("站点Logo地址")}
							</label>
							<TextInput
								id="basic-site-logo-url"
								value={basicSettingsForm.site_logo_url}
								onChange={(e) =>
									setBasicSettingsForm((prev) => ({
										...prev,
										site_logo_url: e.target.value,
									}))
								}
								placeholder={t("可选，留空使用默认图标")}
							/>
						</div>
						<div>
							<label htmlFor="basic-default-language" className="block text-sm text-text-2 mb-1">
								{t("默认语言")}
							</label>
							<SelectField
								id="basic-default-language"
								value={basicSettingsForm.default_language}
								onChange={(value) =>
									setBasicSettingsForm((prev) => ({
										...prev,
										default_language: value as "zh-CN" | "en",
									}))
								}
								options={[
									{ value: "zh-CN", label: t("中文") },
									{ value: "en", label: t("英文") },
								]}
							/>
						</div>
					</div>
					<div className="space-y-3 border-t border-border pt-4">
						<div className="flex flex-wrap items-center justify-between gap-3">
							<div>
								<div className="text-sm font-medium text-text-1">
									{t("Header 自定义链接")}
								</div>
								<div className="mt-1 text-xs text-text-3">
									{t(
										"配置后会显示在顶部导航，支持站内路径或 http/https 外链",
									)}
								</div>
							</div>
							<Button
								onClick={handleAddHeaderCustomLink}
								variant="secondary"
								size="sm"
								disabled={
									(basicSettingsForm.header_custom_links || [])
										.length >= 8
								}
							>
								<IconPlus className="mr-1.5 h-3.5 w-3.5" />
								{t("添加链接")}
							</Button>
						</div>
						{(basicSettingsForm.header_custom_links || []).length ===
						0 ? (
							<div className="text-sm text-text-3">
								{t("暂无自定义链接")}
							</div>
						) : (
							<div className="space-y-2">
								{(basicSettingsForm.header_custom_links || []).map(
									(item, index) => (
										<div
											key={index}
											className="grid grid-cols-1 gap-2 md:grid-cols-[minmax(0,180px)_minmax(0,1fr)_auto] md:items-center"
										>
											<TextInput
												value={item.label}
												onChange={(e) =>
													handleUpdateHeaderCustomLink(
														index,
														"label",
														e.target.value,
													)
												}
												placeholder={t("链接名称，例如 AFF")}
											/>
											<TextInput
												value={item.url}
												onChange={(e) =>
													handleUpdateHeaderCustomLink(
														index,
														"url",
														e.target.value,
													)
												}
												placeholder={t(
													"链接地址，例如 https://example.com/aff/",
												)}
											/>
											<IconButton
												title={t("删除链接")}
												variant="danger"
												onClick={() =>
													handleRemoveHeaderCustomLink(index)
												}
											>
												<IconTrash className="h-4 w-4" />
											</IconButton>
										</div>
									),
								)}
							</div>
						)}
					</div>
					<div className="flex items-center justify-between rounded-sm border border-border bg-surface p-4">
						<div>
							<div className="text-sm font-medium text-text-1">
								{t("启用RSS订阅")}
							</div>
							<div className="mt-1 text-xs text-text-3">
								{t("关闭后将不再暴露公开 RSS 地址")}
							</div>
						</div>
						<label htmlFor="basic-rss-enabled" className="inline-flex cursor-pointer items-center gap-2 text-sm text-text-2">
							<CheckboxInput
								id="basic-rss-enabled"
								checked={basicSettingsForm.rss_enabled}
								onChange={(e) =>
									setBasicSettingsForm((prev) => ({
										...prev,
										rss_enabled: e.target.checked,
									}))
								}
								className="h-4 w-4"
							/>
							<span>
								{basicSettingsForm.rss_enabled
									? t("已开启")
									: t("已关闭")}
							</span>
						</label>
					</div>
				</div>
			)}
		</div>
	);
}
