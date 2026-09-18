import type { Dayjs } from "dayjs";
import Link from "next/link";
import type { Dispatch, SetStateAction } from "react";
import Button from "@/components/Button";
import DateRangePicker from "@/components/DateRangePicker";
import FilterInput from "@/components/FilterInput";
import FilterSelect from "@/components/FilterSelect";
import IconButton from "@/components/IconButton";
import ModalShell from "@/components/ui/ModalShell";
import SelectField from "@/components/ui/SelectField";
import StatusTag from "@/components/ui/StatusTag";
import { IconEye, IconTrash } from "@/components/icons";
import type { AdminCommentItem, CommentListResponse } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

type CommentMonitorSectionProps = {
	commentList: CommentListResponse["items"];
	commentListLoading: boolean;
	commentListPage: number;
	commentListPageSize: number;
	commentListTotal: number;
	commentQuery: string;
	commentArticleTitle: string;
	commentAuthor: string;
	commentStart: string;
	commentEnd: string;
	commentVisibility: string;
	commentReplyFilter: string;
	hasCommentFilters: boolean;
	hoverComment: AdminCommentItem | null;
	hoverTooltipPos: { x: number; y: number } | null;
	showCommentContentModal: boolean;
	activeCommentContent: AdminCommentItem | null;
	pendingCommentActionIds: Set<string>;
	fetchCommentList: () => Promise<void>;
	resetCommentFilters: () => void;
	handleToggleCommentVisibility: (
		comment: AdminCommentItem,
		nextHidden: boolean,
	) => Promise<void>;
	handleDeleteCommentAdmin: (comment: AdminCommentItem) => Promise<void>;
	setCommentQuery: Dispatch<SetStateAction<string>>;
	setCommentArticleTitle: Dispatch<SetStateAction<string>>;
	setCommentAuthor: Dispatch<SetStateAction<string>>;
	setCommentStart: Dispatch<SetStateAction<string>>;
	setCommentEnd: Dispatch<SetStateAction<string>>;
	setCommentVisibility: Dispatch<SetStateAction<string>>;
	setCommentReplyFilter: Dispatch<SetStateAction<string>>;
	setCommentListPage: Dispatch<SetStateAction<number>>;
	setCommentListPageSize: Dispatch<SetStateAction<number>>;
	setHoverComment: Dispatch<SetStateAction<AdminCommentItem | null>>;
	setHoverTooltipPos: Dispatch<SetStateAction<{ x: number; y: number } | null>>;
	setActiveCommentContent: Dispatch<SetStateAction<AdminCommentItem | null>>;
	setShowCommentContentModal: Dispatch<SetStateAction<boolean>>;
	toDayjsRangeFromDateStrings: (
		start?: string,
		end?: string,
	) => [Dayjs | null, Dayjs | null] | null;
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

export default function CommentMonitorSection({
	commentList,
	commentListLoading,
	commentListPage,
	commentListPageSize,
	commentListTotal,
	commentQuery,
	commentArticleTitle,
	commentAuthor,
	commentStart,
	commentEnd,
	commentVisibility,
	commentReplyFilter,
	hasCommentFilters,
	hoverComment,
	hoverTooltipPos,
	showCommentContentModal,
	activeCommentContent,
	pendingCommentActionIds,
	fetchCommentList,
	resetCommentFilters,
	handleToggleCommentVisibility,
	handleDeleteCommentAdmin,
	setCommentQuery,
	setCommentArticleTitle,
	setCommentAuthor,
	setCommentStart,
	setCommentEnd,
	setCommentVisibility,
	setCommentReplyFilter,
	setCommentListPage,
	setCommentListPageSize,
	setHoverComment,
	setHoverTooltipPos,
	setActiveCommentContent,
	setShowCommentContentModal,
	toDayjsRangeFromDateStrings,
}: CommentMonitorSectionProps) {
	const { t } = useI18n();

	const getCommentTargetHref = (comment: AdminCommentItem) => {
		if (comment.resource_type === "review") {
			const reviewTarget = comment.review_slug || comment.review_id;
			return reviewTarget ? `/columns/${reviewTarget}#comment-${comment.id}` : null;
		}
		const articleTarget = comment.article_slug || comment.article_id;
		return articleTarget ? `/article/${articleTarget}#comment-${comment.id}` : null;
	};

	const getCommentTargetTitle = (comment: AdminCommentItem) =>
		comment.resource_title ||
		comment.article_title ||
		comment.review_title ||
		comment.article_slug ||
		comment.review_slug ||
		comment.article_id ||
		comment.review_id ||
		t("未知资源");

	return (
		<>
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
				<FilterInput
					label={t("标题")}
					value={commentArticleTitle}
					onChange={(value) => {
						setCommentArticleTitle(value);
						setCommentListPage(1);
					}}
					placeholder={t("输入文章或专栏标题搜索...")}
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
										className="transition-colors hover:bg-muted"
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
							{getCommentTargetHref(comment) ? (
								<Link
									href={getCommentTargetHref(comment) || "#"}
									className="text-primary hover:text-primary-ink"
									title={getCommentTargetTitle(comment)}
									target="_blank"
									rel="noopener noreferrer"
								>
									{t("查看")}
								</Link>
							) : (
								<span className="text-text-3">-</span>
							)}
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
															comment,
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
											handleDeleteCommentAdmin(comment)
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
		</>
	);
}
