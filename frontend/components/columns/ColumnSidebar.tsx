import type { Dispatch, SetStateAction } from "react";

import Link from "next/link";

import {
	TableOfContents,
	type TocItem,
} from "@/components/article/TableOfContents";
import {
	IconChevronDown,
	IconClock,
	IconList,
	IconTag,
} from "@/components/icons";
import type { ReviewIssue, ReviewNeighbor } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

interface ColumnSidebarProps {
	review: ReviewIssue;
	templateDescriptionText: string;
	tocItems: TocItem[];
	activeTocId: string;
	tocCollapsed: boolean;
	setTocCollapsed: Dispatch<SetStateAction<boolean>>;
	handleTocSelect: (id: string) => void;
	recentReviews: ReviewNeighbor[];
}

function ColumnSidebar({
	review,
	templateDescriptionText,
	tocItems,
	activeTocId,
	tocCollapsed,
	setTocCollapsed,
	handleTocSelect,
	recentReviews,
}: ColumnSidebarProps) {
	const { t } = useI18n();

	return (
		<aside className="flex-shrink-0 w-full lg:w-[420px]">
			<div className="max-h-none overflow-visible lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto">
				<section className="rounded-sm border border-border bg-surface p-4 shadow-sm">
					<div className="flex items-center gap-2">
						<IconTag className="h-4 w-4 text-text-2" />
						<h3 className="text-lg font-semibold text-text-1">{t("专栏信息")}</h3>
					</div>
					<div className="mt-4 space-y-2 text-sm leading-6 text-text-2">
						<div>
							<span className="font-medium text-text-1">{t("名称")}：</span>
							{review.template?.id ? (
								<Link
									href={`/columns?template_id=${review.template.id}`}
									className="break-words text-primary hover:underline"
								>
									{review.template?.name || t("未命名专栏")}
								</Link>
							) : (
								<span className="break-words">
									{review.template?.name || t("未命名专栏")}
								</span>
							)}
						</div>
						<div>
							<span className="font-medium text-text-1">{t("描述")}：</span>
							<span className="whitespace-normal break-words text-text-2">
								{templateDescriptionText || t("暂无描述")}
							</span>
						</div>
					</div>

					{tocItems.length > 0 ? (
						<div className="mt-5">
							<div className="mb-3 flex items-center justify-between">
								<div className="inline-flex items-center gap-2">
									<IconList className="h-4 w-4 text-text-2" />
									<h3 className="text-lg font-semibold text-text-1">{t("目录")}</h3>
								</div>
								<button
									type="button"
									onClick={() => setTocCollapsed((prev) => !prev)}
									className="text-text-3 transition hover:text-primary"
									title={tocCollapsed ? t("展开目录") : t("收起目录")}
									aria-label={tocCollapsed ? t("展开目录") : t("收起目录")}
								>
									<IconChevronDown
										className={`h-4 w-4 transition-transform duration-200 ${
											tocCollapsed ? "" : "rotate-180"
										}`}
									/>
								</button>
							</div>
							{!tocCollapsed ? (
								<TableOfContents
									items={tocItems}
									activeId={activeTocId}
									onSelect={handleTocSelect}
								/>
							) : null}
						</div>
					) : null}

					<div className="mt-5">
						<div className="mb-3 flex items-center gap-2">
							<IconClock className="h-4 w-4 text-text-2" />
							<h3 className="text-lg font-semibold text-text-1">{t("相关内容")}</h3>
						</div>
						{recentReviews.length === 0 ? (
							<div className="text-sm text-text-3">{t("暂无相关内容")}</div>
						) : (
							<div className="space-y-2 text-sm text-text-2">
								{recentReviews.map((item) => (
									<div key={item.id} className="flex items-start gap-2">
										<span className="text-text-3">·</span>
										<div className="min-w-0">
											<Link
												href={`/columns/${item.slug}`}
												className="line-clamp-2 text-sm font-medium leading-6 text-text-2 transition hover:text-text-1"
												target="_blank"
												rel="noreferrer"
												title={item.title}
											>
												{item.title}
											</Link>
										</div>
									</div>
								))}
							</div>
						)}
					</div>
				</section>
			</div>
		</aside>
	);
}

export default ColumnSidebar;
