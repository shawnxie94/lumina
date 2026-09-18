import type { Dispatch, SetStateAction } from "react";
import Button from "@/components/Button";
import IconButton from "@/components/IconButton";
import CheckboxInput from "@/components/ui/CheckboxInput";
import TextArea from "@/components/ui/TextArea";
import TextInput from "@/components/ui/TextInput";
import { IconCopy } from "@/components/icons";
import type { CommentSettings } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

type CommentSettingsSectionProps = {
	commentSubSection: "keys" | "filters";
	commentSettings: CommentSettings;
	setCommentSettings: Dispatch<SetStateAction<CommentSettings>>;
	commentSettingsLoading: boolean;
	commentSettingsSaving: boolean;
	commentValidationResult: {
		ok: boolean;
		messages: string[];
		callbacks: string[];
	} | null;
	handleValidateCommentSettings: () => void;
	handleSaveCommentSettings: () => Promise<void>;
	handleCopyMaskedValue: (value: string) => Promise<void>;
	handleGenerateNextAuthSecret: () => void;
};

export default function CommentSettingsSection({
	commentSubSection,
	commentSettings,
	setCommentSettings,
	commentSettingsLoading,
	commentSettingsSaving,
	commentValidationResult,
	handleValidateCommentSettings,
	handleSaveCommentSettings,
	handleCopyMaskedValue,
	handleGenerateNextAuthSecret,
}: CommentSettingsSectionProps) {
	const { t } = useI18n();

	return (
		<div className="bg-surface rounded-sm shadow-sm border border-border p-6 w-full min-w-0">
			<div className="mb-6 flex flex-wrap items-start justify-between gap-3">
				<div className="space-y-1">
					<h2 className="text-lg font-semibold text-text-1">
						{commentSubSection === "keys"
							? t("登录密钥")
							: t("过滤规则")}
					</h2>
					<p className="text-sm text-text-3">
						{commentSubSection === "keys"
							? t("配置第三方登录并启用文章评论功能")
							: t("配置评论敏感词过滤规则")}
					</p>
				</div>
				<div className="flex flex-wrap items-center gap-2">
					{commentSubSection === "keys" && (
						<Button
							onClick={handleValidateCommentSettings}
							variant="secondary"
						>
							{t("验证配置")}
						</Button>
					)}
					<Button
						onClick={handleSaveCommentSettings}
						disabled={commentSettingsSaving}
						variant="primary"
					>
						{commentSettingsSaving ? t("保存中") : t("保存配置")}
					</Button>
				</div>
			</div>

			{commentSettingsLoading ? (
				<div className="rounded-sm border border-border bg-muted px-4 py-8 text-center text-sm text-text-3">
					{t("加载中")}
				</div>
			) : (
				<div className="space-y-6">
					{commentSubSection === "keys" && (
						<>
							<div className="flex items-center justify-between border border-border rounded-sm p-4 bg-surface">
								<div>
									<div className="text-sm font-medium text-text-1">
										{t("开启评论")}
									</div>
									<div className="text-xs text-text-3 mt-1">
										{t("关闭后访客评论入口将隐藏")}
									</div>
								</div>
								<label className="inline-flex items-center gap-2 text-sm text-text-2 cursor-pointer">
									<CheckboxInput
										checked={commentSettings.comments_enabled}
										onChange={(e) =>
											setCommentSettings((prev) => ({
												...prev,
												comments_enabled: e.target.checked,
											}))
										}
										className="h-4 w-4"
									/>
									<span>
										{commentSettings.comments_enabled
											? t("已开启")
											: t("已关闭")}
									</span>
								</label>
							</div>

							<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
								<div>
									<label className="block text-sm text-text-2 mb-1">
										GitHub Client ID
									</label>
									<TextInput
										value={commentSettings.github_client_id}
										onChange={(e) =>
											setCommentSettings((prev) => ({
												...prev,
												github_client_id: e.target.value,
											}))
										}
										placeholder={t("填写 GitHub OAuth Client ID")}
									/>
								</div>
								<div>
									<label className="block text-sm text-text-2 mb-1">
										GitHub Client Secret
									</label>
									<div className="flex flex-wrap items-center gap-2">
										<TextInput
											type="password"
											value={commentSettings.github_client_secret}
											onChange={(e) =>
												setCommentSettings((prev) => ({
													...prev,
													github_client_secret: e.target.value,
												}))
											}
											placeholder={t(
												"填写 GitHub OAuth Client Secret",
											)}
											className="flex-1"
										/>
										<IconButton
											type="button"
											onClick={() =>
												handleCopyMaskedValue(
													commentSettings.github_client_secret,
												)
											}
											variant="secondary"
											size="md"
											title={t("复制")}
											disabled={
												!commentSettings.github_client_secret
											}
										>
											<IconCopy className="h-4 w-4" />
										</IconButton>
									</div>
								</div>
								<div>
									<label className="block text-sm text-text-2 mb-1">
										Google Client ID
									</label>
									<TextInput
										value={commentSettings.google_client_id}
										onChange={(e) =>
											setCommentSettings((prev) => ({
												...prev,
												google_client_id: e.target.value,
											}))
										}
										placeholder={t("填写 Google OAuth Client ID")}
									/>
								</div>
								<div>
									<label className="block text-sm text-text-2 mb-1">
										Google Client Secret
									</label>
									<div className="flex flex-wrap items-center gap-2">
										<TextInput
											type="password"
											value={commentSettings.google_client_secret}
											onChange={(e) =>
												setCommentSettings((prev) => ({
													...prev,
													google_client_secret: e.target.value,
												}))
											}
											placeholder={t(
												"填写 Google OAuth Client Secret",
											)}
											className="flex-1"
										/>
										<IconButton
											type="button"
											onClick={() =>
												handleCopyMaskedValue(
													commentSettings.google_client_secret,
												)
											}
											variant="secondary"
											size="md"
											title={t("复制")}
											disabled={
												!commentSettings.google_client_secret
											}
										>
											<IconCopy className="h-4 w-4" />
										</IconButton>
									</div>
								</div>
							</div>

							<div>
								<label className="block text-sm text-text-2 mb-1">
									NextAuth Secret
								</label>
								<div className="flex gap-2">
									<TextInput
										type="password"
										value={commentSettings.nextauth_secret}
										onChange={(e) =>
											setCommentSettings((prev) => ({
												...prev,
												nextauth_secret: e.target.value,
											}))
										}
										placeholder={t("用于签名会话的 Secret")}
										className="flex-1"
									/>
									<IconButton
										type="button"
										onClick={() =>
											handleCopyMaskedValue(
												commentSettings.nextauth_secret,
											)
										}
										variant="secondary"
										size="md"
										title={t("复制")}
										disabled={!commentSettings.nextauth_secret}
									>
										<IconCopy className="h-4 w-4" />
									</IconButton>
									<Button
										type="button"
										onClick={handleGenerateNextAuthSecret}
										variant="secondary"
										size="sm"
									>
										{t("自动生成")}
									</Button>
								</div>
							</div>
						</>
					)}

					{commentSubSection === "filters" && (
						<>
							<div className="flex items-center justify-between border border-border rounded-sm p-4 bg-surface">
								<div>
									<div className="text-sm font-medium text-text-1">
										{t("敏感词过滤")}
									</div>
									<div className="text-xs text-text-3 mt-1">
										{t("启用后将拦截包含敏感词的评论")}
									</div>
								</div>
								<label className="inline-flex items-center gap-2 text-sm text-text-2 cursor-pointer">
									<CheckboxInput
										checked={
											commentSettings.sensitive_filter_enabled
										}
										onChange={(e) =>
											setCommentSettings((prev) => ({
												...prev,
												sensitive_filter_enabled: e.target.checked,
											}))
										}
										className="h-4 w-4"
									/>
									<span>
										{commentSettings.sensitive_filter_enabled
											? t("已开启")
											: t("已关闭")}
									</span>
								</label>
							</div>

							<div>
								<div className="flex items-center gap-2 mb-1">
									<label className="block text-sm text-text-2">
										{t("敏感词列表")}
									</label>
									<div className="relative group">
										<span className="h-5 w-5 rounded-full border border-border text-text-3 inline-flex items-center justify-center text-xs cursor-default">
											?
										</span>
										<div className="pointer-events-none absolute left-1/2 top-full mt-2 -translate-x-1/2 whitespace-nowrap rounded-sm border border-border bg-surface px-2 py-1 text-xs text-text-2 shadow-sm opacity-0 group-hover:opacity-100 transition">
											{t("支持换行或逗号分隔")}
										</div>
									</div>
								</div>
								<TextArea
									value={commentSettings.sensitive_words}
									onChange={(e) =>
										setCommentSettings((prev) => ({
											...prev,
											sensitive_words: e.target.value,
										}))
									}
									rows={4}
									placeholder={t("每行一个敏感词，或使用逗号分隔")}
								/>
							</div>
						</>
					)}

					{commentSubSection === "keys" &&
						commentValidationResult && (
							<div
								className={`rounded-sm border p-3 text-xs ${
									commentValidationResult.ok
										? "border-success-soft bg-success-soft text-success-ink"
										: "border-danger-soft bg-danger-soft text-danger-ink"
								}`}
							>
								<div className="font-medium mb-1">
									{commentValidationResult.ok
										? t("校验通过")
										: t("校验提示")}
								</div>
								<div className="space-y-1">
									{commentValidationResult.messages.map((item) => (
										<div key={item}>{item}</div>
									))}
								</div>
								{commentValidationResult.callbacks.length > 0 && (
									<div className="mt-2 text-text-2">
										<div className="font-medium mb-1">
											{t("回调地址")}
										</div>
										<div className="space-y-1">
											{commentValidationResult.callbacks.map(
												(item) => (
													<div key={item} className="break-all">
														{item}
													</div>
												),
											)}
										</div>
									</div>
								)}
							</div>
						)}
					{commentSubSection === "keys" && (
						<div className="text-xs text-text-3">
							{t(
								"保存后立即生效，如登录异常请检查 OAuth 回调地址配置。",
							)}
						</div>
					)}
				</div>
			)}
		</div>
	);
}
