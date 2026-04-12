import dayjs, { type Dayjs } from "dayjs";
import { useRouter } from "next/router";
import { useCallback, useEffect, useMemo, useState } from "react";

import Button from "@/components/Button";
import DateRangePicker from "@/components/DateRangePicker";
import ModalShell from "@/components/ui/ModalShell";
import CheckboxInput from "@/components/ui/CheckboxInput";
import FormField from "@/components/ui/FormField";
import SelectField from "@/components/ui/SelectField";
import { useToast } from "@/components/Toast";
import {
	articleApi,
	type ModelAPIConfig,
	type ReviewGenerationCandidate,
	type ReviewTemplate,
	reviewApi,
	resolveMediaUrl,
} from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import {
	buildReviewTaskMonitorUrl,
	filterReviewTemplateModelOptions,
} from "@/lib/reviewTemplate";

interface ReviewManualGenerateModalProps {
	isOpen: boolean;
	onClose: () => void;
	initialTemplateId?: string;
	initialDateStart?: string;
	initialDateEnd?: string;
	initialSelectedArticleIds?: string[];
	lockTemplateSelection?: boolean;
	title?: string;
}

const formatDateValue = (value: Date | null): string | null => {
	if (!value) return null;
	return dayjs(value).format("YYYY-MM-DD");
};

const parseDateValue = (value?: string | null): Date | null => {
	if (!value) return null;
	const parsed = dayjs(value, "YYYY-MM-DD", true);
	return parsed.isValid() ? parsed.toDate() : null;
};

const toDayjsRange = (range: [Date | null, Date | null]): [Dayjs | null, Dayjs | null] => [
	range[0] ? dayjs(range[0]) : null,
	range[1] ? dayjs(range[1]) : null,
];

export default function ReviewManualGenerateModal({
	isOpen,
	onClose,
	initialTemplateId,
	initialDateStart,
	initialDateEnd,
	initialSelectedArticleIds,
	lockTemplateSelection = false,
	title,
}: ReviewManualGenerateModalProps) {
	const { t } = useI18n();
	const { showToast } = useToast();
	const router = useRouter();
	const [templates, setTemplates] = useState<ReviewTemplate[]>([]);
	const [modelConfigs, setModelConfigs] = useState<ModelAPIConfig[]>([]);
	const [selectedTemplateId, setSelectedTemplateId] = useState("");
	const [selectedModelId, setSelectedModelId] = useState("");
	const [dateRange, setDateRange] = useState<[Date | null, Date | null]>([null, null]);
	const [articles, setArticles] = useState<ReviewGenerationCandidate[]>([]);
	const [selectedArticleIds, setSelectedArticleIds] = useState<string[]>([]);
	const [periodLabel, setPeriodLabel] = useState("");
	const [bootstrapLoading, setBootstrapLoading] = useState(false);
	const [previewLoading, setPreviewLoading] = useState(false);
	const [submitting, setSubmitting] = useState(false);

	const templateMap = useMemo(
		() => new Map(templates.map((template) => [template.id, template])),
		[templates],
	);
	const selectedTemplate = selectedTemplateId ? templateMap.get(selectedTemplateId) || null : null;
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

	const loadPreview = useCallback(
		async (
			templateId: string,
			nextRange: [Date | null, Date | null] | null,
			options?: {
				resetModel?: boolean;
				preferredArticleIds?: string[];
			},
		) => {
			setPreviewLoading(true);
			try {
				const dateStart = nextRange ? formatDateValue(nextRange[0]) : null;
				const dateEnd = nextRange ? formatDateValue(nextRange[1]) : null;
				const preview = await reviewApi.getTemplateGenerationPreview(templateId, {
					date_start: dateStart || undefined,
					date_end: dateEnd || undefined,
				});
				const nextArticles = preview.articles;
				const preferredArticleIds = options?.preferredArticleIds;
				const nextSelectedArticleIds =
					preferredArticleIds && preferredArticleIds.length > 0
						? nextArticles
								.filter((article) => preferredArticleIds.includes(article.id))
								.map((article) => article.id)
						: nextArticles.map((article) => article.id);
				setArticles(nextArticles);
				setSelectedArticleIds(nextSelectedArticleIds);
				setPeriodLabel(preview.period_label);
				setDateRange([
					parseDateValue(preview.date_start),
					parseDateValue(preview.date_end),
				]);
				if (options?.resetModel) {
					const defaultModelId = templateMap.get(templateId)?.model_api_config_id || "";
					setSelectedModelId(defaultModelId);
				}
			} catch (error) {
				console.error("Failed to load review generation preview:", error);
				setArticles([]);
				setSelectedArticleIds([]);
				showToast(t("回顾生成预览加载失败"), "error");
			} finally {
				setPreviewLoading(false);
			}
		},
		[showToast, t, templateMap],
	);

	useEffect(() => {
		if (!isOpen) return;
		let active = true;
		const bootstrap = async () => {
			setBootstrapLoading(true);
			try {
				const [templateData, modelData] = await Promise.all([
					reviewApi.getTemplates(),
					articleApi.getModelAPIConfigs(),
				]);
				if (!active) return;
				const enabledModels = filterReviewTemplateModelOptions(modelData as ModelAPIConfig[]);
				setTemplates(templateData);
				setModelConfigs(enabledModels);
				const fallbackTemplate = templateData.find((template) => template.id === initialTemplateId) || templateData[0];
				const nextTemplateId = fallbackTemplate?.id || "";
				setSelectedTemplateId(nextTemplateId);
			} catch (error) {
				console.error("Failed to bootstrap manual review generation modal:", error);
				if (active) showToast(t("回顾生成配置加载失败"), "error");
			} finally {
				if (active) setBootstrapLoading(false);
			}
		};
		void bootstrap();
		return () => {
			active = false;
		};
	}, [initialTemplateId, isOpen, showToast, t]);

	useEffect(() => {
		if (!isOpen || !selectedTemplateId || templates.length === 0) return;
		const initialRange =
			initialDateStart || initialDateEnd
				? [parseDateValue(initialDateStart), parseDateValue(initialDateEnd)] as [
						Date | null,
						Date | null,
					]
				: null;
		void loadPreview(selectedTemplateId, initialRange, {
			resetModel: true,
			preferredArticleIds: initialSelectedArticleIds,
		});
	}, [
		initialDateEnd,
		initialDateStart,
		initialSelectedArticleIds,
		isOpen,
		loadPreview,
		selectedTemplateId,
		templates.length,
	]);

	const handleDateRangeChange = (values: [Dayjs | null, Dayjs | null] | null) => {
		const nextRange: [Date | null, Date | null] = [
			values?.[0] ? values[0].toDate() : null,
			values?.[1] ? values[1].toDate() : null,
		];
		setDateRange(nextRange);
		if (!selectedTemplateId) return;
		if (!nextRange[0] && !nextRange[1]) {
			void loadPreview(selectedTemplateId, null, {
				preferredArticleIds: selectedArticleIds,
			});
			return;
		}
		if (nextRange[0] && nextRange[1]) {
			void loadPreview(selectedTemplateId, nextRange, {
				preferredArticleIds: selectedArticleIds,
			});
		}
	};

	const toggleArticle = (articleId: string) => {
		setSelectedArticleIds((current) =>
			current.includes(articleId)
				? current.filter((id) => id !== articleId)
				: [...current, articleId],
		);
	};

	const handleSelectAll = () => {
		setSelectedArticleIds(articles.map((article) => article.id));
	};

	const handleClearAll = () => {
		setSelectedArticleIds([]);
	};

	const handleArticleClick = (e: React.MouseEvent, articleId: string) => {
		toggleArticle(articleId);
	};

	const handleArticleTitleClick = (articleSlug: string) => {
		window.open(`/article/${articleSlug}`, "_blank", "noopener,noreferrer");
	};

	const handleSubmit = async () => {
		if (!selectedTemplateId) {
			showToast(t("请先选择模板"), "error");
			return;
		}
		if (!dateRange[0] || !dateRange[1]) {
			showToast(t("请先选择完整时间区间"), "error");
			return;
		}
		if (selectedArticleIds.length === 0) {
			showToast(t("请至少选择一篇文章"), "error");
			return;
		}
		setSubmitting(true);
		try {
			const result = await reviewApi.runTemplateManual(selectedTemplateId, {
				date_start: formatDateValue(dateRange[0]),
				date_end: formatDateValue(dateRange[1]),
				article_ids: selectedArticleIds,
				model_api_config_id: selectedModelId || null,
			});
			showToast(t("回顾生成任务已提交"), "success");
			window.location.assign(buildReviewTaskMonitorUrl(result.task_id));
		} catch (error) {
			console.error("Failed to submit manual review generation:", error);
			showToast(t("回顾生成提交失败"), "error");
		} finally {
			setSubmitting(false);
		}
	};

	return (
		<ModalShell
			isOpen={isOpen}
			onClose={onClose}
			title={title || t("立即生成回顾")}
			widthClassName="max-w-5xl"
			panelClassName="max-h-[90vh] overflow-y-auto"
			headerClassName="border-b border-border p-6"
			bodyClassName="space-y-5 p-6"
			footerClassName="border-t border-border bg-muted p-6"
			footer={
				<div className="flex items-center justify-between gap-3">
					<div className="text-sm text-text-3">
						{selectedArticleIds.length} / {articles.length} {t("篇文章已选择")}
					</div>
					<div className="flex items-center gap-2">
						<Button onClick={onClose} variant="secondary" disabled={submitting}>
							{t("取消")}
						</Button>
						<Button
							onClick={handleSubmit}
							variant="primary"
							loading={submitting}
							disabled={submitting || previewLoading || bootstrapLoading}
						>
							{t("开始生成")}
						</Button>
					</div>
				</div>
			}
		>
			<div className="grid gap-4 lg:grid-cols-[1.1fr_1.1fr_1.4fr]">
				<FormField label={t("模板")}>
					<SelectField
						value={selectedTemplateId}
						onChange={(value) => setSelectedTemplateId(String(value || ""))}
						className="w-full"
						disabled={lockTemplateSelection}
						options={templates.map((template) => ({
							value: template.id,
							label: template.name,
						}))}
					/>
				</FormField>
				<FormField label={t("模型")}>
					<SelectField
						value={selectedModelId}
						onChange={(value) => setSelectedModelId(String(value || ""))}
						className="w-full"
						options={modelOptions}
					/>
				</FormField>
				<div>
					<label className="mb-1.5 block text-sm font-medium text-text-2">
						{t("时间区间")}
					</label>
					<DateRangePicker
						value={toDayjsRange(dateRange)}
						onChange={handleDateRangeChange}
						className="w-full"
					/>
				</div>
			</div>

			<div className="rounded-lg border border-border bg-muted/60 p-4 text-sm text-text-2">
				<div className="flex flex-wrap items-center gap-x-5 gap-y-2">
					<span>
						{t("本期范围")}：{periodLabel || t("自动计算中")}
					</span>
					<span>
						{t("分类")}：
						{selectedTemplate?.include_all_categories
							? t("全部分类")
							: selectedTemplate?.category_ids.length || 0}
						{!selectedTemplate?.include_all_categories ? t("个已选分类") : ""}
					</span>
					<span>
						{t("AI 生成输入")}：
						{selectedTemplate?.review_input_mode === "full_text"
							? t("全文")
							: selectedTemplate?.review_input_mode === "summary"
								? t("总结")
								: t("摘要")}
					</span>
				</div>
			</div>

			<div className="rounded-lg border border-border">
				<div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
					<div>
						<div className="text-sm font-medium text-text-1">{t("候选文章")}</div>
						<div className="text-xs text-text-3">
							{previewLoading || bootstrapLoading ? t("加载中...") : `${articles.length} ${t("篇")}`}
						</div>
					</div>
					<div className="flex items-center gap-2">
						<Button onClick={handleSelectAll} variant="secondary" size="sm" disabled={articles.length === 0}>
							{t("全选")}
						</Button>
						<Button onClick={handleClearAll} variant="secondary" size="sm" disabled={selectedArticleIds.length === 0}>
							{t("清空")}
						</Button>
					</div>
				</div>

				{previewLoading || bootstrapLoading ? (
					<div className="px-4 py-10 text-center text-sm text-text-3">{t("加载中...")}</div>
				) : articles.length === 0 ? (
					<div className="px-4 py-10 text-center text-sm text-text-3">{t("当前条件下暂无文章")}</div>
				) : (
					<div className="max-h-[420px] overflow-y-auto">
						<div className="space-y-0">
							{articles.map((article) => {
								const checked = selectedArticleIds.includes(article.id);
								return (
									<div
										key={article.id}
										className={`flex gap-4 border-b border-border px-4 py-4 transition last:border-b-0 ${
											checked ? "bg-primary-soft/30" : "hover:bg-muted/70"
										}`}
									>
										<div className="mt-1 shrink-0">
											<CheckboxInput
												checked={checked}
												onChange={() => toggleArticle(article.id)}
											/>
										</div>
										<button
											type="button"
											onClick={() => handleArticleTitleClick(article.slug)}
											className="relative h-20 w-28 shrink-0 overflow-hidden rounded-sm bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
										>
											<img
												src={resolveMediaUrl(article.top_image || "") || "/logo.png"}
												alt={article.title}
												className="h-full w-full object-cover"
												loading="lazy"
											/>
										</button>
										<div className="min-w-0 flex-1">
											<div className="flex flex-wrap items-center gap-2 text-xs text-text-3">
												{article.category ? (
													<span className="rounded-sm bg-surface px-2 py-0.5">
														{article.category.name}
													</span>
												) : null}
												<span>
													{t("创建时间")}：{dayjs(article.created_at).format("YYYY-MM-DD")}
												</span>
											</div>
											<button
												type="button"
												onClick={() => handleArticleTitleClick(article.slug)}
												className="mt-1 text-left text-sm font-medium text-text-1 hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 rounded"
											>
												{article.title}
											</button>
											{article.summary ? (
												<p className="mt-1 line-clamp-2 text-sm text-text-2">
													{article.summary}
												</p>
											) : (
												<p className="mt-1 text-sm text-text-3">{t("暂无摘要")}</p>
											)}
										</div>
									</div>
								);
							})}
						</div>
					</div>
				)}
			</div>
		</ModalShell>
	);
}
