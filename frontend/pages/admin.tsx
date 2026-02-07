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
import { Select } from "antd";
import type { Dayjs } from "dayjs";
import dayjs from "dayjs";
import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { useEffect, useMemo, useRef, useState } from "react";
import AppFooter from "@/components/AppFooter";
import AppHeader from "@/components/AppHeader";
import ConfirmModal from "@/components/ConfirmModal";
import Button from "@/components/Button";
import DateRangePicker from "@/components/DateRangePicker";
import FilterInput from "@/components/FilterInput";
import FilterSelect from "@/components/FilterSelect";
import IconButton from "@/components/IconButton";
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
	IconRefresh,
	IconSearch,
	IconTag,
	IconTrash,
	IconFilter,
} from "@/components/icons";
import { useToast } from "@/components/Toast";
import { useAuth } from "@/contexts/AuthContext";
import {
	type AIUsageListResponse,
	type AIUsageLogItem,
	type AIUsageSummaryResponse,
	type ArticleComment,
	aiUsageApi,
	articleApi,
	categoryApi,
	commentAdminApi,
	commentApi,
	commentSettingsApi,
	type CommentListResponse,
	type CommentSettings,
	type ModelAPIConfig,
	type PromptConfig,
} from "@/lib/api";

type SettingSection = "ai" | "categories" | "monitoring" | "comments";
type AISubSection = "model-api" | "prompt";
type MonitoringSubSection = "tasks" | "ai-usage" | "comments";
type CommentSubSection = "keys" | "filters";
type PromptType =
	| "summary"
	| "translation"
	| "key_points"
	| "outline"
	| "quotes";

const PROMPT_TYPES = [
	{ value: "summary" as PromptType, label: "摘要" },
	{ value: "translation" as PromptType, label: "翻译" },
	{ value: "key_points" as PromptType, label: "总结" },
	{ value: "outline" as PromptType, label: "大纲" },
	{ value: "quotes" as PromptType, label: "金句" },
];

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
	{ value: "", label: "默认" },
	{ value: "USD", label: "美元 (USD)" },
	{ value: "CNY", label: "人民币 (CNY)" },
	{ value: "HKD", label: "港币 (HKD)" },
	{ value: "EUR", label: "欧元 (EUR)" },
	{ value: "JPY", label: "日元 (JPY)" },
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
			className="border rounded-lg px-3 py-2 hover:shadow-sm transition flex items-center justify-between bg-white"
		>
			<div className="flex items-center gap-3">
				<button
					{...attributes}
					{...listeners}
					className="cursor-grab active:cursor-grabbing text-gray-400 hover:text-gray-600 px-1"
					title="拖动排序"
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
					<div className="flex items-center gap-2">
						<h3 className="font-semibold text-gray-900 text-sm">
							{category.name}
						</h3>
						<span className="text-xs text-text-3">
							{category.article_count}
						</span>
					</div>
					<p className="text-xs text-gray-600">
						{category.description || "暂无描述"}
					</p>
				</div>
			</div>

			<div className="flex gap-1">
				<IconButton
					onClick={() => onEdit(category)}
					variant="primary"
					size="sm"
					title="编辑"
				>
					<IconEdit className="h-4 w-4" />
				</IconButton>
				<IconButton
					onClick={() => onDelete(category.id)}
					variant="danger"
					size="sm"
					title="删除"
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
	const [primaryTab, setPrimaryTab] = useState<'monitoring' | 'settings'>('monitoring');
	const [activeSection, setActiveSection] =
		useState<SettingSection>("monitoring");
	const [aiSubSection, setAISubSection] = useState<AISubSection>("model-api");
	const [monitoringSubSection, setMonitoringSubSection] =
		useState<MonitoringSubSection>("tasks");
	const [commentSubSection, setCommentSubSection] =
		useState<CommentSubSection>("keys");
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
	const [taskArticleTitleFilter, setTaskArticleTitleFilter] = useState("");
	const hasTaskFilters = Boolean(
		taskStatusFilter || taskTypeFilter || taskArticleTitleFilter,
	);

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
	const showUsageView =
		activeSection === "monitoring" && monitoringSubSection === "ai-usage";
	const showCommentListView =
		activeSection === "monitoring" && monitoringSubSection === "comments";
	const prevActiveSectionRef = useRef<SettingSection | null>(null);
	const prevMonitoringSubSectionRef = useRef<MonitoringSubSection | null>(null);

	const [showModelAPIModal, setShowModelAPIModal] = useState(false);
	const [showModelAPIAdvanced, setShowModelAPIAdvanced] = useState(false);
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
	const [commentSettingsLoading, setCommentSettingsLoading] = useState(false);
	const [commentSettingsSaving, setCommentSettingsSaving] = useState(false);
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
	}>({
		isOpen: false,
		title: "",
		message: "",
		confirmText: "确定",
		cancelText: "取消",
		onConfirm: () => {},
	});

	const [commentList, setCommentList] = useState<CommentListResponse["items"]>([]);
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
	const [hoverTooltipPos, setHoverTooltipPos] = useState<{ x: number; y: number } | null>(null);
	const hasCommentFilters = Boolean(
		commentQuery ||
			commentArticleTitle ||
			commentAuthor ||
			commentStart ||
			commentEnd ||
			commentVisibility ||
			commentReplyFilter,
	);

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
		if (typeof window === "undefined") return;
		const storedSection = localStorage.getItem("settings_active_section");
		const storedAiSubSection = localStorage.getItem("settings_ai_sub_section");
		const storedMonitoringSubSection = localStorage.getItem(
			"settings_monitoring_sub_section",
		);
		const storedCommentSubSection = localStorage.getItem(
			"settings_comment_sub_section",
		);
		const storedPromptType = localStorage.getItem("settings_prompt_type");

		if (
			storedSection === "ai" ||
			storedSection === "categories" ||
			storedSection === "monitoring" ||
			storedSection === "comments"
		) {
			setActiveSection(storedSection);
		}
		if (storedAiSubSection === "model-api" || storedAiSubSection === "prompt") {
			setAISubSection(storedAiSubSection);
		}
		if (
			storedMonitoringSubSection === "tasks" ||
			storedMonitoringSubSection === "ai-usage" ||
			storedMonitoringSubSection === "comments"
		) {
			setMonitoringSubSection(storedMonitoringSubSection);
		}
		if (storedCommentSubSection === "keys" || storedCommentSubSection === "filters") {
			setCommentSubSection(storedCommentSubSection);
		}
		if (PROMPT_TYPES.some((type) => type.value === storedPromptType)) {
			setSelectedPromptType(storedPromptType as PromptType);
		}
	}, []);

	useEffect(() => {
		if (!router.isReady) return;
const { section, article_title: articleTitleParam } = router.query;
		if (section && typeof section === "string") {
			setActiveSection(section as SettingSection);
		}
		if (articleTitleParam && typeof articleTitleParam === "string") {
			setActiveSection("monitoring");
			setMonitoringSubSection("tasks");
			setTaskArticleTitleFilter(articleTitleParam);
			setTaskPage(1);
		}
	}, [router.isReady, router.query]);

	useEffect(() => {
		if (typeof window === "undefined") return;
		localStorage.setItem("settings_active_section", activeSection);
		localStorage.setItem("settings_ai_sub_section", aiSubSection);
		localStorage.setItem(
			"settings_monitoring_sub_section",
			monitoringSubSection,
		);
		localStorage.setItem("settings_comment_sub_section", commentSubSection);
		localStorage.setItem("settings_prompt_type", selectedPromptType);
	}, [activeSection, aiSubSection, monitoringSubSection, commentSubSection, selectedPromptType]);

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
		model_name: "gpt-4o",
		price_input_per_1k: "",
		price_output_per_1k: "",
		currency: "USD",
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
		model_api_config_id: "",
		is_enabled: true,
		is_default: false,
	});
	const [showPromptAdvanced, setShowPromptAdvanced] = useState(false);
	const promptImportInputRef = useRef<HTMLInputElement>(null);
	const [modelOptions, setModelOptions] = useState<string[]>([]);
	const [modelOptionsLoading, setModelOptionsLoading] = useState(false);
	const [modelOptionsError, setModelOptionsError] = useState("");
	const [modelNameManual, setModelNameManual] = useState(false);
	const [showModelAPITestModal, setShowModelAPITestModal] = useState(false);
	const [modelAPITestConfig, setModelAPITestConfig] =
		useState<ModelAPIConfig | null>(null);
	const [modelAPITestPrompt, setModelAPITestPrompt] = useState("");
	const [modelAPITestResult, setModelAPITestResult] = useState("");
	const [modelAPITestRaw, setModelAPITestRaw] = useState("");
	const [modelAPITestError, setModelAPITestError] = useState("");
	const [modelAPITestLoading, setModelAPITestLoading] = useState(false);
	const modelOptionsFetchRef = useRef<ReturnType<typeof setTimeout> | null>(
		null,
	);

	const [categoryFormData, setCategoryFormData] = useState({
		name: "",
		description: "",
		color: "#3B82F6",
		sort_order: 0,
	});

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
				article_title: taskArticleTitleFilter || undefined,
			});
			setTaskItems(response.data || []);
			setTaskTotal(response.pagination?.total || 0);
		} catch (error) {
			console.error("Failed to fetch AI tasks:", error);
			showToast("任务加载失败", "error");
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
		const origin =
			typeof window !== "undefined" ? window.location.origin : "";

		if (!commentSettings.comments_enabled) {
			messages.push("评论已关闭，当前不会对访客开放。");
		}

		const hasGithub =
			Boolean(commentSettings.github_client_id) &&
			Boolean(commentSettings.github_client_secret);
		const hasGoogle =
			Boolean(commentSettings.google_client_id) &&
			Boolean(commentSettings.google_client_secret);

		if (!commentSettings.nextauth_secret) {
			messages.push("NextAuth Secret 未配置。");
		}
		if (!hasGithub && !hasGoogle) {
			messages.push("至少需要配置 GitHub 或 Google 的 Client 信息。");
		}
		if (commentSettings.github_client_id && !commentSettings.github_client_secret) {
			messages.push("GitHub Client Secret 未填写。");
		}
		if (commentSettings.github_client_secret && !commentSettings.github_client_id) {
			messages.push("GitHub Client ID 未填写。");
		}
		if (commentSettings.google_client_id && !commentSettings.google_client_secret) {
			messages.push("Google Client Secret 未填写。");
		}
		if (commentSettings.google_client_secret && !commentSettings.google_client_id) {
			messages.push("Google Client ID 未填写。");
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
			messages: ok ? ["配置检查通过"] : messages,
			callbacks,
		});
		showToast(ok ? "OAuth 配置检查通过" : "OAuth 配置存在问题", ok ? "success" : "error");
	};

	const handleToggleCommentVisibility = async (commentId: string, nextHidden: boolean) => {
		try {
			await commentApi.toggleHidden(commentId, nextHidden);
			showToast(nextHidden ? "评论已隐藏" : "评论已显示");
			fetchCommentList();
		} catch (error) {
			console.error("Failed to toggle comment visibility:", error);
			showToast("更新失败", "error");
		}
	};

	const handleDeleteCommentAdmin = async (commentId: string) => {
		setConfirmState({
			isOpen: true,
			title: "删除评论",
			message: "确定要删除这条评论吗？此操作不可撤销。",
			confirmText: "删除",
			cancelText: "取消",
			onConfirm: async () => {
				try {
					await commentAdminApi.delete(commentId);
					showToast("删除成功");
					fetchCommentList();
				} catch (error) {
					console.error("Failed to delete comment:", error);
					showToast("删除失败", "error");
				}
			},
		});
	};

	const resetTaskFilters = () => {
		setTaskStatusFilter("");
		setTaskTypeFilter("");
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
		if (activeSection === "categories") {
			fetchCategories();
			return;
		}
		if (activeSection === "ai") {
			if (aiSubSection === "model-api") {
				fetchModelAPIConfigs();
			} else {
				fetchPromptConfigs();
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
	}, [activeSection, aiSubSection, monitoringSubSection, commentSubSection]);

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
		if (activeSection !== "monitoring" || monitoringSubSection !== "tasks") return;
		fetchTasks();
	}, [
		taskPage,
		taskPageSize,
		taskStatusFilter,
		taskTypeFilter,
		taskArticleTitleFilter,
		activeSection,
		monitoringSubSection,
	]);

	useEffect(() => {
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
		setEditingModelAPIConfig(null);
		setModelAPIFormData({
			name: "",
			base_url: "https://api.openai.com/v1",
			api_key: "",
			model_name: "gpt-4o",
			price_input_per_1k: "",
			price_output_per_1k: "",
			currency: "USD",
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
		const hasPricingValue =
			config.price_input_per_1k != null ||
			config.price_output_per_1k != null ||
			(!!config.currency && config.currency !== "USD");
		setModelAPIFormData({
			name: config.name,
			base_url: config.base_url,
			api_key: config.api_key,
			model_name: config.model_name,
			price_input_per_1k: config.price_input_per_1k?.toString() || "",
			price_output_per_1k: config.price_output_per_1k?.toString() || "",
			currency: config.currency || "USD",
			is_enabled: config.is_enabled,
			is_default: config.is_default,
		});
		setModelOptions([]);
		setModelOptionsError("");
		setModelNameManual(false);
		setShowModelAPIAdvanced(hasPricingValue);
		setShowModelAPIModal(true);
	};

	const handleSaveModelAPI = async () => {
		const payload = {
			...modelAPIFormData,
			price_input_per_1k: modelAPIFormData.price_input_per_1k
				? Number(modelAPIFormData.price_input_per_1k)
				: undefined,
			price_output_per_1k: modelAPIFormData.price_output_per_1k
				? Number(modelAPIFormData.price_output_per_1k)
				: undefined,
			currency: modelAPIFormData.currency || undefined,
		};
		try {
			if (editingModelAPIConfig) {
				await articleApi.updateModelAPIConfig(
					editingModelAPIConfig.id,
					payload,
				);
			} else {
				await articleApi.createModelAPIConfig(payload);
			}
			showToast(editingModelAPIConfig ? "配置已更新" : "配置已创建");
			fetchModelAPIConfigs();
			setShowModelAPIModal(false);
			setShowModelAPIAdvanced(false);
			setEditingModelAPIConfig(null);
		} catch (error) {
			console.error("Failed to save model API config:", error);
			showToast("保存失败", "error");
		}
	};

	const handleDeleteModelAPI = async (id: string) => {
		setConfirmState({
			isOpen: true,
			title: "删除模型配置",
			message: "确定要删除这个模型API配置吗？此操作不可撤销。",
			confirmText: "删除",
			cancelText: "取消",
			onConfirm: async () => {
				try {
					await articleApi.deleteModelAPIConfig(id);
					showToast("删除成功");
					fetchModelAPIConfigs();
				} catch (error) {
					console.error("Failed to delete model API config:", error);
					showToast("删除失败", "error");
				}
			},
		});
	};

	const handleTestModelAPI = (config: ModelAPIConfig) => {
		setModelAPITestConfig(config);
		setModelAPITestPrompt("请回复：OK");
		setModelAPITestResult("");
		setModelAPITestRaw("");
		setModelAPITestError("");
		setShowModelAPITestModal(true);
	};

	const handleFetchModelOptions = async () => {
		if (!modelAPIFormData.base_url || !modelAPIFormData.api_key) {
			showToast("请先填写API地址与密钥", "info");
			return;
		}
		setModelOptionsLoading(true);
		setModelOptionsError("");
		try {
			const result = await articleApi.getModelAPIModels({
				base_url: modelAPIFormData.base_url,
				api_key: modelAPIFormData.api_key,
			});
			if (result.success) {
				setModelOptions(result.models || []);
				showToast("已获取模型列表");
			} else {
				setModelOptions([]);
				setModelOptionsError(result.message || "获取模型失败");
				showToast("获取模型失败", "error");
			}
		} catch (error) {
			console.error("Failed to fetch model list:", error);
			setModelOptions([]);
			setModelOptionsError("获取模型失败");
			showToast("获取模型失败", "error");
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
				showToast("调用成功");
			} else {
				setModelAPITestError(result.message || "调用失败");
				setModelAPITestResult(result.content || "");
				setModelAPITestRaw(result.raw_response || "");
				showToast("调用失败", "error");
			}
		} catch (error) {
			console.error("Failed to test model API config:", error);
			setModelAPITestError("调用失败");
			showToast("调用失败", "error");
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
			model_api_config_id: config.model_api_config_id || "",
			is_enabled: config.is_enabled,
			is_default: config.is_default,
		});
		setShowPromptAdvanced(false);
		setShowPromptModal(true);
	};

	const handleSavePrompt = async () => {
		if (!promptFormData.system_prompt.trim()) {
			showToast("请填写系统提示词", "error");
			return;
		}
		if (!promptFormData.prompt.trim()) {
			showToast("请填写提示词", "error");
			return;
		}

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
			};

			if (editingPromptConfig) {
				await articleApi.updatePromptConfig(editingPromptConfig.id, data);
			} else {
				await articleApi.createPromptConfig(data);
			}
			showToast(editingPromptConfig ? "配置已更新" : "配置已创建");
			fetchPromptConfigs();
			setShowPromptModal(false);
			setEditingPromptConfig(null);
		} catch (error) {
			console.error("Failed to save prompt config:", error);
			showToast("保存失败", "error");
		}
	};

	const handleRetryTask = async (taskId: string) => {
		try {
			await articleApi.retryAITasks([taskId]);
			showToast("任务已重试");
			fetchTasks();
		} catch (error) {
			console.error("Failed to retry task:", error);
			showToast("重试失败", "error");
		}
	};

	const handleCancelTask = async (taskId: string) => {
		setConfirmState({
			isOpen: true,
			title: "取消任务",
			message: "确定取消该任务吗？",
			confirmText: "确定",
			cancelText: "取消",
			onConfirm: async () => {
				try {
					await articleApi.cancelAITasks([taskId]);
					showToast("任务已取消");
					fetchTasks();
				} catch (error) {
					console.error("Failed to cancel task:", error);
					showToast("取消失败", "error");
				}
			},
		});
	};

	const getTaskTypeLabel = (task: AITaskItem) => {
		if (task.task_type === "process_article_translation") return "翻译";
		if (task.task_type === "process_ai_content") {
			if (task.content_type === "summary") return "摘要";
			if (task.content_type === "key_points") return "总结";
			if (task.content_type === "outline") return "大纲";
			if (task.content_type === "quotes") return "金句";
			return "AI内容";
		}
		return "摘要";
	};

	const getUsageStatusLabel = (status: string) => {
		if (status === "completed") return "已完成";
		if (status === "failed") return "失败";
		if (status === "processing") return "处理中";
		if (status === "cancelled") return "已取消";
		return "待处理";
	};

	const getUsageContentTypeLabel = (contentType: string | null) => {
		if (!contentType) return "-";
		if (contentType === "summary") return "摘要";
		if (contentType === "key_points") return "总结";
		if (contentType === "outline") return "大纲";
		if (contentType === "quotes") return "金句";
		if (contentType === "translation") return "翻译";
		return contentType;
	};

	const formatJsonPayload = (payload: string | null) => {
		if (!payload) return "暂无数据";
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
			return `${label}：-`;
		}
	const cost = (tokens / 1000) * price;
	return `${label}：${tokens} / 1000 * ${price.toFixed(6)} = ${cost.toFixed(6)} ${currency}`;
};

const formatPrice = (value: number | null | undefined) => {
	if (value == null) return "-";
	return value.toFixed(4);
};

const stripReplyPrefix = (content: string) => {
	if (!content) return "";
	const lines = content.split("\n");
	if (!lines[0]?.startsWith("> 回复 @")) return content;
	const blankIndex = lines.findIndex((line, index) => index > 0 && !line.trim());
	if (blankIndex >= 0) {
		return lines.slice(blankIndex + 1).join("\n").trim();
	}
	return lines.slice(1).join("\n").trim();
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
			log.cost_input != null && log.prompt_tokens != null && log.prompt_tokens > 0
				? log.cost_input / (log.prompt_tokens / 1000)
				: null;
		const outputPrice =
			log.cost_output != null &&
			log.completion_tokens != null &&
			log.completion_tokens > 0
				? log.cost_output / (log.completion_tokens / 1000)
				: null;
		const inputLine = formatCostLine(
			"输入",
			log.prompt_tokens,
			inputPrice,
			currency,
		);
		const outputLine = formatCostLine(
			"输出",
			log.completion_tokens,
			outputPrice,
			currency,
		);
		const total = log.cost_total != null
			? `${log.cost_total.toFixed(6)} ${currency}`
			: "-";
		setUsageCostTitle("费用计算逻辑（仅供参考）");
		setUsageCostDetails(`${inputLine}\n${outputLine}\n合计：${total}`);
		setShowUsageCostModal(true);
	};

	const handleCopyPayload = async () => {
		try {
			await navigator.clipboard.writeText(usagePayloadContent);
			showToast("已复制");
		} catch (error) {
			console.error("复制失败", error);
			showToast("复制失败", "error");
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
			title: "删除提示词配置",
			message: "确定要删除这个提示词配置吗？此操作不可撤销。",
			confirmText: "删除",
			cancelText: "取消",
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
		const file = event.target.files?.[0];
		if (!file) return;
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

			showToast(`导入完成：新增 ${created}，更新 ${updated}，跳过 ${skipped}`);
			fetchPromptConfigs();
		} catch (error) {
			console.error("Failed to import prompt configs:", error);
			showToast("导入失败，请检查文件内容", "error");
		} finally {
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
		try {
			if (editingCategory) {
				await categoryApi.updateCategory(editingCategory.id, categoryFormData);
			} else {
				await categoryApi.createCategory(categoryFormData);
			}
			showToast(editingCategory ? "分类已更新" : "分类已创建");
			fetchCategories();
			setShowCategoryModal(false);
			setEditingCategory(null);
		} catch (error) {
			console.error("Failed to save category:", error);
			showToast("保存失败", "error");
		}
	};

	const handleDeleteCategory = async (id: string) => {
		setConfirmState({
			isOpen: true,
			title: "删除分类",
			message: "确定要删除这个分类吗？此操作不可撤销。",
			confirmText: "删除",
			cancelText: "取消",
			onConfirm: async () => {
				try {
					await categoryApi.deleteCategory(id);
					showToast("删除成功");
					fetchCategories();
				} catch (error) {
					console.error("Failed to delete category:", error);
					showToast("删除失败", "error");
				}
			},
		});
	};

	if (authLoading) {
		return (
			<div className="min-h-screen bg-app flex flex-col">
				<AppHeader />
				<div className="flex-1 flex items-center justify-center">
					<div className="text-text-3">加载中...</div>
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
						<div className="text-text-3 mb-4">无权限访问此页面</div>
						<Link href="/login" className="text-primary hover:underline">
							去登录
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
				<title>管理台 - Lumina</title>
			</Head>
			<AppHeader />

			<div className="flex-1">

				<div className="max-w-7xl mx-auto px-4 pt-6">
					<div className="flex gap-1 border-b border-border">
						<button
							onClick={() => {
								setPrimaryTab('monitoring');
								setActiveSection('monitoring');
							}}
							className={`px-6 py-3 text-sm font-medium rounded-t-sm transition ${
								primaryTab === 'monitoring'
									? 'bg-primary-soft text-primary-ink'
									: 'text-text-2 hover:text-text-1 hover:bg-muted'
							}`}
						>
							监控
						</button>
						<button
							onClick={() => {
								setPrimaryTab('settings');
								setActiveSection('categories');
							}}
							className={`px-6 py-3 text-sm font-medium rounded-t-sm transition ${
								primaryTab === 'settings'
									? 'bg-primary-soft text-primary-ink'
									: 'text-text-2 hover:text-text-1 hover:bg-muted'
							}`}
						>
							设置
						</button>
					</div>
				</div>

				<div className="max-w-7xl mx-auto px-4 py-6">
					<div className="flex gap-6">
						<aside className="w-64 flex-shrink-0">
							<div className="bg-white rounded-lg shadow-sm p-4">
								<h2 className="font-semibold text-text-1 mb-4">
									{primaryTab === 'monitoring' ? '监控模块' : '设置模块'}
								</h2>
								<div className="space-y-2">
									{primaryTab === 'monitoring' ? (
										<>
											<button
												onClick={() => {
													setActiveSection("monitoring");
													setMonitoringSubSection("tasks");
												}}
												className={`w-full text-left px-4 py-3 rounded-sm transition ${
													activeSection === "monitoring" && monitoringSubSection === "tasks"
														? "bg-muted text-text-1"
														: "text-text-2 hover:text-text-1 hover:bg-muted"
												}`}
											>
												<span className="inline-flex items-center gap-2">
													<IconList className="h-4 w-4" />
													<span>任务监控</span>
												</span>
											</button>
											<button
												onClick={() => {
													setActiveSection("monitoring");
													setMonitoringSubSection("ai-usage");
												}}
												className={`w-full text-left px-4 py-3 rounded-sm transition ${
													activeSection === "monitoring" && monitoringSubSection === "ai-usage"
														? "bg-muted text-text-1"
														: "text-text-2 hover:text-text-1 hover:bg-muted"
												}`}
											>
												<span className="inline-flex items-center gap-2">
													<IconMoney className="h-4 w-4" />
													<span>模型记录/计量</span>
												</span>
											</button>
											<button
												onClick={() => {
													setActiveSection("monitoring");
													setMonitoringSubSection("comments");
												}}
												className={`w-full text-left px-4 py-3 rounded-sm transition ${
													activeSection === "monitoring" && monitoringSubSection === "comments"
														? "bg-muted text-text-1"
														: "text-text-2 hover:text-text-1 hover:bg-muted"
												}`}
											>
												<span className="inline-flex items-center gap-2">
													<IconNote className="h-4 w-4" />
													<span>评论列表</span>
												</span>
											</button>
										</>
									) : (
										<>
											<button
												onClick={() => setActiveSection("categories")}
												className={`w-full text-left px-4 py-3 rounded-sm transition ${
													activeSection === "categories"
														? "bg-muted text-text-1"
														: "text-text-2 hover:text-text-1 hover:bg-muted"
												}`}
											>
												<span className="inline-flex items-center gap-2">
													<IconTag className="h-4 w-4" />
													<span>分类管理</span>
												</span>
											</button>
											<button
												onClick={() => setActiveSection("ai")}
												className={`w-full text-left px-4 py-3 rounded-sm transition ${
													activeSection === "ai"
														? "bg-muted text-text-1"
														: "text-text-2 hover:text-text-1 hover:bg-muted"
												}`}
											>
												<span className="inline-flex items-center gap-2">
													<IconRobot className="h-4 w-4" />
													<span>AI配置</span>
												</span>
											</button>
											<button
												onClick={() => {
													setActiveSection("ai");
													setAISubSection("model-api");
												}}
												className={`w-full text-left px-6 py-2 text-sm rounded-sm transition ${
													activeSection === "ai" && aiSubSection === "model-api"
														? "bg-muted text-text-1"
														: "text-text-2 hover:text-text-1 hover:bg-muted"
												}`}
											>
												<span className="inline-flex items-center gap-2">
													<IconPlug className="h-4 w-4" />
													<span>模型API配置</span>
												</span>
											</button>
											<button
												onClick={() => {
													setActiveSection("ai");
													setAISubSection("prompt");
												}}
												className={`w-full text-left px-6 py-2 text-sm rounded-sm transition ${
													activeSection === "ai" && aiSubSection === "prompt"
														? "bg-muted text-text-1"
														: "text-text-2 hover:text-text-1 hover:bg-muted"
												}`}
											>
												<span className="inline-flex items-center gap-2">
													<IconNote className="h-4 w-4" />
													<span>提示词配置</span>
												</span>
											</button>
											<button
												onClick={() => setActiveSection("comments")}
												className={`w-full text-left px-4 py-3 rounded-sm transition ${
													activeSection === "comments"
														? "bg-muted text-text-1"
														: "text-text-2 hover:text-text-1 hover:bg-muted"
												}`}
											>
												<span className="inline-flex items-center gap-2">
													<IconFilter className="h-4 w-4" />
													<span>评论配置</span>
												</span>
											</button>
											<button
												onClick={() => {
													setActiveSection("comments");
													setCommentSubSection("keys");
												}}
												className={`w-full text-left px-6 py-2 text-sm rounded-sm transition ${
													activeSection === "comments" && commentSubSection === "keys"
														? "bg-muted text-text-1"
														: "text-text-2 hover:text-text-1 hover:bg-muted"
												}`}
											>
												<span className="inline-flex items-center gap-2">
													<IconPlug className="h-4 w-4" />
													<span>登录密钥</span>
												</span>
											</button>
											<button
												onClick={() => {
													setActiveSection("comments");
													setCommentSubSection("filters");
												}}
												className={`w-full text-left px-6 py-2 text-sm rounded-sm transition ${
													activeSection === "comments" && commentSubSection === "filters"
														? "bg-muted text-text-1"
														: "text-text-2 hover:text-text-1 hover:bg-muted"
												}`}
											>
												<span className="inline-flex items-center gap-2">
													<IconFilter className="h-4 w-4" />
													<span>过滤规则</span>
												</span>
											</button>
										</>
									)}
								</div>
							</div>
						</aside>

						<main className="flex-1">
							{((activeSection === "ai" && aiSubSection === "model-api") || showUsageView) && (
								<div className="bg-surface rounded-sm shadow-sm border border-border p-6">
									<div className="flex items-center justify-between mb-6">
										<h2 className="text-lg font-semibold text-text-1">
											{showUsageView ? "模型记录/计量" : "模型API配置列表"}
										</h2>
										<div className="flex items-center gap-2">
											{!showUsageView && (
												<button
													onClick={handleCreateModelAPINew}
													className="px-4 py-2 bg-primary text-white rounded-sm hover:bg-primary-ink transition"
												>
													+ 创建配置
												</button>
											)}
										</div>
									</div>

									{showUsageView ? (
										<div className="space-y-6">
											<div className="grid grid-cols-1 md:grid-cols-4 gap-3">
												<div className="bg-surface border border-border rounded-sm p-3">
													<div className="text-xs text-text-3">调用次数</div>
													<div className="text-lg font-semibold text-text-1">
														{usageSummary?.calls ?? 0}
													</div>
												</div>
										<div className="bg-surface border border-border rounded-sm p-3">
											<div className="text-xs text-text-3">Tokens（输入/输出）</div>
											<div className="text-lg font-semibold text-text-1">
												{usageSummary?.prompt_tokens ?? 0}/
												{usageSummary?.completion_tokens ?? 0}
											</div>
										</div>
												<div className="bg-surface border border-border rounded-sm p-3">
													<div className="text-xs text-text-3">费用合计（参考）</div>
													<div className="text-lg font-semibold text-text-1">
														{usageCostByCurrency.length > 0 ? (
															<div className="space-y-1">
																{usageCostByCurrency.map(([currency, total]) => (
																	<div key={currency}>
																		{formatPrice(total)}{" "}
																		{currency}
																	</div>
																))}
															</div>
														) : (
															<span>{formatPrice(0)}</span>
														)}
													</div>
												</div>
												<div className="bg-surface border border-border rounded-sm p-3">
													<div className="text-xs text-text-3">明细条数</div>
													<div className="text-lg font-semibold text-text-1">
														{usageTotal}
													</div>
												</div>
											</div>

												<div className="grid grid-cols-1 md:grid-cols-5 gap-4">
													<FilterSelect
														label="模型"
														value={usageModelId}
														onChange={(value) => {
															setUsageModelId(value);
															setUsagePage(1);
														}}
														options={[
															{ value: "", label: "全部" },
															...modelAPIConfigs.map((config) => ({
																value: config.id,
																label: config.name,
															})),
														]}
													/>
													<FilterSelect
														label="状态"
														value={usageStatus}
														onChange={(value) => {
															setUsageStatus(value);
															setUsagePage(1);
														}}
														options={[
															{ value: "", label: "全部" },
															{ value: "completed", label: "已完成" },
															{ value: "failed", label: "失败" },
															{ value: "processing", label: "处理中" },
															{ value: "pending", label: "待处理" },
														]}
													/>
													<FilterSelect
														label="类型"
														value={usageContentType}
														onChange={(value) => {
															setUsageContentType(value);
															setUsagePage(1);
														}}
														options={[
															{ value: "", label: "全部" },
															{ value: "summary", label: "摘要" },
															{ value: "key_points", label: "总结" },
															{ value: "outline", label: "大纲" },
															{ value: "quotes", label: "金句" },
															{ value: "translation", label: "翻译" },
														]}
													/>
													<div className="md:col-span-2">
														<label htmlFor="usage-date-range" className="block text-sm text-text-2 mb-1.5">日期范围</label>
														<DateRangePicker
															id="usage-date-range"
															value={toDayjsRangeFromDateStrings(usageStart, usageEnd)}
															onChange={(values) => {
																const [start, end] = values || [];
																setUsageStart(start ? start.format("YYYY-MM-DD") : "");
																setUsageEnd(end ? end.format("YYYY-MM-DD") : "");
																setUsagePage(1);
															}}
															className="w-full"
														/>
													</div>
												</div>

											<div className="bg-surface border border-border rounded-sm p-4">
												<div className="text-sm font-semibold text-text-1 mb-3">
													按模型汇总
												</div>
												{usageByModel.length === 0 ? (
													<div className="text-sm text-text-3">暂无数据</div>
												) : (
													<div className="overflow-x-auto">
														<table className="min-w-full text-sm">
															<thead className="bg-muted text-text-2">
																<tr>
																	<th className="text-left px-3 py-2">模型</th>
																	<th className="text-left px-3 py-2">调用</th>
															<th className="text-left px-3 py-2">
																Tokens（输入/输出）
															</th>
																	<th className="text-left px-3 py-2">费用（参考）</th>
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
																	{row.prompt_tokens ?? "-"}/{row.completion_tokens ?? "-"}
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
														调用明细
													</div>
													<div className="text-sm text-text-3">
														共 {usageTotal} 条
													</div>
												</div>
												{usageLoading ? (
													<div className="text-center py-6 text-text-3">
														加载中...
													</div>
												) : usageLogs.length === 0 ? (
													<div className="text-center py-6 text-text-3">
														暂无记录
													</div>
												) : (
													<div className="overflow-x-auto">
														<table className="min-w-full text-sm">
															<thead className="bg-muted text-text-2">
																<tr>
																<th className="text-left px-3 py-2">时间</th>
																	<th className="text-left px-3 py-2">模型</th>
																	<th className="text-left px-3 py-2">文章</th>
																	<th className="text-left px-3 py-2">类型</th>
																	<th className="text-left px-3 py-2">
																		Tokens（输入/输出）
																	</th>
															<th className="text-left px-3 py-2">费用（参考）</th>
															<th className="text-left px-3 py-2">状态</th>
															<th className="text-left px-3 py-2">查看</th>
														</tr>
															</thead>
															<tbody className="divide-y divide-border">
																{usageLogs.map((log) => (
																	<tr key={log.id} className="hover:bg-muted">
																<td className="px-3 py-2 text-text-2">
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
															>
																查看
															</Link>
														) : (
															"-"
														)}
																</td>
																<td className="px-3 py-2 text-text-2">
																	{getUsageContentTypeLabel(log.content_type)}
																</td>
															<td className="px-3 py-2 text-text-2">
																{log.prompt_tokens ?? "-"}/{log.completion_tokens ?? "-"}
															</td>
																<td className="px-3 py-2 text-text-2">
																		{log.cost_total != null ? (
																			<button
																				type="button"
																				onClick={() => openUsageCost(log)}
																				className="text-primary hover:text-primary-ink"
																			>
																				{log.cost_total.toFixed(4)}
																				{log.currency ? ` ${log.currency}` : ""}
																			</button>
																		) : (
																			"-"
																		)}
																</td>
															<td className="px-3 py-2 text-text-2">
																{getUsageStatusLabel(log.status)}
															</td>
														<td className="px-3 py-2 text-text-2">
																{log.request_payload || log.response_payload ? (
																	<div className="flex items-center gap-2">
																		<IconButton
																			type="button"
																			onClick={() =>
																				openUsagePayload(
																					"请求输入",
																					log.request_payload,
																				)
																			}
																			variant="ghost"
																			size="sm"
																			title="输入"
																		>
																			<IconArrowDown className="h-4 w-4" />
																		</IconButton>
																		<IconButton
																			type="button"
																			onClick={() =>
																				openUsagePayload(
																					"响应输出",
																					log.response_payload,
																				)
																			}
																			variant="ghost"
																			size="sm"
																			title="输出"
																		>
																			<IconArrowUp className="h-4 w-4" />
																		</IconButton>
																	</div>
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
															<Select
																value={usagePageSize}
																onChange={(value) => {
																	setUsagePageSize(Number(value));
																	setUsagePage(1);
																}}
																className="select-modern-antd"
																popupClassName="select-modern-dropdown"
																options={[
																	{ value: 10, label: "10" },
																	{ value: 20, label: "20" },
																	{ value: 50, label: "50" },
																]}
															/>
															<span>条，共 {usageTotal} 条</span>
														</div>
														<div className="flex items-center gap-2">
														<Button
															onClick={() =>
																setUsagePage((page) => Math.max(1, page - 1))
															}
															disabled={usagePage === 1}
															variant="secondary"
															size="sm"
														>
															上一页
														</Button>
														<span className="px-4 py-2 text-sm bg-surface border border-border rounded-sm text-text-2">
															第 {usagePage} /{" "}
															{Math.ceil(usageTotal / usagePageSize) || 1} 页
														</span>
														<Button
															onClick={() => setUsagePage((page) => page + 1)}
															disabled={
																usagePage * usagePageSize >= usageTotal
															}
															variant="secondary"
															size="sm"
														>
															下一页
														</Button>
														</div>
													</div>
												)}
											</div>
										</div>
									) : modelLoading ? (
										<div className="text-center py-12 text-text-3">
											加载中...
										</div>
									) : modelAPIConfigs.length === 0 ? (
										<div className="text-center py-12 text-text-3">
											<div className="mb-4">暂无模型API配置</div>
											<button
												onClick={handleCreateModelAPINew}
												className="px-4 py-2 bg-primary text-white rounded-sm hover:bg-primary-ink transition"
											>
												创建配置
											</button>
										</div>
									) : (
										<div className="space-y-4">
											{[...modelAPIConfigs]
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
																	<h3 className="font-semibold text-gray-900">
																		{config.name}
																	</h3>
																	{config.is_default && (
																		<span className="ml-2 px-2 py-1 bg-blue-100 text-blue-700 rounded text-xs">
																			默认
																		</span>
																	)}
																	<span
																		className={`px-2 py-1 rounded text-xs ${
																			config.is_enabled
																				? "bg-green-100 text-green-700"
																				: "bg-gray-100 text-gray-600"
																		}`}
																	>
																		{config.is_enabled ? "启用" : "禁用"}
																	</span>
																</div>

																<div className="space-y-1 text-sm text-gray-600">
																	<div>
																		<span className="font-medium">名称：</span>
																		<span>{config.name}</span>
																	</div>
																	<div>
																		<span className="font-medium">
																			API地址：
																		</span>
																		<code className="px-2 py-1 bg-gray-50 rounded text-xs">
																			{config.base_url}
																		</code>
																	</div>
																	<div>
																		<span className="font-medium">
																			模型名称：
																		</span>
																		<code className="px-2 py-1 bg-gray-50 rounded text-xs">
																			{config.model_name}
																		</code>
																	</div>
																	<div>
																		<span className="font-medium">计费：</span>
																		<span>
																			输入{" "}
																			{formatPrice(
																				config.price_input_per_1k,
																			)}
																			/ 输出{" "}
																			{formatPrice(
																				config.price_output_per_1k,
																			)}
																			{config.currency
																				? ` ${config.currency}`
																				: ""}
																		</span>
																	</div>
																	<div>
																		<span className="font-medium">
																			API密钥：
																		</span>
																		<code className="px-2 py-1 bg-gray-50 rounded text-xs">
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
																title="测试连接"
															>
																<IconLink className="h-4 w-4" />
															</IconButton>
															<IconButton
																onClick={() => handleEditModelAPI(config)}
																variant="primary"
																size="sm"
																title="编辑"
															>
																<IconEdit className="h-4 w-4" />
															</IconButton>
															<IconButton
																onClick={() =>
																	handleDeleteModelAPI(config.id)
																}
																variant="danger"
																size="sm"
																title="删除"
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
								<div className="bg-white rounded-lg shadow-sm p-6">
									<div className="flex items-center justify-between mb-4">
										<h2 className="text-lg font-semibold text-gray-900">
											提示词配置列表
										</h2>
										<div className="flex items-center gap-2">
											<button
												onClick={() => handleExportPromptConfigs("current")}
												className="px-3 py-2 text-sm bg-muted text-text-2 rounded-sm hover:bg-surface hover:text-text-1 transition"
											>
												导出当前
											</button>
											<button
												onClick={() => handleExportPromptConfigs("all")}
												className="px-3 py-2 text-sm bg-muted text-text-2 rounded-sm hover:bg-surface hover:text-text-1 transition"
											>
												导出全部
											</button>
											<button
												onClick={() => promptImportInputRef.current?.click()}
												className="px-3 py-2 text-sm bg-muted text-text-2 rounded-sm hover:bg-surface hover:text-text-1 transition"
											>
												导入
											</button>
											<button
												onClick={handleCreatePromptNew}
												className="px-4 py-2 bg-primary text-white rounded-sm hover:bg-primary-ink transition"
											>
												+ 创建配置
											</button>
										</div>
									</div>

									<input
										ref={promptImportInputRef}
										type="file"
										accept="application/json"
										className="hidden"
										onChange={handleImportPromptConfigs}
									/>

									<div className="flex gap-2 mb-6">
										{PROMPT_TYPES.map((type) => (
											<button
												key={type.value}
												onClick={() => setSelectedPromptType(type.value)}
												className={`px-4 py-2 text-sm rounded-sm transition ${
													selectedPromptType === type.value
														? "bg-primary-soft text-primary-ink"
														: "bg-muted text-text-2 hover:bg-surface hover:text-text-1"
												}`}
											>
												{type.label}
											</button>
										))}
									</div>

									{promptLoading ? (
										<div className="text-center py-12 text-gray-500">
											加载中...
										</div>
									) : promptConfigs.filter((c) => c.type === selectedPromptType)
											.length === 0 ? (
										<div className="text-center py-12 text-gray-500">
											<div className="mb-4">
												暂无
												{
													PROMPT_TYPES.find(
														(t) => t.value === selectedPromptType,
													)?.label
												}
												配置
											</div>
											<button
												onClick={handleCreatePromptNew}
												className="px-4 py-2 bg-primary text-white rounded-sm hover:bg-primary-ink transition"
											>
												创建配置
											</button>
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
																	<h3 className="font-semibold text-gray-900">
																		{config.name}
																	</h3>
																	{config.is_default && (
																		<span className="ml-2 px-2 py-1 bg-blue-100 text-blue-700 rounded text-xs">
																			默认
																		</span>
																	)}
																	<span
																		className={`px-2 py-1 rounded text-xs ${
																			config.is_enabled
																				? "bg-green-100 text-green-700"
																				: "bg-gray-100 text-gray-600"
																		}`}
																	>
																		{config.is_enabled ? "启用" : "禁用"}
																	</span>
																</div>

																<div className="space-y-1 text-sm text-gray-600">
																	<div>
																		<span className="font-medium">分类：</span>
																		<span className="inline-flex items-center px-2 py-0.5 bg-gray-100 text-gray-700 rounded text-xs">
																			{config.category_name || "通用"}
																		</span>
																	</div>
																	{config.model_api_config_name && (
																		<div>
																			<span className="font-medium">
																				关联模型API：
																			</span>
																			<span>
																				{config.model_api_config_name}
																			</span>
																		</div>
																	)}
																	{config.system_prompt && (
																		<div>
																			<span className="font-medium">
																				系统提示词：
																			</span>
																			<code className="px-2 py-1 bg-gray-50 rounded text-xs block mt-1 max-h-20 overflow-y-auto">
																				{config.system_prompt.slice(0, 100)}
																				{config.system_prompt.length > 100
																					? "..."
																					: ""}
																			</code>
																		</div>
																	)}
																	<div>
																		<span className="font-medium">
																			提示词：
																		</span>
																		<code className="px-2 py-1 bg-gray-50 rounded text-xs block mt-1 max-h-20 overflow-y-auto">
																			{config.prompt.slice(0, 100)}
																			{config.prompt.length > 100 ? "..." : ""}
																		</code>
																	</div>
																	{(config.system_prompt ||
																		config.response_format ||
																		config.temperature != null ||
																		config.max_tokens != null ||
																		config.top_p != null) && (
																		<div className="flex flex-wrap gap-2 pt-1">
																			{config.response_format && (
																				<span className="px-2 py-1 bg-gray-50 text-gray-700 rounded text-xs">
																					响应格式: {config.response_format}
																				</span>
																			)}
																			{config.temperature != null && (
																				<span className="px-2 py-1 bg-gray-50 text-gray-700 rounded text-xs">
																					温度: {config.temperature}
																				</span>
																			)}
																			{config.max_tokens != null && (
																				<span className="px-2 py-1 bg-gray-50 text-gray-700 rounded text-xs">
																					最大Tokens: {config.max_tokens}
																				</span>
																			)}
																			{config.top_p != null && (
																				<span className="px-2 py-1 bg-gray-50 text-gray-700 rounded text-xs">
																					Top P: {config.top_p}
																				</span>
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
																	title="预览"
																>
																	<IconEye className="h-4 w-4" />
																</IconButton>
																<IconButton
																	onClick={() => handleEditPrompt(config)}
																	variant="primary"
																	size="sm"
																	title="编辑"
																>
																	<IconEdit className="h-4 w-4" />
																</IconButton>
																<IconButton
																	onClick={() => handleDeletePrompt(config.id)}
																	variant="danger"
																	size="sm"
																	title="删除"
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

							{activeSection === "categories" && (
								<div className="bg-white rounded-lg shadow-sm p-6">
									<div className="flex items-center justify-between mb-6">
										<h2 className="text-lg font-semibold text-gray-900">
											分类列表
										</h2>
										<button
											onClick={handleCreateCategoryNew}
											className="px-4 py-2 bg-primary text-white rounded-sm hover:bg-primary-ink transition"
										>
											+ 新增分类
										</button>
									</div>

									{categoryLoading ? (
										<div className="text-center py-12 text-gray-500">
											加载中...
										</div>
									) : categories.length === 0 ? (
										<div className="text-center py-12 text-gray-500">
											<div className="mb-4">暂无分类</div>
											<button
												onClick={handleCreateCategoryNew}
												className="px-4 py-2 bg-primary text-white rounded-sm hover:bg-primary-ink transition"
											>
												新增分类
											</button>
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
							<div className="bg-surface rounded-sm shadow-sm border border-border p-6">
								<div className="flex items-center justify-between mb-6">
									<div>
										<h2 className="text-lg font-semibold text-text-1">
											{commentSubSection === "keys" ? "登录密钥" : "过滤规则"}
										</h2>
										<p className="text-sm text-text-3">
											{commentSubSection === "keys"
												? "配置第三方登录并启用文章评论功能"
												: "配置评论敏感词过滤规则"}
										</p>
									</div>
										<div className="flex items-center gap-2">
											{commentSubSection === "keys" && (
												<button
													onClick={handleValidateCommentSettings}
													className="px-4 py-2 text-sm bg-muted text-text-2 rounded-sm hover:bg-surface hover:text-text-1 transition"
												>
													验证配置
												</button>
											)}
											<button
												onClick={handleSaveCommentSettings}
												disabled={commentSettingsSaving}
												className="px-4 py-2 text-sm bg-primary text-white rounded-sm hover:bg-primary-ink transition disabled:opacity-60"
											>
												{commentSettingsSaving ? "保存中..." : "保存配置"}
											</button>
										</div>
									</div>

											{commentSettingsLoading ? (
												<div className="text-center py-12 text-text-3">
													加载中...
												</div>
											) : (
												<div className="space-y-6">
													{commentSubSection === "keys" && (
														<>
											<div className="flex items-center justify-between border border-border rounded-sm p-4 bg-surface">
												<div>
													<div className="text-sm font-medium text-text-1">
														开启评论
													</div>
													<div className="text-xs text-text-3 mt-1">
														关闭后访客评论入口将隐藏
													</div>
												</div>
												<label className="inline-flex items-center gap-2 text-sm text-text-2 cursor-pointer">
													<input
														type="checkbox"
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
														{commentSettings.comments_enabled ? "已开启" : "已关闭"}
													</span>
												</label>
											</div>

											<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
												<div>
													<label className="block text-sm text-text-2 mb-1">
														GitHub Client ID
													</label>
													<input
														value={commentSettings.github_client_id}
														onChange={(e) =>
															setCommentSettings((prev) => ({
																...prev,
																github_client_id: e.target.value,
															}))
														}
														placeholder="填写 GitHub OAuth Client ID"
														className="w-full h-9 px-3 border border-border rounded-sm bg-surface text-text-2 text-sm placeholder:text-xs placeholder:text-text-3 shadow-sm focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent"
													/>
												</div>
												<div>
													<label className="block text-sm text-text-2 mb-1">
														GitHub Client Secret
													</label>
													<input
														type="password"
														value={commentSettings.github_client_secret}
														onChange={(e) =>
															setCommentSettings((prev) => ({
																...prev,
																github_client_secret: e.target.value,
															}))
														}
														placeholder="填写 GitHub OAuth Client Secret"
														className="w-full h-9 px-3 border border-border rounded-sm bg-surface text-text-2 text-sm placeholder:text-xs placeholder:text-text-3 shadow-sm focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent"
													/>
												</div>
												<div>
													<label className="block text-sm text-text-2 mb-1">
														Google Client ID
													</label>
													<input
														value={commentSettings.google_client_id}
														onChange={(e) =>
															setCommentSettings((prev) => ({
																...prev,
																google_client_id: e.target.value,
															}))
														}
														placeholder="填写 Google OAuth Client ID"
														className="w-full h-9 px-3 border border-border rounded-sm bg-surface text-text-2 text-sm placeholder:text-xs placeholder:text-text-3 shadow-sm focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent"
													/>
												</div>
												<div>
													<label className="block text-sm text-text-2 mb-1">
														Google Client Secret
													</label>
													<input
														type="password"
														value={commentSettings.google_client_secret}
														onChange={(e) =>
															setCommentSettings((prev) => ({
																...prev,
																google_client_secret: e.target.value,
															}))
														}
														placeholder="填写 Google OAuth Client Secret"
														className="w-full h-9 px-3 border border-border rounded-sm bg-surface text-text-2 text-sm placeholder:text-xs placeholder:text-text-3 shadow-sm focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent"
													/>
												</div>
											</div>

											<div>
												<label className="block text-sm text-text-2 mb-1">
													NextAuth Secret
												</label>
												<div className="flex gap-2">
													<input
														type="password"
														value={commentSettings.nextauth_secret}
														onChange={(e) =>
															setCommentSettings((prev) => ({
																...prev,
																nextauth_secret: e.target.value,
															}))
														}
														placeholder="用于签名会话的 Secret"
														className="flex-1 h-9 px-3 border border-border rounded-sm bg-surface text-text-2 text-sm placeholder:text-xs placeholder:text-text-3 shadow-sm focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent"
													/>
													<button
														type="button"
														onClick={handleGenerateNextAuthSecret}
														className="px-3 h-9 text-xs rounded-sm border border-border text-text-2 hover:text-text-1 hover:bg-muted transition"
													>
														自动生成
													</button>
												</div>
											</div>
														</>
													)}

													{commentSubSection === "filters" && (
														<>
															<div className="flex items-center justify-between border border-border rounded-sm p-4 bg-surface">
																<div>
																	<div className="text-sm font-medium text-text-1">
																		敏感词过滤
																	</div>
																	<div className="text-xs text-text-3 mt-1">
																		启用后将拦截包含敏感词的评论
																	</div>
																</div>
																<label className="inline-flex items-center gap-2 text-sm text-text-2 cursor-pointer">
																	<input
																		type="checkbox"
																		checked={commentSettings.sensitive_filter_enabled}
																		onChange={(e) =>
																			setCommentSettings((prev) => ({
																				...prev,
																				sensitive_filter_enabled: e.target.checked,
																			}))
																		}
																		className="h-4 w-4"
																	/>
																	<span>
																		{commentSettings.sensitive_filter_enabled ? "已开启" : "已关闭"}
																	</span>
																</label>
															</div>

															<div>
																<div className="flex items-center gap-2 mb-1">
																	<label className="block text-sm text-text-2">
																		敏感词列表
																	</label>
																	<div className="relative group">
																		<span className="h-5 w-5 rounded-full border border-border text-text-3 inline-flex items-center justify-center text-xs cursor-default">
																			?
																		</span>
																		<div className="pointer-events-none absolute left-1/2 top-full mt-2 -translate-x-1/2 whitespace-nowrap rounded-sm border border-border bg-surface px-2 py-1 text-xs text-text-2 shadow-sm opacity-0 group-hover:opacity-100 transition">
																			支持换行或逗号分隔
																		</div>
																	</div>
																</div>
																<textarea
																	value={commentSettings.sensitive_words}
																	onChange={(e) =>
																		setCommentSettings((prev) => ({
																			...prev,
																			sensitive_words: e.target.value,
																		}))
																	}
																	rows={4}
																	placeholder="每行一个敏感词，或使用逗号分隔"
																	className="w-full px-3 py-2 border border-border rounded-sm bg-surface text-text-2 text-sm placeholder:text-xs placeholder:text-text-3 shadow-sm focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent"
																/>
															</div>
														</>
													)}

											{commentSubSection === "keys" && commentValidationResult && (
												<div
													className={`rounded-sm border p-3 text-xs ${
														commentValidationResult.ok
															? "border-green-200 bg-green-50 text-green-700"
															: "border-red-200 bg-red-50 text-red-700"
													}`}
												>
													<div className="font-medium mb-1">
														{commentValidationResult.ok ? "校验通过" : "校验提示"}
													</div>
													<div className="space-y-1">
														{commentValidationResult.messages.map((item) => (
															<div key={item}>{item}</div>
														))}
													</div>
													{commentValidationResult.callbacks.length > 0 && (
														<div className="mt-2 text-text-2">
															<div className="font-medium mb-1">回调地址</div>
															<div className="space-y-1">
																{commentValidationResult.callbacks.map((item) => (
																	<div key={item} className="break-all">
																		{item}
																	</div>
																))}
															</div>
														</div>
													)}
												</div>
											)}
											{commentSubSection === "keys" && (
												<div className="text-xs text-text-3">
													保存后立即生效，如登录异常请检查 OAuth 回调地址配置。
												</div>
											)}

										</div>
									)}
								</div>
							)}

							{activeSection === "monitoring" && monitoringSubSection === "tasks" && (
								<div className="bg-white rounded-lg shadow-sm p-6">
									<div className="flex items-center justify-between mb-6">
										<div>
											<h2 className="text-lg font-semibold text-gray-900">
												AI 任务监控
											</h2>
											<p className="text-sm text-gray-500">
												查看、重试或取消后台任务
											</p>
										</div>
										<div className="flex items-center gap-2">
											<button
												onClick={() => {
													setTaskStatusFilter("");
													setTaskTypeFilter("");
													setTaskArticleTitleFilter("");
													setTaskPage(1);
												}}
												className="px-4 py-2 text-sm bg-muted text-text-2 rounded-sm hover:bg-surface hover:text-text-1 transition"
												disabled={!hasTaskFilters}
											>
												清空筛选
											</button>
											<button
												onClick={fetchTasks}
												className="px-4 py-2 text-sm bg-muted text-text-2 rounded-sm hover:bg-surface hover:text-text-1 transition"
											>
												刷新
											</button>
										</div>
									</div>

									<div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
										<FilterSelect
											label="状态"
											value={taskStatusFilter}
											onChange={(value) => {
												setTaskStatusFilter(value);
												setTaskPage(1);
											}}
											options={[
												{ value: "", label: "全部" },
												{ value: "pending", label: "待处理" },
												{ value: "processing", label: "处理中" },
												{ value: "completed", label: "已完成" },
												{ value: "failed", label: "失败" },
												{ value: "cancelled", label: "已取消" },
											]}
										/>
										<FilterSelect
											label="任务类型"
											value={taskTypeFilter}
											onChange={(value) => {
												setTaskTypeFilter(value);
												setTaskPage(1);
											}}
											options={[
												{ value: "", label: "全部" },
												{ value: "process_article_ai", label: "文章摘要" },
												{ value: "process_article_translation", label: "翻译生成" },
												{ value: "process_ai_content:summary", label: "AI摘要" },
												{ value: "process_ai_content:outline", label: "大纲生成" },
												{ value: "process_ai_content:quotes", label: "金句生成" },
												{ value: "process_ai_content:key_points", label: "总结生成" },
											]}
										/>
<ArticleSearchSelect
													label="文章名称"
													value={taskArticleTitleFilter}
													onChange={(value) => {
														setTaskArticleTitleFilter(value);
														setTaskPage(1);
													}}
													placeholder="输入文章名称搜索..."
												/>
									</div>

									{taskLoading ? (
										<div className="text-center py-12 text-gray-500">
											加载中...
										</div>
									) : taskItems.length === 0 ? (
										<div className="text-center py-12 text-gray-500">
											{hasTaskFilters ? "暂无匹配任务" : "暂无任务"}
										</div>
									) : (
										<div className="overflow-x-auto">
											<table className="min-w-full text-sm">
												<thead className="bg-gray-50 text-gray-600">
													<tr>
														<th className="text-left px-4 py-3">任务</th>
														<th className="text-left px-4 py-3">状态</th>
														<th className="text-left px-4 py-3">尝试</th>
														<th className="text-left px-4 py-3">文章</th>
														<th className="text-left px-4 py-3">时间</th>
														<th className="text-right px-4 py-3">操作</th>
													</tr>
												</thead>
												<tbody className="divide-y divide-gray-100">
													{taskItems.map((task) => (
														<tr key={task.id} className="hover:bg-gray-50">
															<td className="px-4 py-3">
																<div className="font-medium text-gray-900">
																	{getTaskTypeLabel(task)}生成
																</div>
															</td>
															<td className="px-4 py-3">
																<span
																	className={`px-2 py-1 rounded text-xs ${
																		task.status === "completed"
																			? "bg-green-100 text-green-700"
																			: task.status === "failed"
																				? "bg-red-100 text-red-700"
																				: task.status === "processing"
																					? "bg-blue-100 text-blue-700"
																					: task.status === "cancelled"
																						? "bg-gray-200 text-gray-600"
																						: "bg-yellow-100 text-yellow-700"
																	}`}
																>
																	{task.status === "completed"
																		? "已完成"
																		: task.status === "failed"
																			? "失败"
																			: task.status === "processing"
																				? "处理中"
																				: task.status === "cancelled"
																					? "已取消"
																					: "待处理"}
																</span>
																{task.last_error && (
																	<div
																		className="text-xs text-red-500 mt-1 line-clamp-1"
																		title={task.last_error}
																	>
																		{task.last_error}
																	</div>
																)}
															</td>
															<td className="px-4 py-3 text-gray-600">
																{task.attempts}/{task.max_attempts}
															</td>
															<td className="px-4 py-3 text-gray-600">
																{task.article_id ? (
																	<Link
																		href={`/article/${task.article_slug || task.article_id}`}
																		className="text-blue-600 hover:underline"
																		title={
																			task.article_title || task.article_id
																		}
																	>
																		{(() => {
																			const title =
																				task.article_title || "未知文章";
																			const chars = Array.from(title);
																			const truncated = chars
																				.slice(0, 10)
																				.join("");
																			return chars.length > 10
																				? `${truncated}...`
																				: truncated;
																		})()}
																	</Link>
																) : (
																	"-"
																)}
															</td>
															<td className="px-4 py-3 text-gray-500">
																<div>
																	创建：
																	{new Date(task.created_at).toLocaleString(
																		"zh-CN",
																	)}
																</div>
																{task.finished_at && (
																	<div>
																		完成：
																		{new Date(task.finished_at).toLocaleString(
																			"zh-CN",
																		)}
																	</div>
																)}
															</td>
															<td className="px-4 py-3 text-right">
																<div className="flex items-center justify-end gap-2">
																	<IconButton
																		onClick={() => handleRetryTask(task.id)}
																		variant="ghost"
																		size="sm"
																		title="重试"
																		disabled={task.status === "processing"}
																	>
																		<IconRefresh className="h-4 w-4" />
																	</IconButton>
																	<IconButton
																		onClick={() => handleCancelTask(task.id)}
																		variant="danger"
																		size="sm"
																		title="取消"
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
										<div className="flex items-center gap-2 text-sm text-gray-600">
											<span>每页显示</span>
											<Select
												value={taskPageSize}
												onChange={(value) => {
													setTaskPageSize(Number(value));
													setTaskPage(1);
												}}
												className="select-modern-antd"
												popupClassName="select-modern-dropdown"
												options={[
													{ value: 10, label: "10" },
													{ value: 20, label: "20" },
													{ value: 50, label: "50" },
												]}
											/>
											<span>条，共 {taskTotal} 条</span>
										</div>
										<div className="flex items-center gap-2">
											<Button
												onClick={() => setTaskPage((p) => Math.max(1, p - 1))}
												disabled={taskPage === 1}
												variant="secondary"
												size="sm"
											>
												上一页
											</Button>
											<span className="px-4 py-2 text-sm bg-surface border border-border rounded-sm text-text-2">
												第 {taskPage} /{" "}
												{Math.ceil(taskTotal / taskPageSize) || 1} 页
											</span>
											<Button
												onClick={() => setTaskPage((p) => p + 1)}
												disabled={taskPage * taskPageSize >= taskTotal}
												variant="secondary"
												size="sm"
											>
												下一页
											</Button>
										</div>
									</div>
								</div>
							)}

							{activeSection === "monitoring" &&
								monitoringSubSection === "comments" && (
									<div className="bg-surface rounded-sm shadow-sm border border-border p-6">
										<div className="flex items-center justify-between mb-6">
											<div>
												<h2 className="text-lg font-semibold text-text-1">
													评论列表
												</h2>
												<p className="text-sm text-text-3">
													查看与管理所有评论与回复
												</p>
											</div>
											<div className="flex items-center gap-2">
												<button
													onClick={resetCommentFilters}
													className="px-4 py-2 text-sm bg-muted text-text-2 rounded-sm hover:bg-surface hover:text-text-1 transition"
													disabled={!hasCommentFilters}
												>
													清空筛选
												</button>
												<button
													onClick={fetchCommentList}
													className="px-4 py-2 text-sm bg-muted text-text-2 rounded-sm hover:bg-surface hover:text-text-1 transition"
												>
													刷新
												</button>
											</div>
										</div>

										<div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
										<FilterInput
											label="关键词"
											value={commentQuery}
											onChange={(value) => {
												setCommentQuery(value);
												setCommentListPage(1);
											}}
											placeholder="搜索评论内容"
										/>
<ArticleSearchSelect
													label="文章名称"
													value={commentArticleTitle}
													onChange={(value) => {
														setCommentArticleTitle(value);
														setCommentListPage(1);
													}}
													placeholder="输入文章名称搜索..."
												/>
										<FilterInput
											label="评论人"
											value={commentAuthor}
											onChange={(value) => {
												setCommentAuthor(value);
												setCommentListPage(1);
											}}
											placeholder="评论人昵称"
										/>
										<FilterSelect
											label="可见性"
											value={commentVisibility}
											onChange={(value) => {
												setCommentVisibility(value);
												setCommentListPage(1);
											}}
											options={[
												{ value: "", label: "全部" },
												{ value: "visible", label: "可见" },
												{ value: "hidden", label: "已隐藏" },
											]}
										/>
										<FilterSelect
											label="类型"
											value={commentReplyFilter}
											onChange={(value) => {
												setCommentReplyFilter(value);
												setCommentListPage(1);
											}}
											options={[
												{ value: "", label: "全部" },
												{ value: "main", label: "主评论" },
												{ value: "reply", label: "回复" },
											]}
										/>
										<div>
											<label className="block text-sm text-text-2 mb-1.5">
												日期范围
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
											<div className="text-center py-12 text-text-3">
												加载中...
											</div>
										) : commentList.length === 0 ? (
											<div className="text-center py-12 text-text-3">
												{hasCommentFilters ? "暂无匹配评论" : "暂无评论"}
											</div>
										) : (
											<div className="overflow-x-auto">
												<table className="min-w-full text-sm">
										<thead className="bg-muted text-text-2">
												<tr>
													<th className="text-left px-4 py-3">时间</th>
													<th className="text-left px-4 py-3">内容</th>
													<th className="text-left px-4 py-3">作者</th>
													<th className="text-left px-4 py-3">文章</th>
													<th className="text-left px-4 py-3">类型</th>
													<th className="text-left px-4 py-3">状态</th>
													<th className="text-right px-4 py-3">操作</th>
												</tr>
											</thead>
										<tbody className="divide-y divide-border">
											{commentList.map((comment) => {
												return (
													<tr key={comment.id} className="hover:bg-muted/40">
														<td className="px-4 py-3 text-text-2 whitespace-nowrap">
															{new Date(comment.created_at).toLocaleString("zh-CN")}
														</td>
												<td className="px-4 py-3">
													<span
														onMouseEnter={(event) => {
															setHoverComment(comment);
															const rect = event.currentTarget.getBoundingClientRect();
															setHoverTooltipPos({
																x: rect.left,
																y: rect.bottom + 8,
															});
														}}
														onMouseLeave={() => {
															setHoverComment(null);
															setHoverTooltipPos(null);
														}}
														className="inline-flex items-center gap-1 text-sm text-accent cursor-pointer"
													>
														<IconEye className="h-3 w-3" />
														查看
													</span>
												</td>
															<td className="px-4 py-3">
																<div className="text-text-1">
																	{comment.user_name || "匿名"}
																</div>
																<div className="text-xs text-text-3">
																	{comment.provider || "-"}
																</div>
															</td>
												<td className="px-4 py-3">
													<Link
														href={`/article/${comment.article_slug || comment.article_id}#comment-${comment.id}`}
														className="inline-flex items-center gap-1 text-xs text-accent hover:underline"
														target="_blank"
													>
														<IconLink className="h-3 w-3" />
														查看
													</Link>
												</td>
															<td className="px-4 py-3">
																<span className="text-xs text-text-2 bg-muted px-2 py-1 rounded-sm">
																	{comment.reply_to_id ? "回复" : "主评论"}
																</span>
															</td>
															<td className="px-4 py-3">
																<span
																	className={`text-xs px-2 py-1 rounded-sm ${
																		comment.is_hidden
																			? "bg-red-50 text-red-600"
																			: "bg-green-50 text-green-600"
																	}`}
																>
																	{comment.is_hidden ? "已隐藏" : "可见"}
																</span>
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
																						comment.is_hidden ? "设为可见" : "设为隐藏"
																					}
																				>
																					<IconEye className="h-4 w-4" />
																				</IconButton>
																				<IconButton
																					onClick={() =>
																						handleDeleteCommentAdmin(comment.id)
																					}
																					variant="danger"
																					size="sm"
																					title="删除"
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
												<span>每页显示</span>
												<Select
													value={commentListPageSize}
													onChange={(value) => {
														setCommentListPageSize(Number(value));
														setCommentListPage(1);
													}}
													className="select-modern-antd"
													popupClassName="select-modern-dropdown"
													options={[
														{ value: 10, label: "10" },
														{ value: 20, label: "20" },
														{ value: 50, label: "50" },
													]}
												/>
												<span>条，共 {commentListTotal} 条</span>
											</div>
											<div className="flex items-center gap-2">
												<Button
													onClick={() =>
														setCommentListPage((p) => Math.max(1, p - 1))
													}
													disabled={commentListPage === 1}
													variant="secondary"
													size="sm"
												>
													上一页
												</Button>
												<span className="px-4 py-2 text-sm bg-surface border border-border rounded-sm text-text-2">
													第 {commentListPage} /{" "}
													{Math.ceil(commentListTotal / commentListPageSize) || 1} 页
												</span>
												<Button
													onClick={() => setCommentListPage((p) => p + 1)}
													disabled={commentListPage * commentListPageSize >= commentListTotal}
													variant="secondary"
													size="sm"
												>
													下一页
												</Button>
											</div>
									</div>
								</div>
							)}
					</main>

					{hoverComment && hoverTooltipPos && (
						<div
							className="fixed z-50 w-max max-w-md rounded-md text-sm px-4 py-3 shadow-lg backdrop-blur bg-surface border border-border"
							style={{ left: hoverTooltipPos.x, top: hoverTooltipPos.y }}
						>
							<p className="text-text-1 whitespace-pre-wrap">
								{stripReplyPrefix(hoverComment.content)}
							</p>
						</div>
					)}
					</div>
				</div>

				{showModelAPIModal && (
										<div
											className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
											onClick={() => {
												setShowModelAPIModal(false);
												setShowModelAPIAdvanced(false);
											}}
										>
						<div
							className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto"
							onClick={(event) => event.stopPropagation()}
						>
							<div className="flex items-center justify-between p-6 border-b">
								<h3 className="text-lg font-semibold text-gray-900">
									{editingModelAPIConfig
										? "编辑模型API配置"
										: "创建新模型API配置"}
								</h3>
												<button
													onClick={() => {
													setShowModelAPIModal(false);
													setShowModelAPIAdvanced(false);
												}}
												className="text-gray-500 hover:text-gray-700 text-2xl"
												>
									×
								</button>
							</div>

							<div className="p-6 space-y-4">
								<div>
									<label className="block text-sm font-medium text-gray-700 mb-2">
										配置名称
									</label>
									<input
										type="text"
										value={modelAPIFormData.name}
										onChange={(e) =>
											setModelAPIFormData({
												...modelAPIFormData,
												name: e.target.value,
											})
										}
										className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
										placeholder="OpenAI GPT-4o"
										required
									/>
								</div>

								<div>
									<label className="block text-sm font-medium text-gray-700 mb-2">
										API地址（Base URL）
									</label>
									<input
										type="text"
										value={modelAPIFormData.base_url}
										onChange={(e) =>
											setModelAPIFormData({
												...modelAPIFormData,
												base_url: e.target.value,
											})
										}
										className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
										placeholder="https://api.openai.com/v1"
									/>
								</div>

								<div>
									<label className="block text-sm font-medium text-gray-700 mb-2">
										API密钥
									</label>
									<input
										type="password"
										value={modelAPIFormData.api_key}
										onChange={(e) =>
											setModelAPIFormData({
												...modelAPIFormData,
												api_key: e.target.value,
											})
										}
										className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
										placeholder="sk-..."
										required
									/>
								</div>

								<div>
									<label className="block text-sm font-medium text-gray-700 mb-2">
										模型名称
									</label>
									{modelNameManual ? (
										<div className="flex items-center gap-2">
											<input
												type="text"
												value={modelAPIFormData.model_name}
												onChange={(e) =>
													setModelAPIFormData({
														...modelAPIFormData,
														model_name: e.target.value,
													})
												}
												className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
												placeholder="手动输入模型名称"
												required
											/>
											<button
												type="button"
												onClick={() => setModelNameManual(false)}
												className="px-3 py-2 text-sm bg-muted text-text-2 rounded-sm hover:bg-surface hover:text-text-1 transition"
												title="切换为选择"
											>
												<IconList className="h-4 w-4" />
											</button>
										</div>
									) : (
										<div className="flex items-center gap-2">
											<Select
												value={modelAPIFormData.model_name || undefined}
												onChange={(value) =>
													setModelAPIFormData({
														...modelAPIFormData,
														model_name: value,
													})
												}
												className="select-modern-antd w-full h-10"
												style={{ height: 40 }}
												popupClassName="select-modern-dropdown"
												placeholder="请选择模型"
												options={modelOptions.map((model) => ({
													value: model,
													label: model,
												}))}
												loading={modelOptionsLoading}
											/>
											<button
												type="button"
												onClick={() => setModelNameManual(true)}
												className="px-3 py-2 text-sm bg-muted text-text-2 rounded-sm hover:bg-surface hover:text-text-1 transition"
												title="手动输入"
											>
												<IconEdit className="h-4 w-4" />
											</button>
										</div>
									)}
									{modelOptionsError && (
										<p className="text-xs text-red-600 mt-2">
											{modelOptionsError}
										</p>
									)}
								</div>

							<div className="border border-gray-200 rounded-lg">
								<button
									type="button"
									onClick={() =>
										setShowModelAPIAdvanced(!showModelAPIAdvanced)
									}
									className="w-full flex items-center justify-between px-4 py-3 text-sm text-gray-700 hover:bg-gray-50"
								>
									<span>高级设置（可选）</span>
									<span className="text-gray-400">
										{showModelAPIAdvanced ? "收起" : "展开"}
									</span>
								</button>
								{showModelAPIAdvanced && (
									<div className="border-t border-gray-200 p-4 space-y-4">
										<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
											<div>
												<label className="block text-sm font-medium text-gray-700 mb-2">
													输入单价（每 1K tokens）
												</label>
												<input
													type="number"
													step="0.00001"
													value={modelAPIFormData.price_input_per_1k}
													onChange={(e) =>
														setModelAPIFormData({
															...modelAPIFormData,
															price_input_per_1k: e.target.value,
														})
													}
													className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
													placeholder="0.00000"
												/>
											</div>
											<div>
												<label className="block text-sm font-medium text-gray-700 mb-2">
													输出单价（每 1K tokens）
												</label>
												<input
													type="number"
													step="0.00001"
													value={modelAPIFormData.price_output_per_1k}
													onChange={(e) =>
														setModelAPIFormData({
															...modelAPIFormData,
															price_output_per_1k: e.target.value,
														})
													}
													className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
													placeholder="0.00000"
												/>
											</div>
										</div>

										<div>
											<label className="block text-sm font-medium text-gray-700 mb-2">
												币种
											</label>
											<Select
												value={modelAPIFormData.currency || ""}
												onChange={(value) =>
													setModelAPIFormData({
														...modelAPIFormData,
														currency: value,
													})
												}
												className="select-modern-antd w-full"
												popupClassName="select-modern-dropdown"
												options={CURRENCY_OPTIONS}
											/>
										</div>
									</div>
								)}
							</div>

								<div className="flex items-center gap-4">
									<label className="flex items-center gap-2">
										<input
											type="checkbox"
											checked={modelAPIFormData.is_enabled}
											onChange={(e) =>
												setModelAPIFormData({
													...modelAPIFormData,
													is_enabled: e.target.checked,
												})
											}
											className="w-4 h-4 text-blue-600 rounded"
										/>
										<span className="text-sm text-gray-700">启用此配置</span>
									</label>

									<label className="flex items-center gap-2">
										<input
											type="checkbox"
											checked={modelAPIFormData.is_default}
											onChange={(e) =>
												setModelAPIFormData({
													...modelAPIFormData,
													is_default: e.target.checked,
												})
											}
											className="w-4 h-4 text-blue-600 rounded"
										/>
										<span className="text-sm text-gray-700">设为默认配置</span>
									</label>
								</div>
							</div>

							<div className="flex justify-end gap-2 p-6 border-t bg-gray-50">
										<button
											onClick={() => {
												setShowModelAPIModal(false);
												setShowModelAPIAdvanced(false);
											}}
											className="px-4 py-2 bg-muted text-text-2 rounded-sm hover:bg-surface hover:text-text-1 transition"
										>
									取消
								</button>
								<button
									onClick={handleSaveModelAPI}
									className="px-4 py-2 bg-primary text-white rounded-sm hover:bg-primary-ink transition"
								>
									{editingModelAPIConfig ? "保存" : "创建"}
								</button>
							</div>
						</div>
					</div>
								)}

								{showUsagePayloadModal && (
									<div
										className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
										onClick={() => setShowUsagePayloadModal(false)}
									>
										<div
											className="bg-white rounded-lg shadow-xl max-w-3xl w-full max-h-[90vh] overflow-y-auto"
											onClick={(event) => event.stopPropagation()}
										>
											<div className="flex items-center justify-between p-6 border-b">
												<div className="flex items-center gap-2">
													<h3 className="text-lg font-semibold text-gray-900">
														{usagePayloadTitle}
													</h3>
													<button
														onClick={handleCopyPayload}
														className="p-2 text-text-2 rounded-sm hover:bg-surface hover:text-text-1 transition"
														aria-label="复制"
													>
														<IconCopy className="h-4 w-4" />
													</button>
												</div>
												<button
													onClick={() => setShowUsagePayloadModal(false)}
													className="text-gray-500 hover:text-gray-700 text-2xl"
												>
													×
												</button>
											</div>
											<div className="p-6">
												<pre className="text-xs text-gray-800 whitespace-pre-wrap bg-gray-50 border border-gray-200 rounded-lg p-4">
													{usagePayloadContent}
												</pre>
											</div>
										</div>
									</div>
								)}

								{showUsageCostModal && (
									<div
										className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
										onClick={() => setShowUsageCostModal(false)}
									>
										<div
											className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto"
											onClick={(event) => event.stopPropagation()}
										>
											<div className="flex items-center justify-between p-6 border-b">
												<h3 className="text-lg font-semibold text-gray-900">
													{usageCostTitle}
												</h3>
												<button
													onClick={() => setShowUsageCostModal(false)}
													className="text-gray-500 hover:text-gray-700 text-2xl"
												>
													×
												</button>
											</div>
											<div className="p-6">
												<pre className="text-xs text-gray-800 whitespace-pre-wrap bg-gray-50 border border-gray-200 rounded-lg p-4">
													{usageCostDetails}
												</pre>
											</div>
										</div>
									</div>
								)}

								{showPromptModal && (
									<div
										className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
						onClick={() => setShowPromptModal(false)}
					>
						<div
							className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto"
							onClick={(event) => event.stopPropagation()}
						>
							<div className="flex items-center justify-between p-6 border-b">
								<h3 className="text-lg font-semibold text-gray-900">
									{editingPromptConfig ? "编辑提示词配置" : "创建新提示词配置"}
								</h3>
								<button
									onClick={() => setShowPromptModal(false)}
									className="text-gray-500 hover:text-gray-700 text-2xl"
								>
									×
								</button>
							</div>

							<div className="p-6 space-y-4">
								<div>
									<label className="block text-sm font-medium text-gray-700 mb-2">
										配置名称
									</label>
									<input
										type="text"
										value={promptFormData.name}
										onChange={(e) =>
											setPromptFormData({
												...promptFormData,
												name: e.target.value,
											})
										}
										className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
										placeholder="文章摘要提示词"
										required
									/>
								</div>

								<div>
									<label className="block text-sm font-medium text-gray-700 mb-2">
										分类
									</label>
									<Select
										value={promptFormData.category_id}
										onChange={(value) =>
											setPromptFormData({
												...promptFormData,
												category_id: value,
											})
										}
										className="select-modern-antd w-full"
										popupClassName="select-modern-dropdown"
										options={[
											{ value: "", label: "通用" },
											...categories.map((cat) => ({
												value: cat.id,
												label: cat.name,
											})),
										]}
									/>
								</div>

								<div>
									<label className="block text-sm font-medium text-gray-700 mb-2">
										系统提示词
									</label>
									<textarea
										value={promptFormData.system_prompt}
										onChange={(e) =>
											setPromptFormData({
												...promptFormData,
												system_prompt: e.target.value,
											})
										}
										rows={4}
										className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
										placeholder="系统级约束，例如：你是一个严谨的内容分析助手..."
										required
									/>
								</div>

								<div>
									<label className="block text-sm font-medium text-gray-700 mb-2">
										提示词
									</label>
									<textarea
										value={promptFormData.prompt}
										onChange={(e) =>
											setPromptFormData({
												...promptFormData,
												prompt: e.target.value,
											})
										}
										rows={6}
										className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
										placeholder="请为以下文章生成摘要..."
										required
									/>
								</div>

								<div className="border border-gray-200 rounded-lg">
									<button
										type="button"
										onClick={() => setShowPromptAdvanced(!showPromptAdvanced)}
										className="w-full flex items-center justify-between px-4 py-3 text-sm text-gray-700 hover:bg-gray-50"
									>
										<span>高级设置（可选）</span>
										<span className="text-gray-400">
											{showPromptAdvanced ? "收起" : "展开"}
										</span>
									</button>
									{showPromptAdvanced && (
										<div className="border-t border-gray-200 p-4 space-y-4">
											<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
												<div>
													<label className="block text-sm font-medium text-gray-700 mb-2">
														响应格式
													</label>
													<Select
														value={promptFormData.response_format}
														onChange={(value) =>
															setPromptFormData({
																...promptFormData,
																response_format: value,
															})
														}
														className="select-modern-antd w-full"
														popupClassName="select-modern-dropdown"
														options={[
															{ value: "", label: "默认" },
															{ value: "text", label: "text" },
															{ value: "json_object", label: "json_object" },
														]}
													/>
												</div>

												<div>
													<label className="block text-sm font-medium text-gray-700 mb-2">
														温度
													</label>
													<input
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
														className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
														placeholder="0.7"
													/>
												</div>

												<div>
													<label className="block text-sm font-medium text-gray-700 mb-2">
														最大 Tokens
													</label>
													<input
														type="number"
														min="1"
														value={promptFormData.max_tokens}
														onChange={(e) =>
															setPromptFormData({
																...promptFormData,
																max_tokens: e.target.value,
															})
														}
														className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
														placeholder="1200"
													/>
												</div>

												<div>
													<label className="block text-sm font-medium text-gray-700 mb-2">
														Top P
													</label>
													<input
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
														className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
														placeholder="1.0"
													/>
												</div>
											</div>
										</div>
									)}
								</div>

								<div>
									<label className="block text-sm font-medium text-gray-700 mb-2">
										关联模型API配置（可选）
									</label>
									<Select
										value={promptFormData.model_api_config_id}
										onChange={(value) =>
											setPromptFormData({
												...promptFormData,
												model_api_config_id: value,
											})
										}
										className="select-modern-antd w-full"
										popupClassName="select-modern-dropdown"
										options={[
											{ value: "", label: "使用默认" },
											...modelAPIConfigs.map((config) => ({
												value: config.id,
												label: config.name,
											})),
										]}
									/>
								</div>

								<div className="flex items-center gap-4">
									<label className="flex items-center gap-2">
										<input
											type="checkbox"
											checked={promptFormData.is_enabled}
											onChange={(e) =>
												setPromptFormData({
													...promptFormData,
													is_enabled: e.target.checked,
												})
											}
											className="w-4 h-4 text-blue-600 rounded"
										/>
										<span className="text-sm text-gray-700">启用此配置</span>
									</label>

									<label className="flex items-center gap-2">
										<input
											type="checkbox"
											checked={promptFormData.is_default}
											onChange={(e) =>
												setPromptFormData({
													...promptFormData,
													is_default: e.target.checked,
												})
											}
											className="w-4 h-4 text-blue-600 rounded"
										/>
										<span className="text-sm text-gray-700">设为默认配置</span>
									</label>
								</div>
							</div>

							<div className="flex justify-end gap-2 p-6 border-t bg-gray-50">
								<button
									onClick={() => setShowPromptModal(false)}
									className="px-4 py-2 bg-muted text-text-2 rounded-sm hover:bg-surface hover:text-text-1 transition"
								>
									取消
								</button>
								<button
									onClick={handleSavePrompt}
									className="px-4 py-2 bg-primary text-white rounded-sm hover:bg-primary-ink transition"
								>
									{editingPromptConfig ? "保存" : "创建"}
								</button>
							</div>
						</div>
					</div>
				)}

				{/* Category Modal */}
				{showCategoryModal && (
					<div
						className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
						onClick={() => setShowCategoryModal(false)}
					>
						<div
							className="bg-white rounded-lg shadow-xl max-w-md w-full max-h-[90vh] overflow-y-auto"
							onClick={(event) => event.stopPropagation()}
						>
							<div className="flex items-center justify-between p-6 border-b">
								<h3 className="text-lg font-semibold text-gray-900">
									{editingCategory ? "编辑分类" : "新增分类"}
								</h3>
								<button
									onClick={() => setShowCategoryModal(false)}
									className="text-gray-500 hover:text-gray-700 text-2xl"
								>
									×
								</button>
							</div>

							<div className="p-6 space-y-4">
								<div>
									<label className="block text-sm font-medium text-gray-700 mb-2">
										分类名称
									</label>
									<input
										type="text"
										value={categoryFormData.name}
										onChange={(e) =>
											setCategoryFormData({
												...categoryFormData,
												name: e.target.value,
											})
										}
										className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
										required
									/>
								</div>

								<div>
									<label className="block text-sm font-medium text-gray-700 mb-2">
										描述
									</label>
									<textarea
										value={categoryFormData.description}
										onChange={(e) =>
											setCategoryFormData({
												...categoryFormData,
												description: e.target.value,
											})
										}
										rows={3}
										className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
									/>
								</div>

								<div>
									<label className="block text-sm font-medium text-gray-700 mb-2">
										颜色
									</label>
									<div className="grid grid-cols-10 gap-2">
										{PRESET_COLORS.map((color) => (
											<button
												key={color}
												type="button"
												onClick={() =>
													setCategoryFormData({ ...categoryFormData, color })
												}
												className={`w-8 h-8 rounded-lg transition ${
													categoryFormData.color === color
														? "ring-2 ring-offset-2 ring-blue-500"
														: "hover:scale-110"
												}`}
												style={{ backgroundColor: color }}
											/>
										))}
									</div>
								</div>
							</div>

							<div className="flex justify-end gap-2 p-6 border-t bg-gray-50">
								<button
									onClick={() => setShowCategoryModal(false)}
									className="px-4 py-2 bg-muted text-text-2 rounded-sm hover:bg-surface hover:text-text-1 transition"
								>
									取消
								</button>
								<button
									onClick={handleSaveCategory}
									className="px-4 py-2 bg-primary text-white rounded-sm hover:bg-primary-ink transition"
								>
									{editingCategory ? "保存" : "创建"}
								</button>
							</div>
						</div>
					</div>
				)}

				{showPromptPreview && (
					<div
						className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
						onClick={() => setShowPromptPreview(null)}
					>
						<div
							className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto"
							onClick={(event) => event.stopPropagation()}
						>
							<div className="flex items-center justify-between p-6 border-b">
								<h3 className="text-lg font-semibold text-gray-900">
									提示词预览 - {showPromptPreview.name}
								</h3>
								<button
									onClick={() => setShowPromptPreview(null)}
									className="text-gray-500 hover:text-gray-700 text-2xl"
								>
									×
								</button>
							</div>

							<div className="p-6 space-y-4">
								<div className="flex flex-wrap gap-2">
									<span className="px-2 py-1 bg-blue-100 text-blue-700 rounded text-sm">
										{PROMPT_TYPES.find(
											(t) => t.value === showPromptPreview.type,
										)?.label || showPromptPreview.type}
									</span>
									<span className="px-2 py-1 bg-gray-100 text-gray-700 rounded text-sm">
										分类: {showPromptPreview.category_name || "通用"}
									</span>
									{showPromptPreview.model_api_config_name && (
										<span className="px-2 py-1 bg-blue-100 text-blue-700 rounded text-sm">
											模型: {showPromptPreview.model_api_config_name}
										</span>
									)}
								</div>

								<div>
									<label className="block text-sm font-medium text-gray-700 mb-2">
										系统提示词
									</label>
									<pre className="w-full p-4 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-800 whitespace-pre-wrap font-mono">
										{showPromptPreview.system_prompt || "未设置（必填）"}
									</pre>
								</div>

								<div>
									<label className="block text-sm font-medium text-gray-700 mb-2">
										提示词
									</label>
									<pre className="w-full p-4 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-800 whitespace-pre-wrap font-mono">
										{showPromptPreview.prompt}
									</pre>
								</div>

								<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
									<div className="p-3 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-700">
										<div className="text-xs text-gray-500">响应格式</div>
										<div>{showPromptPreview.response_format || "默认"}</div>
									</div>
									<div className="p-3 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-700">
										<div className="text-xs text-gray-500">温度</div>
										<div>{showPromptPreview.temperature ?? "默认"}</div>
									</div>
									<div className="p-3 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-700">
										<div className="text-xs text-gray-500">最大 Tokens</div>
										<div>{showPromptPreview.max_tokens ?? "默认"}</div>
									</div>
									<div className="p-3 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-700">
										<div className="text-xs text-gray-500">Top P</div>
										<div>{showPromptPreview.top_p ?? "默认"}</div>
									</div>
								</div>
							</div>

							<div className="flex justify-end gap-2 p-6 border-t bg-gray-50">
								<button
									onClick={() => {
										handleEditPrompt(showPromptPreview);
										setShowPromptPreview(null);
									}}
									className="px-4 py-2 bg-primary text-white rounded-sm hover:bg-primary-ink transition"
								>
									编辑此配置
								</button>
								<button
									onClick={() => setShowPromptPreview(null)}
									className="px-4 py-2 bg-muted text-text-2 rounded-sm hover:bg-surface hover:text-text-1 transition"
								>
									关闭
								</button>
							</div>
						</div>
					</div>
				)}

				{showModelAPITestModal && (
					<div
						className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
						onClick={() => setShowModelAPITestModal(false)}
					>
						<div
							className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto"
							onClick={(event) => event.stopPropagation()}
						>
							<div className="flex items-center justify-between p-6 border-b">
								<div>
									<h3 className="text-lg font-semibold text-gray-900">
										模型连接测试
									</h3>
									{modelAPITestConfig && (
										<p className="text-sm text-gray-500 mt-1">
											{modelAPITestConfig.name} ·{" "}
											{modelAPITestConfig.model_name}
										</p>
									)}
								</div>
								<button
									onClick={() => setShowModelAPITestModal(false)}
									className="text-gray-500 hover:text-gray-700 text-2xl"
								>
									×
								</button>
							</div>

							<div className="p-6 space-y-4">
								<div>
									<label className="block text-sm font-medium text-gray-700 mb-2">
										测试输入
									</label>
									<textarea
										value={modelAPITestPrompt}
										onChange={(e) => setModelAPITestPrompt(e.target.value)}
										rows={4}
										className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
										placeholder="请输入要发送给模型的内容"
									/>
								</div>

								<div>
									<label className="block text-sm font-medium text-gray-700 mb-2">
										返回结果
									</label>
									<div className="w-full p-4 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-800 whitespace-pre-wrap min-h-[120px]">
										{modelAPITestLoading
											? "调用中..."
											: modelAPITestError
												? modelAPITestError
												: modelAPITestResult || "暂无返回"}
									</div>
								</div>

								{modelAPITestError && (
									<div>
										<label className="block text-sm font-medium text-gray-700 mb-2">
											原始响应
										</label>
										<pre className="w-full p-4 bg-gray-50 border border-gray-200 rounded-lg text-xs text-gray-800 whitespace-pre-wrap max-h-64 overflow-y-auto">
											{modelAPITestRaw || "暂无原始响应"}
										</pre>
									</div>
								)}
							</div>

							<div className="flex justify-end gap-2 p-6 border-t bg-gray-50">
								<button
									onClick={() => setShowModelAPITestModal(false)}
									className="px-4 py-2 bg-muted text-text-2 rounded-sm hover:bg-surface hover:text-text-1 transition"
								>
									关闭
								</button>
								<button
									onClick={handleRunModelAPITest}
									disabled={modelAPITestLoading}
									className="px-4 py-2 bg-primary text-white rounded-sm hover:bg-primary-ink transition disabled:opacity-50 disabled:cursor-not-allowed"
								>
									{modelAPITestLoading ? "调用中..." : "开始测试"}
								</button>
							</div>
						</div>
					</div>
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
				onCancel={() =>
					setConfirmState((prev) => ({ ...prev, isOpen: false }))
				}
			/>
			<AppFooter />
		</div>
	);
}
