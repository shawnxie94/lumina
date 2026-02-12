import {
	closestCenter,
	DndContext,
	type DragEndEvent,
	KeyboardSensor,
	PointerSensor,
	useSensor,
	useSensors,
} from "@dnd-kit/core";
import {
	arrayMove,
	SortableContext,
	sortableKeyboardCoordinates,
	useSortable,
	verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Dayjs } from "dayjs";
import dayjs from "dayjs";
import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AppFooter from "@/components/AppFooter";
import AppHeader from "@/components/AppHeader";
import ConfirmModal from "@/components/ConfirmModal";
import Button from "@/components/Button";
import DateRangePicker from "@/components/DateRangePicker";
import FilterInput from "@/components/FilterInput";
import FilterSelect from "@/components/FilterSelect";
import IconButton from "@/components/IconButton";
import CheckboxInput from "@/components/ui/CheckboxInput";
import FormField from "@/components/ui/FormField";
import ModalShell from "@/components/ui/ModalShell";
import SectionToggleButton from "@/components/ui/SectionToggleButton";
import SelectableButton from "@/components/ui/SelectableButton";
import SelectField from "@/components/ui/SelectField";
import StatusTag from "@/components/ui/StatusTag";
import TextArea from "@/components/ui/TextArea";
import TextInput from "@/components/ui/TextInput";
import { ArticleSearchSelect } from "@/components/ArticleSearchSelect";
import {
	IconEdit,
	IconEye,
	IconArrowDown,
	IconArrowUp,
	IconGrip,
	IconLink,
	IconList,
	IconCopy,
	IconMoney,
	IconNote,
	IconPlug,
	IconRobot,
	IconSettings,
	IconRefresh,
	IconSearch,
	IconTag,
	IconTrash,
	IconFilter,
} from "@/components/icons";
import { useToast } from "@/components/Toast";
import { useAuth } from "@/contexts/AuthContext";
import { useBasicSettings } from "@/contexts/BasicSettingsContext";
import { useI18n } from "@/lib/i18n";
import {
	type AIUsageListResponse,
	type AIUsageLogItem,
	type AIUsageSummaryResponse,
	type AITaskTimelineEvent,
	type AITaskTimelineResponse,
	type AITaskTimelineUsage,
	type ArticleComment,
	aiUsageApi,
	articleApi,
	type BasicSettings,
	basicSettingsApi,
	categoryApi,
	commentAdminApi,
	commentApi,
	commentSettingsApi,
	mediaApi,
	recommendationSettingsApi,
	storageSettingsApi,
	type RecommendationSettings,
	type CommentListResponse,
	type CommentSettings,
	type StorageSettings,
	type ModelAPIConfig,
	type PromptConfig,
} from "@/lib/api";

type SettingSection =
	| "basic"
	| "ai"
	| "categories"
	| "monitoring"
	| "comments"
	| "storage";
type AISubSection = "model-api" | "prompt" | "recommendations";
type MonitoringSubSection = "tasks" | "ai-usage" | "comments";
type CommentSubSection = "keys" | "filters";

type AdminRouteState = {
	section: SettingSection;
	aiSubSection: AISubSection;
	monitoringSubSection: MonitoringSubSection;
	commentSubSection: CommentSubSection;
};

const AI_SUB_SECTIONS: AISubSection[] = [
	"model-api",
	"prompt",
	"recommendations",
];
const MONITORING_SUB_SECTIONS: MonitoringSubSection[] = [
	"tasks",
	"ai-usage",
	"comments",
];
const COMMENT_SUB_SECTIONS: CommentSubSection[] = ["keys", "filters"];

const isAISubSection = (value: string): value is AISubSection =>
	AI_SUB_SECTIONS.includes(value as AISubSection);
const isMonitoringSubSection = (value: string): value is MonitoringSubSection =>
	MONITORING_SUB_SECTIONS.includes(value as MonitoringSubSection);
const isCommentSubSection = (value: string): value is CommentSubSection =>
	COMMENT_SUB_SECTIONS.includes(value as CommentSubSection);

const normalizePathname = (asPath: string) => {
	const pathname = asPath.split("?")[0]?.split("#")[0] || "/";
	if (pathname.length > 1 && pathname.endsWith("/")) {
		return pathname.slice(0, -1);
	}
	return pathname;
};

const resolveAdminRoutePath = (
	asPath: string,
	rewritePath?: string | string[],
) => {
	const normalized = normalizePathname(asPath);
	if (normalized !== "/admin") {
		return normalized;
	}
	if (!rewritePath) {
		return normalized;
	}
	const segments = Array.isArray(rewritePath)
		? rewritePath.filter(Boolean)
		: [rewritePath];
	if (segments.length === 0) {
		return normalized;
	}
	return `/admin/${segments.join("/")}`;
};

const parseAdminRouteState = (
	asPath: string,
): AdminRouteState => {
	const pathname = normalizePathname(asPath);
	const segments = pathname.split("/").filter(Boolean);
	if (segments[0] === "admin") {
		segments.shift();
	}

	let section: SettingSection = "monitoring";
	let aiSubSection: AISubSection = "model-api";
	let monitoringSubSection: MonitoringSubSection = "ai-usage";
	let commentSubSection: CommentSubSection = "keys";

	if (segments[0] === "monitoring") {
		section = "monitoring";
		const monitoringCandidate = segments[1] || "";
		if (isMonitoringSubSection(monitoringCandidate)) {
			monitoringSubSection = monitoringCandidate;
		}
		return { section, aiSubSection, monitoringSubSection, commentSubSection };
	}

	if (segments[0] === "settings") {
		const settingsSection = segments[1];
		if (settingsSection === "basic") {
			section = "basic";
		} else if (settingsSection === "categories") {
			section = "categories";
		} else if (settingsSection === "storage") {
			section = "storage";
		} else if (settingsSection === "ai") {
			section = "ai";
			const aiCandidate = segments[2] || "";
			if (isAISubSection(aiCandidate)) {
				aiSubSection = aiCandidate;
			}
		} else if (settingsSection === "comments") {
			section = "comments";
			const commentCandidate = segments[2] || "";
			if (isCommentSubSection(commentCandidate)) {
				commentSubSection = commentCandidate;
			}
		}
		return { section, aiSubSection, monitoringSubSection, commentSubSection };
	}

	return { section, aiSubSection, monitoringSubSection, commentSubSection };
};

const buildAdminPath = (
	section: SettingSection,
	aiSubSection: AISubSection,
	monitoringSubSection: MonitoringSubSection,
	commentSubSection: CommentSubSection,
) => {
	if (section === "monitoring") {
		return `/admin/monitoring/${monitoringSubSection}`;
	}
	if (section === "ai") {
		return `/admin/settings/ai/${aiSubSection}`;
	}
	if (section === "comments") {
		return `/admin/settings/comments/${commentSubSection}`;
	}
	if (section === "categories") {
		return "/admin/settings/categories";
	}
	if (section === "storage") {
		return "/admin/settings/storage";
	}
	return "/admin/settings/basic";
};

type PromptType =
	| "summary"
	| "translation"
	| "key_points"
	| "outline"
	| "quotes"
	| "content_cleaning"
	| "content_validation"
	| "classification";

const PROMPT_TYPES = [
	{ value: "content_cleaning" as PromptType, labelKey: "清洗" },
	{ value: "content_validation" as PromptType, labelKey: "校验" },
	{ value: "classification" as PromptType, labelKey: "分类" },
	{ value: "summary" as PromptType, labelKey: "摘要" },
	{ value: "translation" as PromptType, labelKey: "翻译" },
	{ value: "key_points" as PromptType, labelKey: "总结" },
	{ value: "outline" as PromptType, labelKey: "大纲" },
	{ value: "quotes" as PromptType, labelKey: "金句" },
];

const supportsChunkOptionsForPromptType = (
	promptType: string | null | undefined,
): boolean => {
	return promptType === "content_cleaning" || promptType === "translation";
};

const PRESET_COLORS = [
	"#EF4444",
	"#F97316",
	"#F59E0B",
	"#EAB308",
	"#84CC16",
	"#22C55E",
	"#10B981",
	"#14B8A6",
	"#06B6D4",
	"#0EA5E9",
	"#3B82F6",
	"#6366F1",
	"#8B5CF6",
	"#A855F7",
	"#D946EF",
	"#EC4899",
	"#F43F5E",
	"#78716C",
	"#64748B",
	"#6B7280",
];

const CURRENCY_OPTIONS = [
	{ value: "", labelKey: "默认" },
	{ value: "USD", labelKey: "美元 (USD)" },
	{ value: "CNY", labelKey: "人民币 (CNY)" },
	{ value: "HKD", labelKey: "港币 (HKD)" },
	{ value: "EUR", labelKey: "欧元 (EUR)" },
	{ value: "JPY", labelKey: "日元 (JPY)" },
];

interface Category {
	id: string;
	name: string;
	description: string | null;
	color: string;
	sort_order: number;
	article_count: number;
}

interface AITaskItem {
	id: string;
	article_id: string | null;
	article_title?: string | null;
	article_slug?: string | null;
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

interface UsageCostBreakdown {
	currency: string;
	promptTokens: number | null;
	completionTokens: number | null;
	inputUnitPrice: number | null;
	outputUnitPrice: number | null;
	inputCost: number | null;
	outputCost: number | null;
	totalCost: number | null;
}

interface TaskTimelineNode {
	id: string;
	kind: "event" | "usage";
	created_at: string;
	event?: AITaskTimelineEvent;
	usage?: AITaskTimelineUsage;
}

interface TaskTimelineChain {
	id: string;
	index: number;
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

const buildTaskTimelineChains = (
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

interface SortableCategoryItemProps {
	category: Category;
	onEdit: (category: Category) => void;
	onDelete: (id: string) => void;
}

function SortableCategoryItem({
	category,
	onEdit,
	onDelete,
}: SortableCategoryItemProps) {
	const { t } = useI18n();
	const {
		attributes,
		listeners,
		setNodeRef,
		transform,
		transition,
		isDragging,
	} = useSortable({ id: category.id });

	const style = {
		transform: CSS.Transform.toString(transform),
		transition,
		opacity: isDragging ? 0.5 : 1,
	};

	return (
		<div
			ref={setNodeRef}
			style={style}
			className="border rounded-lg px-3 py-2 hover:shadow-sm transition flex items-center justify-between bg-surface"
		>
			<div className="flex items-center gap-3">
				<button
					{...attributes}
					{...listeners}
					className="cursor-grab active:cursor-grabbing text-text-3 hover:text-text-2 px-1"
					title={t("拖动排序")}
					aria-label={t("拖动排序")}
				>
					<IconGrip className="h-4 w-4" />
				</button>
				<div
					className="w-8 h-8 rounded flex items-center justify-center text-white font-bold text-sm"
					style={{ backgroundColor: category.color }}
				>
					{category.name.charAt(0).toUpperCase()}
				</div>
				<div>
					<div className="flex flex-wrap items-center gap-2">
						<h3 className="font-semibold text-text-1 text-sm">
							{category.name}
						</h3>
						<span className="text-xs text-text-3">
							{category.article_count}
						</span>
					</div>
					<p className="text-xs text-text-2">
						{category.description || t("暂无描述")}
					</p>
				</div>
			</div>

			<div className="flex gap-1">
				<IconButton
					onClick={() => onEdit(category)}
					variant="primary"
					size="sm"
					title={t("编辑")}
				>
					<IconEdit className="h-4 w-4" />
				</IconButton>
				<IconButton
					onClick={() => onDelete(category.id)}
					variant="danger"
					size="sm"
					title={t("删除")}
				>
					<IconTrash className="h-4 w-4" />
				</IconButton>
			</div>
		</div>
	);
}

export default function AdminPage() {
	const router = useRouter();
	const { showToast } = useToast();
	const { isAdmin, isLoading: authLoading } = useAuth();
	const { t } = useI18n();
	const { basicSettings, updateBasicSettings: updateBasicSettingsContext } =
		useBasicSettings();
	const [primaryTab, setPrimaryTab] = useState<"monitoring" | "settings">(
		"monitoring",
	);
	const settingsSections = useMemo(
		() =>
			new Set<SettingSection>([
				"basic",
				"categories",
				"ai",
				"comments",
				"storage",
			]),
		[],
	);
	const [activeSection, setActiveSection] =
		useState<SettingSection>("monitoring");
	const [aiSubSection, setAISubSection] = useState<AISubSection>("model-api");
	const [monitoringSubSection, setMonitoringSubSection] =
		useState<MonitoringSubSection>("ai-usage");
	const [commentSubSection, setCommentSubSection] =
		useState<CommentSubSection>("keys");
	const [routeInitialized, setRouteInitialized] = useState(false);
	const [modelAPIConfigs, setModelAPIConfigs] = useState<ModelAPIConfig[]>([]);
	const [promptConfigs, setPromptConfigs] = useState<PromptConfig[]>([]);
	const [categories, setCategories] = useState<Category[]>([]);
	const [taskItems, setTaskItems] = useState<AITaskItem[]>([]);
	const [modelLoading, setModelLoading] = useState(true);
	const [promptLoading, setPromptLoading] = useState(true);
	const [categoryLoading, setCategoryLoading] = useState(true);
	const [taskLoading, setTaskLoading] = useState(false);
	const [selectedPromptType, setSelectedPromptType] =
		useState<PromptType>("summary");
	const [taskPage, setTaskPage] = useState(1);
	const [taskPageSize, setTaskPageSize] = useState(10);
	const [taskTotal, setTaskTotal] = useState(0);
	const [taskStatusFilter, setTaskStatusFilter] = useState("");
	const [taskTypeFilter, setTaskTypeFilter] = useState("");
	const [taskArticleIdFilter, setTaskArticleIdFilter] = useState("");
	const [taskArticleTitleFilter, setTaskArticleTitleFilter] = useState("");
	const hasTaskFilters = Boolean(
		taskStatusFilter ||
			taskTypeFilter ||
			taskArticleIdFilter ||
			taskArticleTitleFilter,
	);
	const [showTaskTimelineModal, setShowTaskTimelineModal] = useState(false);
	const [taskTimelineLoading, setTaskTimelineLoading] = useState(false);
	const [taskTimelineRefreshing, setTaskTimelineRefreshing] = useState(false);
	const [taskTimelineError, setTaskTimelineError] = useState("");
	const [selectedTaskTimeline, setSelectedTaskTimeline] =
		useState<AITaskTimelineResponse | null>(null);
	const [selectedTaskTimelineChainId, setSelectedTaskTimelineChainId] =
		useState<string | null>(null);
	const [selectedTaskTimelineUsageId, setSelectedTaskTimelineUsageId] =
		useState<string | null>(null);
	const [selectedTaskEventId, setSelectedTaskEventId] = useState<string | null>(
		null,
	);
	const [showTaskRetryModal, setShowTaskRetryModal] = useState(false);
	const [retryTargetTask, setRetryTargetTask] = useState<AITaskItem | null>(null);
	const [retryTaskPromptType, setRetryTaskPromptType] =
		useState<PromptType | null>(null);
	const [retryTaskModelConfigId, setRetryTaskModelConfigId] = useState("");
	const [retryTaskPromptConfigId, setRetryTaskPromptConfigId] = useState("");
	const [retryTaskModelOptions, setRetryTaskModelOptions] = useState<
		ModelAPIConfig[]
	>([]);
	const [retryTaskPromptOptions, setRetryTaskPromptOptions] = useState<
		PromptConfig[]
	>([]);
	const [retryTaskOptionsLoading, setRetryTaskOptionsLoading] = useState(false);
	const [retryTaskSubmitting, setRetryTaskSubmitting] = useState(false);

	const [usageLogs, setUsageLogs] = useState<AIUsageLogItem[]>([]);
	const [usageSummary, setUsageSummary] = useState<
		AIUsageSummaryResponse["summary"] | null
	>(null);
	const [usageByModel, setUsageByModel] = useState<
		AIUsageSummaryResponse["by_model"]
	>([]);
	const [usageLoading, setUsageLoading] = useState(false);
	const [usagePage, setUsagePage] = useState(1);
	const [usagePageSize, setUsagePageSize] = useState(10);
	const [usageTotal, setUsageTotal] = useState(0);
	const [usageModelId, setUsageModelId] = useState("");
	const [usageStatus, setUsageStatus] = useState("");
	const [usageContentType, setUsageContentType] = useState("");
	const [usageStart, setUsageStart] = useState("");
	const [usageEnd, setUsageEnd] = useState("");
	const [showUsagePayloadModal, setShowUsagePayloadModal] = useState(false);
	const [usagePayloadTitle, setUsagePayloadTitle] = useState("");
	const [usagePayloadContent, setUsagePayloadContent] = useState("");
	const [showUsageCostModal, setShowUsageCostModal] = useState(false);
	const [usageCostTitle, setUsageCostTitle] = useState("");
	const [usageCostDetails, setUsageCostDetails] = useState("");
	const [usageCostBreakdown, setUsageCostBreakdown] =
		useState<UsageCostBreakdown | null>(null);
	const showUsageView =
		activeSection === "monitoring" && monitoringSubSection === "ai-usage";
	const showCommentListView =
		activeSection === "monitoring" && monitoringSubSection === "comments";
	const prevActiveSectionRef = useRef<SettingSection | null>(null);
	const prevMonitoringSubSectionRef = useRef<MonitoringSubSection | null>(null);
	const [collapsedSettings, setCollapsedSettings] = useState<{
		ai: boolean;
		comments: boolean;
	}>({
		ai: true,
		comments: true,
	});

	const handleToggleAISection = useCallback(() => {
		const nextCollapsed = !collapsedSettings.ai;
		setCollapsedSettings((prev) => ({
			...prev,
			ai: nextCollapsed,
		}));
		if (!nextCollapsed) {
			setActiveSection("ai");
			setAISubSection("model-api");
		}
	}, [collapsedSettings.ai]);

	const handleToggleCommentSection = useCallback(() => {
		const nextCollapsed = !collapsedSettings.comments;
		setCollapsedSettings((prev) => ({
			...prev,
			comments: nextCollapsed,
		}));
		if (!nextCollapsed) {
			setActiveSection("comments");
			setCommentSubSection("keys");
		}
	}, [collapsedSettings.comments]);

	const [showModelAPIModal, setShowModelAPIModal] = useState(false);
	const [showModelAPITestModal, setShowModelAPITestModal] = useState(false);
	const [showPromptModal, setShowPromptModal] = useState(false);
	const [showCategoryModal, setShowCategoryModal] = useState(false);
	const [showPromptPreview, setShowPromptPreview] =
		useState<PromptConfig | null>(null);
	const [commentSettings, setCommentSettings] = useState<CommentSettings>({
		comments_enabled: true,
		github_client_id: "",
		github_client_secret: "",
		google_client_id: "",
		google_client_secret: "",
		nextauth_secret: "",
		sensitive_filter_enabled: true,
		sensitive_words: "",
	});
	const [basicSettingsForm, setBasicSettingsForm] = useState<BasicSettings>({
		default_language: "zh-CN",
		site_name: "Lumina",
		site_description: "信息灯塔",
		site_logo_url: "",
		home_badge_text: "",
		home_tagline_text: "",
		home_primary_button_text: "",
		home_primary_button_url: "",
		home_secondary_button_text: "",
		home_secondary_button_url: "",
	});
	const [storageSettings, setStorageSettings] = useState<StorageSettings>({
		media_storage_enabled: false,
		media_compress_threshold: 1536 * 1024,
		media_max_dim: 2000,
		media_webp_quality: 80,
	});
	const [recommendationSettings, setRecommendationSettings] =
		useState<RecommendationSettings>({
			recommendations_enabled: false,
			recommendation_model_config_id: "",
		});
	const [commentSettingsLoading, setCommentSettingsLoading] = useState(false);
	const [commentSettingsSaving, setCommentSettingsSaving] = useState(false);
	const [basicSettingsLoading, setBasicSettingsLoading] = useState(false);
	const [basicSettingsSaving, setBasicSettingsSaving] = useState(false);
	const [storageSettingsLoading, setStorageSettingsLoading] = useState(false);
	const [storageSettingsSaving, setStorageSettingsSaving] = useState(false);
	const [storageStatsLoading, setStorageStatsLoading] = useState(false);
	const [storageStats, setStorageStats] = useState<{
		asset_count: number;
		asset_total_size: number;
		disk_file_count: number;
		disk_total_size: number;
	}>({
		asset_count: 0,
		asset_total_size: 0,
		disk_file_count: 0,
		disk_total_size: 0,
	});
	const [recommendationSettingsLoading, setRecommendationSettingsLoading] =
		useState(false);
	const [recommendationSettingsSaving, setRecommendationSettingsSaving] =
		useState(false);
	const [storageCleanupLoading, setStorageCleanupLoading] = useState(false);
	const [commentValidationResult, setCommentValidationResult] = useState<{
		ok: boolean;
		messages: string[];
		callbacks: string[];
	} | null>(null);
	const [confirmState, setConfirmState] = useState<{
		isOpen: boolean;
		title: string;
		message: string;
		confirmText?: string;
		cancelText?: string;
		onConfirm: () => void | Promise<void>;
		onCancel?: () => void;
	}>({
		isOpen: false,
		title: "",
		message: "",
		confirmText: t("确定"),
		cancelText: t("取消"),
		onConfirm: () => {},
		onCancel: undefined,
	});

	const [commentList, setCommentList] = useState<CommentListResponse["items"]>(
		[],
	);
	const [commentListLoading, setCommentListLoading] = useState(false);
	const [commentListPage, setCommentListPage] = useState(1);
	const [commentListPageSize, setCommentListPageSize] = useState(10);
	const [commentListTotal, setCommentListTotal] = useState(0);
	const [commentQuery, setCommentQuery] = useState("");
	const [commentArticleTitle, setCommentArticleTitle] = useState("");
	const [commentAuthor, setCommentAuthor] = useState("");
	const [commentStart, setCommentStart] = useState("");
	const [commentEnd, setCommentEnd] = useState("");
	const [commentVisibility, setCommentVisibility] = useState("");
	const [commentReplyFilter, setCommentReplyFilter] = useState("");
	const [hoverComment, setHoverComment] = useState<ArticleComment | null>(null);
	const [hoverTooltipPos, setHoverTooltipPos] = useState<{
		x: number;
		y: number;
	} | null>(null);
	const [showCommentContentModal, setShowCommentContentModal] = useState(false);
	const [activeCommentContent, setActiveCommentContent] =
		useState<ArticleComment | null>(null);
	const hasCommentFilters = Boolean(
		commentQuery ||
			commentArticleTitle ||
			commentAuthor ||
			commentStart ||
			commentEnd ||
			commentVisibility ||
			commentReplyFilter,
	);

	const taskTimelineChains = useMemo<TaskTimelineChain[]>(() => {
		if (!selectedTaskTimeline) return [];
		return buildTaskTimelineChains(selectedTaskTimeline);
	}, [selectedTaskTimeline]);

	const selectedTaskTimelineChain = useMemo(() => {
		if (taskTimelineChains.length === 0) return null;
		if (!selectedTaskTimelineChainId) {
			return taskTimelineChains[taskTimelineChains.length - 1];
		}
		return (
			taskTimelineChains.find((chain) => chain.id === selectedTaskTimelineChainId) ||
			taskTimelineChains[taskTimelineChains.length - 1]
		);
	}, [taskTimelineChains, selectedTaskTimelineChainId]);

	const selectedTaskTimelineUsage = useMemo(() => {
		const usageList = selectedTaskTimelineChain?.usage || [];
		if (usageList.length === 0) return null;
		if (!selectedTaskTimelineUsageId) {
			return usageList[usageList.length - 1];
		}
		return (
			usageList.find((usage) => usage.id === selectedTaskTimelineUsageId) ||
			usageList[usageList.length - 1]
		);
	}, [selectedTaskTimelineChain, selectedTaskTimelineUsageId]);

	const taskTimelineNodes = selectedTaskTimelineChain?.nodes || [];

	const selectedTaskTimelineNode = useMemo(() => {
		if (taskTimelineNodes.length === 0) {
			return null;
		}
		if (!selectedTaskEventId) {
			return taskTimelineNodes[taskTimelineNodes.length - 1];
		}
		return (
			taskTimelineNodes.find((node) => node.id === selectedTaskEventId) ||
			taskTimelineNodes[taskTimelineNodes.length - 1]
		);
	}, [taskTimelineNodes, selectedTaskEventId]);

	const [editingModelAPIConfig, setEditingModelAPIConfig] =
		useState<ModelAPIConfig | null>(null);
	const [editingPromptConfig, setEditingPromptConfig] =
		useState<PromptConfig | null>(null);
	const [editingCategory, setEditingCategory] = useState<Category | null>(null);

	useEffect(() => {
		if (!authLoading && !isAdmin) {
			router.push("/login");
		}
	}, [authLoading, isAdmin, router]);

	useEffect(() => {
		if (!router.isReady) return;
		const resolvedPath = resolveAdminRoutePath(
			router.asPath,
			router.query.path,
		);
		const routeState = parseAdminRouteState(resolvedPath);
		setActiveSection(routeState.section);
		setAISubSection(routeState.aiSubSection);
		setMonitoringSubSection(routeState.monitoringSubSection);
		setCommentSubSection(routeState.commentSubSection);
		setPrimaryTab(
			routeState.section === "monitoring" ? "monitoring" : "settings",
		);

		const articleTitleParam =
			typeof router.query.article_title === "string"
				? router.query.article_title
				: undefined;
		const taskStatusParam =
			typeof router.query.status === "string" ? router.query.status : undefined;
		const taskTypeParam =
			typeof router.query.task_type === "string"
				? router.query.task_type
				: undefined;
		const contentTypeParam =
			typeof router.query.content_type === "string"
				? router.query.content_type
				: undefined;
		const articleIdParam =
			typeof router.query.article_id === "string"
				? router.query.article_id
				: undefined;
		const taskIdParam =
			typeof router.query.task_id === "string" ? router.query.task_id : undefined;
		const autoOpenTaskDetailParam =
			typeof router.query.open_task_detail === "string"
				? router.query.open_task_detail
				: undefined;
		if (
			articleTitleParam ||
			taskStatusParam ||
			taskTypeParam ||
			articleIdParam ||
			taskIdParam ||
			autoOpenTaskDetailParam
		) {
			setActiveSection("monitoring");
			setMonitoringSubSection("tasks");
			setPrimaryTab("monitoring");
			setTaskArticleTitleFilter(articleTitleParam || "");
			setTaskArticleIdFilter(articleIdParam || "");
			setTaskStatusFilter(taskStatusParam || "");
			setTaskTypeFilter(
				taskTypeParam
					? contentTypeParam
						? `${taskTypeParam}:${contentTypeParam}`
						: taskTypeParam
					: "",
			);
			setTaskPage(1);
		}
		setRouteInitialized(true);
	}, [
		router.asPath,
		router.query.article_id,
		router.isReady,
		router.query.article_title,
		router.query.content_type,
		router.query.open_task_detail,
		router.query.path,
		router.query.status,
		router.query.task_id,
		router.query.task_type,
	]);

	useEffect(() => {
		if (settingsSections.has(activeSection)) {
			setPrimaryTab("settings");
			return;
		}
		setPrimaryTab("monitoring");
	}, [activeSection, settingsSections]);

	useEffect(() => {
		if (!router.isReady || !routeInitialized) return;
		const nextPath = buildAdminPath(
			activeSection,
			aiSubSection,
			monitoringSubSection,
			commentSubSection,
		);
		const currentPath = resolveAdminRoutePath(router.asPath, router.query.path);
		if (currentPath === nextPath) {
			return;
		}
		void router.replace(nextPath, undefined, { shallow: true });
	}, [
		activeSection,
		aiSubSection,
		commentSubSection,
		monitoringSubSection,
		routeInitialized,
		router.asPath,
		router.isReady,
		router.query.path,
		router.replace,
	]);

	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			if (showCommentContentModal) {
				setShowCommentContentModal(false);
				setActiveCommentContent(null);
				return;
			}
			if (showUsagePayloadModal) {
				setShowUsagePayloadModal(false);
				return;
			}
			if (showUsageCostModal) {
				setShowUsageCostModal(false);
				return;
			}
			if (showModelAPITestModal) {
				setShowModelAPITestModal(false);
				return;
			}
			if (showPromptPreview) {
				setShowPromptPreview(null);
				return;
			}
			if (showPromptModal) {
				setShowPromptModal(false);
				return;
			}
			if (showModelAPIModal) {
				setShowModelAPIModal(false);
				return;
			}
			if (showCategoryModal) {
				setShowCategoryModal(false);
				return;
			}
			if (confirmState.isOpen) {
				confirmState.onCancel?.();
				setConfirmState((prev) => ({ ...prev, isOpen: false }));
			}
		};
		document.addEventListener("keydown", handleKeyDown);
		return () => document.removeEventListener("keydown", handleKeyDown);
	}, [
		showCommentContentModal,
		showUsagePayloadModal,
		showUsageCostModal,
		showModelAPITestModal,
		showPromptPreview,
		showPromptModal,
		showModelAPIModal,
		showCategoryModal,
		confirmState.isOpen,
	]);

	const sensors = useSensors(
		useSensor(PointerSensor),
		useSensor(KeyboardSensor, {
			coordinateGetter: sortableKeyboardCoordinates,
		}),
	);

	const handleDragEnd = async (event: DragEndEvent) => {
		const { active, over } = event;

		if (over && active.id !== over.id) {
			const oldIndex = categories.findIndex((c) => c.id === active.id);
			const newIndex = categories.findIndex((c) => c.id === over.id);

			const newCategories = arrayMove(categories, oldIndex, newIndex);
			setCategories(newCategories);

			const sortItems = newCategories.map((c, index) => ({
				id: c.id,
				sort_order: index,
			}));

			try {
				await categoryApi.updateCategoriesSort(sortItems);
			} catch (error) {
				console.error("Failed to update sort order:", error);
				showToast("排序更新失败", "error");
				fetchCategories();
			}
		}
	};

	const [modelAPIFormData, setModelAPIFormData] = useState({
		name: "",
		base_url: "https://api.openai.com/v1",
		api_key: "",
		provider: "openai",
		model_name: "gpt-4o",
		model_type: "general",
		price_input_per_1k: "",
		price_output_per_1k: "",
		currency: "USD",
		context_window_tokens: "",
		reserve_output_tokens: "",
		is_enabled: true,
		is_default: false,
	});

	const [promptFormData, setPromptFormData] = useState({
		name: "",
		category_id: "",
		type: "summary",
		prompt: "",
		system_prompt: "",
		response_format: "",
		temperature: "",
		max_tokens: "",
		top_p: "",
		chunk_size_tokens: "",
		chunk_overlap_tokens: "",
		max_continue_rounds: "",
		model_api_config_id: "",
		is_enabled: true,
		is_default: false,
	});
	const [showPromptAdvanced, setShowPromptAdvanced] = useState(false);
	const promptTypeSupportsChunkOptions = supportsChunkOptionsForPromptType(
		promptFormData.type,
	);
	const promptImportInputRef = useRef<HTMLInputElement>(null);
	const [modelOptions, setModelOptions] = useState<string[]>([]);
	const [modelOptionsLoading, setModelOptionsLoading] = useState(false);
	const [modelOptionsError, setModelOptionsError] = useState("");
	const [modelNameManual, setModelNameManual] = useState(false);
	const [showModelAPIAdvanced, setShowModelAPIAdvanced] = useState(false);
	const [modelCategory, setModelCategory] = useState<"general" | "vector">(
		"general",
	);

	const filteredModelAPIConfigs = useMemo(() => {
		const isVector = (config: ModelAPIConfig) =>
			(config.model_type || "general") === "vector";
		if (modelCategory === "vector") {
			return modelAPIConfigs.filter(isVector);
		}
		return modelAPIConfigs.filter((config) => !isVector(config));
	}, [modelAPIConfigs, modelCategory]);
	const [modelAPITestConfig, setModelAPITestConfig] =
		useState<ModelAPIConfig | null>(null);
	const [modelAPITestPrompt, setModelAPITestPrompt] = useState("");
	const [modelAPITestResult, setModelAPITestResult] = useState("");
	const [modelAPITestRaw, setModelAPITestRaw] = useState("");
	const [modelAPITestError, setModelAPITestError] = useState("");
	const [modelAPITestLoading, setModelAPITestLoading] = useState(false);
	const [modelAPISaving, setModelAPISaving] = useState(false);
	const [promptSaving, setPromptSaving] = useState(false);
	const [categorySaving, setCategorySaving] = useState(false);
	const [promptImporting, setPromptImporting] = useState(false);
	const [pendingTaskActionIds, setPendingTaskActionIds] = useState<Set<string>>(
		new Set(),
	);
	const [pendingCommentActionIds, setPendingCommentActionIds] = useState<
		Set<string>
	>(new Set());
	const [openingTaskTimelineId, setOpeningTaskTimelineId] = useState<
		string | null
	>(null);
	const openedTaskTimelineFromQueryRef = useRef<string | null>(null);
	const modelOptionsFetchRef = useRef<ReturnType<typeof setTimeout> | null>(
		null,
	);

	const [categoryFormData, setCategoryFormData] = useState({
		name: "",
		description: "",
		color: "#3B82F6",
		sort_order: 0,
	});

	const setTaskActionPending = (taskId: string, pending: boolean) => {
		setPendingTaskActionIds((prev) => {
			const next = new Set(prev);
			if (pending) {
				next.add(taskId);
			} else {
				next.delete(taskId);
			}
			return next;
		});
	};

	const setCommentActionPending = (commentId: string, pending: boolean) => {
		setPendingCommentActionIds((prev) => {
			const next = new Set(prev);
			if (pending) {
				next.add(commentId);
			} else {
				next.delete(commentId);
			}
			return next;
		});
	};

	const fetchModelAPIConfigs = async () => {
		setModelLoading(true);
		try {
			const data = await articleApi.getModelAPIConfigs();
			setModelAPIConfigs(data);
		} catch (error) {
			console.error("Failed to fetch model API configs:", error);
		} finally {
			setModelLoading(false);
		}
	};

	const fetchPromptConfigs = async () => {
		setPromptLoading(true);
		try {
			const data = await articleApi.getPromptConfigs();
			setPromptConfigs(data);
		} catch (error) {
			console.error("Failed to fetch prompt configs:", error);
		} finally {
			setPromptLoading(false);
		}
	};

	const fetchCategories = async () => {
		setCategoryLoading(true);
		try {
			const data = await categoryApi.getCategories();
			setCategories(data);
		} catch (error) {
			console.error("Failed to fetch categories:", error);
		} finally {
			setCategoryLoading(false);
		}
	};

	const fetchTasks = async () => {
		setTaskLoading(true);
		try {
			const [taskTypeValue, contentTypeValue] = taskTypeFilter.split(":");
			const response = await articleApi.getAITasks({
				page: taskPage,
				size: taskPageSize,
				status: taskStatusFilter || undefined,
				task_type: taskTypeValue || undefined,
				content_type: contentTypeValue || undefined,
				article_id: taskArticleIdFilter || undefined,
				article_title: taskArticleTitleFilter || undefined,
			});
			setTaskItems(response.data || []);
			setTaskTotal(response.pagination?.total || 0);
		} catch (error) {
			console.error("Failed to fetch AI tasks:", error);
			showToast(t("任务加载失败"), "error");
		} finally {
			setTaskLoading(false);
		}
	};

	const fetchUsageLogs = async () => {
		setUsageLoading(true);
		try {
			const response = await aiUsageApi.list({
				model_api_config_id: usageModelId || undefined,
				status: usageStatus || undefined,
				content_type: usageContentType || undefined,
				start: usageStart || undefined,
				end: usageEnd || undefined,
				page: usagePage,
				size: usagePageSize,
			});
			setUsageLogs(response.items || []);
			setUsageTotal(response.total || 0);
		} catch (error) {
			console.error("Failed to fetch AI usage logs:", error);
			showToast("调用记录加载失败", "error");
		} finally {
			setUsageLoading(false);
		}
	};

	const fetchUsageSummary = async () => {
		try {
			const response = await aiUsageApi.summary({
				model_api_config_id: usageModelId || undefined,
				status: usageStatus || undefined,
				content_type: usageContentType || undefined,
				start: usageStart || undefined,
				end: usageEnd || undefined,
			});
			setUsageSummary(response.summary);
			setUsageByModel(response.by_model || []);
		} catch (error) {
			console.error("Failed to fetch AI usage summary:", error);
			showToast("计量汇总加载失败", "error");
		}
	};

	const fetchCommentList = async () => {
		setCommentListLoading(true);
		try {
			const params: {
				query?: string;
				article_title?: string;
				author?: string;
				created_start?: string;
				created_end?: string;
				is_hidden?: boolean;
				has_reply?: boolean;
				page?: number;
				size?: number;
			} = {
				page: commentListPage,
				size: commentListPageSize,
			};
			if (commentQuery) params.query = commentQuery;
			if (commentArticleTitle) params.article_title = commentArticleTitle;
			if (commentAuthor) params.author = commentAuthor;
			if (commentStart) params.created_start = `${commentStart}T00:00:00+00:00`;
			if (commentEnd) params.created_end = `${commentEnd}T23:59:59+00:00`;
			if (commentVisibility === "visible") params.is_hidden = false;
			if (commentVisibility === "hidden") params.is_hidden = true;
			if (commentReplyFilter === "reply") params.has_reply = true;
			if (commentReplyFilter === "main") params.has_reply = false;

			const response = await commentAdminApi.list(params);
			setCommentList(response.items || []);
			setCommentListTotal(response.pagination?.total || 0);
		} catch (error) {
			console.error("Failed to fetch comments:", error);
			showToast("评论列表加载失败", "error");
		} finally {
			setCommentListLoading(false);
		}
	};

	const fetchCommentSettings = async () => {
		setCommentSettingsLoading(true);
		try {
			const data = await commentSettingsApi.getSettings();
			setCommentSettings(data);
		} catch (error) {
			console.error("Failed to fetch comment settings:", error);
			showToast("评论配置加载失败", "error");
		} finally {
			setCommentSettingsLoading(false);
		}
	};

	const handleSaveCommentSettings = async () => {
		setCommentSettingsSaving(true);
		try {
			await commentSettingsApi.updateSettings(commentSettings);
			showToast("评论配置已保存");
		} catch (error) {
			console.error("Failed to save comment settings:", error);
			showToast("评论配置保存失败", "error");
		} finally {
			setCommentSettingsSaving(false);
		}
	};

	const fetchBasicSettings = async () => {
		setBasicSettingsLoading(true);
		try {
			const data = await basicSettingsApi.getSettings();
			setBasicSettingsForm(data);
		} catch (error) {
			console.error("Failed to fetch basic settings:", error);
			showToast(t("基础配置加载失败"), "error");
		} finally {
			setBasicSettingsLoading(false);
		}
	};

	const handleSaveBasicSettings = async () => {
		setBasicSettingsSaving(true);
		try {
			await basicSettingsApi.updateSettings(basicSettingsForm);
			updateBasicSettingsContext(basicSettingsForm);
			showToast(t("基础配置已保存"));
		} catch (error) {
			console.error("Failed to save basic settings:", error);
			showToast(t("基础配置保存失败"), "error");
		} finally {
			setBasicSettingsSaving(false);
		}
	};

	const fetchStorageSettings = async () => {
		setStorageSettingsLoading(true);
		setStorageStatsLoading(true);
		try {
			const [settingsData, statsData] = await Promise.all([
				storageSettingsApi.getSettings(),
				mediaApi.getStats(),
			]);
			setStorageSettings(settingsData);
			setStorageStats({
				asset_count: statsData.asset_count ?? 0,
				asset_total_size: statsData.asset_total_size ?? 0,
				disk_file_count: statsData.disk_file_count ?? 0,
				disk_total_size: statsData.disk_total_size ?? 0,
			});
		} catch (error) {
			console.error("Failed to fetch storage settings:", error);
			showToast("存储配置加载失败", "error");
		} finally {
			setStorageSettingsLoading(false);
			setStorageStatsLoading(false);
		}
	};

	const handleSaveStorageSettings = async () => {
		setStorageSettingsSaving(true);
		try {
			await storageSettingsApi.updateSettings(storageSettings);
			showToast("存储配置已保存");
		} catch (error) {
			console.error("Failed to save storage settings:", error);
			showToast("存储配置保存失败", "error");
		} finally {
			setStorageSettingsSaving(false);
		}
	};

	const fetchRecommendationSettings = async () => {
		setRecommendationSettingsLoading(true);
		try {
			const data = await recommendationSettingsApi.getSettings();
			setRecommendationSettings(data);
		} catch (error) {
			console.error("Failed to fetch recommendation settings:", error);
			showToast(t("文章推荐配置加载失败"), "error");
		} finally {
			setRecommendationSettingsLoading(false);
		}
	};

	const handleSaveRecommendationSettings = async () => {
		if (
			recommendationSettings.recommendations_enabled &&
			!recommendationSettings.recommendation_model_config_id
		) {
			showToast(t("开启文章推荐前，请先选择远程向量模型"), "error");
			return;
		}
		setRecommendationSettingsSaving(true);
		try {
			await recommendationSettingsApi.updateSettings(recommendationSettings);
			showToast(t("文章推荐配置已保存"));
		} catch (error: any) {
			console.error("Failed to save recommendation settings:", error);
			showToast(
				error?.response?.data?.detail || t("文章推荐配置保存失败"),
				"error",
			);
		} finally {
			setRecommendationSettingsSaving(false);
		}
	};

	const handleCleanupMedia = async () => {
		setStorageCleanupLoading(true);
		try {
			const result = await mediaApi.cleanup();
			showToast(
				t("清理完成：记录 {records}，文件 {files}")
					.replace("{records}", String(result.removed_records))
					.replace("{files}", String(result.removed_files)),
				);
			await fetchStorageSettings();
		} catch (error) {
			console.error("Failed to cleanup media:", error);
			showToast(t("清理失败"), "error");
		} finally {
			setStorageCleanupLoading(false);
		}
	};

	const handleGenerateNextAuthSecret = () => {
		if (typeof window === "undefined") return;
		const bytes = new Uint8Array(32);
		window.crypto.getRandomValues(bytes);
		const secret = Array.from(bytes)
			.map((b) => b.toString(16).padStart(2, "0"))
			.join("");
		setCommentSettings((prev) => ({ ...prev, nextauth_secret: secret }));
	};

	const handleValidateCommentSettings = () => {
		const messages: string[] = [];
		const callbacks: string[] = [];
		const origin = typeof window !== "undefined" ? window.location.origin : "";

		if (!commentSettings.comments_enabled) {
			messages.push(t("评论已关闭，当前不会对访客开放。"));
		}

		const hasGithub =
			Boolean(commentSettings.github_client_id) &&
			Boolean(commentSettings.github_client_secret);
		const hasGoogle =
			Boolean(commentSettings.google_client_id) &&
			Boolean(commentSettings.google_client_secret);

		if (!commentSettings.nextauth_secret) {
			messages.push(t("NextAuth Secret 未配置。"));
		}
		if (!hasGithub && !hasGoogle) {
			messages.push(t("至少需要配置 GitHub 或 Google 的 Client 信息。"));
		}
		if (
			commentSettings.github_client_id &&
			!commentSettings.github_client_secret
		) {
			messages.push(t("GitHub Client Secret 未填写。"));
		}
		if (
			commentSettings.github_client_secret &&
			!commentSettings.github_client_id
		) {
			messages.push(t("GitHub Client ID 未填写。"));
		}
		if (
			commentSettings.google_client_id &&
			!commentSettings.google_client_secret
		) {
			messages.push(t("Google Client Secret 未填写。"));
		}
		if (
			commentSettings.google_client_secret &&
			!commentSettings.google_client_id
		) {
			messages.push(t("Google Client ID 未填写。"));
		}

		if (origin) {
			if (hasGithub) {
				callbacks.push(`${origin}/api/auth/callback/github`);
			}
			if (hasGoogle) {
				callbacks.push(`${origin}/api/auth/callback/google`);
			}
		}

		const ok = messages.length === 0;
		setCommentValidationResult({
			ok,
			messages: ok ? [t("配置检查通过")] : messages,
			callbacks,
		});
		showToast(
			ok ? t("OAuth 配置检查通过") : t("OAuth 配置存在问题"),
			ok ? "success" : "error",
		);
	};

	const handleToggleCommentVisibility = async (
		commentId: string,
		nextHidden: boolean,
	) => {
		if (pendingCommentActionIds.has(commentId)) return;
		setCommentActionPending(commentId, true);
		try {
			await commentApi.toggleHidden(commentId, nextHidden);
			showToast(nextHidden ? t("评论已隐藏") : t("评论已显示"));
			await fetchCommentList();
		} catch (error) {
			console.error("Failed to toggle comment visibility:", error);
			showToast(t("更新失败"), "error");
		} finally {
			setCommentActionPending(commentId, false);
		}
	};

	const handleDeleteCommentAdmin = async (commentId: string) => {
		setConfirmState({
			isOpen: true,
			title: t("删除评论"),
			message: t("确定要删除这条评论吗？此操作不可撤销。"),
			confirmText: t("删除"),
			cancelText: t("取消"),
			onConfirm: async () => {
				if (pendingCommentActionIds.has(commentId)) return;
				setCommentActionPending(commentId, true);
				try {
					await commentAdminApi.delete(commentId);
					showToast(t("删除成功"));
					await fetchCommentList();
				} catch (error) {
					console.error("Failed to delete comment:", error);
					showToast(t("删除失败"), "error");
				} finally {
					setCommentActionPending(commentId, false);
				}
			},
			onCancel: () => {},
		});
	};

	const resetTaskFilters = () => {
		setTaskStatusFilter("");
		setTaskTypeFilter("");
		setTaskArticleIdFilter("");
		setTaskArticleTitleFilter("");
		setTaskPage(1);
	};

	const resetUsageFilters = () => {
		setUsageModelId("");
		setUsageStatus("");
		setUsageContentType("");
		setUsageStart("");
		setUsageEnd("");
		setUsagePage(1);
	};

	const resetCommentFilters = () => {
		setCommentQuery("");
		setCommentArticleTitle("");
		setCommentAuthor("");
		setCommentStart("");
		setCommentEnd("");
		setCommentVisibility("");
		setCommentReplyFilter("");
		setCommentListPage(1);
	};

	useEffect(() => {
		if (!routeInitialized) return;
		if (activeSection === "categories") {
			fetchCategories();
			return;
		}
		if (activeSection === "basic") {
			fetchBasicSettings();
			return;
		}
		if (activeSection === "ai") {
			if (aiSubSection === "model-api") {
				fetchModelAPIConfigs();
			} else if (aiSubSection === "prompt") {
				fetchPromptConfigs();
			} else {
				fetchRecommendationSettings();
				fetchModelAPIConfigs();
			}
			return;
		}
		if (activeSection === "monitoring") {
			if (monitoringSubSection === "tasks") {
				fetchTasks();
			} else {
				if (monitoringSubSection === "ai-usage") {
					fetchModelAPIConfigs();
					fetchUsageSummary();
					fetchUsageLogs();
				}
				if (monitoringSubSection === "comments") {
					fetchCommentList();
				}
			}
			return;
		}
		if (activeSection === "comments") {
			fetchCommentSettings();
			return;
		}
		if (activeSection === "storage") {
			fetchStorageSettings();
			return;
		}
	}, [
		activeSection,
		aiSubSection,
		commentSubSection,
		monitoringSubSection,
		routeInitialized,
	]);

	useEffect(() => {
		setCommentValidationResult(null);
	}, [commentSubSection]);

	useEffect(() => {
		const prevSection = prevActiveSectionRef.current;
		const prevMonitoringSubSection = prevMonitoringSubSectionRef.current;

		if (prevSection && prevSection !== activeSection) {
			if (prevSection === "monitoring") {
				resetTaskFilters();
				resetUsageFilters();
			}
			if (activeSection === "monitoring") {
				if (monitoringSubSection === "tasks") {
					resetTaskFilters();
				} else {
					resetUsageFilters();
				}
			}
		}

		if (
			activeSection === "monitoring" &&
			prevMonitoringSubSection &&
			prevMonitoringSubSection !== monitoringSubSection
		) {
			if (monitoringSubSection === "tasks") {
				resetTaskFilters();
			} else if (monitoringSubSection === "ai-usage") {
				resetUsageFilters();
			} else if (monitoringSubSection === "comments") {
				resetCommentFilters();
			}
		}

		prevActiveSectionRef.current = activeSection;
		prevMonitoringSubSectionRef.current = monitoringSubSection;
	}, [activeSection, monitoringSubSection]);

	useEffect(() => {
		if (!routeInitialized) return;
		if (activeSection !== "monitoring" || monitoringSubSection !== "tasks")
			return;
		fetchTasks();
	}, [
		taskPage,
		taskPageSize,
		taskStatusFilter,
		taskTypeFilter,
		taskArticleIdFilter,
		taskArticleTitleFilter,
		activeSection,
		monitoringSubSection,
	]);

	useEffect(() => {
		if (!routeInitialized) return;
		if (activeSection !== "monitoring" || monitoringSubSection !== "ai-usage") {
			return;
		}
		fetchUsageSummary();
		fetchUsageLogs();
	}, [
		activeSection,
		monitoringSubSection,
		usageModelId,
		usageStatus,
		usageContentType,
		usageStart,
		usageEnd,
		usagePage,
		usagePageSize,
	]);

	useEffect(() => {
		if (!routeInitialized) return;
		if (activeSection !== "monitoring" || monitoringSubSection !== "comments") {
			return;
		}
		fetchCommentList();
	}, [
		activeSection,
		monitoringSubSection,
		commentListPage,
		commentListPageSize,
		commentQuery,
		commentArticleTitle,
		commentAuthor,
		commentStart,
		commentEnd,
		commentVisibility,
		commentReplyFilter,
	]);

	const handleCreateModelAPINew = () => {
		const nextModelType = modelCategory === "vector" ? "vector" : "general";
		setEditingModelAPIConfig(null);
		setModelAPIFormData({
			name: "",
			base_url: "https://api.openai.com/v1",
			api_key: "",
			provider: "openai",
			model_name: "gpt-4o",
			model_type: nextModelType,
			price_input_per_1k: "",
			price_output_per_1k: "",
			currency: "USD",
			context_window_tokens: "",
			reserve_output_tokens: "",
			is_enabled: true,
			is_default: false,
		});
		setModelOptions([]);
		setModelOptionsError("");
		setModelNameManual(false);
		setShowModelAPIAdvanced(false);
		setShowModelAPIModal(true);
	};

	const handleEditModelAPI = (config: ModelAPIConfig) => {
		setEditingModelAPIConfig(config);
		if ((config.model_type || "general") === "vector") {
			setModelCategory("vector");
		}
		setModelAPIFormData({
			name: config.name,
			base_url: config.base_url,
			api_key: config.api_key,
			provider: config.provider || "openai",
			model_name: config.model_name,
			model_type: config.model_type || "general",
			price_input_per_1k: config.price_input_per_1k?.toString() || "",
			price_output_per_1k: config.price_output_per_1k?.toString() || "",
			currency: config.currency || "USD",
			context_window_tokens: config.context_window_tokens?.toString() || "",
			reserve_output_tokens: config.reserve_output_tokens?.toString() || "",
			is_enabled: config.is_enabled,
			is_default: config.is_default,
		});
		setModelOptions([]);
		setModelOptionsError("");
		setModelNameManual(false);
		setShowModelAPIAdvanced(false);
		setShowModelAPIModal(true);
	};

	const handleSaveModelAPI = async () => {
		if (modelAPISaving) return;
		const modelApiName = modelAPIFormData.name.trim();
		if (!modelApiName) {
			showToast(t("请填写配置名称"), "error");
			return;
		}
		const contextWindowTokens = modelAPIFormData.context_window_tokens
			? Number(modelAPIFormData.context_window_tokens)
			: undefined;
		const reserveOutputTokens = modelAPIFormData.reserve_output_tokens
			? Number(modelAPIFormData.reserve_output_tokens)
			: undefined;
		if (contextWindowTokens != null && contextWindowTokens <= 0) {
			showToast(t("上下文窗口必须大于 0"), "error");
			return;
		}
		if (reserveOutputTokens != null && reserveOutputTokens < 0) {
			showToast(t("输出预留不能小于 0"), "error");
			return;
		}
		if (
			contextWindowTokens != null &&
			reserveOutputTokens != null &&
			reserveOutputTokens >= contextWindowTokens
		) {
			showToast(t("输出预留必须小于上下文窗口"), "error");
			return;
		}
		const payload = {
			...modelAPIFormData,
			name: modelApiName,
			price_input_per_1k: modelAPIFormData.price_input_per_1k
				? Number(modelAPIFormData.price_input_per_1k)
				: undefined,
			price_output_per_1k: modelAPIFormData.price_output_per_1k
				? Number(modelAPIFormData.price_output_per_1k)
				: undefined,
			currency: modelAPIFormData.currency || undefined,
			context_window_tokens: contextWindowTokens,
			reserve_output_tokens: reserveOutputTokens,
		};
		setModelAPISaving(true);
		try {
			if (editingModelAPIConfig) {
				await articleApi.updateModelAPIConfig(
					editingModelAPIConfig.id,
					payload,
				);
			} else {
				await articleApi.createModelAPIConfig(payload);
			}
			showToast(editingModelAPIConfig ? t("配置已更新") : t("配置已创建"));
			await fetchModelAPIConfigs();
			setShowModelAPIModal(false);
			setShowModelAPIAdvanced(false);
			setEditingModelAPIConfig(null);
		} catch (error) {
			console.error("Failed to save model API config:", error);
			showToast(t("保存失败"), "error");
		} finally {
			setModelAPISaving(false);
		}
	};

	const handleDeleteModelAPI = async (id: string) => {
		setConfirmState({
			isOpen: true,
			title: t("删除模型配置"),
			message: t("确定要删除这个模型API配置吗？此操作不可撤销。"),
			confirmText: t("删除"),
			cancelText: t("取消"),
			onConfirm: async () => {
				try {
					await articleApi.deleteModelAPIConfig(id);
					showToast(t("删除成功"));
					fetchModelAPIConfigs();
				} catch (error) {
					console.error("Failed to delete model API config:", error);
					showToast(t("删除失败"), "error");
				}
			},
		});
	};

	const handleTestModelAPI = (config: ModelAPIConfig) => {
		setModelAPITestConfig(config);
		setModelAPITestPrompt(
			(config.model_type || "general") === "vector"
				? t(
						"针对敏感肌专门设计的天然有机护肤产品：体验由芦荟和洋甘菊提取物带来的自然呵护。我们的护肤产品特别为敏感肌设计，温和滋润，保护您的肌肤不受刺激。让您的肌肤告别不适，迎来健康光彩。",
					)
				: t("请回复：OK"),
		);
		setModelAPITestResult("");
		setModelAPITestRaw("");
		setModelAPITestError("");
		setShowModelAPITestModal(true);
	};

	const handleFetchModelOptions = async () => {
		if (!modelAPIFormData.base_url || !modelAPIFormData.api_key) {
			showToast(t("请先填写API地址与密钥"), "info");
			return;
		}
		if (modelAPIFormData.provider === "jina") {
			setModelOptions([]);
			setModelOptionsError(
				t("JinaAI 暂不支持自动获取模型列表，请手动填写模型名称"),
			);
			return;
		}
		setModelOptionsLoading(true);
		setModelOptionsError("");
		try {
			const result = await articleApi.getModelAPIModels({
				base_url: modelAPIFormData.base_url,
				api_key: modelAPIFormData.api_key,
				provider: modelAPIFormData.provider,
			});
			if (result.success) {
				setModelOptions(result.models || []);
				showToast(t("已获取模型列表"));
			} else {
				setModelOptions([]);
				setModelOptionsError(result.message || t("获取模型失败"));
				showToast(t("获取模型失败"), "error");
			}
		} catch (error) {
			console.error("Failed to fetch model list:", error);
			setModelOptions([]);
			setModelOptionsError(t("获取模型失败"));
			showToast(t("获取模型失败"), "error");
		} finally {
			setModelOptionsLoading(false);
		}
	};

	useEffect(() => {
		if (!showModelAPIModal) return;
		if (!modelAPIFormData.base_url || !modelAPIFormData.api_key) return;
		if (modelOptionsFetchRef.current) {
			clearTimeout(modelOptionsFetchRef.current);
		}
		modelOptionsFetchRef.current = setTimeout(() => {
			handleFetchModelOptions();
		}, 500);
		return () => {
			if (modelOptionsFetchRef.current) {
				clearTimeout(modelOptionsFetchRef.current);
			}
		};
	}, [showModelAPIModal, modelAPIFormData.base_url, modelAPIFormData.api_key]);

	const handleRunModelAPITest = async () => {
		if (!modelAPITestConfig) return;
		setModelAPITestLoading(true);
		setModelAPITestResult("");
		setModelAPITestRaw("");
		setModelAPITestError("");
		try {
			const result = await articleApi.testModelAPIConfig(
				modelAPITestConfig.id,
				{ prompt: modelAPITestPrompt },
			);
			if (result.success) {
				setModelAPITestResult(result.content || "");
				setModelAPITestRaw(result.raw_response || "");
				showToast(t("调用成功"));
			} else {
				setModelAPITestError(result.message || t("调用失败"));
				setModelAPITestResult(result.content || "");
				setModelAPITestRaw(result.raw_response || "");
				showToast(t("调用失败"), "error");
			}
		} catch (error) {
			console.error("Failed to test model API config:", error);
			setModelAPITestError(t("调用失败"));
			showToast(t("调用失败"), "error");
		} finally {
			setModelAPITestLoading(false);
		}
	};

	const handleCreatePromptNew = () => {
		setEditingPromptConfig(null);
		setPromptFormData({
			name: "",
			category_id: "",
			type: selectedPromptType,
			prompt: "",
			system_prompt: "",
			response_format: "",
			temperature: "",
			max_tokens: "",
			top_p: "",
			chunk_size_tokens: "",
			chunk_overlap_tokens: "",
			max_continue_rounds: "",
			model_api_config_id: "",
			is_enabled: true,
			is_default: false,
		});
		setShowPromptAdvanced(false);
		setShowPromptModal(true);
	};

	const handleEditPrompt = (config: PromptConfig) => {
		setEditingPromptConfig(config);
		setPromptFormData({
			name: config.name,
			category_id: config.category_id || "",
			type: config.type,
			prompt: config.prompt,
			system_prompt: config.system_prompt || "",
			response_format: config.response_format || "",
			temperature: config.temperature?.toString() || "",
			max_tokens: config.max_tokens?.toString() || "",
			top_p: config.top_p?.toString() || "",
			chunk_size_tokens: config.chunk_size_tokens?.toString() || "",
			chunk_overlap_tokens: config.chunk_overlap_tokens?.toString() || "",
			max_continue_rounds: config.max_continue_rounds?.toString() || "",
			model_api_config_id: config.model_api_config_id || "",
			is_enabled: config.is_enabled,
			is_default: config.is_default,
		});
		setShowPromptAdvanced(false);
		setShowPromptModal(true);
	};

	const handleSavePrompt = async () => {
		if (promptSaving) return;
		if (!promptFormData.system_prompt.trim()) {
			showToast("请填写系统提示词", "error");
			return;
		}
		if (!promptFormData.prompt.trim()) {
			showToast("请填写提示词", "error");
			return;
		}
		const hasAnyChunkOption =
			promptTypeSupportsChunkOptions &&
			(Boolean(promptFormData.chunk_size_tokens.trim()) ||
				Boolean(promptFormData.chunk_overlap_tokens.trim()) ||
				Boolean(promptFormData.max_continue_rounds.trim()));
		if (hasAnyChunkOption) {
			if (
				!promptFormData.chunk_size_tokens.trim() ||
				!promptFormData.chunk_overlap_tokens.trim() ||
				!promptFormData.max_continue_rounds.trim()
			) {
				showToast(
					t("启用分块参数时，需同时填写分块大小、分块重叠、最多续写轮次"),
					"error",
				);
				return;
			}
			if (!promptFormData.model_api_config_id) {
				showToast(t("启用分块参数时，请先绑定模型配置"), "error");
				return;
			}
			const boundModel = modelAPIConfigs.find(
				(config) => config.id === promptFormData.model_api_config_id,
			);
			if (!boundModel) {
				showToast(t("绑定模型不存在，请重新选择"), "error");
				return;
			}
			if (
				boundModel.context_window_tokens == null ||
				boundModel.reserve_output_tokens == null
			) {
				showToast(
					t("绑定模型缺少上下文窗口或输出预留，无法启用分块参数"),
					"error",
				);
				return;
			}
			const chunkSizeValue = Number(promptFormData.chunk_size_tokens);
			const chunkOverlapValue = Number(promptFormData.chunk_overlap_tokens);
			const continueRoundsValue = Number(promptFormData.max_continue_rounds);
			if (!Number.isFinite(chunkSizeValue) || chunkSizeValue <= 0) {
				showToast(t("分块大小必须大于 0"), "error");
				return;
			}
			if (!Number.isFinite(chunkOverlapValue) || chunkOverlapValue < 0) {
				showToast(t("分块重叠不能小于 0"), "error");
				return;
			}
			if (!Number.isFinite(continueRoundsValue) || continueRoundsValue < 0) {
				showToast(t("最多续写轮次不能小于 0"), "error");
				return;
			}
		}

		setPromptSaving(true);
		try {
			const data = {
				...promptFormData,
				category_id: promptFormData.category_id || undefined,
				model_api_config_id: promptFormData.model_api_config_id || undefined,
				system_prompt: promptFormData.system_prompt || undefined,
				response_format: promptFormData.response_format || undefined,
				temperature: promptFormData.temperature
					? Number(promptFormData.temperature)
					: undefined,
				max_tokens: promptFormData.max_tokens
					? Number(promptFormData.max_tokens)
					: undefined,
				top_p: promptFormData.top_p ? Number(promptFormData.top_p) : undefined,
				chunk_size_tokens:
					promptTypeSupportsChunkOptions && promptFormData.chunk_size_tokens
					? Number(promptFormData.chunk_size_tokens)
					: undefined,
				chunk_overlap_tokens:
					promptTypeSupportsChunkOptions && promptFormData.chunk_overlap_tokens
					? Number(promptFormData.chunk_overlap_tokens)
					: undefined,
				max_continue_rounds:
					promptTypeSupportsChunkOptions && promptFormData.max_continue_rounds
					? Number(promptFormData.max_continue_rounds)
					: undefined,
			};

			if (editingPromptConfig) {
				await articleApi.updatePromptConfig(editingPromptConfig.id, data);
			} else {
				await articleApi.createPromptConfig(data);
			}
			showToast(editingPromptConfig ? t("配置已更新") : t("配置已创建"));
			await fetchPromptConfigs();
			setShowPromptModal(false);
			setEditingPromptConfig(null);
		} catch (error) {
			console.error("Failed to save prompt config:", error);
			showToast(t("保存失败"), "error");
		} finally {
			setPromptSaving(false);
		}
	};

	const getRetryPromptTypeForTask = (task: AITaskItem): PromptType | null => {
		if (task.task_type === "process_article_cleaning") return "content_cleaning";
		if (task.task_type === "process_article_validation")
			return "content_validation";
		if (task.task_type === "process_article_classification")
			return "classification";
		if (task.task_type === "process_article_translation") return "translation";
		if (
			task.task_type === "process_ai_content" &&
			task.content_type &&
			([
				"summary",
				"key_points",
				"outline",
				"quotes",
			] as string[]).includes(task.content_type)
		) {
			return task.content_type as PromptType;
		}
		return null;
	};

	const closeTaskRetryModal = () => {
		setShowTaskRetryModal(false);
		setRetryTargetTask(null);
		setRetryTaskPromptType(null);
		setRetryTaskModelConfigId("");
		setRetryTaskPromptConfigId("");
		setRetryTaskModelOptions([]);
		setRetryTaskPromptOptions([]);
		setRetryTaskOptionsLoading(false);
		setRetryTaskSubmitting(false);
	};

	const handleOpenTaskRetryModal = async (task: AITaskItem) => {
		if (pendingTaskActionIds.has(task.id)) return;
		const promptType = getRetryPromptTypeForTask(task);
		setRetryTargetTask(task);
		setRetryTaskPromptType(promptType);
		setRetryTaskModelConfigId("");
		setRetryTaskPromptConfigId("");
		setRetryTaskModelOptions([]);
		setRetryTaskPromptOptions([]);
		setRetryTaskOptionsLoading(true);
		setShowTaskRetryModal(true);
		try {
			const [models, prompts] = await Promise.all([
				articleApi.getModelAPIConfigs(),
				articleApi.getPromptConfigs(),
			]);
			const enabledGeneralModels = (models as ModelAPIConfig[]).filter(
				(config) => config.is_enabled && config.model_type !== "vector",
			);
			const enabledPrompts = (prompts as PromptConfig[]).filter(
				(config) =>
					config.is_enabled && (!promptType || config.type === promptType),
			);
			setRetryTaskModelOptions(enabledGeneralModels);
			setRetryTaskPromptOptions(enabledPrompts);
		} catch (error) {
			console.error("Failed to load retry configs:", error);
			showToast(t("加载重试配置失败"), "error");
		} finally {
			setRetryTaskOptionsLoading(false);
		}
	};

	const handleSubmitTaskRetry = async () => {
		if (!retryTargetTask) return;
		const taskId = retryTargetTask.id;
		if (pendingTaskActionIds.has(taskId)) return;
		setRetryTaskSubmitting(true);
		setTaskActionPending(taskId, true);
		try {
			const result = await articleApi.retryAITasks([taskId], {
				model_config_id: retryTaskModelConfigId || undefined,
				prompt_config_id: retryTaskPromptConfigId || undefined,
			});
			if ((result?.updated || 0) > 0) {
				showToast(t("任务已重试"));
				closeTaskRetryModal();
			} else {
				const skipReason = result?.skipped_reasons?.[taskId];
				showToast(skipReason || t("当前任务状态不支持重试"), "info");
			}
			await fetchTasks();
		} catch (error: any) {
			console.error("Failed to retry task:", error);
			showToast(error?.response?.data?.detail || t("重试失败"), "error");
		} finally {
			setRetryTaskSubmitting(false);
			setTaskActionPending(taskId, false);
		}
	};

	const handleCancelTask = async (taskId: string) => {
		setConfirmState({
			isOpen: true,
			title: t("取消任务"),
			message: t("确定取消该任务吗？"),
			confirmText: t("确定"),
			cancelText: t("取消"),
			onConfirm: async () => {
				if (pendingTaskActionIds.has(taskId)) return;
				setTaskActionPending(taskId, true);
				try {
					await articleApi.cancelAITasks([taskId]);
					showToast(t("任务已取消"));
					await fetchTasks();
				} catch (error) {
					console.error("Failed to cancel task:", error);
					showToast(t("取消失败"), "error");
				} finally {
					setTaskActionPending(taskId, false);
				}
			},
		});
	};

	const handleOpenTaskTimeline = async (
		taskId: string,
		preferredUsageId?: string | null,
	) => {
		if (openingTaskTimelineId === taskId) return;
		setOpeningTaskTimelineId(taskId);
		setShowTaskTimelineModal(true);
		setTaskTimelineLoading(true);
		setTaskTimelineError("");
		setSelectedTaskTimelineChainId(null);
		setSelectedTaskTimelineUsageId(null);
		setSelectedTaskEventId(null);
		try {
			const data = await articleApi.getAITaskTimeline(taskId);
			setSelectedTaskTimeline(data);
			const chains = buildTaskTimelineChains(data);
			const preferredChain = preferredUsageId
				? chains.find((chain) =>
						chain.usage.some((usage) => usage.id === preferredUsageId),
					)
				: null;
			const targetChain = preferredChain || chains[chains.length - 1] || null;
			setSelectedTaskTimelineChainId(targetChain?.id || null);
			const selectedUsageId =
				preferredUsageId &&
				targetChain?.usage.some((usage) => usage.id === preferredUsageId)
					? preferredUsageId
					: targetChain?.usage[targetChain.usage.length - 1]?.id || null;
			setSelectedTaskTimelineUsageId(selectedUsageId);
			setSelectedTaskEventId(
				targetChain?.nodes[targetChain.nodes.length - 1]?.id || null,
			);
		} catch (error: any) {
			console.error("Failed to fetch task timeline:", error);
			setSelectedTaskTimeline(null);
			setTaskTimelineError(
				error?.response?.data?.detail || t("任务详情加载失败"),
			);
		} finally {
			setTaskTimelineLoading(false);
			setOpeningTaskTimelineId(null);
		}
	};

	useEffect(() => {
		if (!router.isReady || !routeInitialized) return;
		const shouldAutoOpen =
			typeof router.query.open_task_detail === "string" &&
			router.query.open_task_detail.trim() === "1";
		if (!shouldAutoOpen) {
			openedTaskTimelineFromQueryRef.current = null;
			return;
		}
		const taskIdFromQuery =
			typeof router.query.task_id === "string"
				? router.query.task_id.trim()
				: "";
		if (taskIdFromQuery) {
			const queryKey = `task:${taskIdFromQuery}`;
			if (openedTaskTimelineFromQueryRef.current === queryKey) {
				return;
			}
			openedTaskTimelineFromQueryRef.current = queryKey;
			setActiveSection("monitoring");
			setMonitoringSubSection("tasks");
			void handleOpenTaskTimeline(taskIdFromQuery);
			return;
		}

		if (taskLoading || taskItems.length === 0) {
			return;
		}
		const firstTask = taskItems[0];
		const queryKey = `first:${firstTask.id}`;
		if (openedTaskTimelineFromQueryRef.current === queryKey) {
			return;
		}
		openedTaskTimelineFromQueryRef.current = queryKey;
		setActiveSection("monitoring");
		setMonitoringSubSection("tasks");
		void handleOpenTaskTimeline(firstTask.id);
	}, [
		handleOpenTaskTimeline,
		routeInitialized,
		router.isReady,
		router.query.open_task_detail,
		router.query.task_id,
		taskItems,
		taskLoading,
	]);

	const handleRefreshTaskTimeline = async () => {
		const taskId = selectedTaskTimeline?.task.id;
		if (!taskId || taskTimelineLoading || taskTimelineRefreshing) return;
		setTaskTimelineRefreshing(true);
		setTaskTimelineError("");
		try {
			const data = await articleApi.getAITaskTimeline(taskId);
			setSelectedTaskTimeline(data);
			const chains = buildTaskTimelineChains(data);
			const selectedChain =
				(selectedTaskTimelineChainId
					? chains.find((chain) => chain.id === selectedTaskTimelineChainId)
					: null) ||
				(selectedTaskTimelineUsageId
					? chains.find((chain) =>
							chain.usage.some((usage) => usage.id === selectedTaskTimelineUsageId),
						)
					: null) ||
				chains[chains.length - 1] ||
				null;
			setSelectedTaskTimelineChainId(selectedChain?.id || null);
			const selectedUsageId =
				selectedTaskTimelineUsageId &&
				selectedChain?.usage.some(
					(usage) => usage.id === selectedTaskTimelineUsageId,
				)
					? selectedTaskTimelineUsageId
					: selectedChain?.usage[selectedChain.usage.length - 1]?.id || null;
			setSelectedTaskTimelineUsageId(selectedUsageId);
			const selectedNodeId =
				selectedTaskEventId &&
				selectedChain?.nodes.some((node) => node.id === selectedTaskEventId)
					? selectedTaskEventId
					: selectedChain?.nodes[selectedChain.nodes.length - 1]?.id || null;
			setSelectedTaskEventId(selectedNodeId);
		} catch (error: any) {
			console.error("Failed to refresh task timeline:", error);
			setTaskTimelineError(
				error?.response?.data?.detail || t("任务详情刷新失败"),
			);
		} finally {
			setTaskTimelineRefreshing(false);
		}
	};

	const handleOpenUsageRelatedTask = (taskId: string, usageId?: string) => {
		setActiveSection("monitoring");
		setMonitoringSubSection("tasks");
		void handleOpenTaskTimeline(taskId, usageId);
	};

	const closeTaskTimelineModal = () => {
		setShowTaskTimelineModal(false);
		setSelectedTaskTimeline(null);
		setSelectedTaskTimelineChainId(null);
		setSelectedTaskTimelineUsageId(null);
		setSelectedTaskEventId(null);
		setTaskTimelineRefreshing(false);
		setTaskTimelineError("");
	};

	const getTaskTypeLabel = (taskType: string, contentType?: string | null) => {
		if (taskType === "process_article_cleaning") return t("清洗");
		if (taskType === "process_article_validation") return t("校验");
		if (taskType === "process_article_classification") return t("分类");
		if (taskType === "process_article_translation") return t("翻译");
		if (taskType === "process_article_embedding") return t("向量化");
		if (taskType === "process_ai_content") {
			if (contentType === "summary") return t("摘要");
			if (contentType === "key_points") return t("总结");
			if (contentType === "outline") return t("大纲");
			if (contentType === "quotes") return t("金句");
			return t("AI内容");
		}
		return t("其他");
	};

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
		if (node.kind === "usage") return t("AI调用");
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

	const formatTaskEventDetails = (details: AITaskTimelineEvent["details"]) => {
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

	const getUsageStatusLabel = (status: string) => {
		if (status === "completed") return t("已完成");
		if (status === "failed") return t("失败");
		if (status === "processing") return t("处理中");
		if (status === "cancelled") return t("已取消");
		return t("待处理");
	};

	const getUsageContentTypeLabel = (contentType: string | null) => {
		if (!contentType) return "-";
		if (contentType === "summary") return t("摘要");
		if (contentType === "key_points") return t("总结");
		if (contentType === "outline") return t("大纲");
		if (contentType === "quotes") return t("金句");
		if (contentType === "translation") return t("翻译");
		if (contentType === "content_cleaning") return t("清洗");
		if (contentType === "content_validation") return t("校验");
		if (contentType === "classification") return t("分类");
		return contentType;
	};

	const formatJsonPayload = (payload: string | null) => {
		if (!payload) return t("暂无数据");
		try {
			const parsed = JSON.parse(payload);
			return JSON.stringify(parsed, null, 2);
		} catch {
			return payload;
		}
	};

	const openUsagePayload = (title: string, payload: string | null) => {
		setUsagePayloadTitle(title);
		setUsagePayloadContent(formatJsonPayload(payload));
		setShowUsagePayloadModal(true);
	};

	const formatCostLine = (
		label: string,
		tokens: number | null,
		price: number | null,
		currency: string,
	) => {
		if (tokens == null || price == null) {
			return `${label}: -`;
		}
		const cost = (tokens / 1000) * price;
		return `${label}: (${tokens} / 1000) * ${price.toFixed(6)} = ${cost.toFixed(6)} ${currency}`;
	};

	const formatCostValue = (value: number | null | undefined, digits = 6) => {
		if (value == null || Number.isNaN(value)) return "-";
		return value.toFixed(digits);
	};

	const formatPrice = (value: number | null | undefined, digits = 6) => {
		if (value == null || Number.isNaN(value)) return "-";
		if (value === 0) return "0";
		return value.toFixed(digits);
	};

	const formatFileSize = (value: number | null | undefined) => {
		if (value == null || Number.isNaN(value)) return "-";
		if (value < 1024) return `${value} B`;
		if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
		if (value < 1024 * 1024 * 1024) {
			return `${(value / (1024 * 1024)).toFixed(2)} MB`;
		}
		return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`;
	};

	const stripReplyPrefix = (content: string) => {
		if (!content) return "";
		const lines = content.split("\n");
		const prefixes = ["> 回复 @", "> Reply @"];
		if (!prefixes.some((prefix) => lines[0]?.startsWith(prefix)))
			return content;
		const blankIndex = lines.findIndex(
			(line, index) => index > 0 && !line.trim(),
		);
		if (blankIndex >= 0) {
			return lines
				.slice(blankIndex + 1)
				.join("\n")
				.trim();
		}
		return lines.slice(1).join("\n").trim();
	};

	const buildCommentPreview = (content: string) =>
		stripReplyPrefix(content).replace(/\s+/g, " ").trim();

	const toDayjsRangeFromDateStrings = (start?: string, end?: string) => {
		if (!start && !end) return null;
		const startDate = start ? dayjs(start) : null;
		const endDate = end ? dayjs(end) : null;
		return [startDate, endDate] as [Dayjs | null, Dayjs | null];
	};

	const openUsageCost = (log: AIUsageLogItem) => {
		const currency = log.currency || "USD";
		const inputPrice =
			log.cost_input != null &&
			log.prompt_tokens != null &&
			log.prompt_tokens > 0
				? log.cost_input / (log.prompt_tokens / 1000)
				: null;
		const outputPrice =
			log.cost_output != null &&
			log.completion_tokens != null &&
			log.completion_tokens > 0
				? log.cost_output / (log.completion_tokens / 1000)
				: null;
		const inputCost =
			log.prompt_tokens != null && inputPrice != null
				? (log.prompt_tokens / 1000) * inputPrice
				: null;
		const outputCost =
			log.completion_tokens != null && outputPrice != null
				? (log.completion_tokens / 1000) * outputPrice
				: null;
		const totalCost =
			log.cost_total != null
				? log.cost_total
				: inputCost != null || outputCost != null
					? (inputCost || 0) + (outputCost || 0)
					: null;

		setUsageCostBreakdown({
			currency,
			promptTokens: log.prompt_tokens,
			completionTokens: log.completion_tokens,
			inputUnitPrice: inputPrice,
			outputUnitPrice: outputPrice,
			inputCost,
			outputCost,
			totalCost,
		});

		const inputLine = formatCostLine(
			t("输入"),
			log.prompt_tokens,
			inputPrice,
			currency,
		);
		const outputLine = formatCostLine(
			t("输出"),
			log.completion_tokens,
			outputPrice,
			currency,
		);

		setUsageCostTitle(t("费用计算逻辑（仅供参考）"));
		setUsageCostDetails(
			[
				t("费用计算详情")
					.replace("{inputLine}", inputLine)
					.replace("{outputLine}", outputLine)
					.replace(
						"{total}",
						totalCost != null ? `${totalCost.toFixed(6)} ${currency}` : "-",
					),
				`${t("输入单价（每 1K tokens）")}: ${formatCostValue(inputPrice)} ${currency}`,
				`${t("输出单价（每 1K tokens）")}: ${formatCostValue(outputPrice)} ${currency}`,
			].join("\n"),
		);
		setShowUsageCostModal(true);
	};

	const handleCopyPayload = async () => {
		try {
			await navigator.clipboard.writeText(usagePayloadContent);
			showToast(t("已复制"));
		} catch (error) {
			console.error(t("复制失败"), error);
			showToast(t("复制失败"), "error");
		}
	};

	const handleCopyTaskEventDetails = async () => {
		const detailContent =
			selectedTaskTimelineNode?.kind === "event"
				? formatTaskEventDetails(selectedTaskTimelineNode.event?.details || null)
				: selectedTaskTimelineNode?.kind === "usage"
					? JSON.stringify(
							{
								request_payload: selectedTaskTimelineNode.usage?.request_payload,
								response_payload:
									selectedTaskTimelineNode.usage?.response_payload,
							},
							null,
							2,
						)
					: "";
		if (!detailContent || detailContent === "{}") {
			showToast(t("暂无可复制参数"), "info");
			return;
		}
		try {
			await navigator.clipboard.writeText(detailContent);
			showToast(t("已复制"));
		} catch (error) {
			console.error(t("复制失败"), error);
			showToast(t("复制失败"), "error");
		}
	};

	const handleCopyMaskedValue = async (value: string) => {
		if (!value) return;
		try {
			await navigator.clipboard.writeText(value);
			showToast(t("已复制"));
		} catch (error) {
			console.error(t("复制失败"), error);
			showToast(t("复制失败"), "error");
		}
	};

	const formatUsageDateTime = (value: string | null) => {
		if (!value) return "-";
		const date = new Date(value);
		if (Number.isNaN(date.getTime())) return value;
		const pad = (num: number) => String(num).padStart(2, "0");
		const year = date.getFullYear();
		const month = pad(date.getMonth() + 1);
		const day = pad(date.getDate());
		const hours = pad(date.getHours());
		const minutes = pad(date.getMinutes());
		const seconds = pad(date.getSeconds());
		return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
	};

	const usageCostByCurrency = useMemo(() => {
		const totals = new Map<string, number>();
		usageByModel.forEach((item) => {
			if (item.cost_total == null) return;
			if (!item.currency) return;
			const currency = item.currency;
			totals.set(currency, (totals.get(currency) ?? 0) + item.cost_total);
		});
		return Array.from(totals.entries()).sort((a, b) =>
			a[0].localeCompare(b[0]),
		);
	}, [usageByModel]);

	const handleDeletePrompt = async (id: string) => {
		setConfirmState({
			isOpen: true,
			title: t("删除提示词配置"),
			message: t("确定要删除这个提示词配置吗？此操作不可撤销。"),
			confirmText: t("删除"),
			cancelText: t("取消"),
			onConfirm: async () => {
				try {
					await articleApi.deletePromptConfig(id);
					showToast("删除成功");
					fetchPromptConfigs();
				} catch (error) {
					console.error("Failed to delete prompt config:", error);
					showToast("删除失败", "error");
				}
			},
		});
	};

	const handleExportPromptConfigs = (scope: "current" | "all") => {
		const source =
			scope === "all"
				? promptConfigs
				: promptConfigs.filter((config) => config.type === selectedPromptType);

		const exportData = source.map(
			({
				category_name,
				model_api_config_name,
				created_at,
				updated_at,
				id,
				...rest
			}) => rest,
		);

		const blob = new Blob([JSON.stringify({ configs: exportData }, null, 2)], {
			type: "application/json",
		});
		const url = URL.createObjectURL(blob);
		const link = document.createElement("a");
		const suffix = scope === "all" ? "all" : selectedPromptType;
		link.href = url;
		link.download = `prompt-configs-${suffix}.json`;
		document.body.appendChild(link);
		link.click();
		document.body.removeChild(link);
		URL.revokeObjectURL(url);
	};

	const handleImportPromptConfigs = async (
		event: React.ChangeEvent<HTMLInputElement>,
	) => {
		if (promptImporting) return;
		const file = event.target.files?.[0];
		if (!file) return;
		setPromptImporting(true);
		try {
			const raw = await file.text();
			const parsed = JSON.parse(raw);
			const configs = Array.isArray(parsed) ? parsed : parsed?.configs;
			if (!Array.isArray(configs)) {
				showToast("导入失败：格式不正确", "error");
				return;
			}

			let created = 0;
			let updated = 0;
			let skipped = 0;

			for (const item of configs) {
				if (!item || typeof item !== "object") {
					skipped += 1;
					continue;
				}
				const type = String(item.type || "").trim();
				const name = String(item.name || "").trim();
				const prompt = String(item.prompt || "").trim();
				const systemPrompt = String(item.system_prompt || "").trim();

				if (!type || !name || !prompt || !systemPrompt) {
					skipped += 1;
					continue;
				}

				const payload = {
					name,
					type,
					prompt,
					system_prompt: systemPrompt,
					category_id: item.category_id || undefined,
					model_api_config_id: item.model_api_config_id || undefined,
					response_format: item.response_format || undefined,
					temperature: item.temperature ?? undefined,
					max_tokens: item.max_tokens ?? undefined,
					top_p: item.top_p ?? undefined,
					chunk_size_tokens: item.chunk_size_tokens ?? undefined,
					chunk_overlap_tokens: item.chunk_overlap_tokens ?? undefined,
					max_continue_rounds: item.max_continue_rounds ?? undefined,
					is_enabled: item.is_enabled ?? true,
					is_default: item.is_default ?? false,
				};

				const existing = promptConfigs.find(
					(config) =>
						config.type === type &&
						config.name === name &&
						(config.category_id || "") === (item.category_id || ""),
				);

				if (existing) {
					await articleApi.updatePromptConfig(existing.id, payload);
					updated += 1;
				} else {
					await articleApi.createPromptConfig(payload);
					created += 1;
				}
			}

			showToast(
				t("导入完成：新增 {created}，更新 {updated}，跳过 {skipped}")
					.replace("{created}", String(created))
					.replace("{updated}", String(updated))
					.replace("{skipped}", String(skipped)),
			);
			await fetchPromptConfigs();
		} catch (error) {
			console.error("Failed to import prompt configs:", error);
			showToast(t("导入失败，请检查文件内容"), "error");
		} finally {
			setPromptImporting(false);
			if (promptImportInputRef.current) {
				promptImportInputRef.current.value = "";
			}
		}
	};

	// Category handlers
	const handleCreateCategoryNew = () => {
		setEditingCategory(null);
		const maxSortOrder =
			categories.length > 0
				? Math.max(...categories.map((c) => c.sort_order)) + 1
				: 0;
		setCategoryFormData({
			name: "",
			description: "",
			color: PRESET_COLORS[0],
			sort_order: maxSortOrder,
		});
		setShowCategoryModal(true);
	};

	const handleEditCategory = (category: Category) => {
		setEditingCategory(category);
		setCategoryFormData({
			name: category.name,
			description: category.description || "",
			color: category.color,
			sort_order: category.sort_order,
		});
		setShowCategoryModal(true);
	};

	const handleSaveCategory = async () => {
		if (categorySaving) return;
		setCategorySaving(true);
		try {
			if (editingCategory) {
				await categoryApi.updateCategory(editingCategory.id, categoryFormData);
			} else {
				await categoryApi.createCategory(categoryFormData);
			}
			showToast(editingCategory ? t("分类已更新") : t("分类已创建"));
			await fetchCategories();
			setShowCategoryModal(false);
			setEditingCategory(null);
		} catch (error) {
			console.error("Failed to save category:", error);
			showToast(t("保存失败"), "error");
		} finally {
			setCategorySaving(false);
		}
	};

	const handleDeleteCategory = async (id: string) => {
		setConfirmState({
			isOpen: true,
			title: t("删除分类"),
			message: t("确定要删除这个分类吗？此操作不可撤销。"),
			confirmText: t("删除"),
			cancelText: t("取消"),
			onConfirm: async () => {
				try {
					await categoryApi.deleteCategory(id);
					showToast(t("删除成功"));
					fetchCategories();
				} catch (error) {
					console.error("Failed to delete category:", error);
					showToast(t("删除失败"), "error");
				}
			},
		});
	};

	if (authLoading) {
		return (
			<div className="min-h-screen bg-app flex flex-col">
				<AppHeader />
				<div className="flex-1 flex items-center justify-center">
					<div className="text-text-3">{t("加载中")}</div>
				</div>
				<AppFooter />
			</div>
		);
	}

	if (!isAdmin) {
		return (
			<div className="min-h-screen bg-app flex flex-col">
				<AppHeader />
				<div className="flex-1 flex items-center justify-center">
					<div className="text-center">
						<div className="text-text-3 mb-4">{t("无权限访问此页面")}</div>
						<Link
							href={`/login?redirect=${encodeURIComponent(router.asPath || "/admin")}`}
							className="text-primary hover:underline"
						>
							{t("去登录")}
						</Link>
					</div>
				</div>
				<AppFooter />
			</div>
		);
	}

	return (
		<div className="min-h-screen bg-app flex flex-col">
			<Head>
				<title>
					{t("管理台")} - {basicSettings.site_name || "Lumina"}
				</title>
			</Head>
			<AppHeader />

			<div className="flex-1">
				<div className="max-w-7xl mx-auto px-4 pt-6">
					<div className="flex gap-1 border-b border-border">
						<SelectableButton
							onClick={() => {
								setPrimaryTab("monitoring");
								setActiveSection("monitoring");
							}}
							active={primaryTab === "monitoring"}
							variant="tab"
						>
							{t("监控")}
						</SelectableButton>
						<SelectableButton
							onClick={() => {
								setPrimaryTab("settings");
								setActiveSection("basic");
							}}
							active={primaryTab === "settings"}
							variant="tab"
						>
							{t("设置")}
						</SelectableButton>
					</div>
				</div>

				<div className="max-w-7xl mx-auto px-4 py-6">
					<div className="flex min-w-0 gap-6">
						<aside className="w-64 flex-shrink-0">
							<div className="bg-surface rounded-lg shadow-sm p-4">
								<h2 className="font-semibold text-text-1 mb-4">
									{primaryTab === "monitoring" ? t("监控模块") : t("设置模块")}
								</h2>
								<div className="space-y-2">
									{primaryTab === "monitoring" ? (
										<>
											<SelectableButton
												onClick={() => {
													setActiveSection("monitoring");
													setMonitoringSubSection("ai-usage");
												}}
												active={
													activeSection === "monitoring" &&
													monitoringSubSection === "ai-usage"
												}
												variant="menu"
											>
												<span className="inline-flex items-center gap-2">
													<IconMoney className="h-4 w-4" />
													<span>{t("模型记录/计量")}</span>
												</span>
											</SelectableButton>
											<SelectableButton
												onClick={() => {
													setActiveSection("monitoring");
													setMonitoringSubSection("tasks");
												}}
												active={
													activeSection === "monitoring" &&
													monitoringSubSection === "tasks"
												}
												variant="menu"
											>
												<span className="inline-flex items-center gap-2">
													<IconList className="h-4 w-4" />
													<span>{t("任务监控")}</span>
												</span>
											</SelectableButton>
											<SelectableButton
												onClick={() => {
													setActiveSection("monitoring");
													setMonitoringSubSection("comments");
												}}
												active={
													activeSection === "monitoring" &&
													monitoringSubSection === "comments"
												}
												variant="menu"
											>
												<span className="inline-flex items-center gap-2">
													<IconNote className="h-4 w-4" />
													<span>{t("评论列表")}</span>
												</span>
											</SelectableButton>
										</>
									) : (
										<>
											<SelectableButton
												onClick={() => setActiveSection("basic")}
												active={activeSection === "basic"}
												variant="menu"
											>
												<span className="inline-flex items-center gap-2">
													<IconSettings className="h-4 w-4" />
													<span>{t("基础配置")}</span>
												</span>
											</SelectableButton>
											<SelectableButton
												onClick={() => setActiveSection("categories")}
												active={activeSection === "categories"}
												variant="menu"
											>
												<span className="inline-flex items-center gap-2">
													<IconTag className="h-4 w-4" />
													<span>{t("分类管理")}</span>
												</span>
											</SelectableButton>

											<SectionToggleButton
												label={t("AI配置")}
												active={activeSection === "ai"}
												expanded={!collapsedSettings.ai}
												onMainClick={handleToggleAISection}
												onToggle={handleToggleAISection}
												toggleAriaLabel={
													collapsedSettings.ai ? t("展开") : t("收起")
												}
												icon={<IconRobot className="h-4 w-4" />}
												expandedIndicator={<IconArrowUp className="h-4 w-4" />}
												collapsedIndicator={
													<IconArrowDown className="h-4 w-4" />
												}
											/>

											{!collapsedSettings.ai && (
												<>
													<SelectableButton
														onClick={() => {
															setActiveSection("ai");
															setAISubSection("model-api");
														}}
														active={
															activeSection === "ai" &&
															aiSubSection === "model-api"
														}
														variant="submenu"
													>
														<span className="inline-flex items-center gap-2">
															<IconPlug className="h-4 w-4" />
															<span>{t("模型API")}</span>
														</span>
													</SelectableButton>
													<SelectableButton
														onClick={() => {
															setActiveSection("ai");
															setAISubSection("prompt");
														}}
														active={
															activeSection === "ai" &&
															aiSubSection === "prompt"
														}
														variant="submenu"
													>
														<span className="inline-flex items-center gap-2">
															<IconNote className="h-4 w-4" />
															<span>{t("提示词")}</span>
														</span>
													</SelectableButton>
													<SelectableButton
														onClick={() => {
															setActiveSection("ai");
															setAISubSection("recommendations");
														}}
														active={
															activeSection === "ai" &&
															aiSubSection === "recommendations"
														}
														variant="submenu"
													>
														<span className="inline-flex items-center gap-2">
															<IconTag className="h-4 w-4" />
															<span>{t("文章推荐")}</span>
														</span>
													</SelectableButton>
												</>
											)}

											<SectionToggleButton
												label={t("评论配置")}
												active={activeSection === "comments"}
												expanded={!collapsedSettings.comments}
												onMainClick={handleToggleCommentSection}
												onToggle={handleToggleCommentSection}
												toggleAriaLabel={
													collapsedSettings.comments ? t("展开") : t("收起")
												}
												icon={<IconFilter className="h-4 w-4" />}
												expandedIndicator={<IconArrowUp className="h-4 w-4" />}
												collapsedIndicator={
													<IconArrowDown className="h-4 w-4" />
												}
											/>

											{!collapsedSettings.comments && (
												<>
													<SelectableButton
														onClick={() => {
															setActiveSection("comments");
															setCommentSubSection("keys");
														}}
														active={
															activeSection === "comments" &&
															commentSubSection === "keys"
														}
														variant="submenu"
													>
														<span className="inline-flex items-center gap-2">
															<IconPlug className="h-4 w-4" />
															<span>{t("登录密钥")}</span>
														</span>
													</SelectableButton>
													<SelectableButton
														onClick={() => {
															setActiveSection("comments");
															setCommentSubSection("filters");
														}}
														active={
															activeSection === "comments" &&
															commentSubSection === "filters"
														}
														variant="submenu"
													>
														<span className="inline-flex items-center gap-2">
															<IconFilter className="h-4 w-4" />
															<span>{t("过滤规则")}</span>
														</span>
													</SelectableButton>
												</>
											)}

											<SelectableButton
												onClick={() => setActiveSection("storage")}
												active={activeSection === "storage"}
												variant="menu"
											>
												<span className="inline-flex items-center gap-2">
													<IconLink className="h-4 w-4" />
													<span>{t("文件存储")}</span>
												</span>
											</SelectableButton>
										</>
									)}
								</div>
							</div>
						</aside>

						<main className="flex-1 w-full min-w-0">
							{((activeSection === "ai" && aiSubSection === "model-api") ||
								showUsageView) && (
								<div className="bg-surface rounded-sm shadow-sm border border-border p-6 w-full min-w-0">
									<div className="mb-6 flex flex-wrap items-start justify-between gap-3">
										<div className="space-y-1">
											<h2 className="text-lg font-semibold text-text-1">
												{showUsageView
													? t("模型记录/计量")
													: t("模型API配置列表")}
											</h2>
										</div>
										<div className="flex flex-wrap items-center gap-2">
											{!showUsageView && (
												<Button
													onClick={handleCreateModelAPINew}
													variant="primary"
												>
													+ {t("创建配置")}
												</Button>
											)}
										</div>
									</div>

									{!showUsageView && (
										<div className="mb-4 flex gap-2">
											<SelectableButton
												onClick={() => setModelCategory("general")}
												active={modelCategory === "general"}
												variant="pill"
											>
												{t("通用")}
											</SelectableButton>
											<SelectableButton
												onClick={() => setModelCategory("vector")}
												active={modelCategory === "vector"}
												variant="pill"
											>
												{t("向量")}
											</SelectableButton>
										</div>
									)}

									{showUsageView ? (
										<div className="space-y-6">
											<div className="grid grid-cols-1 md:grid-cols-4 gap-3">
												<div className="bg-surface border border-border rounded-sm p-3">
													<div className="text-xs text-text-3">
														{t("调用次数")}
													</div>
													<div className="text-lg font-semibold text-text-1">
														{usageSummary?.calls ?? 0}
													</div>
												</div>
												<div className="bg-surface border border-border rounded-sm p-3">
													<div className="text-xs text-text-3">
														{t("Tokens（输入/输出）")}
													</div>
													<div className="text-lg font-semibold text-text-1">
														{usageSummary?.prompt_tokens ?? 0}/
														{usageSummary?.completion_tokens ?? 0}
													</div>
												</div>
												<div className="bg-surface border border-border rounded-sm p-3">
													<div className="text-xs text-text-3">
														{t("费用合计（参考）")}
													</div>
													<div className="text-lg font-semibold text-text-1">
														{usageCostByCurrency.length > 0 ? (
															<div className="space-y-1">
																{usageCostByCurrency.map(
																	([currency, total]) => (
																		<div key={currency}>
																			{formatPrice(total)} {currency}
																		</div>
																	),
																)}
															</div>
														) : (
															<span>{formatPrice(0)}</span>
														)}
													</div>
												</div>
												<div className="bg-surface border border-border rounded-sm p-3">
													<div className="text-xs text-text-3">
														{t("明细条数")}
													</div>
													<div className="text-lg font-semibold text-text-1">
														{usageTotal}
													</div>
												</div>
											</div>

											<div className="grid grid-cols-1 md:grid-cols-5 gap-4">
												<FilterSelect
													label={t("模型")}
													value={usageModelId}
													onChange={(value) => {
														setUsageModelId(value);
														setUsagePage(1);
													}}
													options={[
														{ value: "", label: t("全部") },
														...modelAPIConfigs.map((config) => ({
															value: config.id,
															label: config.name,
														})),
													]}
												/>
												<FilterSelect
													label={t("状态")}
													value={usageStatus}
													onChange={(value) => {
														setUsageStatus(value);
														setUsagePage(1);
													}}
													options={[
														{ value: "", label: t("全部") },
														{ value: "completed", label: t("已完成") },
														{ value: "failed", label: t("失败") },
														{ value: "processing", label: t("处理中") },
														{ value: "pending", label: t("待处理") },
													]}
												/>
												<FilterSelect
													label={t("类型")}
													value={usageContentType}
													onChange={(value) => {
														setUsageContentType(value);
														setUsagePage(1);
													}}
													options={[
														{ value: "", label: t("全部") },
														{ value: "summary", label: t("摘要") },
														{ value: "key_points", label: t("总结") },
														{ value: "outline", label: t("大纲") },
														{ value: "quotes", label: t("金句") },
														{ value: "translation", label: t("翻译") },
														{ value: "content_cleaning", label: t("清洗") },
														{ value: "content_validation", label: t("校验") },
														{ value: "classification", label: t("分类") },
													]}
												/>
												<div className="md:col-span-2">
													<label
														htmlFor="usage-date-range"
														className="block text-sm text-text-2 mb-1.5"
													>
														{t("日期范围")}
													</label>
													<DateRangePicker
														id="usage-date-range"
														value={toDayjsRangeFromDateStrings(
															usageStart,
															usageEnd,
														)}
														onChange={(values) => {
															const [start, end] = values || [];
															setUsageStart(
																start ? start.format("YYYY-MM-DD") : "",
															);
															setUsageEnd(end ? end.format("YYYY-MM-DD") : "");
															setUsagePage(1);
														}}
														className="w-full"
													/>
												</div>
											</div>

											<div className="bg-surface border border-border rounded-sm p-4">
												<div className="text-sm font-semibold text-text-1 mb-3">
													{t("按模型汇总")}
												</div>
												{usageByModel.length === 0 ? (
													<div className="rounded-sm border border-border bg-muted px-4 py-4 text-sm text-text-3">
														{t("暂无数据")}
													</div>
												) : (
													<div className="w-full overflow-x-auto">
														<table className="w-full table-auto text-sm">
															<thead className="bg-muted text-text-2">
																<tr>
																	<th className="w-[34%] text-left px-3 py-2">
																		{t("模型")}
																	</th>
																	<th className="text-left px-3 py-2">
																		{t("调用")}
																	</th>
																	<th className="w-[24%] whitespace-nowrap text-left px-3 py-2">
																		{t("Tokens（输入/输出）")}
																	</th>
																	<th className="w-[22%] whitespace-nowrap text-left px-3 py-2">
																		{t("费用（参考）")}
																	</th>
																</tr>
															</thead>
															<tbody className="divide-y divide-border">
																{usageByModel.map((row) => (
																	<tr
																		key={
																			row.model_api_config_id ||
																			row.model_api_config_name
																		}
																	>
																		<td className="px-3 py-2 text-text-1">
																			{row.model_api_config_name || "-"}
																		</td>
																		<td className="px-3 py-2 text-text-2">
																			{row.calls}
																		</td>
																		<td className="px-3 py-2 text-text-2">
																			{row.prompt_tokens ?? "-"}/
																			{row.completion_tokens ?? "-"}
																		</td>
																		<td className="px-3 py-2 text-text-2">
																			{row.cost_total.toFixed(4)}
																			{row.currency ? ` ${row.currency}` : ""}
																		</td>
																	</tr>
																))}
															</tbody>
														</table>
													</div>
												)}
											</div>

											<div className="bg-surface border border-border rounded-sm p-4">
												<div className="flex items-center justify-between mb-3">
													<div className="text-sm font-semibold text-text-1">
														{t("调用明细")}
													</div>
													<div className="text-sm text-text-3">
														{t("共")} {usageTotal} {t("条")}
													</div>
												</div>
												{usageLoading ? (
													<div className="rounded-sm border border-border bg-muted px-4 py-8 text-center text-sm text-text-3">
														{t("加载中")}
													</div>
												) : usageLogs.length === 0 ? (
													<div className="rounded-sm border border-border bg-muted px-4 py-8 text-center text-sm text-text-3">
														{t("暂无记录")}
													</div>
												) : (
													<div className="w-full overflow-x-auto">
														<table className="w-full table-auto text-sm">
															<thead className="bg-muted text-text-2">
																<tr>
																	<th className="w-[16%] whitespace-nowrap text-left px-3 py-2">
																		{t("时间")}
																	</th>
																	<th className="w-[16%] text-left px-3 py-2">
																		{t("模型")}
																	</th>
																	<th className="w-[8%] whitespace-nowrap text-left px-3 py-2">
																		{t("文章")}
																	</th>
																	<th className="w-[10%] whitespace-nowrap text-left px-3 py-2">
																		{t("类型")}
																	</th>
																	<th className="w-[20%] whitespace-nowrap text-left px-3 py-2">
																		{t("Tokens（输入/输出）")}
																	</th>
																	<th className="w-[14%] whitespace-nowrap text-left px-3 py-2">
																		{t("费用（参考）")}
																	</th>
																	<th className="w-[8%] whitespace-nowrap text-left px-3 py-2">
																		{t("状态")}
																	</th>
																	<th className="w-[8%] whitespace-nowrap text-left px-3 py-2">
																		{t("关联任务")}
																	</th>
																</tr>
															</thead>
															<tbody className="divide-y divide-border">
																{usageLogs.map((log) => (
																	<tr key={log.id} className="hover:bg-muted">
																		<td className="px-3 py-2 text-text-2 whitespace-nowrap">
																			{formatUsageDateTime(log.created_at)}
																		</td>
																		<td className="px-3 py-2 text-text-1">
																			{log.model_api_config_name || "-"}
																		</td>
																		<td className="px-3 py-2 text-text-2">
																			{log.article_id ? (
																				<Link
																					href={`/article/${log.article_slug || log.article_id}`}
																					className="text-primary hover:text-primary-ink"
																					target="_blank"
																					rel="noopener noreferrer"
																				>
																					{t("查看")}
																				</Link>
																			) : (
																				"-"
																			)}
																		</td>
																		<td className="px-3 py-2 text-text-2">
																			{getUsageContentTypeLabel(
																				log.content_type,
																			)}
																		</td>
																		<td className="px-3 py-2 text-text-2">
																			{log.prompt_tokens ?? "-"}/
																			{log.completion_tokens ?? "-"}
																		</td>
																		<td className="px-3 py-2 text-text-2">
																			{log.cost_total != null ? (
																				<button
																					type="button"
																					onClick={() => openUsageCost(log)}
																					className="text-primary hover:text-primary-ink"
																				>
																					{log.cost_total.toFixed(4)}
																					{log.currency
																						? ` ${log.currency}`
																						: ""}
																				</button>
																			) : (
																				"-"
																			)}
																		</td>
																		<td className="px-3 py-2 text-text-2">
																			{getUsageStatusLabel(log.status)}
																		</td>
																		<td className="px-3 py-2 text-text-2">
																			{log.task_id ? (
																				<button
																					type="button"
																					onClick={() =>
																						handleOpenUsageRelatedTask(
																							log.task_id!,
																							log.id,
																						)
																					}
																					className="text-primary hover:text-primary-ink"
																				>
																					{t("查看任务")}
																				</button>
																			) : (
																				"-"
																			)}
																		</td>
																	</tr>
																))}
															</tbody>
														</table>
													</div>
												)}

												{usageTotal > usagePageSize && (
													<div className="flex items-center justify-between mt-4">
														<div className="flex items-center gap-2 text-sm text-text-2">
															<SelectField
																value={usagePageSize}
																onChange={(value) => {
																	setUsagePageSize(Number(value));
																	setUsagePage(1);
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
																{t("条")}，{t("共")} {usageTotal} {t("条")}
															</span>
														</div>
														<div className="flex flex-wrap items-center gap-2">
															<Button
																onClick={() =>
																	setUsagePage((page) => Math.max(1, page - 1))
																}
																disabled={usagePage === 1}
																variant="secondary"
																size="sm"
															>
																{t("上一页")}
															</Button>
															<span className="min-w-[112px] px-4 py-2 text-center text-sm bg-surface border border-border rounded-sm text-text-2">
																{t("第")} {usagePage} /{" "}
																{Math.ceil(usageTotal / usagePageSize) || 1}{" "}
																{t("页")}
															</span>
															<Button
																onClick={() => setUsagePage((page) => page + 1)}
																disabled={
																	usagePage * usagePageSize >= usageTotal
																}
																variant="secondary"
																size="sm"
															>
																{t("下一页")}
															</Button>
														</div>
													</div>
												)}
											</div>
										</div>
									) : modelLoading ? (
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
								</div>
							)}

							{activeSection === "ai" && aiSubSection === "prompt" && (
								<div className="bg-surface rounded-sm shadow-sm border border-border p-6 w-full min-w-0">
									<div className="mb-6 flex flex-wrap items-start justify-between gap-3">
										<div className="space-y-1">
											<h2 className="text-lg font-semibold text-text-1">
												{t("提示词配置列表")}
											</h2>
										</div>
										<div className="flex flex-wrap items-center gap-2">
											<Button
												onClick={() => handleExportPromptConfigs("current")}
												variant="secondary"
												size="sm"
											>
												{t("导出当前")}
											</Button>
											<Button
												onClick={() => handleExportPromptConfigs("all")}
												variant="secondary"
												size="sm"
											>
												{t("导出全部")}
											</Button>
											<Button
												onClick={() => promptImportInputRef.current?.click()}
												variant="secondary"
												size="sm"
												loading={promptImporting}
												disabled={promptImporting}
											>
												{t("导入")}
											</Button>
											<Button onClick={handleCreatePromptNew} variant="primary">
												+ {t("创建配置")}
											</Button>
										</div>
									</div>

									<TextInput
										ref={promptImportInputRef}
										type="file"
										accept="application/json"
										className="hidden"
										onChange={handleImportPromptConfigs}
										disabled={promptImporting}
									/>

									<div className="flex gap-2 mb-6">
										{PROMPT_TYPES.map((type) => (
											<SelectableButton
												key={type.value}
												onClick={() => setSelectedPromptType(type.value)}
												active={selectedPromptType === type.value}
												variant="pill"
											>
												{t(type.labelKey)}
											</SelectableButton>
										))}
									</div>

									{promptLoading ? (
										<div className="rounded-sm border border-border bg-muted px-4 py-8 text-center text-sm text-text-3">
											{t("加载中...")}
										</div>
									) : promptConfigs.filter((c) => c.type === selectedPromptType)
											.length === 0 ? (
										<div className="rounded-sm border border-border bg-muted px-4 py-8 text-center text-sm text-text-3">
											<div className="mb-4">
												{t("暂无")}
												{t(
													PROMPT_TYPES.find(
														(t) => t.value === selectedPromptType,
													)?.labelKey || "",
												)}
												{t("配置")}
											</div>
											<Button onClick={handleCreatePromptNew} variant="primary">
												{t("创建配置")}
											</Button>
										</div>
									) : (
										<div className="space-y-4">
											{[...promptConfigs]
												.filter((c) => c.type === selectedPromptType)
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
																			{t("分类")}：
																		</span>
																		<StatusTag tone="neutral">
																			{config.category_name || t("通用")}
																		</StatusTag>
																	</div>
																	{config.model_api_config_name && (
																		<div>
																			<span className="font-medium">
																				{t("关联模型API")}：
																			</span>
																			<span>
																				{config.model_api_config_name}
																			</span>
																		</div>
																	)}
																	{config.system_prompt && (
																		<div>
																			<span className="font-medium">
																				{t("系统提示词")}：
																			</span>
																			<code className="px-2 py-1 bg-muted rounded text-xs block mt-1 max-h-20 overflow-y-auto">
																				{config.system_prompt.slice(0, 100)}
																				{config.system_prompt.length > 100
																					? "..."
																					: ""}
																			</code>
																		</div>
																	)}
																	<div>
																		<span className="font-medium">
																			{t("提示词")}：
																		</span>
																		<code className="px-2 py-1 bg-muted rounded text-xs block mt-1 max-h-20 overflow-y-auto">
																			{config.prompt.slice(0, 100)}
																			{config.prompt.length > 100 ? "..." : ""}
																		</code>
																	</div>
																	{(config.system_prompt ||
																		config.response_format ||
																		config.temperature != null ||
																		config.max_tokens != null ||
																		config.top_p != null ||
																		(supportsChunkOptionsForPromptType(config.type) &&
																			(config.chunk_size_tokens != null ||
																				config.chunk_overlap_tokens != null ||
																				config.max_continue_rounds != null))) && (
																		<div className="flex flex-wrap gap-2 pt-1">
																			{config.response_format && (
																				<StatusTag tone="neutral">
																					{t("响应格式")}:{" "}
																					{config.response_format}
																				</StatusTag>
																			)}
																			{config.temperature != null && (
																				<StatusTag tone="neutral">
																					{t("温度")}: {config.temperature}
																				</StatusTag>
																			)}
																			{config.max_tokens != null && (
																				<StatusTag tone="neutral">
																					{t("最大 Tokens")}:{" "}
																					{config.max_tokens}
																				</StatusTag>
																			)}
																			{config.top_p != null && (
																				<StatusTag tone="neutral">
																					Top P: {config.top_p}
																				</StatusTag>
																			)}
																			{supportsChunkOptionsForPromptType(config.type) &&
																				config.chunk_size_tokens != null && (
																				<StatusTag tone="neutral">
																					{t("分块大小")}: {config.chunk_size_tokens}
																				</StatusTag>
																			)}
																			{supportsChunkOptionsForPromptType(config.type) &&
																				config.chunk_overlap_tokens != null && (
																				<StatusTag tone="neutral">
																					{t("分块重叠")}:{" "}
																					{config.chunk_overlap_tokens}
																				</StatusTag>
																			)}
																			{supportsChunkOptionsForPromptType(config.type) &&
																				config.max_continue_rounds != null && (
																				<StatusTag tone="neutral">
																					{t("续写轮次")}:{" "}
																					{config.max_continue_rounds}
																				</StatusTag>
																			)}
																		</div>
																	)}
																</div>
															</div>

															<div className="flex gap-1">
																<IconButton
																	onClick={() => setShowPromptPreview(config)}
																	variant="primary"
																	size="sm"
																	title={t("预览")}
																>
																	<IconEye className="h-4 w-4" />
																</IconButton>
																<IconButton
																	onClick={() => handleEditPrompt(config)}
																	variant="primary"
																	size="sm"
																	title={t("编辑")}
																>
																	<IconEdit className="h-4 w-4" />
																</IconButton>
																<IconButton
																	onClick={() => handleDeletePrompt(config.id)}
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
								</div>
							)}

							{activeSection === "basic" && (
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
													<label className="block text-sm text-text-2 mb-1">
														{t("首页顶部标语")}
													</label>
													<TextInput
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
													<label className="block text-sm text-text-2 mb-1">
														{t("站点名称")}
													</label>
													<TextInput
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
													<label className="block text-sm text-text-2 mb-1">
														{t("站点描述")}
													</label>
													<TextInput
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
													<label className="block text-sm text-text-2 mb-1">
														{t("首页补充文案")}
													</label>
													<TextInput
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
													<label className="block text-sm text-text-2 mb-1">
														{t("首页主按钮文案")}
													</label>
													<TextInput
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
													<label className="block text-sm text-text-2 mb-1">
														{t("首页主按钮链接")}
													</label>
													<TextInput
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
													<label className="block text-sm text-text-2 mb-1">
														{t("首页副按钮文案")}
													</label>
													<TextInput
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
													<label className="block text-sm text-text-2 mb-1">
														{t("首页副按钮链接")}
													</label>
													<TextInput
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
													<label className="block text-sm text-text-2 mb-1">
														{t("站点Logo地址")}
													</label>
													<TextInput
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
													<label className="block text-sm text-text-2 mb-1">
														{t("默认语言")}
													</label>
													<SelectField
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
										</div>
									)}
								</div>
							)}

							{activeSection === "categories" && (
								<div className="bg-surface rounded-sm shadow-sm border border-border p-6 w-full min-w-0">
									<div className="mb-6 flex flex-wrap items-start justify-between gap-3">
										<div className="space-y-1">
											<h2 className="text-lg font-semibold text-text-1">
												{t("分类列表")}
											</h2>
										</div>
										<div className="flex flex-wrap items-center gap-2">
											<Button
												onClick={handleCreateCategoryNew}
												variant="primary"
											>
												+ {t("新增分类")}
											</Button>
										</div>
									</div>

									{categoryLoading ? (
										<div className="rounded-sm border border-border bg-muted px-4 py-8 text-center text-sm text-text-3">
											{t("加载中...")}
										</div>
									) : categories.length === 0 ? (
										<div className="rounded-sm border border-border bg-muted px-4 py-8 text-center text-sm text-text-3">
											<div className="mb-4">{t("暂无分类")}</div>
											<Button
												onClick={handleCreateCategoryNew}
												variant="primary"
											>
												{t("新增分类")}
											</Button>
										</div>
									) : (
										<DndContext
											sensors={sensors}
											collisionDetection={closestCenter}
											onDragEnd={handleDragEnd}
										>
											<SortableContext
												items={categories.map((c) => c.id)}
												strategy={verticalListSortingStrategy}
											>
												<div className="space-y-3">
													{categories.map((category) => (
														<SortableCategoryItem
															key={category.id}
															category={category}
															onEdit={handleEditCategory}
															onDelete={handleDeleteCategory}
														/>
													))}
												</div>
											</SortableContext>
										</DndContext>
									)}
								</div>
							)}

							{activeSection === "comments" && (
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
							)}

							{activeSection === "storage" && (
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
												<label className="inline-flex items-center gap-2 text-sm text-text-2 cursor-pointer">
													<CheckboxInput
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
													<label className="block text-sm text-text-2 mb-1">
														{t("压缩阈值 (KB)")}
													</label>
													<TextInput
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
													<label className="block text-sm text-text-2 mb-1">
														{t("最长边 (px)")}
													</label>
													<TextInput
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
													<label className="block text-sm text-text-2 mb-1">
														{t("WEBP 质量 (30-95)")}
													</label>
													<TextInput
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
										</div>
									)}
								</div>
							)}

							{activeSection === "monitoring" &&
								monitoringSubSection === "tasks" && (
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
													{
														value: "process_article_cleaning",
														label: t("清洗"),
													},
													{
														value: "process_article_validation",
														label: t("校验"),
													},
													{
														value: "process_article_classification",
														label: t("分类"),
													},
													{
														value: "process_article_translation",
														label: t("翻译"),
													},
													{
														value: "process_article_embedding",
														label: t("向量化"),
													},
													{
														value: "process_ai_content:summary",
														label: t("摘要"),
													},
													{
														value: "process_ai_content:outline",
														label: t("大纲"),
													},
													{
														value: "process_ai_content:quotes",
														label: t("金句"),
													},
														{
															value: "process_ai_content:key_points",
															label: t("总结"),
														},
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
															<tr key={task.id} className="hover:bg-muted">
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
																			{getTaskTypeLabel(
																				task.task_type,
																				task.content_type,
																			)}
																			{t("生成")}
																		</div>
																		<div className="text-xs text-text-3">
																			#{task.id.slice(0, 8)}
																		</div>
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
																	{task.article_id ? (
																		<Link
																			href={`/article/${task.article_slug || task.article_id}`}
																			className="text-primary hover:underline"
																			title={
																				task.article_title ||
																				task.article_id ||
																				t("未知文章")
																			}
																			target="_blank"
																			rel="noopener noreferrer"
																		>
																			{t("查看")}
																		</Link>
																	) : (
																		"-"
																	)}
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
								)}

							{activeSection === "ai" && aiSubSection === "recommendations" && (
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
							)}

							{activeSection === "monitoring" &&
								monitoringSubSection === "comments" && (
									<div className="bg-surface rounded-sm shadow-sm border border-border p-6 w-full min-w-0">
										<div className="mb-6 flex flex-wrap items-start justify-between gap-3">
											<div className="space-y-1">
												<h2 className="text-lg font-semibold text-text-1">
													{t("评论列表")}
												</h2>
												<p className="text-sm text-text-3">
													{t("查看与管理所有评论与回复")}
												</p>
											</div>
											<div className="flex flex-wrap items-center gap-2">
												<Button
													onClick={resetCommentFilters}
													variant="secondary"
													disabled={!hasCommentFilters}
												>
													{t("清空筛选")}
												</Button>
												<Button onClick={fetchCommentList} variant="secondary">
													{t("刷新")}
												</Button>
											</div>
										</div>

										<div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
											<FilterInput
												label={t("关键词")}
												value={commentQuery}
												onChange={(value) => {
													setCommentQuery(value);
													setCommentListPage(1);
												}}
												placeholder={t("搜索评论内容")}
											/>
											<ArticleSearchSelect
												label={t("文章名称")}
												value={commentArticleTitle}
												onChange={(value) => {
													setCommentArticleTitle(value);
													setCommentListPage(1);
												}}
												placeholder={t("输入文章名称搜索...")}
											/>
											<FilterInput
												label={t("评论人")}
												value={commentAuthor}
												onChange={(value) => {
													setCommentAuthor(value);
													setCommentListPage(1);
												}}
												placeholder={t("评论人昵称")}
											/>
											<FilterSelect
												label={t("可见性")}
												value={commentVisibility}
												onChange={(value) => {
													setCommentVisibility(value);
													setCommentListPage(1);
												}}
												options={[
													{ value: "", label: t("全部") },
													{ value: "visible", label: t("可见") },
													{ value: "hidden", label: t("已隐藏") },
												]}
											/>
											<FilterSelect
												label={t("类型")}
												value={commentReplyFilter}
												onChange={(value) => {
													setCommentReplyFilter(value);
													setCommentListPage(1);
												}}
												options={[
													{ value: "", label: t("全部") },
													{ value: "main", label: t("主评论") },
													{ value: "reply", label: t("回复") },
												]}
											/>
											<div>
												<label className="block text-sm text-text-2 mb-1.5">
													{t("日期范围")}
												</label>
												<DateRangePicker
													value={toDayjsRangeFromDateStrings(
														commentStart,
														commentEnd,
													)}
													onChange={(values) => {
														const [start, end] = values || [];
														setCommentStart(
															start ? start.format("YYYY-MM-DD") : "",
														);
														setCommentEnd(end ? end.format("YYYY-MM-DD") : "");
														setCommentListPage(1);
													}}
													className="w-full"
												/>
											</div>
										</div>

										{commentListLoading ? (
											<div className="rounded-sm border border-border bg-muted px-4 py-8 text-center text-sm text-text-3">
												{t("加载中")}
											</div>
										) : commentList.length === 0 ? (
											<div className="rounded-sm border border-border bg-muted px-4 py-8 text-center text-sm text-text-3">
												{hasCommentFilters ? t("暂无匹配评论") : t("暂无评论")}
											</div>
										) : (
											<div className="w-full overflow-x-auto">
												<table className="w-full table-auto text-sm">
													<thead className="bg-muted text-text-2">
														<tr>
															<th className="w-[22%] whitespace-nowrap text-left px-4 py-3">
																{t("时间")}
															</th>
															<th className="w-[10%] whitespace-nowrap text-left px-4 py-3">
																{t("内容")}
															</th>
															<th className="w-[18%] text-left px-4 py-3">
																{t("作者")}
															</th>
															<th className="w-[14%] text-left px-4 py-3">
																{t("文章")}
															</th>
															<th className="w-[10%] whitespace-nowrap text-left px-4 py-3">
																{t("类型")}
															</th>
															<th className="w-[12%] whitespace-nowrap text-left px-4 py-3">
																{t("状态")}
															</th>
															<th className="w-[14%] whitespace-nowrap text-right px-4 py-3">
																{t("操作")}
															</th>
														</tr>
													</thead>
													<tbody className="divide-y divide-border">
														{commentList.map((comment) => {
															return (
																<tr
																	key={comment.id}
																	className="hover:bg-muted/40"
																>
																	<td className="px-4 py-3 text-text-2 whitespace-nowrap">
																		{new Date(
																			comment.created_at,
																		).toLocaleString("zh-CN")}
																	</td>
																	<td className="px-4 py-3">
																		<button
																			type="button"
																			onMouseEnter={(event) => {
																				setHoverComment(comment);
																				const rect =
																					event.currentTarget.getBoundingClientRect();
																				setHoverTooltipPos({
																					x: rect.left,
																					y: rect.bottom + 8,
																				});
																			}}
																			onMouseLeave={() => {
																				setHoverComment(null);
																				setHoverTooltipPos(null);
																			}}
																			onClick={() => {
																				setActiveCommentContent(comment);
																				setShowCommentContentModal(true);
																				setHoverComment(null);
																				setHoverTooltipPos(null);
																			}}
																			className="text-primary hover:text-primary-ink"
																			aria-label={t("查看")}
																		>
																			{t("查看")}
																		</button>
																	</td>
																	<td className="px-4 py-3">
																		<div className="max-w-[160px] truncate text-text-1">
																			{comment.user_name || t("匿名")}
																		</div>
																		<div className="text-xs text-text-3">
																			{comment.provider || "-"}
																		</div>
																	</td>
																	<td className="px-4 py-3">
																		<Link
																			href={`/article/${comment.article_slug || comment.article_id}#comment-${comment.id}`}
																			className="text-primary hover:text-primary-ink"
																			target="_blank"
																			rel="noopener noreferrer"
																		>
																			{t("查看")}
																		</Link>
																	</td>
																	<td className="px-4 py-3">
																		<StatusTag tone="neutral">
																			{comment.reply_to_id
																				? t("回复")
																				: t("主评论")}
																		</StatusTag>
																	</td>
																	<td className="px-4 py-3">
																		<StatusTag
																			tone={
																				comment.is_hidden ? "danger" : "success"
																			}
																		>
																			{comment.is_hidden
																				? t("已隐藏")
																				: t("可见")}
																		</StatusTag>
																	</td>
																	<td className="px-4 py-3 text-right">
																		<div className="flex items-center justify-end gap-2">
																			<IconButton
																				onClick={() =>
																					handleToggleCommentVisibility(
																						comment.id,
																						!comment.is_hidden,
																					)
																				}
																				variant="ghost"
																				size="sm"
																				title={
																					comment.is_hidden
																						? t("设为可见")
																						: t("设为隐藏")
																				}
																				loading={pendingCommentActionIds.has(
																					comment.id,
																				)}
																				disabled={pendingCommentActionIds.has(
																					comment.id,
																				)}
																			>
																				<IconEye className="h-4 w-4" />
																			</IconButton>
																			<IconButton
																				onClick={() =>
																					handleDeleteCommentAdmin(comment.id)
																				}
																				variant="danger"
																				size="sm"
																				title={t("删除")}
																				loading={pendingCommentActionIds.has(
																					comment.id,
																				)}
																				disabled={pendingCommentActionIds.has(
																					comment.id,
																				)}
																			>
																				<IconTrash className="h-4 w-4" />
																			</IconButton>
																		</div>
																	</td>
																</tr>
															);
														})}
													</tbody>
												</table>
											</div>
										)}

										<div className="mt-6 flex items-center justify-between">
											<div className="flex items-center gap-2 text-sm text-text-2">
												<span>{t("每页显示")}</span>
												<SelectField
													value={commentListPageSize}
													onChange={(value) => {
														setCommentListPageSize(Number(value));
														setCommentListPage(1);
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
													{t("条")}，{t("共")} {commentListTotal} {t("条")}
												</span>
											</div>
											<div className="flex flex-wrap items-center gap-2">
												<Button
													onClick={() =>
														setCommentListPage((p) => Math.max(1, p - 1))
													}
													disabled={commentListPage === 1}
													variant="secondary"
													size="sm"
												>
													{t("上一页")}
												</Button>
												<span className="min-w-[112px] px-4 py-2 text-center text-sm bg-surface border border-border rounded-sm text-text-2">
													{t("第")} {commentListPage} /{" "}
													{Math.ceil(commentListTotal / commentListPageSize) ||
														1}{" "}
													{t("页")}
												</span>
												<Button
													onClick={() => setCommentListPage((p) => p + 1)}
													disabled={
														commentListPage * commentListPageSize >=
														commentListTotal
													}
													variant="secondary"
													size="sm"
												>
													{t("下一页")}
												</Button>
											</div>
										</div>
									</div>
								)}
						</main>

						{hoverComment && hoverTooltipPos && (
							<div
								className="fixed z-50 w-72 max-w-[calc(100vw-2rem)] rounded-md text-sm px-4 py-3 shadow-lg backdrop-blur bg-surface border border-border"
								style={{ left: hoverTooltipPos.x, top: hoverTooltipPos.y }}
							>
								<p
									className="text-text-1"
									style={{
										display: "-webkit-box",
										WebkitLineClamp: 3,
										WebkitBoxOrient: "vertical",
										overflow: "hidden",
										textOverflow: "ellipsis",
									}}
								>
									{buildCommentPreview(hoverComment.content)}
								</p>
							</div>
						)}
					</div>
				</div>

				{showCommentContentModal && activeCommentContent && (
					<ModalShell
						isOpen={showCommentContentModal}
						onClose={() => {
							setShowCommentContentModal(false);
							setActiveCommentContent(null);
						}}
						title={t("评论详情")}
						widthClassName="max-w-2xl"
						footer={
							<div className="flex justify-end">
								<Button
									type="button"
									onClick={() => {
										setShowCommentContentModal(false);
										setActiveCommentContent(null);
									}}
									variant="secondary"
								>
									{t("关闭")}
								</Button>
							</div>
						}
					>
						<div className="space-y-2 text-sm text-text-2">
							<div className="text-xs text-text-3">
								{activeCommentContent.user_name || t("匿名")} ·{" "}
								{new Date(activeCommentContent.created_at).toLocaleString(
									"zh-CN",
								)}
							</div>
							<div className="rounded-sm border border-border bg-muted p-3 whitespace-pre-wrap break-words text-text-1">
								{stripReplyPrefix(activeCommentContent.content)}
							</div>
						</div>
					</ModalShell>
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
										{getTaskTypeLabel(
											retryTargetTask.task_type,
											retryTargetTask.content_type,
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
						panelClassName="max-h-[90vh] overflow-y-auto"
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
										{getTaskTypeLabel(
											selectedTaskTimeline.task.task_type,
											selectedTaskTimeline.task.content_type,
										)}
									</div>
									<div>
										{t("任务ID")}: {selectedTaskTimeline.task.id}
									</div>
									<div>
										{t("状态")}:{" "}
										{getTaskStatusLabel(selectedTaskTimeline.task.status)}
									</div>
									<div>
										{t("尝试")}: {selectedTaskTimeline.task.attempts}/
										{selectedTaskTimeline.task.max_attempts}
									</div>
									{selectedTaskTimeline.task.article_slug && (
										<div>
											{t("文章")}:
											<Link
												href={`/article/${selectedTaskTimeline.task.article_slug}`}
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
														{new Date(chain.start_at).toLocaleTimeString(
															"zh-CN",
															{
															hour12: false,
														},
													)}{" "}
														· {getTaskTimelineChainModelLabel(chain)}
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
														const usageMeta = {
															model: usage.model_api_config_name || t("未知模型"),
															status: getUsageStatusLabel(
																nodeDisplayStatus || usage.status,
															),
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
																				{getUsageStatusLabel(
																					nodeDisplayStatus || usage.status,
																				)}
																			</StatusTag>
																		</div>
																		<div>
																			{formatTimelineDateTime(usage.created_at)}
																		</div>
																	</div>
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

				{showUsagePayloadModal && (
					<ModalShell
						isOpen={showUsagePayloadModal}
						onClose={() => setShowUsagePayloadModal(false)}
						title={usagePayloadTitle}
						widthClassName="max-w-3xl"
						panelClassName="max-h-[90vh] overflow-y-auto"
						headerClassName="border-b border-border p-6"
						headerActions={
							<IconButton
								type="button"
								onClick={handleCopyPayload}
								variant="ghost"
								size="sm"
								title={t("复制")}
								aria-label={t("复制内容")}
							>
								<IconCopy className="h-4 w-4" />
							</IconButton>
						}
						bodyClassName="p-6"
						footerClassName="border-t border-border bg-muted p-6"
						footer={
							<div className="flex justify-end">
								<Button
									onClick={() => setShowUsagePayloadModal(false)}
									variant="secondary"
								>
									{t("关闭")}
								</Button>
							</div>
						}
					>
						<pre className="rounded-lg border border-border bg-muted p-4 text-xs text-text-1 whitespace-pre-wrap">
							{usagePayloadContent}
						</pre>
					</ModalShell>
				)}

				{showUsageCostModal && (
					<ModalShell
						isOpen={showUsageCostModal}
						onClose={() => setShowUsageCostModal(false)}
						title={usageCostTitle}
						widthClassName="max-w-2xl"
						panelClassName="max-h-[90vh] overflow-y-auto"
						headerClassName="border-b border-border p-6"
						bodyClassName="p-6"
						footerClassName="border-t border-border bg-muted p-6"
						footer={
							<div className="flex justify-end">
								<Button
									onClick={() => setShowUsageCostModal(false)}
									variant="secondary"
								>
									{t("关闭")}
								</Button>
							</div>
						}
					>
						<div className="space-y-4">
							{usageCostBreakdown && (
								<div className="rounded-lg border border-border bg-muted p-4">
									<div className="mb-3 text-sm font-medium text-text-1">
										{t("计算明细")}
									</div>
									<div className="overflow-x-auto">
										<table className="min-w-full text-xs">
											<thead className="text-text-3">
												<tr>
													<th className="px-3 py-2 text-left">{t("项目")}</th>
													<th className="px-3 py-2 text-left">{t("数值")}</th>
													<th className="px-3 py-2 text-left">{t("公式")}</th>
												</tr>
											</thead>
											<tbody className="divide-y divide-border text-text-2">
												<tr>
													<td className="px-3 py-2">{t("输入成本")}</td>
													<td className="px-3 py-2">
														{formatCostValue(usageCostBreakdown.inputCost)}{" "}
														{usageCostBreakdown.currency}
													</td>
													<td className="px-3 py-2">
														{usageCostBreakdown.promptTokens != null &&
														usageCostBreakdown.inputUnitPrice != null
															? `(${usageCostBreakdown.promptTokens} / 1000) × ${formatCostValue(usageCostBreakdown.inputUnitPrice)} = ${formatCostValue(usageCostBreakdown.inputCost)}`
															: "-"}
													</td>
												</tr>
												<tr>
													<td className="px-3 py-2">{t("输出成本")}</td>
													<td className="px-3 py-2">
														{formatCostValue(usageCostBreakdown.outputCost)}{" "}
														{usageCostBreakdown.currency}
													</td>
													<td className="px-3 py-2">
														{usageCostBreakdown.completionTokens != null &&
														usageCostBreakdown.outputUnitPrice != null
															? `(${usageCostBreakdown.completionTokens} / 1000) × ${formatCostValue(usageCostBreakdown.outputUnitPrice)} = ${formatCostValue(usageCostBreakdown.outputCost)}`
															: "-"}
													</td>
												</tr>
												<tr>
													<td className="px-3 py-2">{t("总成本")}</td>
													<td className="px-3 py-2 font-medium text-text-1">
														{formatCostValue(usageCostBreakdown.totalCost)}{" "}
														{usageCostBreakdown.currency}
													</td>
													<td className="px-3 py-2">
														{usageCostBreakdown.inputCost != null ||
														usageCostBreakdown.outputCost != null
															? `${formatCostValue(usageCostBreakdown.inputCost)} + ${formatCostValue(usageCostBreakdown.outputCost)} = ${formatCostValue(usageCostBreakdown.totalCost)}`
															: "-"}
													</td>
												</tr>
											</tbody>
										</table>
									</div>
								</div>
							)}
							<pre className="rounded-lg border border-border bg-muted p-4 text-xs text-text-1 whitespace-pre-wrap">
								{usageCostDetails}
							</pre>
						</div>
					</ModalShell>
				)}

				{showPromptModal && (
					<ModalShell
						isOpen={showPromptModal}
						onClose={() => setShowPromptModal(false)}
						title={
							editingPromptConfig ? t("编辑提示词配置") : t("创建新提示词配置")
						}
						widthClassName="max-w-2xl"
						panelClassName="max-h-[90vh] overflow-y-auto"
						headerClassName="border-b border-border p-6"
						bodyClassName="space-y-4 p-6"
						footerClassName="border-t border-border bg-muted p-6"
						footer={
							<div className="flex justify-end gap-2">
								<Button
									onClick={() => setShowPromptModal(false)}
									variant="secondary"
								>
									{t("取消")}
								</Button>
								<Button
									onClick={handleSavePrompt}
									variant="primary"
									loading={promptSaving}
									disabled={promptSaving}
								>
									{editingPromptConfig ? t("保存") : t("创建")}
								</Button>
							</div>
						}
					>
						<FormField label={t("配置名称")} required>
							<TextInput
								type="text"
								value={promptFormData.name}
								onChange={(e) =>
									setPromptFormData({
										...promptFormData,
										name: e.target.value,
									})
								}
								placeholder={t("文章摘要提示词")}
								required
							/>
						</FormField>

						<FormField label={t("分类")}>
							<SelectField
								value={promptFormData.category_id}
								onChange={(value) =>
									setPromptFormData({
										...promptFormData,
										category_id: value,
									})
								}
								className="w-full"
								popupClassName="select-modern-dropdown"
								options={[
									{ value: "", label: t("通用") },
									...categories.map((cat) => ({
										value: cat.id,
										label: cat.name,
									})),
								]}
							/>
						</FormField>

						<FormField label={t("系统提示词")} required>
							<TextArea
								value={promptFormData.system_prompt}
								onChange={(e) =>
									setPromptFormData({
										...promptFormData,
										system_prompt: e.target.value,
									})
								}
								rows={4}
								placeholder={t(
									"系统级约束，例如：你是一个严谨的内容分析助手...",
								)}
								required
							/>
						</FormField>

						<FormField label={t("提示词")} required>
							<TextArea
								value={promptFormData.prompt}
								onChange={(e) =>
									setPromptFormData({
										...promptFormData,
										prompt: e.target.value,
									})
								}
								rows={6}
								placeholder={t("请为以下文章生成摘要...")}
								required
							/>
						</FormField>

						<div className="rounded-lg border border-border">
							<SectionToggleButton
								label={t("高级设置（可选）")}
								expanded={showPromptAdvanced}
								onToggle={() => setShowPromptAdvanced(!showPromptAdvanced)}
								expandedIndicator={t("收起")}
								collapsedIndicator={t("展开")}
							/>
							{showPromptAdvanced && (
								<div className="space-y-4 border-t border-border p-4">
										<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
										<FormField label={t("响应格式")}>
											<SelectField
												value={promptFormData.response_format}
												onChange={(value) =>
													setPromptFormData({
														...promptFormData,
														response_format: value,
													})
												}
												className="w-full"
												popupClassName="select-modern-dropdown"
												options={[
													{ value: "", label: t("默认") },
													{ value: "text", label: "text" },
													{ value: "json_object", label: "json_object" },
												]}
											/>
										</FormField>

										<FormField label={t("温度")}>
											<TextInput
												type="number"
												step="0.1"
												min="0"
												max="2"
												value={promptFormData.temperature}
												onChange={(e) =>
													setPromptFormData({
														...promptFormData,
														temperature: e.target.value,
													})
												}
												placeholder={t("0.7")}
											/>
										</FormField>

										<FormField label={t("最大 Tokens")}>
											<TextInput
												type="number"
												min="1"
												value={promptFormData.max_tokens}
												onChange={(e) =>
													setPromptFormData({
														...promptFormData,
														max_tokens: e.target.value,
													})
												}
												placeholder={t("1200")}
											/>
										</FormField>

											<FormField label="Top P">
											<TextInput
												type="number"
												step="0.1"
												min="0"
												max="1"
												value={promptFormData.top_p}
												onChange={(e) =>
													setPromptFormData({
														...promptFormData,
														top_p: e.target.value,
													})
												}
												placeholder={t("1.0")}
											/>
											</FormField>
										</div>

											{promptTypeSupportsChunkOptions && (
												<div className="rounded-lg border border-border p-3">
													<div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
														<FormField label={t("分块大小")}>
															<TextInput
																type="number"
																min="1"
																value={promptFormData.chunk_size_tokens}
																onChange={(e) =>
																	setPromptFormData({
																		...promptFormData,
																		chunk_size_tokens: e.target.value,
																	})
																}
																placeholder={t("例如 12000")}
															/>
														</FormField>
														<FormField label={t("分块重叠")}>
															<TextInput
																type="number"
																min="0"
																value={promptFormData.chunk_overlap_tokens}
																onChange={(e) =>
																	setPromptFormData({
																		...promptFormData,
																		chunk_overlap_tokens: e.target.value,
																	})
																}
																placeholder={t("例如 800")}
															/>
														</FormField>
														<FormField label={t("最多续写轮次")}>
															<TextInput
																type="number"
																min="0"
																value={promptFormData.max_continue_rounds}
																onChange={(e) =>
																	setPromptFormData({
																		...promptFormData,
																		max_continue_rounds: e.target.value,
																	})
																}
																placeholder={t("例如 2")}
															/>
														</FormField>
													</div>
													<p className="mt-2 text-xs text-text-3">
														{t(
															"该三项需同时填写；并且关联模型需配置上下文窗口与输出预留，否则后端会拒绝保存。",
														)}
													</p>
												</div>
											)}
									</div>
								)}
							</div>

						<FormField label={t("关联模型API配置（可选）")}>
							<SelectField
								value={promptFormData.model_api_config_id}
								onChange={(value) =>
									setPromptFormData({
										...promptFormData,
										model_api_config_id: value,
									})
								}
								className="w-full"
								popupClassName="select-modern-dropdown"
								options={[
									{ value: "", label: t("使用默认") },
									...modelAPIConfigs.map((config) => ({
										value: config.id,
										label: config.name,
									})),
								]}
							/>
						</FormField>

						<div className="flex items-center gap-4">
							<label className="flex flex-wrap items-center gap-2">
								<CheckboxInput
									checked={promptFormData.is_enabled}
									onChange={(e) =>
										setPromptFormData({
											...promptFormData,
											is_enabled: e.target.checked,
										})
									}
								/>
								<span className="text-sm text-text-2">{t("启用此配置")}</span>
							</label>

							<label className="flex flex-wrap items-center gap-2">
								<CheckboxInput
									checked={promptFormData.is_default}
									onChange={(e) =>
										setPromptFormData({
											...promptFormData,
											is_default: e.target.checked,
										})
									}
								/>
								<span className="text-sm text-text-2">{t("设为默认配置")}</span>
							</label>
						</div>
					</ModalShell>
				)}

				{/* Category Modal */}
				{showCategoryModal && (
					<ModalShell
						isOpen={showCategoryModal}
						onClose={() => setShowCategoryModal(false)}
						title={editingCategory ? t("编辑分类") : t("新增分类")}
						widthClassName="max-w-md"
						panelClassName="max-h-[90vh] overflow-y-auto"
						headerClassName="border-b border-border p-6"
						bodyClassName="space-y-4 p-6"
						footerClassName="border-t border-border bg-muted p-6"
						footer={
							<div className="flex justify-end gap-2">
								<Button
									onClick={() => setShowCategoryModal(false)}
									variant="secondary"
								>
									{t("取消")}
								</Button>
								<Button
									onClick={handleSaveCategory}
									variant="primary"
									loading={categorySaving}
									disabled={categorySaving}
								>
									{editingCategory ? t("保存") : t("创建")}
								</Button>
							</div>
						}
					>
						<FormField label={t("分类名称")} required>
							<TextInput
								type="text"
								value={categoryFormData.name}
								onChange={(e) =>
									setCategoryFormData({
										...categoryFormData,
										name: e.target.value,
									})
								}
								required
							/>
						</FormField>

						<FormField label={t("描述")}>
							<TextArea
								value={categoryFormData.description}
								onChange={(e) =>
									setCategoryFormData({
										...categoryFormData,
										description: e.target.value,
									})
								}
								rows={3}
								placeholder={t("描述将用于辅助AI自动分类判断")}
							/>
						</FormField>

						<FormField label={t("颜色")}>
							<div className="grid grid-cols-10 gap-2">
								{PRESET_COLORS.map((color) => (
									<button
										key={color}
										type="button"
										onClick={() =>
											setCategoryFormData({ ...categoryFormData, color })
										}
										className={`h-8 w-8 rounded-lg transition ${
											categoryFormData.color === color
												? "ring-2 ring-primary ring-offset-2"
												: "hover:scale-110"
										}`}
										style={{ backgroundColor: color }}
									/>
								))}
							</div>
						</FormField>
					</ModalShell>
				)}

				{showPromptPreview && (
					<ModalShell
						isOpen={Boolean(showPromptPreview)}
						onClose={() => setShowPromptPreview(null)}
						title={`${t("提示词预览")} - ${showPromptPreview.name}`}
						widthClassName="max-w-2xl"
						panelClassName="max-h-[90vh] overflow-y-auto"
						headerClassName="border-b border-border p-6"
						bodyClassName="space-y-4 p-6"
						footerClassName="border-t border-border bg-muted p-6"
						footer={
							<div className="flex justify-end gap-2">
								<Button
									onClick={() => {
										handleEditPrompt(showPromptPreview);
										setShowPromptPreview(null);
									}}
									variant="primary"
								>
									{t("编辑此配置")}
								</Button>
								<Button
									onClick={() => setShowPromptPreview(null)}
									variant="secondary"
								>
									{t("关闭")}
								</Button>
							</div>
						}
					>
						<div className="flex flex-wrap gap-2">
							<StatusTag tone="info" size="sm">
								{(() => {
									const promptType = PROMPT_TYPES.find(
										(item) => item.value === showPromptPreview.type,
									);
									return promptType?.labelKey
										? t(promptType.labelKey)
										: showPromptPreview.type;
								})()}
							</StatusTag>
							<StatusTag tone="neutral" size="sm">
								{t("分类")}: {showPromptPreview.category_name || t("通用")}
							</StatusTag>
							{showPromptPreview.model_api_config_name && (
								<StatusTag tone="info" size="sm">
									{t("模型")}: {showPromptPreview.model_api_config_name}
								</StatusTag>
							)}
						</div>

						<div>
							<label className="mb-2 block text-sm font-medium text-text-2">
								{t("系统提示词")}
							</label>
							<pre className="w-full rounded-lg border border-border bg-muted p-4 text-sm text-text-1 whitespace-pre-wrap font-mono">
								{showPromptPreview.system_prompt || t("未设置（必填）")}
							</pre>
						</div>

						<div>
							<label className="mb-2 block text-sm font-medium text-text-2">
								{t("提示词")}
							</label>
							<pre className="w-full rounded-lg border border-border bg-muted p-4 text-sm text-text-1 whitespace-pre-wrap font-mono">
								{showPromptPreview.prompt}
							</pre>
						</div>

						<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
							<div className="rounded-lg border border-border bg-muted p-3 text-sm text-text-2">
								<div className="text-xs text-text-3">{t("响应格式")}</div>
								<div>{showPromptPreview.response_format || t("默认")}</div>
							</div>
							<div className="rounded-lg border border-border bg-muted p-3 text-sm text-text-2">
								<div className="text-xs text-text-3">{t("温度")}</div>
								<div>{showPromptPreview.temperature ?? t("默认")}</div>
							</div>
							<div className="rounded-lg border border-border bg-muted p-3 text-sm text-text-2">
								<div className="text-xs text-text-3">{t("最大 Tokens")}</div>
								<div>{showPromptPreview.max_tokens ?? t("默认")}</div>
							</div>
							<div className="rounded-lg border border-border bg-muted p-3 text-sm text-text-2">
								<div className="text-xs text-text-3">Top P</div>
								<div>{showPromptPreview.top_p ?? t("默认")}</div>
							</div>
							{supportsChunkOptionsForPromptType(showPromptPreview.type) && (
								<>
									<div className="rounded-lg border border-border bg-muted p-3 text-sm text-text-2">
										<div className="text-xs text-text-3">{t("分块大小")}</div>
										<div>{showPromptPreview.chunk_size_tokens ?? t("默认")}</div>
									</div>
									<div className="rounded-lg border border-border bg-muted p-3 text-sm text-text-2">
										<div className="text-xs text-text-3">{t("分块重叠")}</div>
										<div>
											{showPromptPreview.chunk_overlap_tokens ?? t("默认")}
										</div>
									</div>
									<div className="rounded-lg border border-border bg-muted p-3 text-sm text-text-2">
										<div className="text-xs text-text-3">
											{t("最多续写轮次")}
										</div>
										<div>
											{showPromptPreview.max_continue_rounds ?? t("默认")}
										</div>
									</div>
								</>
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
			</div>
			<ConfirmModal
				isOpen={confirmState.isOpen}
				title={confirmState.title}
				message={confirmState.message}
				confirmText={confirmState.confirmText}
				cancelText={confirmState.cancelText}
				onConfirm={async () => {
					const action = confirmState.onConfirm;
					setConfirmState((prev) => ({ ...prev, isOpen: false }));
					await action();
				}}
				onCancel={() => {
					confirmState.onCancel?.();
					setConfirmState((prev) => ({ ...prev, isOpen: false }));
				}}
			/>
			<AppFooter />
		</div>
	);
}
