import { useEffect, useMemo, useState } from "react";
import dayjs, { type Dayjs } from "dayjs";
import AiUsageSection, { type UsageCostBreakdown } from "./AiUsageSection";
import { formatCostValue } from "./formatting";
import {
	aiUsageApi,
	articleApi,
	type AIUsageLogItem,
	type AIUsageSummaryResponse,
	type ModelAPIConfig,
} from "@/lib/api";
import { parseAITaskFilterValue } from "@/lib/aiTaskMeta";
import { useToast } from "@/components/Toast";
import { useI18n } from "@/lib/i18n";

export default function AiUsageContainer({
	onOpenTask,
}: {
	onOpenTask: (taskId: string, usageId?: string) => void;
}) {
	const { t } = useI18n();
	const { showToast } = useToast();
	const [modelAPIConfigs, setModels] = useState<ModelAPIConfig[]>([]);
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
	const [showUsageCostModal, setShowUsageCostModal] = useState(false);
	const [usageCostTitle, setUsageCostTitle] = useState("");
	const [usageCostDetails, setUsageCostDetails] = useState("");
	const [usageCostBreakdown, setUsageCostBreakdown] =
		useState<UsageCostBreakdown | null>(null);
	useEffect(() => {
		let active = true;
		articleApi
			.getModelAPIConfigs()
			.then((models) => {
				if (active) setModels(models);
			})
			.catch(console.error);
		return () => {
			active = false;
		};
	}, []);
	const usageParams = useMemo(() => {
		const { taskType, contentType } = parseAITaskFilterValue(usageContentType);
		return {
			model_api_config_id: usageModelId || undefined,
			status: usageStatus || undefined,
			task_type: taskType,
			content_type: contentType,
			start: usageStart || undefined,
			end: usageEnd || undefined,
		};
	}, [usageModelId, usageStatus, usageContentType, usageStart, usageEnd]);
	useEffect(() => {
		let active = true;
		setUsageLoading(true);
		aiUsageApi
			.list({ ...usageParams, page: usagePage, size: usagePageSize })
			.then((logs) => {
				if (active) {
					setUsageLogs(logs.items || []);
					setUsageTotal(logs.total || 0);
				}
			})
			.catch((error) => {
				if (active) {
					console.error(error);
					showToast(t("调用记录加载失败"), "error");
				}
			})
			.finally(() => {
				if (active) setUsageLoading(false);
			});
		return () => {
			active = false;
		};
	}, [usageParams, usagePage, usagePageSize, showToast, t]);
	useEffect(() => {
		let active = true;
		aiUsageApi
			.summary(usageParams)
			.then((summary) => {
				if (active) {
					setUsageSummary(summary.summary);
					setUsageByModel(summary.by_model || []);
				}
			})
			.catch((error) => {
				if (active) {
					console.error(error);
					showToast(t("计量汇总加载失败"), "error");
				}
			});
		return () => {
			active = false;
		};
	}, [usageParams, showToast, t]);
	useEffect(() => {
		const close = (event: KeyboardEvent) => {
			if (event.key === "Escape") setShowUsageCostModal(false);
		};
		window.addEventListener("keydown", close);
		return () => window.removeEventListener("keydown", close);
	}, []);
	const usageCostByCurrency = useMemo(() => {
		const totals = new Map<string, number>();
		for (const item of usageByModel)
			if (item.cost_total != null && item.currency)
				totals.set(
					item.currency,
					(totals.get(item.currency) || 0) + item.cost_total,
				);
		return Array.from(totals.entries()).sort((a, b) =>
			a[0].localeCompare(b[0]),
		);
	}, [usageByModel]);
	const getUsageStatusLabel = (status: string) => {
		if (status === "completed") return t("已完成");
		if (status === "failed") return t("失败");
		if (status === "processing") return t("处理中");
		if (status === "cancelled") return t("已取消");
		return t("待处理");
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
		const line = (
			label: string,
			tokens: number | null,
			price: number | null,
		) =>
			tokens == null || price == null
				? `${label}: -`
				: `${label}: (${tokens} / 1000) * ${price.toFixed(6)} = ${((tokens / 1000) * price).toFixed(6)} ${currency}`;
		setUsageCostTitle(t("费用计算逻辑（仅供参考）"));
		setUsageCostDetails(
			[
				t("费用计算详情")
					.replace(
						"{inputLine}",
						line(t("输入"), log.prompt_tokens, inputPrice),
					)
					.replace(
						"{outputLine}",
						line(t("输出"), log.completion_tokens, outputPrice),
					)
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
	return (
		<AiUsageSection
			{...{
				modelAPIConfigs,
				usageSummary,
				usageByModel,
				usageCostByCurrency,
				usageTotal,
				usageLoading,
				usageLogs,
				usagePage,
				usagePageSize,
				usageModelId,
				usageStatus,
				usageContentType,
				usageStart,
				usageEnd,
				getUsageStatusLabel,
				openUsageCost,
				setUsageModelId,
				setUsageStatus,
				setUsageContentType,
				setUsageStart,
				setUsageEnd,
				setUsagePage,
				setUsagePageSize,
				showUsageCostModal,
				setShowUsageCostModal,
				usageCostTitle,
				usageCostDetails,
				usageCostBreakdown,
			}}
			handleOpenUsageRelatedTask={onOpenTask}
			toDayjsRangeFromDateStrings={(start, end) =>
				!start && !end
					? null
					: ([start ? dayjs(start) : null, end ? dayjs(end) : null] as [
							Dayjs | null,
							Dayjs | null,
						])
			}
		/>
	);
}
