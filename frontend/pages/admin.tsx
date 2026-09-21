import {
	type DragEndEvent,
	KeyboardSensor,
	PointerSensor,
	useSensor,
	useSensors,
} from "@dnd-kit/core";
import {
	arrayMove,
	sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import type { Dayjs } from "dayjs";
import dayjs from "dayjs";
import Link from "next/link";
import { useRouter } from "next/router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AppFooter from "@/components/AppFooter";
import AppHeader from "@/components/AppHeader";
import SeoHead from "@/components/SeoHead";
import ConfirmModal from "@/components/ConfirmModal";
import Button from "@/components/Button";
import ReviewTemplateSettings from "@/components/ReviewTemplateSettings";
import CommentMonitorSection from "@/components/admin/CommentMonitorSection";
import TaskMonitorSection, {
	buildTaskTimelineChains,
	formatTaskEventDetails,
	type AITaskItem,
	type TaskTimelineChain,
} from "@/components/admin/TaskMonitorSection";
import StorageSection from "@/components/admin/StorageSection";
import BasicSettingsSection from "@/components/admin/BasicSettingsSection";
import CommentSettingsSection from "@/components/admin/CommentSettingsSection";
import ExtractionSettingsSection, {
	type ExtractionSubSection,
} from "@/components/admin/ExtractionSettingsSection";
import PromptSettingsSection, {
	createEmptyPromptFormData,
	supportsChunkOptionsForPromptType,
	type PromptType,
} from "@/components/admin/PromptSettingsSection";
import AiUsageSection, {
	type UsageCostBreakdown,
} from "@/components/admin/AiUsageSection";
import ModelApiSettingsSection from "@/components/admin/ModelApiSettingsSection";
import { formatCostValue } from "@/components/admin/formatting";
import RecommendationSettingsSection from "@/components/admin/RecommendationSettingsSection";
import CategoriesSection, {
	type Category,
	PRESET_COLORS,
} from "@/components/admin/CategoriesSection";
import IconButton from "@/components/IconButton";
import ModalShell from "@/components/ui/ModalShell";
import SectionToggleButton from "@/components/ui/SectionToggleButton";
import SelectableButton from "@/components/ui/SelectableButton";
import {
	IconDoc,
	IconArrowDown,
	IconArrowUp,
	IconLink,
	IconList,
	IconCopy,
	IconMoney,
	IconNote,
	IconPlug,
	IconRobot,
	IconSettings,
	IconSearch,
	IconTag,
	IconFilter,
} from "@/components/icons";
import { useToast } from "@/components/Toast";
import { useAuth } from "@/contexts/AuthContext";
import { useBasicSettings } from "@/contexts/BasicSettingsContext";
import {
	getRetryPromptTypeForTask,
	parseAITaskFilterValue,
} from "@/lib/aiTaskMeta";
import { useI18n } from "@/lib/i18n";
import { useLatestBackupExportJob } from "@/lib/useLatestBackupExportJob";
import {
	type AIUsageLogItem,
	type AIUsageSummaryResponse,
	type AITaskTimelineResponse,
	type AdminCommentItem,
	aiUsageApi,
	articleApi,
	backupApi,
	type BasicSettings,
	basicSettingsApi,
	categoryApi,
	commentAdminApi,
	commentApi,
	commentSettingsApi,
	extractionSettingsApi,
	mediaApi,
	recommendationSettingsApi,
	reviewCommentApi,
	storageSettingsApi,
	type ExtractionSettings,
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
	| "columns"
	| "monitoring"
	| "comments"
	| "extraction"
	| "storage";
type AISubSection =
	| "model-api"
	| "prompt"
	| "recommendations";
type MonitoringSubSection = "tasks" | "ai-usage" | "comments";
type CommentSubSection = "keys" | "filters";

type AdminRouteState = {
	section: SettingSection;
	aiSubSection: AISubSection;
	monitoringSubSection: MonitoringSubSection;
	commentSubSection: CommentSubSection;
	extractionSubSection: ExtractionSubSection;
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
const EXTRACTION_SUB_SECTIONS: ExtractionSubSection[] = [
	"parser",
	"post-processing",
];

const isAISubSection = (value: string): value is AISubSection =>
	AI_SUB_SECTIONS.includes(value as AISubSection);
const isMonitoringSubSection = (value: string): value is MonitoringSubSection =>
	MONITORING_SUB_SECTIONS.includes(value as MonitoringSubSection);
const isCommentSubSection = (value: string): value is CommentSubSection =>
	COMMENT_SUB_SECTIONS.includes(value as CommentSubSection);
const isExtractionSubSection = (
	value: string,
): value is ExtractionSubSection =>
	EXTRACTION_SUB_SECTIONS.includes(value as ExtractionSubSection);

const normalizeExtractionSettings = (
	settings: ExtractionSettings,
): ExtractionSettings => ({
	...settings,
	jina_reader_enabled: settings.jina_reader_prefer_mode !== "local_only",
	auto_ai_outline_enabled: Boolean(settings.auto_ai_outline_enabled),
	auto_ai_quotes_enabled: Boolean(settings.auto_ai_quotes_enabled),
});

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
	let extractionSubSection: ExtractionSubSection = "parser";

	if (segments[0] === "monitoring") {
		section = "monitoring";
		const monitoringCandidate = segments[1] || "";
		if (isMonitoringSubSection(monitoringCandidate)) {
			monitoringSubSection = monitoringCandidate;
		}
		return {
			section,
			aiSubSection,
			monitoringSubSection,
			commentSubSection,
			extractionSubSection,
		};
	}

	if (segments[0] === "settings") {
		const settingsSection = segments[1];
		if (settingsSection === "basic") {
			section = "basic";
		} else if (settingsSection === "categories") {
			section = "categories";
		} else if (settingsSection === "columns") {
			section = "columns";
		} else if (settingsSection === "storage") {
			section = "storage";
		} else if (settingsSection === "extraction") {
			section = "extraction";
			const extractionCandidate = segments[2] || "";
			if (isExtractionSubSection(extractionCandidate)) {
				extractionSubSection = extractionCandidate;
			} else if (
				extractionCandidate === "parse-strategy" ||
				extractionCandidate === "ai-strategy"
			) {
				extractionSubSection = "post-processing";
			}
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
		return {
			section,
			aiSubSection,
			monitoringSubSection,
			commentSubSection,
			extractionSubSection,
		};
	}

	return {
		section,
		aiSubSection,
		monitoringSubSection,
		commentSubSection,
		extractionSubSection,
	};
};

const buildAdminPath = (
	section: SettingSection,
	aiSubSection: AISubSection,
	monitoringSubSection: MonitoringSubSection,
	commentSubSection: CommentSubSection,
	extractionSubSection: ExtractionSubSection,
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
	if (section === "columns") {
		return "/admin/settings/columns";
	}
	if (section === "storage") {
		return "/admin/settings/storage";
	}
	if (section === "extraction") {
		return `/admin/settings/extraction/${extractionSubSection}`;
	}
	return "/admin/settings/basic";
};

export default function AdminPage() {
	const router = useRouter();
	const { showToast } = useToast();
	const { isAdmin, isLoading: authLoading } = useAuth();
	const { t } = useI18n();
	const { basicSettings, updateBasicSettings: updateBasicSettingsContext } =
		useBasicSettings();
	const pageTitle = `${basicSettings.site_name || "Lumina"} - ${t("管理台")}`;
	const [primaryTab, setPrimaryTab] = useState<"monitoring" | "settings">(
		"monitoring",
	);
	const settingsSections = useMemo(
		() =>
			new Set<SettingSection>([
				"basic",
				"categories",
				"columns",
				"ai",
				"comments",
				"extraction",
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
	const [extractionSubSection, setExtractionSubSection] =
		useState<ExtractionSubSection>("parser");
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
	const prevActiveSectionRef = useRef<SettingSection | null>(null);
	const prevMonitoringSubSectionRef = useRef<MonitoringSubSection | null>(null);
	const [collapsedSettings, setCollapsedSettings] = useState<{
		extraction: boolean;
		ai: boolean;
		comments: boolean;
	}>({
		extraction: true,
		ai: true,
		comments: true,
	});

	const handleToggleExtractionSection = useCallback(() => {
		const nextCollapsed = !collapsedSettings.extraction;
		setCollapsedSettings((prev) => ({
			...prev,
			extraction: nextCollapsed,
		}));
		if (!nextCollapsed) {
			setActiveSection("extraction");
			setExtractionSubSection("parser");
		}
	}, [collapsedSettings.extraction]);

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
		rss_enabled: false,
		home_badge_text: "",
		home_tagline_text: "",
		home_primary_button_text: "",
		home_primary_button_url: "",
		home_secondary_button_text: "",
		home_secondary_button_url: "",
		header_custom_links: [],
	});
	const [storageSettings, setStorageSettings] = useState<StorageSettings>({
		media_storage_enabled: false,
		media_compress_threshold: 1536 * 1024,
		media_max_dim: 2000,
		media_webp_quality: 80,
	});
	const [extractionSettings, setExtractionSettings] =
		useState<ExtractionSettings>({
			jina_reader_enabled: false,
			jina_reader_base_url: "https://r.jina.ai",
			jina_reader_api_key: "",
			jina_reader_timeout_seconds: 15,
			jina_reader_token_budget: null,
			jina_reader_prefer_mode: "local_only",
			auto_ai_classification_enabled: true,
			auto_ai_summary_enabled: true,
			auto_ai_outline_enabled: false,
			auto_ai_quotes_enabled: false,
			auto_translation_enabled: true,
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
	const [extractionSettingsLoading, setExtractionSettingsLoading] =
		useState(false);
	const [extractionSettingsSaving, setExtractionSettingsSaving] =
		useState(false);
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
	const [recommendationEmbeddingRefreshing, setRecommendationEmbeddingRefreshing] =
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
	const [hoverComment, setHoverComment] = useState<AdminCommentItem | null>(null);
	const [hoverTooltipPos, setHoverTooltipPos] = useState<{
		x: number;
		y: number;
	} | null>(null);
	const [showCommentContentModal, setShowCommentContentModal] = useState(false);
	const [activeCommentContent, setActiveCommentContent] =
		useState<AdminCommentItem | null>(null);
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

		const taskTimelineNodes = useMemo(
			() => selectedTaskTimelineChain?.nodes || [],
			[selectedTaskTimelineChain],
		);

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
		setExtractionSubSection(routeState.extractionSubSection);
		setCollapsedSettings((prev) => ({
			...prev,
			ai: routeState.section === "ai" ? false : prev.ai,
			comments: routeState.section === "comments" ? false : prev.comments,
			extraction: routeState.section === "extraction" ? false : prev.extraction,
		}));
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
			extractionSubSection,
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
			extractionSubSection,
			monitoringSubSection,
			routeInitialized,
			router,
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
			confirmState,
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
				showToast(t("排序更新失败"), "error");
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
		api_type: "chat_completions" as "chat_completions" | "responses",
		thinking_level: "disabled" as "disabled" | "auto" | "low" | "medium" | "high" | "adaptive",
		price_input_per_1k: "",
		price_output_per_1k: "",
		currency: "USD",
		context_window_tokens: "",
		reserve_output_tokens: "",
		is_enabled: true,
		is_default: false,
	});

	const [promptFormData, setPromptFormData] = useState({
		...createEmptyPromptFormData("summary"),
	});
	const [showPromptAdvanced, setShowPromptAdvanced] = useState(false);
	const [promptModalMode, setPromptModalMode] = useState<
		"create" | "edit" | "duplicate"
	>("create");
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
	const promptModelOptions = useMemo(
		() =>
			modelAPIConfigs
				.map((config) => ({
					value: config.id,
					label:
						`${config.name || config.model_name || config.id}` +
						(config.model_name && config.model_name !== config.name
							? ` (${config.model_name})`
							: "") +
						(config.model_type === "vector" ? ` · ${t("向量")}` : "") +
						(!config.is_enabled ? ` · ${t("已禁用")}` : ""),
				}))
				.sort((a, b) => a.label.localeCompare(b.label, "zh-Hans-CN")),
		[modelAPIConfigs, t],
	);
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
	const backupImportInputRef = useRef<HTMLInputElement>(null);
	const [backupImporting, setBackupImporting] = useState(false);
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
			const { taskType: taskTypeValue, contentType: contentTypeValue } =
				parseAITaskFilterValue(taskTypeFilter);
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
			const { taskType, contentType } = parseAITaskFilterValue(usageContentType);
			const response = await aiUsageApi.list({
				model_api_config_id: usageModelId || undefined,
				status: usageStatus || undefined,
				task_type: taskType,
				content_type: contentType,
				start: usageStart || undefined,
				end: usageEnd || undefined,
				page: usagePage,
				size: usagePageSize,
			});
			setUsageLogs(response.items || []);
			setUsageTotal(response.total || 0);
		} catch (error) {
			console.error("Failed to fetch AI usage logs:", error);
			showToast(t("调用记录加载失败"), "error");
		} finally {
			setUsageLoading(false);
		}
	};

	const fetchUsageSummary = async () => {
		try {
			const { taskType, contentType } = parseAITaskFilterValue(usageContentType);
			const response = await aiUsageApi.summary({
				model_api_config_id: usageModelId || undefined,
				status: usageStatus || undefined,
				task_type: taskType,
				content_type: contentType,
				start: usageStart || undefined,
				end: usageEnd || undefined,
			});
			setUsageSummary(response.summary);
			setUsageByModel(response.by_model || []);
		} catch (error) {
			console.error("Failed to fetch AI usage summary:", error);
			showToast(t("计量汇总加载失败"), "error");
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
			showToast(t("评论列表加载失败"), "error");
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
			showToast(t("评论配置加载失败"), "error");
		} finally {
			setCommentSettingsLoading(false);
		}
	};

	const handleSaveCommentSettings = async () => {
		setCommentSettingsSaving(true);
		try {
			await commentSettingsApi.updateSettings(commentSettings);
			showToast(t("评论配置已保存"));
		} catch (error) {
			console.error("Failed to save comment settings:", error);
			showToast(t("评论配置保存失败"), "error");
		} finally {
			setCommentSettingsSaving(false);
		}
	};

	const fetchBasicSettings = async () => {
		setBasicSettingsLoading(true);
		try {
			const data = await basicSettingsApi.getSettings();
			setBasicSettingsForm({
				...data,
				header_custom_links: data.header_custom_links || [],
			});
		} catch (error) {
			console.error("Failed to fetch basic settings:", error);
			showToast(t("基础配置加载失败"), "error");
		} finally {
			setBasicSettingsLoading(false);
		}
	};

	const handleAddHeaderCustomLink = () => {
		setBasicSettingsForm((prev) => ({
			...prev,
			header_custom_links: [
				...(prev.header_custom_links || []),
				{ label: "", url: "" },
			],
		}));
	};

	const handleUpdateHeaderCustomLink = (
		index: number,
		field: "label" | "url",
		value: string,
	) => {
		setBasicSettingsForm((prev) => ({
			...prev,
			header_custom_links: (prev.header_custom_links || []).map((item, itemIndex) =>
				itemIndex === index ? { ...item, [field]: value } : item,
			),
		}));
	};

	const handleRemoveHeaderCustomLink = (index: number) => {
		setBasicSettingsForm((prev) => ({
			...prev,
			header_custom_links: (prev.header_custom_links || []).filter(
				(_, itemIndex) => itemIndex !== index,
			),
		}));
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
			showToast(t("存储配置加载失败"), "error");
		} finally {
			setStorageSettingsLoading(false);
			setStorageStatsLoading(false);
		}
	};

	const handleSaveStorageSettings = async () => {
		setStorageSettingsSaving(true);
		try {
			await storageSettingsApi.updateSettings(storageSettings);
			showToast(t("存储配置已保存"));
		} catch (error) {
			console.error("Failed to save storage settings:", error);
			showToast(t("存储配置保存失败"), "error");
		} finally {
			setStorageSettingsSaving(false);
		}
	};

	const fetchExtractionSettings = async () => {
		setExtractionSettingsLoading(true);
		try {
			const data = await extractionSettingsApi.getSettings();
			setExtractionSettings(normalizeExtractionSettings(data));
		} catch (error) {
			console.error("Failed to fetch extraction settings:", error);
			showToast(t("内容解析配置加载失败"), "error");
		} finally {
			setExtractionSettingsLoading(false);
		}
	};

	const handleSaveExtractionSettings = async () => {
		setExtractionSettingsSaving(true);
		try {
			await extractionSettingsApi.updateSettings(
				normalizeExtractionSettings(extractionSettings),
			);
			showToast(t("内容解析配置已保存"));
		} catch (error: any) {
			console.error("Failed to save extraction settings:", error);
			showToast(
				error?.response?.data?.detail || t("内容解析配置保存失败"),
				"error",
			);
		} finally {
			setExtractionSettingsSaving(false);
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

	const handleRefreshRecommendationEmbeddings = async () => {
		if (!recommendationSettings.recommendation_model_config_id) {
			showToast(t("请先选择远程向量模型"), "error");
			return;
		}
		setRecommendationEmbeddingRefreshing(true);
		try {
			await recommendationSettingsApi.updateSettings(recommendationSettings);
			const result = await recommendationSettingsApi.rebuildEmbeddings();
			showToast(
				t("向量刷新任务已提交：扫描 {scanned}，入队 {queued}，跳过 {skipped}")
					.replace("{scanned}", String(result.scanned_articles))
					.replace("{queued}", String(result.queued_tasks))
					.replace("{skipped}", String(result.skipped_articles)),
			);
		} catch (error: any) {
			console.error("Failed to refresh recommendation embeddings:", error);
			showToast(
				error?.response?.data?.detail || t("向量刷新任务提交失败"),
				"error",
			);
		} finally {
			setRecommendationEmbeddingRefreshing(false);
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
		comment: AdminCommentItem,
		nextHidden: boolean,
	) => {
		if (pendingCommentActionIds.has(comment.id)) return;
		setCommentActionPending(comment.id, true);
		try {
			if (comment.resource_type === "review") {
				await reviewCommentApi.toggleHidden(comment.id, nextHidden);
			} else {
				await commentApi.toggleHidden(comment.id, nextHidden);
			}
			showToast(nextHidden ? t("评论已隐藏") : t("评论已显示"));
			await fetchCommentList();
		} catch (error) {
			console.error("Failed to toggle comment visibility:", error);
			showToast(t("更新失败"), "error");
		} finally {
			setCommentActionPending(comment.id, false);
		}
	};

	const handleDeleteCommentAdmin = async (comment: AdminCommentItem) => {
		setConfirmState({
			isOpen: true,
			title: t("删除评论"),
			message: t("确定要删除这条评论吗？此操作不可撤销。"),
			confirmText: t("删除"),
			cancelText: t("取消"),
			onConfirm: async () => {
				if (pendingCommentActionIds.has(comment.id)) return;
				setCommentActionPending(comment.id, true);
				try {
					await commentAdminApi.delete(comment.id, comment.resource_type);
					showToast(t("删除成功"));
					await fetchCommentList();
				} catch (error) {
					console.error("Failed to delete comment:", error);
					showToast(t("删除失败"), "error");
				} finally {
					setCommentActionPending(comment.id, false);
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

		// The fetch helpers below intentionally stay out of deps to avoid
		// request fan-out while this page coordinates section-driven loading.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	/* eslint-disable react-hooks/exhaustive-deps */
	// biome-ignore lint/correctness/useExhaustiveDependencies: fetch 函数为普通函数且按分区加载，补依赖会导致每渲染重新触发请求扇出
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
				fetchModelAPIConfigs();
				fetchPromptConfigs();
			} else if (aiSubSection === "recommendations") {
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
		if (activeSection === "extraction") {
			fetchExtractionSettings();
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
	/* eslint-enable react-hooks/exhaustive-deps */

	// biome-ignore lint/correctness/useExhaustiveDependencies: 懒加载守卫由 showPromptModal/长度条件控制，fetch 函数非稳定引用
	useEffect(() => {
		if (!showPromptModal || modelLoading || modelAPIConfigs.length > 0) return;
		void fetchModelAPIConfigs();
	}, [showPromptModal, modelLoading, modelAPIConfigs.length]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: commentSubSection 是刻意信号，切换评论子分区时清空校验结果
	useEffect(() => {
		setCommentValidationResult(null);
	}, [commentSubSection]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: reset 过滤器函数为普通函数，分区切换重置属一次性语义，补依赖会重复重置
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

	/* eslint-disable react-hooks/exhaustive-deps */
	// biome-ignore lint/correctness/useExhaustiveDependencies: 筛选值是刻意的重新拉取信号，fetchTasks/routeInitialized 非稳定引用，补齐会改变触发语义
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
	/* eslint-enable react-hooks/exhaustive-deps */

	/* eslint-disable react-hooks/exhaustive-deps */
	// biome-ignore lint/correctness/useExhaustiveDependencies: usage 筛选值是刻意的重新拉取信号，fetch/routeInitialized 非稳定引用，补齐会改变触发语义
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
	/* eslint-enable react-hooks/exhaustive-deps */

	/* eslint-disable react-hooks/exhaustive-deps */
	// biome-ignore lint/correctness/useExhaustiveDependencies: 评论筛选值是刻意的重新拉取信号，fetchCommentList/routeInitialized 非稳定引用
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
	/* eslint-enable react-hooks/exhaustive-deps */

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
			api_type: "chat_completions",
			thinking_level: "disabled",
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
			api_type: config.api_type || "chat_completions",
			thinking_level: config.thinking_level || "disabled",
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

		const handleFetchModelOptions = useCallback(async () => {
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
		}, [
			modelAPIFormData.api_key,
			modelAPIFormData.base_url,
			modelAPIFormData.provider,
			showToast,
			t,
		]);

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
		}, [
			showModelAPIModal,
			modelAPIFormData.base_url,
			modelAPIFormData.api_key,
			handleFetchModelOptions,
		]);

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
		setPromptModalMode("create");
		setPromptFormData(createEmptyPromptFormData(selectedPromptType));
		setShowPromptAdvanced(false);
		if (modelAPIConfigs.length === 0) {
			void fetchModelAPIConfigs();
		}
		setShowPromptModal(true);
	};

	const handleEditPrompt = (config: PromptConfig) => {
		setEditingPromptConfig(config);
		setPromptModalMode("edit");
		setPromptFormData({
			name: config.name,
			category_id: config.category_id || "",
			type: config.type as PromptType,
			prompt: config.prompt,
			system_prompt: config.system_prompt || "",
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
		if (modelAPIConfigs.length === 0) {
			void fetchModelAPIConfigs();
		}
		setShowPromptModal(true);
	};

	const handleDuplicatePrompt = (config: PromptConfig) => {
		setEditingPromptConfig(null);
		setPromptModalMode("duplicate");
		setPromptFormData({
			name: `${config.name} ${t("副本")}`,
			category_id: config.category_id || "",
			type: config.type as PromptType,
			prompt: config.prompt,
			system_prompt: config.system_prompt || "",
			temperature: config.temperature?.toString() || "",
			max_tokens: config.max_tokens?.toString() || "",
			top_p: config.top_p?.toString() || "",
			chunk_size_tokens: config.chunk_size_tokens?.toString() || "",
			chunk_overlap_tokens: config.chunk_overlap_tokens?.toString() || "",
			max_continue_rounds: config.max_continue_rounds?.toString() || "",
			model_api_config_id: config.model_api_config_id || "",
			is_enabled: config.is_enabled,
			is_default: false,
		});
		setShowPromptAdvanced(false);
		if (modelAPIConfigs.length === 0) {
			void fetchModelAPIConfigs();
		}
		setShowPromptModal(true);
	};

	const handleSavePrompt = async () => {
		if (promptSaving) return;
		if (!promptFormData.system_prompt.trim()) {
			showToast(t("请填写系统提示词"), "error");
			return;
		}
		if (!promptFormData.prompt.trim()) {
			showToast(t("请填写任务要求"), "error");
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
		const promptType = getRetryPromptTypeForTask(
			task.task_type,
			task.content_type,
		) as PromptType | null;
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

		const handleOpenTaskTimeline = useCallback(async (
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
		}, [openingTaskTimelineId, t]);

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

	const getUsageStatusLabel = (status: string) => {
		if (status === "completed") return t("已完成");
		if (status === "failed") return t("失败");
		if (status === "processing") return t("处理中");
		if (status === "cancelled") return t("已取消");
		return t("待处理");
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
					showToast(t("删除成功"));
					fetchPromptConfigs();
				} catch (error) {
					console.error("Failed to delete prompt config:", error);
					showToast(t("删除失败"), "error");
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
				showToast(t("导入失败：格式不正确"), "error");
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

	const formatBackupTimestamp = (value: string) => {
		const parsed = new Date(value);
		if (Number.isNaN(parsed.getTime())) return value;
		return parsed.toLocaleString();
	};
	const {
		backupExportJob,
		backupExporting,
		backupExportStatusText,
		backupExportDownloadReady,
		handleExportBackup,
		handleDownloadLatestBackup,
	} = useLatestBackupExportJob({
		active: routeInitialized && activeSection === "storage",
		t,
		showToast,
		formatTimestamp: formatBackupTimestamp,
	});

	const handleImportBackup = async (
		event: React.ChangeEvent<HTMLInputElement>,
	) => {
		if (backupImporting) return;
		const file = event.target.files?.[0];
		if (!file) return;
		const lowerName = file.name.toLowerCase();
		if (!lowerName.endsWith(".zip")) {
			showToast(t("导入失败：仅支持 zip 备份文件"), "error");
			if (backupImportInputRef.current) {
				backupImportInputRef.current.value = "";
			}
			return;
		}

		setConfirmState({
			isOpen: true,
			title: t("导入备份数据"),
			message: t(
				"将执行镜像恢复并覆盖当前文章、AI 解读、配置、评论与媒体文件；统计、任务、向量和日志不会恢复，且备份文件包含敏感配置，是否继续？",
			),
			confirmText: t("开始恢复"),
			cancelText: t("取消"),
			onConfirm: async () => {
				setBackupImporting(true);
				try {
					const result = await backupApi.importBackup(file);
					showToast(
						t("镜像恢复完成：备份时间 {backup}，恢复时间 {restored}")
							.replace(
								"{backup}",
								formatBackupTimestamp(result.meta.backup_exported_at),
							)
							.replace(
								"{restored}",
								formatBackupTimestamp(result.meta.restored_at),
							),
					);
					await Promise.all([
						fetchCategories(),
						fetchModelAPIConfigs(),
						fetchPromptConfigs(),
						fetchStorageSettings(),
						fetchBasicSettings(),
						fetchCommentSettings(),
						fetchExtractionSettings(),
						fetchRecommendationSettings(),
					]);
				} catch (importError) {
					console.error("Failed to import backup:", importError);
					showToast(t("镜像恢复失败，请检查备份文件或版本"), "error");
				} finally {
					setBackupImporting(false);
					if (backupImportInputRef.current) {
						backupImportInputRef.current.value = "";
					}
				}
			},
			onCancel: () => {
				if (backupImportInputRef.current) {
					backupImportInputRef.current.value = "";
				}
			},
		});
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
			<>
				<SeoHead title={pageTitle} robots="noindex,nofollow" />
				<div className="min-h-screen bg-app flex flex-col">
					<AppHeader />
					<div className="flex-1 flex items-center justify-center">
						<div className="text-text-3">{t("加载中")}</div>
					</div>
					<AppFooter />
				</div>
			</>
		);
	}

	if (!isAdmin) {
		return (
			<>
				<SeoHead title={pageTitle} robots="noindex,nofollow" />
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
			</>
		);
	}

		return (
			<div className="min-h-screen bg-app flex flex-col">
				<SeoHead
					title={pageTitle}
					robots="noindex,nofollow"
				/>
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
											<SelectableButton
												onClick={() => setActiveSection("columns")}
												active={activeSection === "columns"}
												variant="menu"
											>
												<span className="inline-flex items-center gap-2">
													<IconDoc className="h-4 w-4" />
													<span>{t("专栏管理")}</span>
												</span>
											</SelectableButton>

															<SectionToggleButton
																label={t("内容解析")}
												active={activeSection === "extraction"}
												expanded={!collapsedSettings.extraction}
												onMainClick={handleToggleExtractionSection}
												onToggle={handleToggleExtractionSection}
												toggleAriaLabel={
													collapsedSettings.extraction ? t("展开") : t("收起")
												}
												icon={<IconSearch className="h-4 w-4" />}
												expandedIndicator={<IconArrowUp className="h-4 w-4" />}
												collapsedIndicator={
													<IconArrowDown className="h-4 w-4" />
												}
											/>

											{!collapsedSettings.extraction && (
												<>
													<SelectableButton
														onClick={() => {
															setActiveSection("extraction");
															setExtractionSubSection("parser");
														}}
														active={
															activeSection === "extraction" &&
															extractionSubSection === "parser"
														}
														variant="submenu"
													>
														<span className="inline-flex items-center gap-2">
															<IconSearch className="h-4 w-4" />
															<span>{t("解析器")}</span>
														</span>
													</SelectableButton>
													<SelectableButton
														onClick={() => {
															setActiveSection("extraction");
															setExtractionSubSection("post-processing");
														}}
														active={
															activeSection === "extraction" &&
															extractionSubSection === "post-processing"
														}
														variant="submenu"
													>
														<span className="inline-flex items-center gap-2">
															<IconRobot className="h-4 w-4" />
															<span>{t("后处理")}</span>
														</span>
													</SelectableButton>
												</>
											)}

											

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
										<AiUsageSection
											modelAPIConfigs={modelAPIConfigs}
											usageSummary={usageSummary}
											usageByModel={usageByModel}
											usageCostByCurrency={usageCostByCurrency}
											usageTotal={usageTotal}
											usageLoading={usageLoading}
											usageLogs={usageLogs}
											usagePage={usagePage}
											usagePageSize={usagePageSize}
											usageModelId={usageModelId}
											usageStatus={usageStatus}
											usageContentType={usageContentType}
											usageStart={usageStart}
											usageEnd={usageEnd}
											toDayjsRangeFromDateStrings={toDayjsRangeFromDateStrings}
											getUsageStatusLabel={getUsageStatusLabel}
											openUsageCost={openUsageCost}
											handleOpenUsageRelatedTask={handleOpenUsageRelatedTask}
											setUsageModelId={setUsageModelId}
											setUsageStatus={setUsageStatus}
											setUsageContentType={setUsageContentType}
											setUsageStart={setUsageStart}
											setUsageEnd={setUsageEnd}
											setUsagePage={setUsagePage}
											setUsagePageSize={setUsagePageSize}
											showUsageCostModal={showUsageCostModal}
											setShowUsageCostModal={setShowUsageCostModal}
											usageCostTitle={usageCostTitle}
											usageCostDetails={usageCostDetails}
											usageCostBreakdown={usageCostBreakdown}
										/>
									) : (
										<ModelApiSettingsSection
											modelLoading={modelLoading}
											filteredModelAPIConfigs={filteredModelAPIConfigs}
											modelCategory={modelCategory}
											showModelAPIModal={showModelAPIModal}
											setShowModelAPIModal={setShowModelAPIModal}
											editingModelAPIConfig={editingModelAPIConfig}
											modelAPIFormData={modelAPIFormData}
											setModelAPIFormData={setModelAPIFormData}
											modelAPISaving={modelAPISaving}
											modelOptions={modelOptions}
											modelOptionsLoading={modelOptionsLoading}
											modelOptionsError={modelOptionsError}
											modelNameManual={modelNameManual}
											setModelNameManual={setModelNameManual}
											showModelAPIAdvanced={showModelAPIAdvanced}
											setShowModelAPIAdvanced={setShowModelAPIAdvanced}
											showModelAPITestModal={showModelAPITestModal}
											setShowModelAPITestModal={setShowModelAPITestModal}
											modelAPITestConfig={modelAPITestConfig}
											modelAPITestPrompt={modelAPITestPrompt}
											setModelAPITestPrompt={setModelAPITestPrompt}
											modelAPITestResult={modelAPITestResult}
											modelAPITestRaw={modelAPITestRaw}
											modelAPITestError={modelAPITestError}
											modelAPITestLoading={modelAPITestLoading}
											handleCreateModelAPINew={handleCreateModelAPINew}
											handleTestModelAPI={handleTestModelAPI}
											handleEditModelAPI={handleEditModelAPI}
											handleDeleteModelAPI={handleDeleteModelAPI}
											handleSaveModelAPI={handleSaveModelAPI}
											handleRunModelAPITest={handleRunModelAPITest}
											handleCopyMaskedValue={handleCopyMaskedValue}
										/>
									)}
								</div>
							)}

							{activeSection === "ai" && aiSubSection === "prompt" && (
								<PromptSettingsSection
									categories={categories}
									handleCreatePromptNew={handleCreatePromptNew}
									handleDeletePrompt={handleDeletePrompt}
									handleDuplicatePrompt={handleDuplicatePrompt}
									handleEditPrompt={handleEditPrompt}
									handleExportPromptConfigs={handleExportPromptConfigs}
									handleImportPromptConfigs={handleImportPromptConfigs}
									handleSavePrompt={handleSavePrompt}
									promptConfigs={promptConfigs}
									promptFormData={promptFormData}
									promptImportInputRef={promptImportInputRef}
									promptImporting={promptImporting}
									promptLoading={promptLoading}
									promptModalMode={promptModalMode}
									promptModelOptions={promptModelOptions}
									promptSaving={promptSaving}
									promptTypeSupportsChunkOptions={promptTypeSupportsChunkOptions}
									selectedPromptType={selectedPromptType}
									setPromptFormData={setPromptFormData}
									setSelectedPromptType={setSelectedPromptType}
									setShowPromptAdvanced={setShowPromptAdvanced}
									setShowPromptModal={setShowPromptModal}
									setShowPromptPreview={setShowPromptPreview}
									showPromptAdvanced={showPromptAdvanced}
									showPromptModal={showPromptModal}
									showPromptPreview={showPromptPreview}
								/>
							)}

							{activeSection === "basic" && (
								<BasicSettingsSection
									basicSettingsForm={basicSettingsForm}
									setBasicSettingsForm={setBasicSettingsForm}
									basicSettingsLoading={basicSettingsLoading}
									basicSettingsSaving={basicSettingsSaving}
									handleSaveBasicSettings={handleSaveBasicSettings}
									handleAddHeaderCustomLink={handleAddHeaderCustomLink}
									handleUpdateHeaderCustomLink={handleUpdateHeaderCustomLink}
									handleRemoveHeaderCustomLink={handleRemoveHeaderCustomLink}
								/>
							)}

							{activeSection === "categories" && (
								<CategoriesSection
									categories={categories}
									categoryLoading={categoryLoading}
									categorySaving={categorySaving}
									categoryFormData={categoryFormData}
									editingCategory={editingCategory}
									showCategoryModal={showCategoryModal}
									sensors={sensors}
									handleCreateCategoryNew={handleCreateCategoryNew}
									handleDeleteCategory={handleDeleteCategory}
									handleDragEnd={handleDragEnd}
									handleEditCategory={handleEditCategory}
									handleSaveCategory={handleSaveCategory}
									setCategoryFormData={setCategoryFormData}
									setShowCategoryModal={setShowCategoryModal}
								/>
							)}

														{activeSection === "columns" && (
								<ReviewTemplateSettings />
							)}

{activeSection === "comments" && (
	<CommentSettingsSection
		commentSubSection={commentSubSection}
		commentSettings={commentSettings}
		setCommentSettings={setCommentSettings}
		commentSettingsLoading={commentSettingsLoading}
		commentSettingsSaving={commentSettingsSaving}
		commentValidationResult={commentValidationResult}
		handleValidateCommentSettings={handleValidateCommentSettings}
		handleSaveCommentSettings={handleSaveCommentSettings}
		handleCopyMaskedValue={handleCopyMaskedValue}
	handleGenerateNextAuthSecret={handleGenerateNextAuthSecret}
	/>
)}


							{activeSection === "extraction" && (
								<ExtractionSettingsSection
									extractionSettings={extractionSettings}
									setExtractionSettings={setExtractionSettings}
									extractionSettingsLoading={extractionSettingsLoading}
									extractionSettingsSaving={extractionSettingsSaving}
									extractionSubSection={extractionSubSection}
									handleSaveExtractionSettings={handleSaveExtractionSettings}
								/>
							)}

							{activeSection === "storage" && (
								<StorageSection
									storageSettings={storageSettings}
									setStorageSettings={setStorageSettings}
									storageSettingsLoading={storageSettingsLoading}
									storageSettingsSaving={storageSettingsSaving}
									storageStatsLoading={storageStatsLoading}
									storageStats={storageStats}
									storageCleanupLoading={storageCleanupLoading}
									backupImporting={backupImporting}
									handleCleanupMedia={handleCleanupMedia}
									handleSaveStorageSettings={handleSaveStorageSettings}
									handleImportBackup={handleImportBackup}
									backupExportJob={backupExportJob}
									backupExporting={backupExporting}
									backupExportStatusText={backupExportStatusText}
									backupExportDownloadReady={backupExportDownloadReady}
									handleExportBackup={handleExportBackup}
									handleDownloadLatestBackup={handleDownloadLatestBackup}
									backupImportInputRef={backupImportInputRef}
								/>
							)}

{activeSection === "monitoring" &&
								monitoringSubSection === "tasks" && (
									<TaskMonitorSection
										hasTaskFilters={hasTaskFilters}
										taskItems={taskItems}
										taskLoading={taskLoading}
										taskPage={taskPage}
										taskPageSize={taskPageSize}
										taskTotal={taskTotal}
										taskStatusFilter={taskStatusFilter}
										taskTypeFilter={taskTypeFilter}
										taskArticleTitleFilter={taskArticleTitleFilter}
										pendingTaskActionIds={pendingTaskActionIds}
										openingTaskTimelineId={openingTaskTimelineId}
										showTaskRetryModal={showTaskRetryModal}
										retryTargetTask={retryTargetTask}
										retryTaskPromptType={retryTaskPromptType}
										retryTaskModelConfigId={retryTaskModelConfigId}
										retryTaskPromptConfigId={retryTaskPromptConfigId}
										setRetryTaskModelConfigId={setRetryTaskModelConfigId}
										setRetryTaskPromptConfigId={setRetryTaskPromptConfigId}
										retryTaskModelOptions={retryTaskModelOptions}
										retryTaskPromptOptions={retryTaskPromptOptions}
										retryTaskOptionsLoading={retryTaskOptionsLoading}
										retryTaskSubmitting={retryTaskSubmitting}
										showTaskTimelineModal={showTaskTimelineModal}
										taskTimelineLoading={taskTimelineLoading}
										taskTimelineRefreshing={taskTimelineRefreshing}
										taskTimelineError={taskTimelineError}
										selectedTaskTimeline={selectedTaskTimeline}
										taskTimelineChains={taskTimelineChains}
										selectedTaskTimelineChain={selectedTaskTimelineChain}
										selectedTaskTimelineUsage={selectedTaskTimelineUsage}
										taskTimelineNodes={taskTimelineNodes}
										selectedTaskTimelineNode={selectedTaskTimelineNode}
										fetchTasks={fetchTasks}
										handleOpenTaskTimeline={handleOpenTaskTimeline}
										handleCancelTask={handleCancelTask}
										handleOpenTaskRetryModal={handleOpenTaskRetryModal}
										handleSubmitTaskRetry={handleSubmitTaskRetry}
										closeTaskRetryModal={closeTaskRetryModal}
										closeTaskTimelineModal={closeTaskTimelineModal}
										handleRefreshTaskTimeline={handleRefreshTaskTimeline}
										handleCopyTaskEventDetails={handleCopyTaskEventDetails}
										openUsagePayload={openUsagePayload}
										getUsageStatusLabel={getUsageStatusLabel}
										setTaskPage={setTaskPage}
										setTaskPageSize={setTaskPageSize}
										setTaskStatusFilter={setTaskStatusFilter}
										setTaskTypeFilter={setTaskTypeFilter}
										setTaskArticleIdFilter={setTaskArticleIdFilter}
										setTaskArticleTitleFilter={setTaskArticleTitleFilter}
										setSelectedTaskTimelineChainId={setSelectedTaskTimelineChainId}
										setSelectedTaskTimelineUsageId={setSelectedTaskTimelineUsageId}
										setSelectedTaskEventId={setSelectedTaskEventId}
									/>
								)}


							{activeSection === "ai" && aiSubSection === "recommendations" && (
								<RecommendationSettingsSection
									recommendationSettings={recommendationSettings}
									setRecommendationSettings={setRecommendationSettings}
									recommendationSettingsLoading={recommendationSettingsLoading}
									recommendationSettingsSaving={recommendationSettingsSaving}
									recommendationEmbeddingRefreshing={recommendationEmbeddingRefreshing}
									modelAPIConfigs={modelAPIConfigs}
									handleSaveRecommendationSettings={handleSaveRecommendationSettings}
									handleRefreshRecommendationEmbeddings={handleRefreshRecommendationEmbeddings}
								/>
							)}

						{activeSection === "monitoring" &&
							monitoringSubSection === "comments" && (
								<CommentMonitorSection
									commentList={commentList}
									commentListLoading={commentListLoading}
									commentListPage={commentListPage}
									commentListPageSize={commentListPageSize}
									commentListTotal={commentListTotal}
									commentQuery={commentQuery}
									commentArticleTitle={commentArticleTitle}
									commentAuthor={commentAuthor}
									commentStart={commentStart}
									commentEnd={commentEnd}
									commentVisibility={commentVisibility}
									commentReplyFilter={commentReplyFilter}
									hasCommentFilters={hasCommentFilters}
									hoverComment={hoverComment}
									hoverTooltipPos={hoverTooltipPos}
									showCommentContentModal={showCommentContentModal}
									activeCommentContent={activeCommentContent}
									pendingCommentActionIds={pendingCommentActionIds}
									fetchCommentList={fetchCommentList}
									resetCommentFilters={resetCommentFilters}
									handleToggleCommentVisibility={handleToggleCommentVisibility}
									handleDeleteCommentAdmin={handleDeleteCommentAdmin}
									setCommentQuery={setCommentQuery}
									setCommentArticleTitle={setCommentArticleTitle}
									setCommentAuthor={setCommentAuthor}
									setCommentStart={setCommentStart}
									setCommentEnd={setCommentEnd}
									setCommentVisibility={setCommentVisibility}
									setCommentReplyFilter={setCommentReplyFilter}
									setCommentListPage={setCommentListPage}
									setCommentListPageSize={setCommentListPageSize}
									setHoverComment={setHoverComment}
									setHoverTooltipPos={setHoverTooltipPos}
									setActiveCommentContent={setActiveCommentContent}
									setShowCommentContentModal={setShowCommentContentModal}
									toDayjsRangeFromDateStrings={toDayjsRangeFromDateStrings}
								/>
							)}
						</main>
					</div>
				</div>

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
