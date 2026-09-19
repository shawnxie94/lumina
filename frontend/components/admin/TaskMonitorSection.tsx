import Link from "next/link";
import type { Dispatch, SetStateAction } from "react";
import { ArticleSearchSelect } from "@/components/ArticleSearchSelect";
import Button from "@/components/Button";
import FilterSelect from "@/components/FilterSelect";
import IconButton from "@/components/IconButton";
import FormField from "@/components/ui/FormField";
import ModalShell from "@/components/ui/ModalShell";
import SelectableButton from "@/components/ui/SelectableButton";
import SelectField from "@/components/ui/SelectField";
import StatusTag from "@/components/ui/StatusTag";
import {
	IconArrowDown,
	IconArrowUp,
	IconCopy,
	IconRefresh,
	IconTrash,
} from "@/components/icons";
import type {
	AITaskTimelineEvent,
	AITaskTimelineResponse,
	AITaskTimelineUsage,
	ModelAPIConfig,
	PromptConfig,
} from "@/lib/api";
import { getAITaskFilterOptions, getAITaskLabel } from "@/lib/aiTaskMeta";
import { useI18n } from "@/lib/i18n";

export interface AITaskItem {
	id: string;
	root_task_id?: string | null;
	latest_task_id?: string | null;
	chain_length?: number;
	has_continuations?: boolean;
	article_id: string | null;
	article_title?: string | null;
	article_slug?: string | null;
	article_kind?: string | null;
	task_type: string;
	content_type: string | null;
	status: string;
	attempts: number;
	max_attempts: number;
	run_at: string | null;
	locked_at: string | null;
	locked_by: string | null;
	last_error: string | null;
	created_at: string;
	updated_at: string;
	finished_at: string | null;
}

export interface TaskTimelineNode {
	id: string;
	kind: "event" | "usage";
	created_at: string;
	event?: AITaskTimelineEvent;
	usage?: AITaskTimelineUsage;
}

export interface TaskTimelineChain {
	id: string;
	index: number;
	task_id: string | null;
	root_task_id: string | null;
	trigger_event_type: string | null;
	start_at: string;
	events: AITaskTimelineEvent[];
	usage: AITaskTimelineUsage[];
	nodes: TaskTimelineNode[];
}

const TASK_CHAIN_MARKER_EVENT_TYPES = new Set([
	"enqueued",
	"retried",
	"stale_lock_requeued",
	"retry_scheduled",
]);

const TASK_PROGRESS_EVENT_TYPES = new Set([
	"enqueued",
	"retried",
	"claimed",
	"chunking_plan",
	"media_ingest",
	"retry_scheduled",
	"stale_lock_requeued",
	"retry_skipped_duplicate",
]);

const parseTimelineTimestamp = (value: string) => {
	const timestamp = Date.parse(value);
	return Number.isNaN(timestamp) ? 0 : timestamp;
};

const sortTimelineEntries = <T extends { created_at: string }>(entries: T[]) =>
	[...entries].sort((a, b) => {
		const timestampA = parseTimelineTimestamp(a.created_at);
		const timestampB = parseTimelineTimestamp(b.created_at);
		if (timestampA !== timestampB) return timestampA - timestampB;
		return a.created_at.localeCompare(b.created_at);
	});

const buildTimelineNodes = (
	events: AITaskTimelineEvent[],
	usage: AITaskTimelineUsage[],
) => {
	const eventNodes: TaskTimelineNode[] = events.map((event) => ({
		id: `event:${event.id}`,
		kind: "event",
		created_at: event.created_at,
		event,
	}));
	const usageNodes: TaskTimelineNode[] = usage.map((item) => ({
		id: `usage:${item.id}`,
		kind: "usage",
		created_at: item.created_at,
		usage: item,
	}));
	return [...eventNodes, ...usageNodes].sort((a, b) => {
		const timestampA = parseTimelineTimestamp(a.created_at);
		const timestampB = parseTimelineTimestamp(b.created_at);
		if (timestampA !== timestampB) return timestampA - timestampB;
		if (a.kind === b.kind) return a.id.localeCompare(b.id);
		return a.kind === "event" ? -1 : 1;
	});
};

export const buildTaskTimelineChains = (
	timeline: AITaskTimelineResponse,
): TaskTimelineChain[] => {
	const events = sortTimelineEntries(timeline.events || []);
	const usage = sortTimelineEntries(timeline.usage || []);
	if (events.length === 0 && usage.length === 0) return [];

	if (events.length === 0) {
		return [
			{
				id: "chain:0",
				index: 0,
				task_id: usage[0]?.task_id || timeline.task.latest_task_id || timeline.task.id,
				root_task_id:
					usage[0]?.root_task_id ||
					timeline.task.root_task_id ||
					timeline.task.id,
				trigger_event_type: null,
				start_at: usage[0]?.created_at || timeline.task.created_at,
				events: [],
				usage,
				nodes: buildTimelineNodes([], usage),
			},
		];
	}

	const markerIndexes = events
		.map((event, index) =>
			TASK_CHAIN_MARKER_EVENT_TYPES.has(event.event_type) ? index : -1,
		)
		.filter((index) => index >= 0);
	if (markerIndexes.length === 0) {
		markerIndexes.push(0);
	} else if (markerIndexes[0] !== 0) {
		markerIndexes.unshift(0);
	}

	const chains: TaskTimelineChain[] = markerIndexes.map((startIndex, chainIndex) => {
		const nextStartIndex =
			chainIndex < markerIndexes.length - 1
				? markerIndexes[chainIndex + 1]
				: events.length;
		const chainEvents = events.slice(startIndex, nextStartIndex);
		const chainStartAt = chainEvents[0]?.created_at || timeline.task.created_at;
		const nextChainStartAt = events[nextStartIndex]?.created_at || null;
		const chainStartTs = parseTimelineTimestamp(chainStartAt);
		const nextChainStartTs = nextChainStartAt
			? parseTimelineTimestamp(nextChainStartAt)
			: null;
		const chainUsage = usage.filter((item) => {
			const usageTimestamp = parseTimelineTimestamp(item.created_at);
			if (usageTimestamp < chainStartTs) return false;
			if (nextChainStartTs != null && usageTimestamp >= nextChainStartTs) {
				return false;
			}
			return true;
		});
		return {
			id: `chain:${chainEvents[0]?.id || chainIndex}`,
			index: chainIndex,
			task_id:
				chainEvents[0]?.task_id ||
				chainUsage[0]?.task_id ||
				timeline.task.latest_task_id ||
				timeline.task.id,
			root_task_id:
				chainEvents[0]?.root_task_id ||
				chainUsage[0]?.root_task_id ||
				timeline.task.root_task_id ||
				timeline.task.id,
			trigger_event_type: chainEvents[0]?.event_type || null,
			start_at: chainStartAt,
			events: chainEvents,
			usage: chainUsage,
			nodes: [],
		};
	});

	const assignedUsageIds = new Set<string>();
	chains.forEach((chain) => {
		chain.usage.forEach((item) => assignedUsageIds.add(item.id));
	});
	const orphanUsage = usage.filter((item) => !assignedUsageIds.has(item.id));
	if (orphanUsage.length > 0) {
		const targetChain = chains[chains.length - 1];
		targetChain.usage = sortTimelineEntries([...targetChain.usage, ...orphanUsage]);
	}

	return chains.map((chain) => ({
		...chain,
		nodes: buildTimelineNodes(chain.events, chain.usage),
	}));
};

export const formatTaskEventDetails = (details: AITaskTimelineEvent["details"]) => {
	if (!details) return "";
	if (typeof details === "string") {
		try {
			const parsed = JSON.parse(details);
			return JSON.stringify(parsed, null, 2);
		} catch {
			return details;
		}
	}
	return JSON.stringify(details, null, 2);
};

type TaskMonitorSectionProps = {
	hasTaskFilters: boolean;
	taskItems: AITaskItem[];
	taskLoading: boolean;
	taskPage: number;
	taskPageSize: number;
	taskTotal: number;
	taskStatusFilter: string;
	taskTypeFilter: string;
	taskArticleTitleFilter: string;
	pendingTaskActionIds: Set<string>;
	openingTaskTimelineId: string | null;
	showTaskRetryModal: boolean;
	retryTargetTask: AITaskItem | null;
	retryTaskPromptType: string | null;
	retryTaskModelConfigId: string;
	retryTaskPromptConfigId: string;
	setRetryTaskModelConfigId: Dispatch<SetStateAction<string>>;
	setRetryTaskPromptConfigId: Dispatch<SetStateAction<string>>;
	retryTaskModelOptions: ModelAPIConfig[];
	retryTaskPromptOptions: PromptConfig[];
	retryTaskOptionsLoading: boolean;
	retryTaskSubmitting: boolean;
	showTaskTimelineModal: boolean;
	taskTimelineLoading: boolean;
	taskTimelineRefreshing: boolean;
	taskTimelineError: string;
	selectedTaskTimeline: AITaskTimelineResponse | null;
	taskTimelineChains: TaskTimelineChain[];
	selectedTaskTimelineChain: TaskTimelineChain | null;
	selectedTaskTimelineUsage: AITaskTimelineUsage | null;
	taskTimelineNodes: TaskTimelineNode[];
	selectedTaskTimelineNode: TaskTimelineNode | null;
	fetchTasks: () => Promise<void>;
	handleOpenTaskTimeline: (
		taskId: string,
		preferredUsageId?: string | null,
	) => Promise<void>;
	handleCancelTask: (taskId: string) => Promise<void>;
	handleOpenTaskRetryModal: (task: AITaskItem) => Promise<void>;
	handleSubmitTaskRetry: () => Promise<void>;
	closeTaskRetryModal: () => void;
	closeTaskTimelineModal: () => void;
	handleRefreshTaskTimeline: () => Promise<void>;
	handleCopyTaskEventDetails: () => Promise<void>;
	openUsagePayload: (title: string, payload: string | null) => void;
	getUsageStatusLabel: (status: string) => string;
	setTaskPage: Dispatch<SetStateAction<number>>;
	setTaskPageSize: Dispatch<SetStateAction<number>>;
	setTaskStatusFilter: Dispatch<SetStateAction<string>>;
	setTaskTypeFilter: Dispatch<SetStateAction<string>>;
	setTaskArticleIdFilter: Dispatch<SetStateAction<string>>;
	setTaskArticleTitleFilter: Dispatch<SetStateAction<string>>;
	setSelectedTaskTimelineChainId: Dispatch<SetStateAction<string | null>>;
	setSelectedTaskTimelineUsageId: Dispatch<SetStateAction<string | null>>;
	setSelectedTaskEventId: Dispatch<SetStateAction<string | null>>;
};

export default function TaskMonitorSection({
	hasTaskFilters,
	taskItems,
	taskLoading,
	taskPage,
	taskPageSize,
	taskTotal,
	taskStatusFilter,
	taskTypeFilter,
	taskArticleTitleFilter,
	pendingTaskActionIds,
	openingTaskTimelineId,
	showTaskRetryModal,
	retryTargetTask,
	retryTaskPromptType,
	retryTaskModelConfigId,
	retryTaskPromptConfigId,
	setRetryTaskModelConfigId,
	setRetryTaskPromptConfigId,
	retryTaskModelOptions,
	retryTaskPromptOptions,
	retryTaskOptionsLoading,
	retryTaskSubmitting,
	showTaskTimelineModal,
	taskTimelineLoading,
	taskTimelineRefreshing,
	taskTimelineError,
	selectedTaskTimeline,
	taskTimelineChains,
	selectedTaskTimelineChain,
	selectedTaskTimelineUsage,
	taskTimelineNodes,
	selectedTaskTimelineNode,
	fetchTasks,
	handleOpenTaskTimeline,
	handleCancelTask,
	handleOpenTaskRetryModal,
	handleSubmitTaskRetry,
	closeTaskRetryModal,
	closeTaskTimelineModal,
	handleRefreshTaskTimeline,
	handleCopyTaskEventDetails,
	openUsagePayload,
	getUsageStatusLabel,
	setTaskPage,
	setTaskPageSize,
	setTaskStatusFilter,
	setTaskTypeFilter,
	setTaskArticleIdFilter,
	setTaskArticleTitleFilter,
	setSelectedTaskTimelineChainId,
	setSelectedTaskTimelineUsageId,
	setSelectedTaskEventId,
}: TaskMonitorSectionProps) {
	const { t } = useI18n();

	const getTaskTargetHref = (
		task: {
			article_id: string | null;
			article_slug?: string | null;
			article_kind?: string | null;
		},
	) => {
		if (task.article_kind === "review" && task.article_slug) {
			return `/columns/${task.article_slug}`;
		}
		if (
			(task.article_kind === "article" || !task.article_kind) &&
			(task.article_slug || task.article_id)
		) {
			return `/article/${task.article_slug || task.article_id}`;
		}
		return null;
	};

	const getTaskTargetLabel = () => t("查看");

	const getTaskTargetTitle = (
		task: {
			article_id: string | null;
			article_title?: string | null;
			article_kind?: string | null;
		},
	) =>
		task.article_title ||
		task.article_id ||
		(task.article_kind === "review" ? t("未知专栏文章") : t("未知文章"));

	const getTaskStatusLabel = (status: string) => {
		if (status === "completed") return t("已完成");
		if (status === "failed") return t("失败");
		if (status === "processing") return t("处理中");
		if (status === "cancelled") return t("已取消");
		return t("待处理");
	};

	const getTaskEventLabel = (eventType: string) => {
		if (eventType === "enqueued") return t("入队");
		if (eventType === "claimed") return t("领取");
		if (eventType === "retry_scheduled") return t("安排重试");
		if (eventType === "retried") return t("手动重试");
		if (eventType === "retry_skipped_duplicate")
			return t("重试跳过（重复任务）");
		if (eventType === "completed") return t("完成");
		if (eventType === "failed") return t("失败");
		if (eventType === "cancelled_by_api") return t("手动取消");
		if (eventType === "stale_lock_requeued") return t("锁过期重排");
		if (eventType === "stale_lock_failed") return t("锁过期失败");
		if (eventType === "media_ingest") return t("图片转储");
		return eventType;
	};

	const getTaskEventStatus = (event: AITaskTimelineEvent): string | null => {
		if (event.to_status) return event.to_status;
		if (event.event_type === "completed") return "completed";
		if (event.event_type === "failed" || event.event_type === "stale_lock_failed")
			return "failed";
		if (event.event_type === "claimed") return "processing";
		if (event.event_type === "cancelled_by_api") return "cancelled";
		if (
			event.event_type === "enqueued" ||
			event.event_type === "retry_scheduled" ||
			event.event_type === "retried" ||
			event.event_type === "retry_skipped_duplicate" ||
			event.event_type === "stale_lock_requeued"
		) {
			return "pending";
		}
		return null;
	};

	const getTaskEventVisual = (
		event: AITaskTimelineEvent,
		statusOverride?: string | null,
	): {
		tagTone: "neutral" | "info" | "success" | "warning" | "danger";
		tagClassName?: string;
		dotClassName: string;
		lineClassName: string;
		cardClassName: string;
	} => {
		const status = statusOverride ?? getTaskEventStatus(event);
		const isRetryEvent =
			event.event_type === "retry_scheduled" ||
			event.event_type === "retried" ||
			event.event_type === "retry_skipped_duplicate";

		if (status === "completed") {
			return {
				tagTone: "success",
				dotClassName: "bg-success-ink",
				lineClassName: "bg-success-soft",
				cardClassName:
					"border-success-soft/70 bg-success-soft/20 hover:border-success-soft",
			};
		}
		if (status === "failed") {
			return {
				tagTone: "danger",
				dotClassName: "bg-danger-ink",
				lineClassName: "bg-danger-soft",
				cardClassName:
					"border-danger-soft/70 bg-danger-soft/20 hover:border-danger-soft",
			};
		}
		if (status === "processing") {
			return {
				tagTone: "info",
				dotClassName: "bg-info-ink",
				lineClassName: "bg-info-soft",
				cardClassName:
					"border-info-soft/70 bg-info-soft/20 hover:border-info-soft",
			};
		}
		if (status === "cancelled") {
			return {
				tagTone: "neutral",
				tagClassName: "bg-violet-100 text-violet-700",
				dotClassName: "bg-violet-500",
				lineClassName: "bg-violet-200",
				cardClassName:
					"border-violet-200 bg-violet-50 hover:border-violet-300",
			};
		}
		if (status === "pending") {
			if (isRetryEvent) {
				return {
					tagTone: "warning",
					dotClassName: "bg-warning-ink",
					lineClassName: "bg-warning-soft",
					cardClassName:
						"border-warning-soft/70 bg-warning-soft/20 hover:border-warning-soft",
				};
			}
			return {
				tagTone: "neutral",
				dotClassName: "bg-text-3",
				lineClassName: "bg-border",
				cardClassName: "border-border bg-surface hover:border-text-3/40",
			};
		}
		return {
			tagTone: "neutral",
			dotClassName: "bg-text-3",
			lineClassName: "bg-border",
			cardClassName: "border-border bg-surface hover:border-text-3/40",
		};
	};

	const getTaskEventStatusLabel = (
		event: AITaskTimelineEvent,
		statusOverride?: string | null,
	) => {
		const status = statusOverride ?? getTaskEventStatus(event);
		if (status) return getTaskStatusLabel(status);
		if (event.event_type === "media_ingest") return t("信息");
		return t("未知");
	};

	const getTaskEventSummary = (event: AITaskTimelineEvent) => {
		if (event.message?.trim()) return event.message.trim();
		if (event.from_status && event.to_status) {
			return `${event.from_status} -> ${event.to_status}`;
		}
		return t("无附加说明");
	};

	const getTaskTimelineChainModelLabel = (chain: TaskTimelineChain) => {
		const modelNames = Array.from(
			new Set(
				chain.usage
					.map((usage) => usage.model_api_config_name?.trim())
					.filter((name): name is string => Boolean(name)),
			),
		);
		if (modelNames.length === 0) return t("未知模型");
		if (modelNames.length === 1) return modelNames[0];
		return `${modelNames[0]} +${modelNames.length - 1}`;
	};

	const getTaskChainAdjustmentLabel = (task: AITaskItem) => {
		if (!task.has_continuations || !task.chain_length || task.chain_length <= 1) {
			return null;
		}
		return t("已调整 {count} 次").replace(
			"{count}",
			String(task.chain_length - 1),
		);
	};

	const getTaskTimelineExecutionLabel = (taskId?: string | null) => {
		const rootTaskId =
			selectedTaskTimeline?.task.root_task_id || selectedTaskTimeline?.task.id;
		if (!taskId || !rootTaskId) return null;
		if (taskId === rootTaskId) return t("初始生成");
		const continuationTaskIds = Array.from(
			new Set(
				taskTimelineChains
					.map((chain) => chain.task_id)
					.filter((chainTaskId): chainTaskId is string => Boolean(chainTaskId))
					.filter((chainTaskId) => chainTaskId !== rootTaskId),
			),
		);
		const continuationIndex = continuationTaskIds.indexOf(taskId);
		if (continuationIndex < 0) return t("续写");
		return `${t("续写")} #${continuationIndex + 1}`;
	};

	const getTaskTimelineChainLabel = (chain: TaskTimelineChain) => {
		const executionLabel = getTaskTimelineExecutionLabel(chain.task_id);
		const modelLabel = getTaskTimelineChainModelLabel(chain);
		if (!executionLabel) return modelLabel;
		return `${executionLabel} · ${modelLabel}`;
	};

	const getTaskTimelineNodeDisplayStatus = (
		node: TaskTimelineNode,
		nodes: TaskTimelineNode[],
	): string | null => {
		if (node.kind === "usage" && node.usage) {
			return node.usage.status;
		}
		const event = node.event as AITaskTimelineEvent;
		const baseStatus = getTaskEventStatus(event);
		if (
			baseStatus === "completed" ||
			baseStatus === "failed" ||
			baseStatus === "cancelled"
		) {
			return baseStatus;
		}
		const nodeIndex = nodes.findIndex((item) => item.id === node.id);
		const hasLaterNode = nodeIndex >= 0 && nodeIndex < nodes.length - 1;
		if (hasLaterNode && TASK_PROGRESS_EVENT_TYPES.has(event.event_type)) {
			return "completed";
		}
		return baseStatus;
	};

	const getTaskTimelineChainStatus = (chain: TaskTimelineChain) => {
		const latestNode = chain.nodes[chain.nodes.length - 1];
		if (!latestNode) return null;
		return getTaskTimelineNodeDisplayStatus(latestNode, chain.nodes);
	};

	const getTaskUsageVisual = (
		usage: AITaskTimelineUsage,
		statusOverride?: string | null,
	): {
		tagTone: "neutral" | "info" | "success" | "warning" | "danger";
		tagClassName?: string;
		dotClassName: string;
		lineClassName: string;
		cardClassName: string;
	} => {
		const status = statusOverride ?? usage.status;
		if (status === "completed") {
			return {
				tagTone: "success",
				dotClassName: "bg-success-ink",
				lineClassName: "bg-success-soft",
				cardClassName:
					"border-success-soft/70 bg-success-soft/20 hover:border-success-soft",
			};
		}
		if (status === "failed") {
			return {
				tagTone: "danger",
				dotClassName: "bg-danger-ink",
				lineClassName: "bg-danger-soft",
				cardClassName:
					"border-danger-soft/70 bg-danger-soft/20 hover:border-danger-soft",
			};
		}
		if (status === "processing") {
			return {
				tagTone: "info",
				dotClassName: "bg-info-ink",
				lineClassName: "bg-info-soft",
				cardClassName:
					"border-info-soft/70 bg-info-soft/20 hover:border-info-soft",
			};
		}
		return {
			tagTone: "neutral",
			dotClassName: "bg-text-3",
			lineClassName: "bg-border",
			cardClassName: "border-border bg-surface hover:border-text-3/40",
		};
	};

	const getTaskTimelineNodeVisual = (
		node: TaskTimelineNode,
		nodes: TaskTimelineNode[],
	) => {
		const displayStatus = getTaskTimelineNodeDisplayStatus(node, nodes);
		if (node.kind === "usage" && node.usage) {
			return getTaskUsageVisual(node.usage, displayStatus);
		}
		return getTaskEventVisual(
			node.event as AITaskTimelineEvent,
			displayStatus,
		);
	};

	const getTaskTimelineNodeLabel = (node: TaskTimelineNode) => {
		if (node.kind === "usage") {
			const executionLabel = getTaskTimelineExecutionLabel(node.usage?.task_id);
			return executionLabel ? `${t("AI调用")} · ${executionLabel}` : t("AI调用");
		}
		return getTaskEventLabel((node.event as AITaskTimelineEvent).event_type);
	};

	const getTaskTimelineNodeSummary = (node: TaskTimelineNode) => {
		if (node.kind === "usage" && node.usage) {
			const modelLabel = node.usage.model_api_config_name || t("未知模型");
			const tokenLabel =
				node.usage.total_tokens != null ? `${node.usage.total_tokens} tokens` : "-";
			const chunkLabel =
				node.usage.chunk_index != null
					? `${t("分块")} #${node.usage.chunk_index + 1}`
					: null;
			const continueLabel =
				node.usage.continue_round != null
					? `${t("续写")} #${node.usage.continue_round + 1}`
					: null;
			return [modelLabel, tokenLabel, chunkLabel, continueLabel]
				.filter(Boolean)
				.join(" · ");
		}
		return getTaskEventSummary(node.event as AITaskTimelineEvent);
	};

	const getTaskTimelineNodeStatusFlow = (
		node: TaskTimelineNode,
		nodes: TaskTimelineNode[],
	) => {
		if (
			node.kind === "event" &&
			node.event?.from_status &&
			node.event?.to_status
		) {
			return `${node.event.from_status} → ${node.event.to_status}`;
		}
		const displayStatus = getTaskTimelineNodeDisplayStatus(node, nodes);
		if (!displayStatus) return t("状态未知");
		return `${t("状态")}: ${getTaskStatusLabel(displayStatus)}`;
	};

	const formatTimelineDateTime = (value: string) => {
		const timestamp = new Date(value);
		if (Number.isNaN(timestamp.getTime())) return value;
		return timestamp.toLocaleString("zh-CN", {
			hour12: false,
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
			hour: "2-digit",
			minute: "2-digit",
			second: "2-digit",
		});
	};

	return (
		<>
		<div className="bg-surface rounded-sm shadow-sm border border-border p-6 w-full min-w-0">
			<div className="mb-6 flex flex-wrap items-start justify-between gap-3">
				<div className="space-y-1">
					<h2 className="text-lg font-semibold text-text-1">
						{t("AI 任务监控")}
					</h2>
					<p className="text-sm text-text-3">
						{t("查看、重试或取消后台任务")}
					</p>
				</div>
				<div className="flex flex-wrap items-center gap-2">
					<Button
						onClick={() => {
							setTaskStatusFilter("");
							setTaskTypeFilter("");
							setTaskArticleIdFilter("");
							setTaskArticleTitleFilter("");
							setTaskPage(1);
						}}
						variant="secondary"
						disabled={!hasTaskFilters}
					>
						{t("清空筛选")}
					</Button>
					<Button onClick={fetchTasks} variant="secondary">
						{t("刷新")}
					</Button>
				</div>
			</div>

			<div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
				<FilterSelect
					label={t("状态")}
					value={taskStatusFilter}
					onChange={(value) => {
						setTaskStatusFilter(value);
						setTaskPage(1);
					}}
					options={[
						{ value: "", label: t("全部") },
						{ value: "pending", label: t("待处理") },
						{ value: "processing", label: t("处理中") },
						{ value: "completed", label: t("已完成") },
						{ value: "failed", label: t("失败") },
						{ value: "cancelled", label: t("已取消") },
					]}
				/>
				<FilterSelect
					label={t("任务类型")}
					value={taskTypeFilter}
					onChange={(value) => {
						setTaskTypeFilter(value);
						setTaskPage(1);
					}}
					options={[
						{ value: "", label: t("全部") },
						...getAITaskFilterOptions(t),
					]}
				/>
				<ArticleSearchSelect
					label={t("文章名称")}
					value={taskArticleTitleFilter}
					onChange={(value) => {
						setTaskArticleTitleFilter(value);
						setTaskPage(1);
					}}
					placeholder={t("输入文章名称搜索...")}
				/>
			</div>

			{taskLoading ? (
				<div className="rounded-sm border border-border bg-muted px-4 py-8 text-center text-sm text-text-3">
					{t("加载中")}
				</div>
			) : taskItems.length === 0 ? (
				<div className="rounded-sm border border-border bg-muted px-4 py-8 text-center text-sm text-text-3">
					{hasTaskFilters ? t("暂无匹配任务") : t("暂无任务")}
				</div>
			) : (
				<div className="w-full overflow-x-auto">
					<table className="w-full table-auto text-sm">
						<thead className="bg-muted text-text-2">
							<tr>
								<th className="w-[11%] text-left px-4 py-3">
									{t("任务")}
								</th>
								<th className="w-[12%] whitespace-nowrap text-left px-4 py-3">
									{t("状态")}
								</th>
								<th className="w-[8%] whitespace-nowrap text-left px-4 py-3">
									{t("尝试")}
								</th>
								<th className="w-[18%] text-left px-4 py-3">
									{t("文章")}
								</th>
								<th className="w-[28%] whitespace-nowrap text-left px-4 py-3">
									{t("时间")}
								</th>
								<th className="w-[12%] whitespace-nowrap text-right px-4 py-3">
									{t("操作")}
								</th>
							</tr>
						</thead>
						<tbody className="divide-y divide-border">
							{taskItems.map((task) => (
								<tr
									key={task.id}
									className="transition-colors hover:bg-muted"
								>
									<td className="px-4 py-3">
										<button
											type="button"
											onClick={() =>
												handleOpenTaskTimeline(task.id)
											}
											className="w-full text-left text-primary hover:underline disabled:opacity-50 disabled:cursor-not-allowed"
											disabled={openingTaskTimelineId === task.id}
											aria-busy={
												openingTaskTimelineId === task.id ||
												undefined
											}
										>
											<div className="font-medium text-text-1 truncate">
												{getAITaskLabel(
													task.task_type,
													task.content_type,
													t,
												)}
											</div>
											<div className="text-xs text-text-3">
												#{task.id.slice(0, 8)}
											</div>
											{getTaskChainAdjustmentLabel(task) && (
												<div className="text-xs text-text-3">
													{getTaskChainAdjustmentLabel(task)}
												</div>
											)}
											{openingTaskTimelineId === task.id && (
												<div className="text-xs text-text-3">
													{t("加载中...")}
												</div>
											)}
										</button>
									</td>
									<td className="px-4 py-3">
										<StatusTag
											tone={
												task.status === "completed"
													? "success"
													: task.status === "failed"
														? "danger"
														: task.status === "processing"
															? "info"
															: task.status === "cancelled"
																? "neutral"
																: "warning"
											}
										>
											{getTaskStatusLabel(task.status)}
										</StatusTag>
										{task.last_error && (
											<div
												className="text-xs text-danger mt-1 line-clamp-1"
												title={task.last_error}
											>
												{task.last_error}
											</div>
										)}
									</td>
									<td className="px-4 py-3 text-text-2">
										{task.attempts}/{task.max_attempts}
									</td>
								<td className="px-4 py-3 text-text-2">
										{(() => {
											const href = getTaskTargetHref(task);
											if (!href) return "-";
											return (
												<Link
													href={href}
													className="text-primary hover:underline"
													title={getTaskTargetTitle(task)}
													target="_blank"
													rel="noopener noreferrer"
												>
													{getTaskTargetLabel()}
												</Link>
											);
										})()}
									</td>
									<td className="px-4 py-3 text-text-3">
										<div>
											{t("创建")}：
											{new Date(task.created_at).toLocaleString(
												"zh-CN",
											)}
										</div>
										{task.finished_at && (
											<div>
												{t("完成")}：
												{new Date(
													task.finished_at,
												).toLocaleString("zh-CN")}
											</div>
										)}
									</td>
									<td className="px-4 py-3 text-right">
										<div className="flex items-center justify-end gap-2">
											<IconButton
												onClick={() =>
													handleOpenTaskRetryModal(task)
												}
												variant="ghost"
												size="sm"
												title={t("重试")}
												loading={pendingTaskActionIds.has(
													task.id,
												)}
												disabled={
													task.status === "processing" ||
													task.status === "pending" ||
													pendingTaskActionIds.has(task.id)
												}
											>
												<IconRefresh className="h-4 w-4" />
											</IconButton>
											<IconButton
												onClick={() => handleCancelTask(task.id)}
												variant="danger"
												size="sm"
												title={t("取消")}
												loading={pendingTaskActionIds.has(
													task.id,
												)}
												disabled={pendingTaskActionIds.has(
													task.id,
												)}
											>
												<IconTrash className="h-4 w-4" />
											</IconButton>
										</div>
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}

			<div className="mt-6 flex items-center justify-between">
				<div className="flex items-center gap-2 text-sm text-text-2">
					<span>{t("每页显示")}</span>
					<SelectField
						value={taskPageSize}
						onChange={(value) => {
							setTaskPageSize(Number(value));
							setTaskPage(1);
						}}
						className="w-20"
						popupClassName="select-modern-dropdown"
						options={[
							{ value: 10, label: "10" },
							{ value: 20, label: "20" },
							{ value: 50, label: "50" },
						]}
					/>
					<span>
						{t("条")}，{t("共")} {taskTotal} {t("条")}
					</span>
				</div>
				<div className="flex flex-wrap items-center gap-2">
					<Button
						onClick={() => setTaskPage((p) => Math.max(1, p - 1))}
						disabled={taskPage === 1}
						variant="secondary"
						size="sm"
					>
						{t("上一页")}
					</Button>
					<span className="min-w-[112px] px-4 py-2 text-center text-sm bg-surface border border-border rounded-sm text-text-2">
						{t("第")} {taskPage} /{" "}
						{Math.ceil(taskTotal / taskPageSize) || 1} {t("页")}
					</span>
					<Button
						onClick={() => setTaskPage((p) => p + 1)}
						disabled={taskPage * taskPageSize >= taskTotal}
						variant="secondary"
						size="sm"
					>
						{t("下一页")}
					</Button>
				</div>
			</div>
	</div>

		{showTaskRetryModal && (
			<ModalShell
				isOpen={showTaskRetryModal}
				onClose={closeTaskRetryModal}
				title={t("重试任务")}
				widthClassName="max-w-md"
				footerClassName="border-t border-border bg-muted p-6"
				footer={
					<div className="flex justify-end gap-2">
						<Button
							type="button"
							variant="secondary"
							onClick={closeTaskRetryModal}
							disabled={retryTaskSubmitting}
						>
							{t("取消")}
						</Button>
						<Button
							type="button"
							variant="primary"
							onClick={handleSubmitTaskRetry}
							loading={retryTaskSubmitting}
							disabled={retryTaskOptionsLoading || retryTaskSubmitting}
						>
							{t("提交重试")}
						</Button>
					</div>
				}
			>
				<div className="space-y-4">
					{retryTargetTask && (
						<div className="rounded-sm border border-border bg-muted px-3 py-2 text-xs text-text-2">
							<div className="font-medium text-text-1">
								{getAITaskLabel(
									retryTargetTask.task_type,
									retryTargetTask.content_type,
									t,
								)}
							</div>
							<div className="mt-1 text-text-3">#{retryTargetTask.id.slice(0, 8)}</div>
						</div>
					)}
					{retryTaskOptionsLoading ? (
						<div className="rounded-sm border border-border bg-muted px-4 py-8 text-center text-sm text-text-3">
							{t("加载中")}
						</div>
					) : (
						<>
							<FormField label={t("模型配置")}>
								<SelectField
									value={retryTaskModelConfigId}
									onChange={(value) => setRetryTaskModelConfigId(value)}
									className="w-full"
									options={[
										{ value: "", label: t("沿用原任务配置") },
										...retryTaskModelOptions.map((config) => ({
											value: config.id,
											label: `${config.name} (${config.model_name})`,
										})),
									]}
								/>
							</FormField>

							<FormField label={t("提示词配置")}>
								<SelectField
									value={retryTaskPromptConfigId}
									onChange={(value) => setRetryTaskPromptConfigId(value)}
									className="w-full"
									disabled={!retryTaskPromptType}
									options={[
										{ value: "", label: t("沿用原任务配置") },
										...retryTaskPromptOptions.map((config) => ({
											value: config.id,
											label: config.name,
										})),
									]}
								/>
							</FormField>
							{!retryTaskPromptType && (
								<p className="text-xs text-text-3">
									{t("当前任务类型不支持覆盖提示词，将沿用原任务配置。")}
								</p>
							)}
						</>
					)}
				</div>
			</ModalShell>
		)}

		{showTaskTimelineModal && (
			<ModalShell
				isOpen={showTaskTimelineModal}
				onClose={closeTaskTimelineModal}
				title={t("任务链路详情")}
				widthClassName="max-w-4xl"
				headerClassName="border-b border-border p-6"
				bodyClassName="space-y-4 p-6"
				footerClassName="border-t border-border bg-muted p-6"
				footer={
					<div className="flex justify-end">
						<Button onClick={closeTaskTimelineModal} variant="secondary">
							{t("关闭")}
						</Button>
					</div>
				}
			>
				{taskTimelineLoading ? (
					<div className="rounded-sm border border-border bg-muted px-4 py-8 text-center text-sm text-text-3">
						{t("加载中")}
					</div>
				) : taskTimelineError ? (
					<div className="rounded-sm border border-danger/40 bg-danger-soft px-4 py-3 text-sm text-danger-ink">
						{taskTimelineError}
					</div>
				) : selectedTaskTimeline ? (
					<div className="space-y-4">
						<div className="rounded-lg border border-border bg-muted p-4 text-sm text-text-2">
							<div className="font-medium text-text-1 mb-2">
								{getAITaskLabel(
									selectedTaskTimeline.task.task_type,
									selectedTaskTimeline.task.content_type,
									t,
								)}
							</div>
							<div>
								{t("任务ID")}: {selectedTaskTimeline.task.id}
							</div>
							{selectedTaskTimeline.task.has_continuations &&
								selectedTaskTimeline.task.chain_length &&
								selectedTaskTimeline.task.chain_length > 1 && (
									<div>
										{t("任务链")}:{" "}
										{t("已调整 {count} 次").replace(
											"{count}",
											String(
												selectedTaskTimeline.task.chain_length - 1,
											),
										)}
									</div>
								)}
							<div>
								{t("状态")}:{" "}
								{getTaskStatusLabel(selectedTaskTimeline.task.status)}
							</div>
							<div>
								{t("尝试")}: {selectedTaskTimeline.task.attempts}/
								{selectedTaskTimeline.task.max_attempts}
							</div>
							{getTaskTargetHref(selectedTaskTimeline.task) && (
								<div>
									{selectedTaskTimeline.task.article_kind === "review"
										? t("专栏")
										: t("文章")}
									:
									<Link
										href={getTaskTargetHref(selectedTaskTimeline.task) || "#"}
										className="text-primary hover:underline"
										target="_blank"
										rel="noopener noreferrer"
									>
										{selectedTaskTimeline.task.article_title ||
											selectedTaskTimeline.task.article_slug}
									</Link>
								</div>
							)}
						</div>

						<div className="mb-3 space-y-2">
							<div className="flex flex-wrap items-center gap-2">
								<span className="text-sm font-semibold text-text-1">
									{t("调用链")}
								</span>
								{taskTimelineChains.length === 0 ? (
									<span className="text-xs text-text-3">
										{t("暂无调用记录")}
									</span>
								) : (
									taskTimelineChains.map((chain) => (
										<SelectableButton
											key={chain.id}
											onClick={() => {
												setSelectedTaskTimelineChainId(chain.id);
												setSelectedTaskTimelineUsageId(
													chain.usage[chain.usage.length - 1]?.id || null,
												);
												setSelectedTaskEventId(
													chain.nodes[chain.nodes.length - 1]?.id || null,
												);
											}}
											active={selectedTaskTimelineChain?.id === chain.id}
											variant="pill"
											>
												{getTaskTimelineChainLabel(chain)}
										</SelectableButton>
									))
								)}
							</div>
							{selectedTaskTimelineChain && (
								<div className="rounded-sm border border-border bg-muted px-3 py-2 text-xs text-text-2">
									<div>
										{t("当前链路状态")}:{" "}
										{getTaskStatusLabel(
											getTaskTimelineChainStatus(selectedTaskTimelineChain) ||
												"pending",
										)}
									</div>
									<div>
										{t("节点数")}: {selectedTaskTimelineChain.nodes.length} ·{" "}
										{t("AI调用")}: {selectedTaskTimelineChain.usage.length}
									</div>
									{selectedTaskTimelineUsage?.error_message && (
										<div className="text-danger-ink">
											{selectedTaskTimelineUsage.error_message}
										</div>
									)}
								</div>
							)}
						</div>

						<div>
							<div className="mb-2 flex items-center justify-between gap-2">
								<h4 className="text-sm font-semibold text-text-1">
									{t("状态时间线")}
								</h4>
								<IconButton
									type="button"
									onClick={handleRefreshTaskTimeline}
									variant="ghost"
									size="sm"
									title={t("刷新时间线")}
									disabled={taskTimelineLoading || taskTimelineRefreshing}
								>
									<IconRefresh
										className={`h-4 w-4 ${
											taskTimelineRefreshing ? "animate-spin" : ""
										}`}
									/>
								</IconButton>
							</div>
							{taskTimelineNodes.length === 0 ? (
								<div className="rounded-sm border border-border bg-muted px-4 py-4 text-sm text-text-3">
									{t("暂无事件与调用记录")}
								</div>
							) : (
								<div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
									<div className="rounded-lg border border-border bg-muted p-3">
										<div className="space-y-2">
											{taskTimelineNodes.map((node, index) => {
												const visual = getTaskTimelineNodeVisual(
													node,
													taskTimelineNodes,
												);
												const isActive =
													selectedTaskTimelineNode?.id === node.id;
												const summary = getTaskTimelineNodeSummary(node);
												const statusFlow = getTaskTimelineNodeStatusFlow(
													node,
													taskTimelineNodes,
												);
												return (
													<button
														key={node.id}
														type="button"
														onClick={() => {
															setSelectedTaskEventId(node.id);
															if (node.kind === "usage" && node.usage) {
																setSelectedTaskTimelineUsageId(node.usage.id);
															}
														}}
														className={`w-full rounded-md border p-3 text-left text-xs transition ${
															isActive
																? `${visual.cardClassName} shadow-sm`
																: "border-border bg-surface hover:border-text-3/40"
														}`}
													>
														<div className="flex items-start gap-3">
															<div className="flex min-h-[52px] flex-col items-center pt-1">
																<span
																	className={`h-2.5 w-2.5 rounded-full ${visual.dotClassName}`}
																/>
																{index <
																	taskTimelineNodes.length - 1 && (
																	<span
																		className={`mt-1 h-full min-h-[32px] w-px ${visual.lineClassName}`}
																	/>
																)}
															</div>
															<div className="min-w-0 flex-1">
																<div className="flex flex-wrap items-center gap-2 text-text-2">
																	<div className="font-medium text-text-1">
																		{getTaskTimelineNodeLabel(node)}
																	</div>
																	<span className="text-text-3">·</span>
																	<div className="text-text-3">
																		{formatTimelineDateTime(node.created_at)}
																	</div>
																	<span className="text-text-3">·</span>
																	<div>{statusFlow}</div>
																</div>
																<div className="mt-1 text-text-2">
																	{summary.length > 120
																		? `${summary.slice(0, 120)}...`
																		: summary}
																</div>
															</div>
														</div>
													</button>
												);
											})}
										</div>
									</div>
									<div className="rounded-lg border border-border bg-muted p-4 text-xs text-text-2">
										{selectedTaskTimelineNode ? (
											(() => {
												const visual = getTaskTimelineNodeVisual(
													selectedTaskTimelineNode,
													taskTimelineNodes,
												);
												const nodeDisplayStatus =
													getTaskTimelineNodeDisplayStatus(
														selectedTaskTimelineNode,
														taskTimelineNodes,
													);
												if (
													selectedTaskTimelineNode.kind === "event" &&
													selectedTaskTimelineNode.event
												) {
													const event = selectedTaskTimelineNode.event;
													const detailsText = formatTaskEventDetails(
														event.details,
													);
													return (
														<div className="space-y-3">
															<div className="flex items-start justify-between gap-2">
																<div className="space-y-1">
																	<div className="flex flex-wrap items-center gap-2">
																		<div className="text-sm font-semibold text-text-1">
																			{getTaskEventLabel(event.event_type)}
																		</div>
																		<StatusTag
																			tone={visual.tagTone}
																			className={visual.tagClassName}
																		>
																			{getTaskEventStatusLabel(
																				event,
																				nodeDisplayStatus,
																			)}
																		</StatusTag>
																	</div>
																	<div>
																		{formatTimelineDateTime(event.created_at)}
																	</div>
																</div>
																<IconButton
																	type="button"
																	onClick={handleCopyTaskEventDetails}
																	variant="ghost"
																	size="sm"
																	title={t("复制参数")}
																	disabled={!event.details}
																>
																	<IconCopy className="h-4 w-4" />
																</IconButton>
															</div>

															{event.from_status && event.to_status && (
																<div>
																	<span className="text-text-3">
																		{t("状态流转")}:
																	</span>{" "}
																	{event.from_status} → {event.to_status}
																</div>
															)}
															{event.message && (
																<div>
																	<span className="text-text-3">
																		{t("说明")}:
																	</span>{" "}
																	{event.message}
																</div>
															)}
															{event.error_type && (
																<div>
																	<span className="text-text-3">
																		Error Type:
																	</span>{" "}
																	{event.error_type}
																</div>
															)}

															<div className="space-y-1">
																<div className="text-text-3">{t("参数详情")}</div>
																{event.details ? (
																	<pre className="max-h-[260px] overflow-auto whitespace-pre-wrap rounded-md border border-border bg-surface p-3 text-[11px] text-text-1">
																		{detailsText}
																	</pre>
																) : (
																	<div className="rounded-md border border-dashed border-border bg-surface px-3 py-4 text-center text-text-3">
																		{t("该节点无附加参数")}
																	</div>
																)}
															</div>
														</div>
													);
												}
												const usage =
													selectedTaskTimelineNode.usage as AITaskTimelineUsage;
												const usageDisplayStatus =
													nodeDisplayStatus || usage.status;
												const usageMeta = {
													model: usage.model_api_config_name || t("未知模型"),
													status: getUsageStatusLabel(usageDisplayStatus),
													prompt_tokens: usage.prompt_tokens,
													completion_tokens: usage.completion_tokens,
													total_tokens: usage.total_tokens,
													latency_ms: usage.latency_ms,
													finish_reason: usage.finish_reason,
													truncated: usage.truncated,
													chunk_index: usage.chunk_index,
													continue_round: usage.continue_round,
													estimated_input_tokens:
														usage.estimated_input_tokens,
													error_message: usage.error_message,
												};
												return (
													<div className="space-y-3">
														<div className="flex items-start justify-between gap-2">
															<div className="space-y-1">
																<div className="flex flex-wrap items-center gap-2">
																	<div className="text-sm font-semibold text-text-1">
																		{t("AI调用")}
																	</div>
																	<StatusTag
																		tone={visual.tagTone}
																		className={visual.tagClassName}
																	>
																		{getUsageStatusLabel(usageDisplayStatus)}
																	</StatusTag>
																</div>
																<div>
																	{formatTimelineDateTime(usage.created_at)}
																</div>
															</div>
															<div className="flex items-center gap-2">
																<IconButton
																	type="button"
																	onClick={handleCopyTaskEventDetails}
																	variant="ghost"
																	size="sm"
																	title={t("复制参数")}
																	disabled={
																		!usage.request_payload &&
																		!usage.response_payload
																	}
																>
																	<IconCopy className="h-4 w-4" />
																</IconButton>
															</div>
														</div>

														<div>
															<span className="text-text-3">{t("模型")}:</span>{" "}
															{usage.model_api_config_name || t("未知模型")}
														</div>
														{usage.error_message && (
															<div className="text-danger-ink">
																{usage.error_message}
															</div>
														)}

														<div className="flex flex-wrap items-center gap-2">
															<IconButton
																type="button"
																onClick={() =>
																	openUsagePayload(
																		`${t("请求输入")} · ${usage.model_api_config_name || t("未知模型")}`,
																		usage.request_payload || null,
																	)
																}
																variant="ghost"
																size="sm"
																title={t("查看入参")}
																disabled={!usage.request_payload}
															>
																<IconArrowDown className="h-4 w-4" />
															</IconButton>
															<IconButton
																type="button"
																onClick={() =>
																	openUsagePayload(
																		`${t("响应输出")} · ${usage.model_api_config_name || t("未知模型")}`,
																		usage.response_payload || null,
																	)
																}
																variant="ghost"
																size="sm"
																title={t("查看出参")}
																disabled={!usage.response_payload}
															>
																<IconArrowUp className="h-4 w-4" />
															</IconButton>
														</div>

														<div className="space-y-1">
															<div className="text-text-3">{t("参数详情")}</div>
															<pre className="max-h-[260px] overflow-auto whitespace-pre-wrap rounded-md border border-border bg-surface p-3 text-[11px] text-text-1">
																{JSON.stringify(usageMeta, null, 2)}
															</pre>
														</div>
													</div>
												);
											})()
										) : (
											<div className="rounded-md border border-dashed border-border bg-surface px-3 py-4 text-center text-text-3">
												{t("请选择时间线节点")}
											</div>
										)}
									</div>
								</div>
							)}
						</div>

					</div>
				) : null}
			</ModalShell>
		)}
		</>
	);
}
