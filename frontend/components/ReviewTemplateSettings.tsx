import { useEffect, useMemo, useRef, useState } from "react";
import dayjs from "dayjs";

import Button from "@/components/Button";
import ConfirmModal from "@/components/ConfirmModal";
import IconButton from "@/components/IconButton";
import ModalShell from "@/components/ui/ModalShell";
import StatusTag from "@/components/ui/StatusTag";
import CheckboxInput from "@/components/ui/CheckboxInput";
import FormField from "@/components/ui/FormField";
import SelectField from "@/components/ui/SelectField";
import SectionToggleButton from "@/components/ui/SectionToggleButton";
import TextArea from "@/components/ui/TextArea";
import TextInput from "@/components/ui/TextInput";
import { IconCopy, IconEdit, IconEye, IconRefresh, IconTrash } from "@/components/icons";
import { useToast } from "@/components/Toast";
import {
	articleApi,
	categoryApi,
	type Category,
	type ModelAPIConfig,
	type ReviewScheduleType,
	type ReviewTemplateInputMode,
	type ReviewTemplate,
	reviewApi,
} from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import {
	filterReviewTemplateModelOptions,
	buildReviewTaskMonitorUrl,
	REVIEW_TEMPLATE_HELP_VIEWPORT_PADDING,
	REVIEW_TEMPLATE_HELP_PANEL_WIDTH,
	REVIEW_TEMPLATE_MODAL_PANEL_CLASSNAME,
	resolveReviewTemplateHelpPlacement,
	resolveReviewTemplateDefaultTimezone,
	shouldShowReviewTemplateModalRunAction,
} from "@/lib/reviewTemplate";

type ReviewTemplateFormState = {
	name: string;
	description: string;
	is_enabled: boolean;
	schedule_type: ReviewScheduleType;
	custom_interval_days: string;
	anchor_date: string;
	timezone: string;
	trigger_time: string;
	include_all_categories: boolean;
	category_ids: string[];
	model_api_config_id: string;
	review_input_mode: ReviewTemplateInputMode;
	system_prompt: string;
	prompt_template: string;
	temperature: string;
	max_tokens: string;
	top_p: string;
	title_template: string;
};

type ReviewTemplateModalMode = "create" | "edit" | "duplicate";

const DEFAULT_PROMPT = `你是一名技术内容编辑，请为本期内容生成回顾草稿。

输出要求：
1. 写一段开场导语。
2. 写一段本期总结，提炼趋势与重点。
3. 如有需要，可在导语与总结之间补充 1-2 个简短过渡小节，但整体保持克制。
4. 不要输出文章列表、分类标题或任何文章占位标记，这部分会由系统按分类自动插入。
5. 不要额外新增“相关文章”“延伸阅读”等自定义列表区块。
6. 使用 Markdown 输出，不要输出代码块围栏。`;

const DEFAULT_SYSTEM_PROMPT =
	"你是一名技术内容主编，擅长把一组文章整理成结构清晰、判断克制、可直接发布前再润色的中文回顾草稿。";

const createEmptyForm = (): ReviewTemplateFormState => ({
	name: "",
	description: "",
	is_enabled: true,
	schedule_type: "weekly",
	custom_interval_days: "7",
	anchor_date: new Date().toISOString().slice(0, 10),
	timezone: resolveReviewTemplateDefaultTimezone(() =>
		typeof window === "undefined"
			? undefined
			: Intl.DateTimeFormat().resolvedOptions().timeZone,
	),
	trigger_time: "09:00",
	include_all_categories: true,
	category_ids: [],
	model_api_config_id: "",
	review_input_mode: "abstract",
	system_prompt: DEFAULT_SYSTEM_PROMPT,
	prompt_template: DEFAULT_PROMPT,
	temperature: "",
	max_tokens: "",
	top_p: "",
	title_template: "{period_label} 回顾",
});

const getScheduleLabel = (
	template: ReviewTemplate | ReviewTemplateFormState,
	t: (key: string) => string,
) => {
	if (template.schedule_type === "weekly") return t("按周");
	if (template.schedule_type === "monthly") return t("按月");
	return `${t("每")} ${template.custom_interval_days || 7} ${t("天")}`;
};

const formatTriggerDateTime = (value?: string | null, fallback = "暂无") => {
	if (!value) return fallback;
	const parsed = dayjs(value);
	return parsed.isValid() ? parsed.format("YYYY-MM-DD HH:mm:ss") : value;
};

const cloneTemplateToForm = (template: ReviewTemplate): ReviewTemplateFormState => ({
	name: template.name,
	description: template.description || "",
	is_enabled: template.is_enabled,
	schedule_type: template.schedule_type,
	custom_interval_days: String(template.custom_interval_days || 7),
	anchor_date: template.anchor_date,
	timezone: template.timezone,
	trigger_time: template.trigger_time,
	include_all_categories: template.include_all_categories,
	category_ids: template.category_ids,
	model_api_config_id: template.model_api_config_id || "",
	review_input_mode: template.review_input_mode || "summary",
	system_prompt: template.system_prompt || DEFAULT_SYSTEM_PROMPT,
	prompt_template: template.prompt_template,
	temperature: template.temperature?.toString() || "",
	max_tokens: template.max_tokens?.toString() || "",
	top_p: template.top_p?.toString() || "",
	title_template: template.title_template,
});

export default function ReviewTemplateSettings() {
	const { t } = useI18n();
	const { showToast } = useToast();
	const [templates, setTemplates] = useState<ReviewTemplate[]>([]);
	const [categories, setCategories] = useState<Category[]>([]);
	const [modelConfigs, setModelConfigs] = useState<ModelAPIConfig[]>([]);
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [runningTemplateId, setRunningTemplateId] = useState<string | null>(null);
	const [showModal, setShowModal] = useState(false);
	const [modalMode, setModalMode] = useState<ReviewTemplateModalMode>("create");
	const [activeTemplate, setActiveTemplate] = useState<ReviewTemplate | null>(null);
	const [previewTemplate, setPreviewTemplate] = useState<ReviewTemplate | null>(null);
	const [showTitleTemplateHelp, setShowTitleTemplateHelp] = useState(false);
	const [titleTemplateHelpPosition, setTitleTemplateHelpPosition] = useState<{
		left: number;
		top: number;
	} | null>(null);
	const [form, setForm] = useState<ReviewTemplateFormState>(createEmptyForm());
	const [confirmDeleteTemplate, setConfirmDeleteTemplate] = useState<ReviewTemplate | null>(null);
	const [showAdvancedSettings, setShowAdvancedSettings] = useState(false);
	const titleTemplateHelpRef = useRef<HTMLDivElement | null>(null);
	const titleTemplateHelpButtonRef = useRef<HTMLButtonElement | null>(null);
	const titleTemplateHelpPanelRef = useRef<HTMLDivElement | null>(null);

	const categoryOptions = useMemo(
		() => categories.map((category) => ({ value: category.id, label: category.name })),
		[categories],
	);

	const modelOptions = useMemo(
		() => [
			{ value: "", label: t("默认模型") },
			...modelConfigs.map((config) => ({
				value: config.id,
				label: `${config.name} · ${config.model_name}`,
			})),
		],
		[modelConfigs, t],
	);

	const loadData = async () => {
		const [templateData, categoryData, modelData] = await Promise.all([
			reviewApi.getTemplates(),
			categoryApi.getCategories(),
			articleApi.getModelAPIConfigs(),
		]);
		setTemplates(templateData);
		setCategories(categoryData);
		setModelConfigs(filterReviewTemplateModelOptions(modelData as ModelAPIConfig[]));
	};

	useEffect(() => {
		let active = true;
		const bootstrap = async () => {
			setLoading(true);
			try {
				await loadData();
			} catch (error) {
				console.error("Failed to load review templates:", error);
				if (active) showToast(t("回顾配置加载失败"), "error");
			} finally {
				if (active) setLoading(false);
			}
		};
		void bootstrap();
		return () => {
			active = false;
		};
	}, [showToast, t]);

	useEffect(() => {
		if (!showTitleTemplateHelp) return;
		const handleClickOutside = (event: MouseEvent) => {
			if (
				titleTemplateHelpRef.current &&
				!titleTemplateHelpRef.current.contains(event.target as Node)
			) {
				setShowTitleTemplateHelp(false);
			}
		};
		document.addEventListener("mousedown", handleClickOutside);
		return () => document.removeEventListener("mousedown", handleClickOutside);
	}, [showTitleTemplateHelp]);

	useEffect(() => {
		if (!showTitleTemplateHelp) {
			setTitleTemplateHelpPosition(null);
			return;
		}

		const updateHelpPosition = () => {
			if (
				typeof window === "undefined" ||
				!titleTemplateHelpButtonRef.current ||
				!titleTemplateHelpPanelRef.current
			) {
				return;
			}

			const triggerRect = titleTemplateHelpButtonRef.current.getBoundingClientRect();
			const panelRect = titleTemplateHelpPanelRef.current.getBoundingClientRect();
			const dialogRect = titleTemplateHelpRef.current
				?.closest('[role="dialog"]')
				?.getBoundingClientRect();
			setTitleTemplateHelpPosition(
				resolveReviewTemplateHelpPlacement({
					triggerRect: {
						top: triggerRect.top,
						left: triggerRect.left,
						width: triggerRect.width,
						height: triggerRect.height,
					},
					panelWidth: panelRect.width || REVIEW_TEMPLATE_HELP_PANEL_WIDTH,
					panelHeight: panelRect.height || 0,
					viewport: {
						width: window.innerWidth,
						height: window.innerHeight,
					},
					bounds: dialogRect
						? {
								left: dialogRect.left + REVIEW_TEMPLATE_HELP_VIEWPORT_PADDING,
								top: dialogRect.top + REVIEW_TEMPLATE_HELP_VIEWPORT_PADDING,
								right: dialogRect.right - REVIEW_TEMPLATE_HELP_VIEWPORT_PADDING,
								bottom: dialogRect.bottom - REVIEW_TEMPLATE_HELP_VIEWPORT_PADDING,
							}
						: undefined,
				}),
			);
		};

		updateHelpPosition();
		window.addEventListener("resize", updateHelpPosition);
		window.addEventListener("scroll", updateHelpPosition, true);
		return () => {
			window.removeEventListener("resize", updateHelpPosition);
			window.removeEventListener("scroll", updateHelpPosition, true);
		};
	}, [showTitleTemplateHelp]);

	const openCreateModal = () => {
		setModalMode("create");
		setActiveTemplate(null);
		setShowTitleTemplateHelp(false);
		setTitleTemplateHelpPosition(null);
		setShowAdvancedSettings(false);
		setForm(createEmptyForm());
		setShowModal(true);
	};

	const openEditModal = (template: ReviewTemplate) => {
		setModalMode("edit");
		setActiveTemplate(template);
		setShowTitleTemplateHelp(false);
		setTitleTemplateHelpPosition(null);
		setShowAdvancedSettings(false);
		setForm(cloneTemplateToForm(template));
		setShowModal(true);
	};

	const openDuplicateModal = (template: ReviewTemplate) => {
		setModalMode("duplicate");
		setActiveTemplate(null);
		setShowTitleTemplateHelp(false);
		setTitleTemplateHelpPosition(null);
		setShowAdvancedSettings(false);
		setForm({
			...cloneTemplateToForm(template),
			name: `${template.name} ${t("副本")}`,
		});
		setShowModal(true);
	};

	const handleSave = async () => {
		setSaving(true);
		const payload = {
			name: form.name,
			description: form.description,
			is_enabled: form.is_enabled,
			schedule_type: form.schedule_type,
			custom_interval_days:
				form.schedule_type === "custom_days" ? Number(form.custom_interval_days || 7) : null,
			anchor_date: form.anchor_date,
			timezone: form.timezone,
			trigger_time: form.trigger_time,
			include_all_categories: form.include_all_categories,
			category_ids: form.include_all_categories ? [] : form.category_ids,
			model_api_config_id: form.model_api_config_id || null,
			review_input_mode: form.review_input_mode,
			system_prompt: form.system_prompt.trim() || null,
			prompt_template: form.prompt_template,
			temperature: form.temperature.trim() ? Number(form.temperature) : null,
			max_tokens: form.max_tokens.trim() ? Number(form.max_tokens) : null,
			top_p: form.top_p.trim() ? Number(form.top_p) : null,
			title_template: form.title_template,
		};
		try {
			if (modalMode === "edit" && activeTemplate) {
				await reviewApi.updateTemplate(activeTemplate.id, payload);
			} else {
				await reviewApi.createTemplate(payload);
			}
				await loadData();
				setShowModal(false);
				setActiveTemplate(null);
				setShowTitleTemplateHelp(false);
				setTitleTemplateHelpPosition(null);
				showToast(t("回顾配置已保存"), "success");
		} catch (error) {
			console.error("Failed to save review template:", error);
			showToast(t("回顾配置保存失败"), "error");
		} finally {
			setSaving(false);
		}
	};

	const handleRunNow = async (template: ReviewTemplate) => {
		setRunningTemplateId(template.id);
		try {
			const result = await reviewApi.runTemplateNow(template.id);
			showToast(t("回顾生成任务已提交"), "success");
			window.location.assign(buildReviewTaskMonitorUrl(result.task_id));
		} catch (error) {
			console.error("Failed to run review template:", error);
			showToast(t("回顾生成提交失败"), "error");
		} finally {
			setRunningTemplateId(null);
		}
	};

	const handleDelete = async () => {
		if (!confirmDeleteTemplate) return;
		try {
			await reviewApi.deleteTemplate(confirmDeleteTemplate.id);
			await loadData();
			showToast(t("删除成功"), "success");
			setConfirmDeleteTemplate(null);
		} catch (error) {
			console.error("Failed to delete review template:", error);
			showToast(t("删除失败"), "error");
		}
	};

	const renderCategorySummary = (template: ReviewTemplate) => {
		if (template.include_all_categories) return t("全部分类");
		const names = categories
			.filter((category) => template.category_ids.includes(category.id))
			.map((category) => category.name);
		return names.length > 0 ? names.join("、") : t("未选择分类");
	};

	const renderModelSummary = (template: ReviewTemplate | ReviewTemplateFormState) => {
		const selectedId = template.model_api_config_id || "";
		if (!selectedId) return t("默认模型");
		const matched = modelConfigs.find((config) => config.id === selectedId);
		return matched ? `${matched.name} · ${matched.model_name}` : t("已失效模型");
	};

	return (
		<div className="bg-surface rounded-sm shadow-sm border border-border p-6 w-full min-w-0">
			<div className="mb-6 flex flex-wrap items-start justify-between gap-3">
				<div className="space-y-1">
					<h2 className="text-lg font-semibold text-text-1">{t("回顾模板")}</h2>
					<p className="text-sm text-text-3">{t("配置周期性回顾模板并自动生成草稿")}</p>
				</div>
				<Button onClick={openCreateModal} variant="primary">
					+ {t("新建模板")}
				</Button>
			</div>

			{loading ? (
				<div className="rounded-sm border border-border bg-muted px-4 py-8 text-center text-sm text-text-3">
					{t("加载中...")}
				</div>
			) : templates.length === 0 ? (
				<div className="rounded-sm border border-border bg-muted px-4 py-8 text-center text-sm text-text-3">
					<div className="mb-4">{t("暂无回顾模板")}</div>
					<Button onClick={openCreateModal} variant="primary">
						{t("新建模板")}
					</Button>
				</div>
			) : (
				<div className="space-y-4">
					{templates.map((template) => (
						<div
							key={template.id}
							className="border rounded-lg p-4 hover:shadow-md transition"
						>
							<div className="flex items-start justify-between gap-4">
								<div className="flex-1 min-w-0">
									<div className="flex flex-wrap items-center gap-2 mb-2">
										<h3 className="font-semibold text-text-1">{template.name}</h3>
										<StatusTag tone={template.is_enabled ? "success" : "neutral"}>
											{template.is_enabled ? t("启用") : t("禁用")}
										</StatusTag>
										<StatusTag tone="info">{getScheduleLabel(template, t)}</StatusTag>
									</div>
									<div className="space-y-2 text-sm text-text-2">
										<div>
											<span className="font-medium">{t("描述")}：</span>
											<span>{template.description?.trim() || t("暂无描述")}</span>
										</div>
										<div className="flex flex-wrap gap-2">
											<StatusTag tone="neutral">
												{t("触发时刻")}: {template.trigger_time}
											</StatusTag>
											{template.next_run_at && (
												<StatusTag tone="neutral">
													{t("下次触发")}: {formatTriggerDateTime(template.next_run_at, t("暂无"))}
												</StatusTag>
											)}
										</div>
									</div>
								</div>
								<div className="flex gap-1 shrink-0">
									<IconButton
										onClick={() => setPreviewTemplate(template)}
										variant="primary"
										size="sm"
										title={t("预览")}
									>
										<IconEye className="h-4 w-4" />
									</IconButton>
									<IconButton
										onClick={() => void handleRunNow(template)}
										variant="primary"
										size="sm"
										title={t("立即生成")}
										loading={runningTemplateId === template.id}
									>
										<IconRefresh className="h-4 w-4" />
									</IconButton>
									<IconButton
										onClick={() => openDuplicateModal(template)}
										variant="primary"
										size="sm"
										title={t("复制")}
									>
										<IconCopy className="h-4 w-4" />
									</IconButton>
									<IconButton
										onClick={() => openEditModal(template)}
										variant="primary"
										size="sm"
										title={t("编辑")}
									>
										<IconEdit className="h-4 w-4" />
									</IconButton>
									<IconButton
										onClick={() => setConfirmDeleteTemplate(template)}
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

			<ModalShell
				isOpen={showModal}
				onClose={() => {
					setShowModal(false);
					setActiveTemplate(null);
					setShowTitleTemplateHelp(false);
					setShowAdvancedSettings(false);
					setTitleTemplateHelpPosition(null);
				}}
				title={
					modalMode === "edit"
						? t("编辑回顾模板")
						: modalMode === "duplicate"
							? t("复制回顾模板")
							: t("创建回顾模板")
				}
				widthClassName="max-w-4xl"
				panelClassName={REVIEW_TEMPLATE_MODAL_PANEL_CLASSNAME}
				headerClassName="border-b border-border p-6"
				bodyClassName="space-y-4 p-6"
				footerClassName="border-t border-border bg-muted p-6"
				footer={
					<div className="flex justify-end gap-2">
						{shouldShowReviewTemplateModalRunAction() && modalMode === "edit" && activeTemplate && (
							<Button
								onClick={() => void handleRunNow(activeTemplate)}
								variant="secondary"
								loading={runningTemplateId === activeTemplate.id}
								disabled={runningTemplateId === activeTemplate.id}
							>
								<IconRefresh className="mr-1 h-4 w-4" />
								{t("立即生成")}
							</Button>
						)}
						<Button
							onClick={() => {
								setShowModal(false);
								setActiveTemplate(null);
								setShowTitleTemplateHelp(false);
								setShowAdvancedSettings(false);
							}}
							variant="secondary"
						>
							{t("取消")}
						</Button>
						<Button onClick={handleSave} variant="primary" loading={saving} disabled={saving}>
							{modalMode === "edit" ? t("保存模板") : t("创建模板")}
						</Button>
					</div>
				}
			>
				<div className="grid gap-4">
					<FormField label={t("模板名称")}>
						<TextInput
							value={form.name}
							onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
						/>
					</FormField>
				</div>

				<FormField label={t("描述")}>
					<TextArea
						rows={3}
						value={form.description}
						onChange={(event) =>
							setForm((prev) => ({ ...prev, description: event.target.value }))
						}
					/>
				</FormField>

				<div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
					<FormField label={t("周期类型")}>
						<SelectField
							className="w-full"
							value={form.schedule_type}
							onChange={(value) =>
								setForm((prev) => ({
									...prev,
									schedule_type: value as ReviewScheduleType,
								}))
							}
							options={[
								{ value: "weekly", label: t("按周") },
								{ value: "monthly", label: t("按月") },
								{ value: "custom_days", label: t("自定义天数") },
							]}
						/>
					</FormField>
					<FormField label={t("锚点日期")}>
						<TextInput
							type="date"
							value={form.anchor_date}
							onChange={(event) => setForm((prev) => ({ ...prev, anchor_date: event.target.value }))}
						/>
					</FormField>
					<FormField label={t("触发时刻")}>
						<TextInput
							type="time"
							value={form.trigger_time}
							onChange={(event) =>
								setForm((prev) => ({ ...prev, trigger_time: event.target.value }))
							}
						/>
					</FormField>
					<FormField label={t("AI 生成输入")}>
						<SelectField
							className="w-full"
							value={form.review_input_mode}
							onChange={(value) =>
								setForm((prev) => ({
									...prev,
									review_input_mode: value as ReviewTemplateInputMode,
								}))
							}
							options={[
								{ value: "abstract", label: t("摘要") },
								{ value: "summary", label: t("总结") },
								{ value: "full_text", label: t("全文") },
							]}
						/>
					</FormField>
				</div>

				{form.schedule_type === "custom_days" && (
					<FormField label={t("自定义天数")}>
						<TextInput
							type="number"
							min={1}
							value={form.custom_interval_days}
							onChange={(event) =>
								setForm((prev) => ({ ...prev, custom_interval_days: event.target.value }))
							}
						/>
					</FormField>
				)}

					<div className="grid gap-4">
						<div>
							<div className="mb-1.5 flex items-center gap-1.5 text-sm text-text-2">
								<span>{t("标题模板")}</span>
								<div className="relative" ref={titleTemplateHelpRef}>
									<button
										type="button"
										ref={titleTemplateHelpButtonRef}
										className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-border bg-surface text-[11px] font-semibold text-text-3 transition hover:text-text-1"
										aria-label={t("查看标题模板占位符说明")}
										onClick={() => setShowTitleTemplateHelp((prev) => !prev)}
									>
										?
									</button>
									{showTitleTemplateHelp && (
										<div
											ref={titleTemplateHelpPanelRef}
											className="fixed z-[70] w-80 rounded-lg border border-border bg-surface p-3 shadow-lg"
											style={{
												left: titleTemplateHelpPosition?.left ?? 16,
												top: titleTemplateHelpPosition?.top ?? 16,
												visibility: titleTemplateHelpPosition ? "visible" : "hidden",
											}}
										>
											<div className="text-xs font-medium text-text-1">{t("支持占位符")}</div>
											<div className="mt-2 space-y-2 text-xs text-text-2">
												<div>
													<code className="rounded bg-muted px-1 py-0.5">{"{period_label}"}</code>
													<span className="ml-2">{t("当前回顾周期，如 2026-04 或 2026-03-30 ~ 2026-04-05")}</span>
												</div>
												<div>
													<code className="rounded bg-muted px-1 py-0.5">{"{template_name}"}</code>
													<span className="ml-2">{t("当前模板名称")}</span>
												</div>
												<div>
													<code className="rounded bg-muted px-1 py-0.5">{"{issue_number}"}</code>
													<span className="ml-2">{t("按当前模板已发布期数 + 1 计算")}</span>
												</div>
											</div>
											<div className="mt-3 border-t border-border pt-2 text-xs text-text-3">
												<span className="font-medium text-text-2">{t("示例")}：</span>
												<code className="ml-1 rounded bg-muted px-1 py-0.5">
													第 {"{issue_number}"} 期｜{"{template_name}"}｜{"{period_label}"}
												</code>
											</div>
										</div>
									)}
								</div>
							</div>
							<TextInput
								value={form.title_template}
								onChange={(event) =>
									setForm((prev) => ({ ...prev, title_template: event.target.value }))
								}
							/>
						</div>
				</div>

				<div className="flex flex-wrap items-center gap-6">
					<label className="inline-flex items-center gap-2 text-sm text-text-2">
						<CheckboxInput
							checked={form.is_enabled}
							onChange={(event) =>
								setForm((prev) => ({ ...prev, is_enabled: event.target.checked }))
							}
						/>
						{t("自动运行")}
					</label>
					<label className="inline-flex items-center gap-2 text-sm text-text-2">
						<CheckboxInput
							checked={form.include_all_categories}
							onChange={(event) =>
								setForm((prev) => ({
									...prev,
									include_all_categories: event.target.checked,
								}))
							}
						/>
						{t("包含全部分类")}
					</label>
				</div>

				{!form.include_all_categories && (
					<FormField label={t("分类选择")}>
						<SelectField
							className="w-full"
							mode="multiple"
							multiline
							value={form.category_ids}
							onChange={(value) =>
								setForm((prev) => ({
									...prev,
									category_ids: Array.isArray(value) ? value.map(String) : [],
								}))
							}
							options={categoryOptions}
						/>
					</FormField>
				)}

				<FormField label={t("系统提示词")}>
					<TextArea
						rows={5}
						value={form.system_prompt}
						onChange={(event) =>
							setForm((prev) => ({ ...prev, system_prompt: event.target.value }))
						}
					/>
				</FormField>

				<FormField label={t("用户提示词")}>
					<TextArea
						rows={12}
						value={form.prompt_template}
						onChange={(event) =>
							setForm((prev) => ({ ...prev, prompt_template: event.target.value }))
						}
					/>
				</FormField>

				<div className="grid gap-4">
					<FormField label={t("生成模型")}>
						<SelectField
							className="w-full"
							value={form.model_api_config_id}
							onChange={(value) =>
								setForm((prev) => ({
									...prev,
									model_api_config_id: String(value || ""),
								}))
							}
							options={modelOptions}
						/>
					</FormField>
				</div>

				<div className="rounded-lg border border-border">
					<SectionToggleButton
						label={t("高级设置（可选）")}
						expanded={showAdvancedSettings}
						onToggle={() => setShowAdvancedSettings((prev) => !prev)}
						expandedIndicator={t("收起")}
						collapsedIndicator={t("展开")}
					/>
					{showAdvancedSettings && (
						<div className="space-y-4 border-t border-border p-4">
							<div className="grid gap-4 md:grid-cols-3">
								<FormField label={t("温度")}>
									<TextInput
										type="number"
										step="0.1"
										min={0}
										max={2}
										value={form.temperature}
										onChange={(event) =>
											setForm((prev) => ({ ...prev, temperature: event.target.value }))
										}
										placeholder={t("留空使用默认值")}
									/>
								</FormField>
								<FormField label={t("最大 Tokens")}>
									<TextInput
										type="number"
										min={1}
										value={form.max_tokens}
										onChange={(event) =>
											setForm((prev) => ({ ...prev, max_tokens: event.target.value }))
										}
										placeholder={t("留空使用默认值")}
									/>
								</FormField>
								<FormField label={t("Top P")}>
									<TextInput
										type="number"
										step="0.1"
										min={0}
										max={1}
										value={form.top_p}
										onChange={(event) =>
											setForm((prev) => ({ ...prev, top_p: event.target.value }))
										}
										placeholder={t("留空使用默认值")}
									/>
								</FormField>
							</div>
						</div>
					)}
				</div>
			</ModalShell>

			<ConfirmModal
				isOpen={Boolean(confirmDeleteTemplate)}
				title={t("删除回顾模板")}
				message={t("确定要删除这个回顾模板吗？此操作不可撤销。")}
				confirmText={t("删除")}
				cancelText={t("取消")}
				onConfirm={handleDelete}
				onCancel={() => setConfirmDeleteTemplate(null)}
			/>

			<ModalShell
				isOpen={Boolean(previewTemplate)}
				onClose={() => setPreviewTemplate(null)}
				title={
					previewTemplate
						? `${t("回顾模板预览")} - ${previewTemplate.name}`
						: t("回顾模板预览")
				}
				widthClassName="max-w-2xl"
				panelClassName="max-h-[90vh] overflow-y-auto"
				headerClassName="border-b border-border p-6"
				bodyClassName="space-y-4 p-6"
				footerClassName="border-t border-border bg-muted p-6"
				footer={
					<div className="flex justify-end gap-2">
						{previewTemplate && (
							<Button
								onClick={() => {
									openEditModal(previewTemplate);
									setPreviewTemplate(null);
								}}
								variant="primary"
							>
								{t("编辑此配置")}
							</Button>
						)}
						<Button onClick={() => setPreviewTemplate(null)} variant="secondary">
							{t("关闭")}
						</Button>
					</div>
				}
			>
				{previewTemplate && (
					<>
						<div className="flex flex-wrap gap-2">
							<StatusTag tone={previewTemplate.is_enabled ? "success" : "neutral"}>
								{previewTemplate.is_enabled ? t("启用") : t("禁用")}
							</StatusTag>
							<StatusTag tone="info">{getScheduleLabel(previewTemplate, t)}</StatusTag>
							<StatusTag tone="neutral">
								{t("分类")}: {renderCategorySummary(previewTemplate)}
							</StatusTag>
						</div>

						<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
							<div className="rounded-lg border border-border bg-muted p-3 text-sm text-text-2">
								<div className="text-xs text-text-3">{t("触发时刻")}</div>
								<div>{previewTemplate.trigger_time}</div>
							</div>
							<div className="rounded-lg border border-border bg-muted p-3 text-sm text-text-2">
								<div className="text-xs text-text-3">{t("锚点日期")}</div>
								<div>{previewTemplate.anchor_date}</div>
							</div>
							<div className="rounded-lg border border-border bg-muted p-3 text-sm text-text-2">
								<div className="text-xs text-text-3">{t("下次触发")}</div>
								<div>{formatTriggerDateTime(previewTemplate.next_run_at, t("暂无"))}</div>
							</div>
							<div className="rounded-lg border border-border bg-muted p-3 text-sm text-text-2">
								<div className="text-xs text-text-3">{t("生成模型")}</div>
								<div>{renderModelSummary(previewTemplate)}</div>
							</div>
							<div className="rounded-lg border border-border bg-muted p-3 text-sm text-text-2">
								<div className="text-xs text-text-3">{t("AI 生成输入")}</div>
								<div>
									{previewTemplate.review_input_mode === "abstract"
										? t("摘要")
										: previewTemplate.review_input_mode === "full_text"
											? t("全文")
											: t("总结")}
								</div>
							</div>
							<div className="rounded-lg border border-border bg-muted p-3 text-sm text-text-2">
								<div className="text-xs text-text-3">{t("高级参数")}</div>
								<div>
									{[
										previewTemplate.temperature != null
											? `${t("温度")} ${previewTemplate.temperature}`
											: null,
										previewTemplate.max_tokens != null
											? `${t("最大 Tokens")} ${previewTemplate.max_tokens}`
											: null,
										previewTemplate.top_p != null
											? `Top P ${previewTemplate.top_p}`
											: null,
									]
										.filter(Boolean)
										.join(" · ") || t("使用默认值")}
								</div>
							</div>
						</div>

						<div>
							<label className="mb-2 block text-sm font-medium text-text-2">
								{t("描述")}
							</label>
							<div className="rounded-lg border border-border bg-muted p-4 text-sm text-text-1 whitespace-pre-wrap">
								{previewTemplate.description?.trim() || t("暂无描述")}
							</div>
						</div>

						<div>
							<label className="mb-2 block text-sm font-medium text-text-2">
								{t("标题模板")}
							</label>
							<pre className="w-full rounded-lg border border-border bg-muted p-4 text-sm text-text-1 whitespace-pre-wrap font-mono">
								{previewTemplate.title_template}
							</pre>
						</div>

						<div>
							<label className="mb-2 block text-sm font-medium text-text-2">
								{t("系统提示词")}
							</label>
							<pre className="w-full rounded-lg border border-border bg-muted p-4 text-sm text-text-1 whitespace-pre-wrap font-mono">
								{previewTemplate.system_prompt?.trim() || DEFAULT_SYSTEM_PROMPT}
							</pre>
						</div>

						<div>
							<label className="mb-2 block text-sm font-medium text-text-2">
								{t("用户提示词")}
							</label>
							<pre className="w-full rounded-lg border border-border bg-muted p-4 text-sm text-text-1 whitespace-pre-wrap font-mono">
								{previewTemplate.prompt_template}
							</pre>
						</div>
					</>
				)}
			</ModalShell>
		</div>
	);
}
