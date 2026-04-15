import { useCallback, useEffect, useRef, useState } from "react";

import { backupApi, type BackupExportJob } from "@/lib/api";
import {
	BACKUP_EXPORT_POLL_INTERVAL_MS,
	canDownloadBackupExport,
	getBackupExportStatusText,
} from "@/lib/backupExport";

interface UseLatestBackupExportJobOptions {
	active: boolean;
	t: (key: string) => string;
	showToast: (message: string, type?: "success" | "error" | "info") => void;
	formatTimestamp: (value: string) => string;
}

export function useLatestBackupExportJob({
	active,
	t,
	showToast,
	formatTimestamp,
}: UseLatestBackupExportJobOptions) {
	const [backupExportJob, setBackupExportJob] = useState<BackupExportJob | null>(
		null,
	);
	const [backupExporting, setBackupExporting] = useState(false);
	const backupExportPollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
		null,
	);
	const previousBackupExportStatusRef = useRef<BackupExportJob["status"] | null>(
		null,
	);

	const refreshLatestBackupExportJob = useCallback(
		async (options?: { silent?: boolean }) => {
			try {
				const data = await backupApi.getLatestExportJob();
				setBackupExportJob(data);
				return data;
			} catch (error) {
				console.error("Failed to fetch latest backup export job:", error);
				if (!options?.silent) {
					showToast(t("备份状态加载失败"), "error");
				}
				return null;
			}
		},
		[showToast, t],
	);

	useEffect(() => {
		if (!active) return;
		void refreshLatestBackupExportJob({ silent: true });
	}, [active, refreshLatestBackupExportJob]);

	useEffect(() => {
		const previousStatus = previousBackupExportStatusRef.current;
		const nextStatus = backupExportJob?.status ?? null;
		if (previousStatus === "processing" && nextStatus === "completed") {
			showToast(t("最新备份已生成，可开始下载"));
		}
		if (previousStatus === "processing" && nextStatus === "failed") {
			showToast(t("备份导出失败"), "error");
		}
		previousBackupExportStatusRef.current = nextStatus;
	}, [backupExportJob?.status, showToast, t]);

	useEffect(() => {
		if (backupExportPollTimerRef.current) {
			clearTimeout(backupExportPollTimerRef.current);
			backupExportPollTimerRef.current = null;
		}
		if (!active || backupExportJob?.status !== "processing") return;
		backupExportPollTimerRef.current = setTimeout(() => {
			void refreshLatestBackupExportJob({ silent: true });
		}, BACKUP_EXPORT_POLL_INTERVAL_MS);
		return () => {
			if (backupExportPollTimerRef.current) {
				clearTimeout(backupExportPollTimerRef.current);
				backupExportPollTimerRef.current = null;
			}
		};
	}, [active, backupExportJob?.status, refreshLatestBackupExportJob]);

	const backupExportStatusText = getBackupExportStatusText(
		backupExportJob,
		t,
		formatTimestamp,
	);
	const backupExportDownloadReady = canDownloadBackupExport(backupExportJob);

	const handleExportBackup = async () => {
		if (backupExporting) return;
		setBackupExporting(true);
		try {
			const job = await backupApi.startLatestExportJob();
			setBackupExportJob(job);
			showToast(t("备份已开始后台生成"));
		} catch (error) {
			console.error("Failed to export backup:", error);
			showToast(t("备份导出失败"), "error");
		} finally {
			setBackupExporting(false);
		}
	};

	const handleDownloadLatestBackup = () => {
		if (!backupExportDownloadReady || typeof document === "undefined") return;
		const link = document.createElement("a");
		link.href = backupApi.getLatestExportDownloadUrl();
		document.body.appendChild(link);
		link.click();
		document.body.removeChild(link);
	};

	return {
		backupExportJob,
		backupExporting,
		backupExportStatusText,
		backupExportDownloadReady,
		refreshLatestBackupExportJob,
		handleExportBackup,
		handleDownloadLatestBackup,
	};
}
