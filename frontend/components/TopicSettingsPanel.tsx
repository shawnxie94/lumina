import { useEffect, useState } from "react";

import Button from "@/components/Button";
import ConfirmModal from "@/components/ConfirmModal";
import IconButton from "@/components/IconButton";
import { IconCopy } from "@/components/icons";
import { useToast } from "@/components/Toast";
import CheckboxInput from "@/components/ui/CheckboxInput";
import ModalShell from "@/components/ui/ModalShell";
import TextInput from "@/components/ui/TextInput";
import {
	topicApi,
	topicSettingsApi,
	type TopicOrphanCleanupResult,
	type TopicSettings,
} from "@/lib/api";
import { useI18n } from "@/lib/i18n";

const DEFAULT_TOPIC_SETTINGS: TopicSettings = {
	enabled: false,
	bridge_base_url: "http://127.0.0.1:8787",
	bridge_token_configured: false,
	auto_sync_on_enable: true,
	knowledge_type: "llm_wiki",
	project_path: null,
	last_sync_at: null,
	last_sync_status: "idle",
	last_sync_error: null,
	last_sync_result: null,
	health: {
		bridge: { ok: false, status: "unknown", detail: null, checked_at: null },
		llm_wiki: { ok: false, status: "unknown", detail: null, checked_at: null },
		project: { ok: false, name: null, path: null },
	},
	doctor: null,
};

export default function TopicSettingsPanel() {
	const { t, language } = useI18n();
	const { showToast } = useToast();

	const [topicSettings, setTopicSettings] =
		useState<TopicSettings>(DEFAULT_TOPIC_SETTINGS);
	const [topicBridgeTokenInput, setTopicBridgeTokenInput] = useState("");
	const [topicSettingsLoading, setTopicSettingsLoading] = useState(false);
	const [topicSettingsSaving, setTopicSettingsSaving] = useState(false);
	const [topicHealthChecking, setTopicHealthChecking] = useState(false);
	const [topicSyncing, setTopicSyncing] = useState(false);
	const [topicInstallModalOpen, setTopicInstallModalOpen] = useState(false);
	const [topicCleanupLoading, setTopicCleanupLoading] = useState(false);
	const [topicCleanupPreview, setTopicCleanupPreview] =
		useState<TopicOrphanCleanupResult | null>(null);
	const [topicCleanupConfirmOpen, setTopicCleanupConfirmOpen] = useState(false);
	const [lastSyncResult, setLastSyncResult] = useState<{
		status: string;
		at: string;
		summary: string;
		detailLines: string[];
		hint?: string | null;
		error?: string | null;
	} | null>(null);

	const normalizeTopicPath = (value?: string | null) =>
		(value || "").trim().replace(/[\\/]+$/, "");

	const formatTopicDateTime = (value?: string | null) => {
		if (!value) return t("尚未同步");
		const parsed = new Date(value);
		if (Number.isNaN(parsed.getTime())) return value;
		return parsed.toLocaleString(language === "en" ? "en-US" : "zh-CN", {
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
			hour: "2-digit",
			minute: "2-digit",
			second: "2-digit",
			hour12: false,
		});
	};

	const formatTopicSyncStatus = (status?: string | null) => {
		const normalized = (status || "idle").trim().toLowerCase();
		if (normalized === "completed" || normalized === "success" || normalized === "ok") {
			return t("同步成功");
		}
		if (normalized === "failed" || normalized === "error") {
			return t("同步失败");
		}
		if (
			normalized === "running" ||
			normalized === "syncing" ||
			normalized === "processing"
		) {
			return t("同步中");
		}
		if (normalized === "idle" || normalized === "none" || normalized === "pending") {
			return t("空闲");
		}
		return status || t("未知状态");
	};

	const buildBridgeHeaders = () => {
		const headers: Record<string, string> = {
			"Content-Type": "application/json",
		};
		const token = topicBridgeTokenInput.trim();
		if (token) headers.Authorization = `Bearer ${token}`;
		return headers;
	};

	const humanizeTopicProbeError = (error: unknown) => {
		if (error instanceof DOMException && error.name === "AbortError") {
			return t("检测超时");
		}
		const message = error instanceof Error ? error.message : String(error);
		const normalized = message.toLowerCase();
		if (
			normalized.includes("failed to fetch") ||
			normalized.includes("networkerror") ||
			normalized.includes("load failed")
		) {
			return t("无法连接 Bridge，请确认本机服务已启动");
		}
		return message || t("Bridge 检测失败");
	};

	const probeBridgeDoctor = async () => {
		const base = (topicSettings.bridge_base_url || "http://127.0.0.1:8787").replace(
			/\/$/,
			"",
		);
		const controller = new AbortController();
		const timer = window.setTimeout(() => controller.abort(), 3000);
		try {
			let response = await fetch(`${base}/doctor`, {
				method: "GET",
				headers: buildBridgeHeaders(),
				signal: controller.signal,
			});
			if (response.status === 404) {
				response = await fetch(`${base}/status`, {
					method: "GET",
					headers: buildBridgeHeaders(),
					signal: controller.signal,
				});
			}
			if (!response.ok) {
				throw new Error(`HTTP ${response.status}`);
			}
			return (await response.json()) as {
				ok?: boolean;
				source?: string;
				aligned_with?: string;
				checks?: Array<{ name?: string; ok?: boolean; detail?: unknown }>;
				summary?: Record<string, string>;
				hints?: string[];
				cli?: Record<string, string>;
				health?: TopicSettings["health"] & {
					provider?: TopicSettings["health"]["llm_wiki"] & {
						name?: string | null;
					};
				};
				bridge?: TopicSettings["health"]["bridge"] & { version?: string | null };
				llm_wiki?: TopicSettings["health"]["llm_wiki"];
				project?: TopicSettings["health"]["project"];
				setup?: TopicSettings["setup"];
			};
		} finally {
			window.clearTimeout(timer);
		}
	};


	
	const normalizePersistedSyncResult = (
		value: TopicSettings["last_sync_result"] | null | undefined,
		fallbackStatus?: string | null,
		fallbackAt?: string | null,
		fallbackError?: string | null,
	) => {
		if (value && typeof value === "object") {
			const detailLines = Array.isArray(value.detailLines)
				? value.detailLines.map((item) => String(item || "").trim()).filter(Boolean)
				: [];
			return {
				status: String(value.status || fallbackStatus || "completed").trim() || "completed",
				at: String(value.at || fallbackAt || "").trim() || fallbackAt || new Date().toISOString(),
				summary: String(value.summary || "").trim() || formatTopicSyncStatus(fallbackStatus),
				detailLines,
				hint: value.hint ?? null,
				error: value.error ?? fallbackError ?? null,
			};
		}
		if (!fallbackStatus && !fallbackAt && !fallbackError) return null;
		const detailLines: string[] = [];
		if (fallbackError) detailLines.push(String(fallbackError));
		return {
			status: String(fallbackStatus || "idle"),
			at: fallbackAt || new Date().toISOString(),
			summary: formatTopicSyncStatus(fallbackStatus),
			detailLines,
			hint: null,
			error: fallbackError ?? null,
		};
	};

const summarizeTopicSyncResult = (result: Record<string, unknown> | null | undefined) => {
		const status = String(result?.status || "completed").trim() || "completed";
		const mode = String(result?.mode || "").trim();
		const exported = Number(result?.exported_articles ?? 0);
		const skipped = Number(result?.skipped_articles ?? 0);
		const scannedTopics = Number(
			result?.scanned_topics ?? result?.writeback_topics_scanned ?? 0,
		);
		const writebackTopicsChanged = Number(
			result?.writeback_topics_changed ?? result?.writeback_topics ?? 0,
		);
		const writebackTopicsUnchanged = Number(result?.writeback_topics_unchanged ?? 0);
		const writebackArticlesChanged = Number(
			result?.writeback_articles_changed ?? result?.writeback_articles ?? 0,
		);
		const writebackArticlesUnchanged = Number(
			result?.writeback_articles_unchanged ?? 0,
		);
		const writebackSkipped = Boolean(result?.writeback_skipped);
		const hint =
			typeof result?.hint === "string" && result.hint.trim()
				? result.hint.trim()
				: null;
		const error =
			typeof result?.error === "string" && result.error.trim()
				? result.error.trim()
				: null;

		const detailLines: string[] = [];
		const scanned = Number.isFinite(scannedTopics) ? scannedTopics : 0;
		const changed = Number.isFinite(writebackTopicsChanged)
			? writebackTopicsChanged
			: 0;
		const articleChanged = Number.isFinite(writebackArticlesChanged)
			? writebackArticlesChanged
			: 0;
		const exportCount = Number.isFinite(exported) ? exported : 0;
		const skipCount = Number.isFinite(skipped) ? skipped : 0;

		// Keep a single compact metrics line; summary already carries the outcome.
		const metricParts: string[] = [];
		if (exportCount > 0 || skipCount > 0) {
			metricParts.push(`${t("导出")} ${exportCount}/${t("跳过")} ${skipCount}`);
		}
		if (scanned > 0 || changed > 0) {
			metricParts.push(`${t("主题")} ${changed}/${scanned}`);
		}
		if (articleChanged > 0) {
			metricParts.push(`${t("文章")} ${articleChanged}`);
		}
		if (metricParts.length > 0) {
			detailLines.push(metricParts.join(" · "));
		}

		if (writebackSkipped && status.toLowerCase() === "awaiting_compile") {
			detailLines.push(t("等待知识库编译后写回"));
		} else if (
			result?.auto_writeback &&
			typeof result.auto_writeback === "object"
		) {
			const auto = result.auto_writeback as Record<string, unknown>;
			if (auto.scheduled || auto.active || auto.status) {
				detailLines.push(t("已安排自动二次写回"));
			}
		}

		// mode kept out of UI; retained only for potential future debugging.
		void mode;

		let summary = t("同步完成");
		const normalized = status.toLowerCase();
		const changedTopics = Number.isFinite(writebackTopicsChanged)
			? writebackTopicsChanged
			: 0;
		if (normalized === "awaiting_compile") {
			summary = t("已导出，等待知识库编译后写回");
		} else if (normalized === "failed" || normalized === "error") {
			summary = t("同步失败");
		} else if (exported > 0 && changedTopics > 0) {
			summary = t("同步成功：导出 {exported} 篇，写回 {topics} 个主题")
				.replace("{exported}", String(exported))
				.replace("{topics}", String(changedTopics));
		} else if (exported > 0) {
			summary = t("同步成功：导出 {exported} 篇文章")
				.replace("{exported}", String(exported));
		} else if (changedTopics > 0) {
			summary = t("同步成功：写回 {topics} 个主题")
				.replace("{topics}", String(changedTopics));
		} else if (
			(Number.isFinite(scannedTopics) ? scannedTopics : 0) > 0 ||
			(Number.isFinite(writebackTopicsUnchanged)
				? writebackTopicsUnchanged
				: 0) > 0
		) {
			summary = t("同步完成：主题无变化");
		} else if (skipped > 0) {
			summary = t("同步完成：无新增，跳过 {skipped} 篇")
				.replace("{skipped}", String(skipped));
		}

		return {
			status,
			summary,
			detailLines,
			hint,
			error,
			exported: Number.isFinite(exported) ? exported : 0,
			skipped: Number.isFinite(skipped) ? skipped : 0,
			writebackTopics: Number.isFinite(writebackTopicsChanged)
				? writebackTopicsChanged
				: 0,
			writebackArticles: Number.isFinite(writebackArticlesChanged)
				? writebackArticlesChanged
				: 0,
		};
	};

	const handleTopicSync = async (options?: { silent?: boolean }) => {
		setTopicSyncing(true);
		try {
			const base = (topicSettings.bridge_base_url || "http://127.0.0.1:8787").replace(
				/\/$/,
				"",
			);
			const controller = new AbortController();
			const timer = window.setTimeout(() => controller.abort(), 120000);
			let response: Response;
			try {
				response = await fetch(`${base}/sync`, {
					method: "POST",
					headers: buildBridgeHeaders(),
					signal: controller.signal,
				});
			} finally {
				window.clearTimeout(timer);
			}
			if (!response.ok) {
				let detail = `HTTP ${response.status}`;
				try {
					const failed = await response.json();
					if (failed?.error) detail = String(failed.error);
					else if (failed?.detail) detail = String(failed.detail);
				} catch {
					// ignore body parse errors
				}
				throw new Error(detail);
			}
			const result = (await response.json()) as Record<string, unknown>;
			const summarized = summarizeTopicSyncResult(result);
			const syncedAt = new Date().toISOString();
			const syncResultPayload = {
				status: summarized.status,
				at: syncedAt,
				summary: summarized.summary,
				detailLines: summarized.detailLines,
				hint: summarized.hint,
				error: summarized.error,
				exported: summarized.exported,
				skipped: summarized.skipped,
				writebackTopics: summarized.writebackTopics,
				writebackArticles: summarized.writebackArticles,
			};
			const next = await topicSettingsApi.update({
				last_sync_at: syncedAt,
				last_sync_status: summarized.status,
				last_sync_error:
					summarized.status.toLowerCase() === "failed" || summarized.error
						? summarized.error || summarized.summary
						: null,
				last_sync_result: syncResultPayload,
			});
			setTopicSettings(next);
			setLastSyncResult(syncResultPayload);
			if (!options?.silent) {
				const normalized = summarized.status.toLowerCase();
				if (normalized === "failed" || normalized === "error") {
					showToast(summarized.summary, "error");
				} else if (normalized === "awaiting_compile") {
					showToast(summarized.summary, "info");
				} else {
					showToast(summarized.summary, "success");
				}
			}
		} catch (error) {
			console.error("Failed to sync topics via bridge:", error);
			const message = error instanceof Error ? error.message : String(error);
			const failedAt = new Date().toISOString();
			try {
				const failResult = {
					status: "failed",
					at: failedAt,
					summary: t("同步失败"),
					detailLines: [message],
					hint: null,
					error: message,
				};
				const next = await topicSettingsApi.update({
					last_sync_at: failedAt,
					last_sync_status: "failed",
					last_sync_error: message,
					last_sync_result: failResult,
				});
				setTopicSettings(next);
			} catch {
				// ignore cache write failures
			}
			setLastSyncResult({
				status: "failed",
				at: failedAt,
				summary: t("同步失败"),
				detailLines: [message],
				hint: null,
				error: message,
			});
			if (!options?.silent) {
				showToast(`${t("主题同步失败")}: ${message}`, "error");
			}
		} finally {
			setTopicSyncing(false);
		}
	};

	const handleCheckTopicHealth = async (options?: { silent?: boolean }) => {
		setTopicHealthChecking(true);
		try {
			const report = await probeBridgeDoctor();
			const checkedAt = new Date().toISOString();
			const configuredPath = normalizeTopicPath(topicSettings.project_path);
			const healthFromDoctor = report.health;
			const reportedPath = normalizeTopicPath(
				healthFromDoctor?.project?.path || report.project?.path,
			);
			const projectPath = configuredPath || reportedPath || null;
			const pathMismatch = Boolean(
				configuredPath && reportedPath && configuredPath !== reportedPath,
			);
			const providerHealth =
				healthFromDoctor?.provider ||
				healthFromDoctor?.llm_wiki ||
				report.llm_wiki || {
					ok: false,
					status: "unknown",
					detail: null,
					checked_at: checkedAt,
				};
			const projectOk = Boolean(
				(healthFromDoctor?.project?.ok ?? report.project?.ok) && !pathMismatch,
			);
			const projectDetail = pathMismatch
				? `${t("路径与 Bridge 不一致")} · Bridge: ${reportedPath}`
				: healthFromDoctor?.project?.detail || null;
			const health: TopicSettings["health"] = {
				bridge: {
					ok: Boolean(healthFromDoctor?.bridge?.ok ?? report.bridge?.ok ?? report.ok),
					status:
						healthFromDoctor?.bridge?.status ||
						report.bridge?.status ||
						(report.ok ? "online" : "offline"),
					detail: healthFromDoctor?.bridge?.detail ?? report.bridge?.detail ?? null,
					checked_at: checkedAt,
					version:
						healthFromDoctor?.bridge?.version || report.bridge?.version || null,
				},
				llm_wiki: {
					ok: Boolean(providerHealth?.ok),
					status: providerHealth?.status || "unknown",
					detail: providerHealth?.detail ?? null,
					checked_at: providerHealth?.checked_at || checkedAt,
					version: providerHealth?.version || null,
					install: providerHealth?.install,
				},
				project: {
					ok: projectOk,
					name:
						healthFromDoctor?.project?.name ||
						report.project?.name ||
						null,
					path: projectPath,
					detail: projectDetail,
				},
			};
			const doctor = {
				ok: Boolean(report.ok ?? health.bridge?.ok),
				source: report.source || "bridge-doctor",
				aligned_with: report.aligned_with || "lumina doctor",
				checks: report.checks || [],
				summary: report.summary || {},
				hints: report.hints || [],
				cli: report.cli || {
					doctor: "lumina doctor",
					up: "lumina up --install",
					sync: "lumina sync",
					status: "lumina status",
				},
			};
			const knowledgeType =
				(providerHealth as { name?: string | null } | undefined)?.name ||
				topicSettings.knowledge_type ||
				"llm_wiki";
			const reportedProjectPath = projectPath || topicSettings.project_path || null;
			const patch: Parameters<typeof topicSettingsApi.update>[0] = {
				health,
				knowledge_type: knowledgeType,
				project_path: reportedProjectPath,
			};
			if (
				topicSettings.last_sync_status &&
				["completed", "success", "ok"].includes(topicSettings.last_sync_status) &&
				topicSettings.last_sync_error
			) {
				patch.last_sync_error = null;
			}
			const next = await topicSettingsApi.update(patch);
			setTopicSettings({ ...next, doctor });
			if (!options?.silent) {
				showToast(
					doctor.ok ? t("本机诊断通过") : t("本机诊断未通过"),
					doctor.ok ? "success" : "error",
				);
			}
			return health;
		} catch (error) {
			console.error("Failed to run topic doctor checks:", error);
			const message = humanizeTopicProbeError(error);
			const checkedAt = new Date().toISOString();
			const health: TopicSettings["health"] = {
				bridge: {
					ok: false,
					status: "offline",
					detail: message,
					checked_at: checkedAt,
					version: null,
				},
				llm_wiki: {
					ok: false,
					status: "unknown",
					detail: null,
					checked_at: checkedAt,
				},
				project: {
					ok: false,
					name: null,
					path: topicSettings.project_path || null,
					detail: null,
				},
			};
			const doctor = {
				ok: false,
				source: "bridge-doctor",
				aligned_with: "lumina doctor",
				checks: [],
				summary: {
					bridge: "offline",
					provider: "unknown",
					project: "unknown",
				},
				hints: ["lumina up --install", "lumina doctor"],
				cli: {
					doctor: "lumina doctor",
					up: "lumina up --install",
					sync: "lumina sync",
					status: "lumina status",
				},
			};
			try {
				const next = await topicSettingsApi.update({ health });
				setTopicSettings({ ...next, doctor });
			} catch {
				setTopicSettings((prev) => ({
					...prev,
					health,
					doctor,
				}));
			}
			if (!options?.silent) {
				showToast(t("本机诊断失败"), "error");
			}
			return health;
		} finally {
			setTopicHealthChecking(false);
		}
	};

	const fetchTopicSettings = async () => {
		setTopicSettingsLoading(true);
		try {
			const data = await topicSettingsApi.get();
			setTopicSettings({
				...data,
				knowledge_type: data.knowledge_type || "llm_wiki",
				project_path: data.project_path ?? null,
				auto_sync_on_enable: Boolean(data.auto_sync_on_enable),
				last_sync_result: data.last_sync_result ?? null,
				health: data.health || DEFAULT_TOPIC_SETTINGS.health,
			});
			const restored = normalizePersistedSyncResult(
				data.last_sync_result,
				data.last_sync_status,
				data.last_sync_at,
				data.last_sync_error,
			);
			if (restored) setLastSyncResult(restored);
			window.setTimeout(() => {
				void handleCheckTopicHealth({ silent: true });
			}, 0);
		} catch (error) {
			console.error("Failed to fetch topic settings:", error);
			showToast(t("主题解析配置加载失败"), "error");
		} finally {
			setTopicSettingsLoading(false);
		}
	};

	const handleSaveTopicSettings = async () => {
		setTopicSettingsSaving(true);
		const wasEnabled = Boolean(topicSettings.enabled);
		try {
			const payload: Parameters<typeof topicSettingsApi.update>[0] = {
				enabled: topicSettings.enabled,
				bridge_base_url: topicSettings.bridge_base_url,
			};
			if (topicBridgeTokenInput.trim()) {
				payload.bridge_token = topicBridgeTokenInput.trim();
			}
			const next = await topicSettingsApi.update(payload);
			setTopicSettings(next);
			setTopicBridgeTokenInput("");
			showToast(t("主题解析配置已保存"));
			const health = await handleCheckTopicHealth({ silent: true });
			if (next.enabled && !wasEnabled && health?.bridge?.ok) {
				await handleTopicSync({ silent: true });
			}
		} catch (error) {
			console.error("Failed to save topic settings:", error);
			showToast(t("主题解析配置保存失败"), "error");
		} finally {
			setTopicSettingsSaving(false);
		}
	};

	const copyTopicCommand = async (command?: string | null) => {
		const value = (command || "").trim();
		if (!value) {
			showToast(t("暂无可复制参数"), "info");
			return;
		}
		try {
			await navigator.clipboard.writeText(value);
			showToast(t("已复制"));
		} catch (error) {
			console.error(t("复制失败"), error);
			showToast(t("复制失败"), "error");
		}
	};


	const resolveCleanupErrorMessage = (error: unknown) => {
		if (error && typeof error === "object" && "response" in error) {
			const response = (error as { response?: { data?: { detail?: unknown }; status?: number } }).response;
			const detail = response?.data?.detail;
			if (typeof detail === "string" && detail.trim()) return detail;
			if (response?.status) return `HTTP ${response.status}`;
		}
		if (error instanceof Error && error.message) return error.message;
		return String(error || "");
	};

	const handlePreviewOrphanCleanup = async () => {
		if (!topicSettings.enabled) {
			showToast(t("请先启用主题能力"), "info");
			return;
		}
		setTopicCleanupLoading(true);
		try {
			// Backend fetches Bridge wiki keys itself to avoid browser CORS/network flakiness.
			const preview = await topicApi.cleanupOrphans({
				dry_run: true,
			});
			setTopicCleanupPreview(preview);
			if (!preview.orphan_count) {
				showToast(t("没有发现孤儿主题"));
				setTopicCleanupConfirmOpen(false);
				return;
			}
			setTopicCleanupConfirmOpen(true);
		} catch (error) {
			console.error("Failed to preview orphan topics:", error);
			showToast(resolveCleanupErrorMessage(error) || t("孤儿主题分析失败"), "error");
		} finally {
			setTopicCleanupLoading(false);
		}
	};

	const handleConfirmOrphanCleanup = async () => {
		if (!topicCleanupPreview?.orphan_count) {
			setTopicCleanupConfirmOpen(false);
			return;
		}
		setTopicCleanupLoading(true);
		try {
			const result = await topicApi.cleanupOrphans({
				dry_run: false,
			});
			setTopicCleanupConfirmOpen(false);
			setTopicCleanupPreview(null);
			showToast(
				t("已清理 {count} 个孤儿主题").replace(
					"{count}",
					String(result.deleted_count ?? result.orphan_count ?? 0),
				),
			);
		} catch (error) {
			console.error("Failed to cleanup orphan topics:", error);
			showToast(resolveCleanupErrorMessage(error) || t("孤儿主题清理失败"), "error");
		} finally {
			setTopicCleanupLoading(false);
		}
	};

	useEffect(() => {
		void fetchTopicSettings();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	const orphanConfirmMessage = (() => {
		if (!topicCleanupPreview?.orphan_count) {
			return t("没有发现孤儿主题");
		}
		const samples = (topicCleanupPreview.orphans || [])
			.slice(0, 8)
			.map((item) => item.title || item.key)
			.filter(Boolean);
		const extra =
			topicCleanupPreview.orphan_count > samples.length
				? t("等共 {count} 个").replace(
						"{count}",
						String(topicCleanupPreview.orphan_count),
					)
				: t("共 {count} 个").replace(
						"{count}",
						String(topicCleanupPreview.orphan_count),
					);
		const sampleText = samples.length ? samples.join("、") : "-";
		return t(
			"将清理知识库中已不存在的主题：{samples}（{extra}）。此操作不可恢复。",
		)
			.replace("{samples}", sampleText)
			.replace("{extra}", extra);
	})();

	return (
		<>
			<div className="bg-surface rounded-sm shadow-sm border border-border p-6 w-full min-w-0">
				<div className="mb-6 flex flex-wrap items-start justify-between gap-3">
					<div className="space-y-1">
						<h2 className="text-lg font-semibold text-text-1">{t("主题解析")}</h2>
						<p className="text-sm text-text-3">
							{t("连接本地知识库，将文章编译沉淀为主题")}
						</p>
					</div>
					<div className="flex flex-wrap items-center gap-2">
						<Button
							variant="secondary"
							onClick={() => setTopicInstallModalOpen(true)}
						>
							{t("知识库安装")}
						</Button>
						<Button
							variant="secondary"
							onClick={() => void handleTopicSync()}
							loading={topicSyncing}
							disabled={!topicSettings.enabled}
						>
							{t("立即同步")}
						</Button>
						<Button
							variant="secondary"
							onClick={() => void handlePreviewOrphanCleanup()}
							loading={topicCleanupLoading}
							disabled={!topicSettings.enabled || topicCleanupLoading}
						>
							{t("孤儿清理")}
						</Button>
						<Button
							variant="primary"
							onClick={() => void handleSaveTopicSettings()}
							loading={topicSettingsSaving}
						>
							{topicSettingsSaving ? t("保存中") : t("保存配置")}
						</Button>
					</div>
				</div>

				{topicSettingsLoading ? (
					<div className="text-sm text-text-3">{t("加载中...")}</div>
				) : (
					<div className="space-y-4">
						{(() => {
							const bridgeOnline = Boolean(topicSettings.health?.bridge?.ok);
							const llmOnline = Boolean(topicSettings.health?.llm_wiki?.ok);
							const projectPath =
								topicSettings.project_path ||
								topicSettings.health?.project?.path ||
								"";
							const projectOk = Boolean(topicSettings.health?.project?.ok);
							const projectMismatch = Boolean(
								topicSettings.health?.project?.detail,
							);
							const bridgeTitle = topicHealthChecking
								? t("检测中")
								: bridgeOnline
									? t("在线")
									: t("离线");
							const llmTitle = topicHealthChecking
								? t("检测中")
								: llmOnline
									? t("在线")
									: t("离线");
							const projectTitle = topicHealthChecking
								? t("检测中")
								: projectOk
									? topicSettings.health?.project?.name || t("已就绪")
									: projectMismatch
										? t("路径不一致")
										: projectPath
											? t("无效")
											: t("未配置");
							const syncTitle = formatTopicSyncStatus(
								topicSettings.last_sync_status,
							);
							const syncTime = topicSettings.last_sync_at
								? formatTopicDateTime(topicSettings.last_sync_at)
								: t("尚未同步");
							const bridgeVersion = topicSettings.health?.bridge?.version
								? `v${String(topicSettings.health.bridge.version).replace(/^v/i, "")}`
								: "";
							const llmVersion = topicSettings.health?.llm_wiki?.version
								? `v${String(topicSettings.health.llm_wiki.version).replace(/^v/i, "")}`
								: "";

							const statusCard = (
								label: string,
								title: string,
								detail?: string,
							) => (
								<div className="rounded-sm border border-border bg-surface px-4 py-3">
									<div className="text-xs text-text-3">{label}</div>
									<div className="mt-1 text-sm font-medium text-text-1">
										{title}
									</div>
									{detail ? (
										<div
											className="mt-1 truncate text-xs text-text-3"
											title={detail}
										>
											{detail}
										</div>
									) : null}
								</div>
							);

							return (
								<>
									<div className="grid grid-cols-1 gap-3 md:grid-cols-3">
										{statusCard("Bridge", bridgeTitle, bridgeVersion || undefined)}
										{statusCard(
											topicSettings.knowledge_type || "llm_wiki",
											llmTitle,
											llmVersion || undefined,
										)}
										{statusCard(
											t("知识库项目"),
											projectTitle,
											projectPath || undefined,
										)}
									</div>

									{(lastSyncResult || topicSettings.last_sync_status) && (
										<div className="rounded-sm border border-border bg-muted/40 px-4 py-3">
											<div className="flex flex-wrap items-start justify-between gap-2">
												<div className="min-w-0 flex-1">
													<div className="text-sm font-medium text-text-1">
														{lastSyncResult?.summary || syncTitle}
													</div>
													{(lastSyncResult?.detailLines?.length
														? lastSyncResult.detailLines
														: topicSettings.last_sync_error
															? [topicSettings.last_sync_error]
															: []
													)
														.slice(0, 2)
														.map((line) => (
															<div
																key={line}
																className="mt-1 truncate text-xs text-text-3"
																title={line}
															>
																{line}
															</div>
														))}
												</div>
												<div className="shrink-0 text-xs text-text-3">
													{lastSyncResult?.at
														? formatTopicDateTime(lastSyncResult.at)
														: syncTime}
												</div>
											</div>
										</div>
									)}

									<div className="flex items-center justify-between rounded-sm border border-border bg-surface p-4">
										<div>
											<div className="text-sm font-medium text-text-1">
												{t("启用主题能力")}
											</div>
											<div className="mt-1 text-xs text-text-3">
												{t(
													"开启后会展示主题模块；保存启用时会自动检测并尝试同步一次。",
												)}
											</div>
										</div>
										<label className="inline-flex cursor-pointer items-center gap-2 text-sm text-text-2">
											<CheckboxInput
												checked={topicSettings.enabled}
												onChange={(e) =>
													setTopicSettings((prev) => ({
														...prev,
														enabled: e.target.checked,
													}))
												}
												className="h-4 w-4"
											/>
											<span>
												{topicSettings.enabled ? t("已开启") : t("已关闭")}
											</span>
										</label>
									</div>

									<div className="grid grid-cols-1 gap-4 md:grid-cols-2">
										<div>
											<label className="mb-1 block text-sm text-text-2">
												{t("Bridge 地址")}
											</label>
											<TextInput
												value={topicSettings.bridge_base_url}
												onChange={(e) =>
													setTopicSettings((prev) => ({
														...prev,
														bridge_base_url: e.target.value,
													}))
												}
												placeholder="http://127.0.0.1:8787"
											/>
										</div>
										<div>
											<label className="mb-1 block text-sm text-text-2">
												{t("Bridge Token")}
											</label>
											<TextInput
												value={topicBridgeTokenInput}
												onChange={(e) => setTopicBridgeTokenInput(e.target.value)}
												placeholder={
													topicSettings.bridge_token_configured
														? t("已配置，留空表示不修改")
														: t("可选")
												}
											/>
										</div>
									</div>
								</>
							);
						})()}
					</div>
				)}
			</div>

			{topicInstallModalOpen ? (
				<ModalShell
					isOpen={topicInstallModalOpen}
					onClose={() => setTopicInstallModalOpen(false)}
					title={t("知识库安装")}
					widthClassName="max-w-lg"
					footer={
						<div className="flex justify-end">
							<Button
								type="button"
								variant="primary"
								onClick={() => setTopicInstallModalOpen(false)}
							>
								{t("关闭")}
							</Button>
						</div>
					}
				>
					{(() => {
						const installCommand =
							"curl -fsSL https://raw.githubusercontent.com/shawnxie94/lumina/main/scripts/install-lumina-cli.sh | bash";
						const setupCommand = "lumina up --install";
						const commandBox = (label: string, command: string) => (
							<div className="rounded-sm border border-border bg-muted px-3 py-2">
								<div className="mb-1 flex items-center justify-between gap-2">
									<div className="text-xs text-text-3">{label}</div>
									<IconButton
										type="button"
										variant="ghost"
										size="sm"
										title={t("复制")}
										onClick={() => void copyTopicCommand(command)}
									>
										<IconCopy className="h-3.5 w-3.5" />
									</IconButton>
								</div>
								<code className="block break-all text-xs text-text-1">
									{command}
								</code>
							</div>
						);
						const steps = [
							{
								title: t("安装 Lumina CLI"),
								body: commandBox(t("安装命令"), installCommand),
							},
							{
								title: t("启动 Bridge 与知识库"),
								body: commandBox(t("开启命令"), setupCommand),
							},
							{
								title: t("刷新设置页，自动检测连接状态"),
							},
						];
						return (
							<div className="space-y-4 text-sm text-text-2">
								{steps.map((step, index) => (
									<div key={step.title} className="space-y-2">
										<div className="font-medium text-text-1">
											{index + 1}. {step.title}
										</div>
										{"body" in step ? step.body : null}
									</div>
								))}
							</div>
						);
					})()}
				</ModalShell>
			) : null}

			<ConfirmModal
				isOpen={topicCleanupConfirmOpen}
				title={t("孤儿清理")}
				message={orphanConfirmMessage}
				confirmText={t("确认清理")}
				cancelText={t("取消")}
				onCancel={() => {
					if (topicCleanupLoading) return;
					setTopicCleanupConfirmOpen(false);
				}}
				onConfirm={() => handleConfirmOrphanCleanup()}
			/>
		</>
	);
}
