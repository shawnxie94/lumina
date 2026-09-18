import type { Dispatch, SetStateAction } from "react";
import type { Dayjs } from "dayjs";
import Link from "next/link";
import Button from "@/components/Button";
import DateRangePicker from "@/components/DateRangePicker";
import FilterSelect from "@/components/FilterSelect";
import ModalShell from "@/components/ui/ModalShell";
import SelectField from "@/components/ui/SelectField";
import {
	getAIUsageFilterOptions,
	getAITaskLabel,
} from "@/lib/aiTaskMeta";
import type {
	AIUsageLogItem,
	AIUsageSummaryResponse,
	ModelAPIConfig,
} from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { formatCostValue, formatPrice } from "@/components/admin/formatting";

export interface UsageCostBreakdown {
	currency: string;
	promptTokens: number | null;
	completionTokens: number | null;
	inputUnitPrice: number | null;
	outputUnitPrice: number | null;
	inputCost: number | null;
	outputCost: number | null;
	totalCost: number | null;
}

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

type AiUsageSectionProps = {
	modelAPIConfigs: ModelAPIConfig[];
	usageSummary: AIUsageSummaryResponse["summary"] | null;
	usageByModel: AIUsageSummaryResponse["by_model"];
	usageCostByCurrency: [string, number][];
	usageTotal: number;
	usageLoading: boolean;
	usageLogs: AIUsageLogItem[];
	usagePage: number;
	usagePageSize: number;
	usageModelId: string;
	usageStatus: string;
	usageContentType: string;
	usageStart: string;
	usageEnd: string;
	toDayjsRangeFromDateStrings: (
		start?: string,
		end?: string,
	) => [Dayjs | null, Dayjs | null] | null;
	getUsageStatusLabel: (status: string) => string;
	openUsageCost: (log: AIUsageLogItem) => void;
	handleOpenUsageRelatedTask: (taskId: string, usageId?: string) => void;
	setUsageModelId: Dispatch<SetStateAction<string>>;
	setUsageStatus: Dispatch<SetStateAction<string>>;
	setUsageContentType: Dispatch<SetStateAction<string>>;
	setUsageStart: Dispatch<SetStateAction<string>>;
	setUsageEnd: Dispatch<SetStateAction<string>>;
	setUsagePage: Dispatch<SetStateAction<number>>;
	setUsagePageSize: Dispatch<SetStateAction<number>>;
	showUsageCostModal: boolean;
	setShowUsageCostModal: Dispatch<SetStateAction<boolean>>;
	usageCostTitle: string;
	usageCostDetails: string;
	usageCostBreakdown: UsageCostBreakdown | null;
};

export default function AiUsageSection({
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
	toDayjsRangeFromDateStrings,
	getUsageStatusLabel,
	openUsageCost,
	handleOpenUsageRelatedTask,
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
}: AiUsageSectionProps) {
	const { t } = useI18n();

	return (
		<>
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
					...getAIUsageFilterOptions(t),
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
											{getAITaskLabel(
												log.task_type,
												log.content_type,
												t,
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
		</>
	);
}
