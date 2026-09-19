import type { ChangeEvent, Dispatch, RefObject, SetStateAction } from "react";
import Button from "@/components/Button";
import CheckboxInput from "@/components/ui/CheckboxInput";
import TextInput from "@/components/ui/TextInput";
import type { BackupExportJob, StorageSettings } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

const formatFileSize = (value: number | null | undefined) => {
	if (value == null || Number.isNaN(value)) return "-";
	if (value < 1024) return `${value} B`;
	if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
	if (value < 1024 * 1024 * 1024) {
		return `${(value / (1024 * 1024)).toFixed(2)} MB`;
	}
	return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`;
};

type StorageSectionProps = {
	storageSettings: StorageSettings;
	setStorageSettings: Dispatch<SetStateAction<StorageSettings>>;
	storageSettingsLoading: boolean;
	storageSettingsSaving: boolean;
	storageStatsLoading: boolean;
	storageStats: {
		asset_count: number;
		asset_total_size: number;
		disk_file_count: number;
		disk_total_size: number;
	};
	storageCleanupLoading: boolean;
	backupImporting: boolean;
	handleCleanupMedia: () => Promise<void>;
	handleSaveStorageSettings: () => Promise<void>;
	handleImportBackup: (event: ChangeEvent<HTMLInputElement>) => Promise<void>;
	backupExportJob: BackupExportJob | null;
	backupExporting: boolean;
	backupExportStatusText: string;
	backupExportDownloadReady: boolean;
	handleExportBackup: () => Promise<void>;
	handleDownloadLatestBackup: () => void;
	backupImportInputRef: RefObject<HTMLInputElement>;
};

export default function StorageSection({
	storageSettings,
	setStorageSettings,
	storageSettingsLoading,
	storageSettingsSaving,
	storageStatsLoading,
	storageStats,
	storageCleanupLoading,
	backupImporting,
	handleCleanupMedia,
	handleSaveStorageSettings,
	handleImportBackup,
	backupExportJob,
	backupExporting,
	backupExportStatusText,
	backupExportDownloadReady,
	handleExportBackup,
	handleDownloadLatestBackup,
	backupImportInputRef,
}: StorageSectionProps) {
	const { t } = useI18n();

	return (
		<div className="bg-surface rounded-sm shadow-sm border border-border p-6 w-full min-w-0">
			<div className="mb-6 flex flex-wrap items-start justify-between gap-3">
				<div className="space-y-1">
					<h2 className="text-lg font-semibold text-text-1">
						{t("文件存储")}
					</h2>
					<p className="text-sm text-text-3">
						{t("控制图片是否转存为本地文件")}
					</p>
				</div>
				<div className="flex flex-wrap items-center gap-2">
					<Button
						onClick={handleCleanupMedia}
						disabled={storageCleanupLoading}
						variant="secondary"
					>
						{storageCleanupLoading ? t("清理中") : t("深度清理")}
					</Button>
					<Button
						onClick={handleSaveStorageSettings}
						disabled={storageSettingsSaving}
						variant="primary"
					>
						{storageSettingsSaving ? t("保存中") : t("保存配置")}
					</Button>
				</div>
			</div>

			{storageSettingsLoading ? (
				<div className="rounded-sm border border-border bg-muted px-4 py-8 text-center text-sm text-text-3">
					{t("加载中")}
				</div>
			) : (
				<div className="space-y-4">
					<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
						<div className="rounded-sm border border-border bg-muted/60 px-4 py-3">
							<div className="text-xs text-text-3">
								{t("图片占用空间（记录）")}
							</div>
							<div className="mt-1 text-lg font-semibold text-text-1">
								{storageStatsLoading
									? t("加载中")
									: formatFileSize(storageStats.asset_total_size)}
							</div>
							<div className="mt-1 text-xs text-text-3">
								{t("记录数")} {storageStats.asset_count}
							</div>
						</div>
						<div className="rounded-sm border border-border bg-muted/60 px-4 py-3">
							<div className="text-xs text-text-3">
								{t("磁盘占用空间（实际）")}
							</div>
							<div className="mt-1 text-lg font-semibold text-text-1">
								{storageStatsLoading
									? t("加载中")
									: formatFileSize(storageStats.disk_total_size)}
							</div>
							<div className="mt-1 text-xs text-text-3">
								{t("文件数")} {storageStats.disk_file_count}
							</div>
						</div>
					</div>
					<div className="flex items-center justify-between border border-border rounded-sm p-4 bg-surface">
						<div>
							<div className="text-sm font-medium text-text-1">
								{t("开启本地图片存储")}
							</div>
							<div className="text-xs text-text-3 mt-1">
								{t("启用后会将外链图片转存为本地文件")}
							</div>
						</div>
						<label htmlFor="storage-media-enabled" className="inline-flex items-center gap-2 text-sm text-text-2 cursor-pointer">
							<CheckboxInput
								id="storage-media-enabled"
								checked={storageSettings.media_storage_enabled}
								onChange={(e) =>
									setStorageSettings((prev) => ({
										...prev,
										media_storage_enabled: e.target.checked,
									}))
								}
								className="h-4 w-4"
							/>
							<span>
								{storageSettings.media_storage_enabled
									? t("已开启")
									: t("已关闭")}
							</span>
						</label>
					</div>
					<div className="grid grid-cols-1 md:grid-cols-3 gap-4">
						<div>
							<label htmlFor="storage-media-compress-threshold" className="block text-sm text-text-2 mb-1">
								{t("压缩阈值 (KB)")}
							</label>
							<TextInput
								id="storage-media-compress-threshold"
								type="number"
								min={256}
								value={Math.round(
									storageSettings.media_compress_threshold / 1024,
								)}
								onChange={(e) =>
									setStorageSettings((prev) => ({
										...prev,
										media_compress_threshold:
											Math.max(256, Number(e.target.value || 0)) *
											1024,
									}))
								}
								placeholder={t("超过该大小触发压缩")}
							/>
						</div>
						<div>
							<label htmlFor="storage-media-max-dim" className="block text-sm text-text-2 mb-1">
								{t("最长边 (px)")}
							</label>
							<TextInput
								id="storage-media-max-dim"
								type="number"
								min={600}
								value={storageSettings.media_max_dim}
								onChange={(e) =>
									setStorageSettings((prev) => ({
										...prev,
										media_max_dim: Math.max(
											600,
											Number(e.target.value || 0),
										),
									}))
								}
								placeholder={t("限制图片最长边")}
							/>
						</div>
						<div>
							<label htmlFor="storage-media-webp-quality" className="block text-sm text-text-2 mb-1">
								{t("WEBP 质量 (30-95)")}
							</label>
							<TextInput
								id="storage-media-webp-quality"
								type="number"
								min={30}
								max={95}
								value={storageSettings.media_webp_quality}
								onChange={(e) =>
									setStorageSettings((prev) => ({
										...prev,
										media_webp_quality: Math.min(
											95,
											Math.max(30, Number(e.target.value || 0)),
										),
									}))
								}
								placeholder={t("WEBP 压缩质量")}
							/>
						</div>
					</div>

					<div className="rounded-sm border border-border bg-muted/40 p-4 space-y-3">
						<div className="flex flex-wrap items-start justify-between gap-3 md:flex-nowrap">
							<div className="min-w-0 flex-1">
								<div className="text-sm font-medium text-text-1">
									{t("数据备份与恢复")}
								</div>
								<p className="mt-1 break-words text-xs text-text-3">
									{t(
										"导出业务全量镜像 zip，除去统计、任务、向量和日志，且包含敏感配置。",
									)}
								</p>
							</div>
							<div className="flex shrink-0 flex-wrap items-center gap-2 md:ml-auto">
								{backupExportDownloadReady && (
									<Button
										onClick={handleDownloadLatestBackup}
										disabled={backupImporting}
										variant="secondary"
									>
										{t("下载最新备份")}
									</Button>
								)}
								<Button
									onClick={handleExportBackup}
									disabled={
										backupExporting ||
										backupImporting ||
										backupExportJob?.status === "processing"
									}
									variant="secondary"
								>
									{backupExporting ||
									backupExportJob?.status === "processing"
										? t("生成中...")
										: t("生成备份")}
								</Button>
								<Button
									onClick={() =>
										backupImportInputRef.current?.click()
									}
									disabled={
										backupImporting ||
										backupExporting ||
										backupExportJob?.status === "processing"
									}
									loading={backupImporting}
									variant="secondary"
								>
									{backupImporting
										? t("导入中...")
										: t("导入备份")}
								</Button>
							</div>
						</div>
						<p className="text-xs text-text-3">
							{backupExportStatusText}
						</p>
						<TextInput
							ref={backupImportInputRef}
							type="file"
							accept=".zip,application/zip"
							className="hidden"
							onChange={handleImportBackup}
							disabled={backupImporting}
						/>
					</div>
				</div>
			)}
		</div>
	);
}
