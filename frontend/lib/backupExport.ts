import type { BackupExportJob } from "@/lib/api";

export const BACKUP_EXPORT_POLL_INTERVAL_MS = 1500;

export const canDownloadBackupExport = (
	job?: BackupExportJob | null,
): boolean => {
	return job?.status === "completed" && Boolean(job.file_path || job.filename);
};

export const formatBackupExportFileSize = (bytes?: number | null): string => {
	if (!bytes || bytes <= 0) {
		return "0 B";
	}
	if (bytes < 1024) {
		return `${bytes} B`;
	}
	const kilobytes = bytes / 1024;
	if (kilobytes < 1024) {
		return `${kilobytes.toFixed(1)} KB`;
	}
	const megabytes = kilobytes / 1024;
	if (megabytes < 1024) {
		return `${megabytes.toFixed(1)} MB`;
	}
	return `${(megabytes / 1024).toFixed(1)} GB`;
};

export const getBackupExportStatusText = (
	job: BackupExportJob | null | undefined,
	t: (key: string) => string,
	formatTimestamp: (value: string) => string,
): string => {
	if (!job || job.status === "idle") {
		return t("点击生成最新备份，完成后可直接下载。");
	}
	if (job.status === "processing") {
		return t("备份正在后台生成，生成完成后可下载最新文件。");
	}
	if (job.status === "failed") {
		const errorMessage = job.error_message?.trim();
		if (errorMessage) {
			return t("最近一次备份生成失败：{error}").replace(
				"{error}",
				errorMessage,
			);
		}
		return t("最近一次备份生成失败，请重试。");
	}

	const createdAt = job.created_at?.trim();
	const timeLabel = createdAt
		? formatTimestamp(createdAt)
		: t("时间未知");
	return t("最新备份已生成：{time} · {size}")
		.replace("{time}", timeLabel)
		.replace("{size}", formatBackupExportFileSize(job.file_size));
};
