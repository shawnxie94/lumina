import type { GetServerSideProps } from "next";
import dayjs, { type Dayjs } from "dayjs";
import Link from "next/link";
import { useRouter } from "next/router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import AppFooter from "@/components/AppFooter";
import AppHeader from "@/components/AppHeader";
import Button from "@/components/Button";
import DateRangePicker from "@/components/DateRangePicker";
import FilterInput from "@/components/FilterInput";
import FilterSelect from "@/components/FilterSelect";
import FilterSelectInline from "@/components/FilterSelectInline";
import IconButton from "@/components/IconButton";
import ReviewManualGenerateModal from "@/components/ReviewManualGenerateModal";
import SelectField from "@/components/ui/SelectField";
import SeoHead from "@/components/SeoHead";
import TextInput from "@/components/ui/TextInput";
import { BackToTop } from "@/components/BackToTop";
import {
	IconChevronDown,
	IconChevronUp,
	IconEdit,
	IconEye,
	IconEyeOff,
	IconPlus,
	IconTag,
	IconTrash,
} from "@/components/icons";
import { useAuth } from "@/contexts/AuthContext";
import { useBasicSettings } from "@/contexts/BasicSettingsContext";
import {
	type BasicSettings,
	type ReviewIssue,
	type ReviewIssueListResponse,
	type ReviewTemplateFilterItem,
	type ReviewIssueVersionSummary,
	resolveMediaUrl,
	reviewApi,
} from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import {
	buildCanonicalUrl,
	buildMetaDescription,
	buildPathWithQuery,
	getReviewListPageSeo,
	resolveReviewListTemplateName,
	resolveSeoAssetUrl,
} from "@/lib/seo";
import {
	fetchServerAuthState,
	fetchServerBasicSettings,
	fetchServerReviews,
	resolveRequestOrigin,
} from "@/lib/serverApi";

type ReviewListQuery = Record<string, string>;

interface ReviewListPageProps {
	initialBasicSettings: BasicSettings;
	initialReviews: ReviewIssue[];
	initialTemplateFilters: ReviewTemplateFilterItem[];
	initialSelectedTemplateName: string | null;
	initialPagination: ReviewIssueListResponse["pagination"];
	initialQuery: ReviewListQuery;
	initialIsAdmin: boolean;
	initialDataLoaded: boolean;
	siteOrigin: string;
}

const REVIEW_QUERY_KEYS = [
	"template_id",
	"search",
	"published_at_start",
	"published_at_end",
	"visibility",
	"page",
	"size",
] as const;
const REVIEW_SEARCH_DEBOUNCE_MS = 500;

const getQueryValue = (value: string | string[] | undefined): string => {
	if (Array.isArray(value)) return value[0] || "";
	return value || "";
};

const pickReviewQuery = (
	query: Record<string, string | string[] | undefined>,
): ReviewListQuery => {
	const picked: ReviewListQuery = {};
	REVIEW_QUERY_KEYS.forEach((key) => {
		const value = getQueryValue(query[key]);
		if (value) {
			picked[key] = value;
		}
	});
	return picked;
};

const parseDateQuery = (value: string): Date | null => {
	if (!value) return null;
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? null : date;
};

const formatDate = (date: Date | null): string => {
	if (!date) return "";
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	return `${year}-${month}-${day}`;
};

const toDayjsRange = (range: [Date | null, Date | null]): [Dayjs | null, Dayjs | null] => [
	range[0] ? dayjs(range[0]) : null,
	range[1] ? dayjs(range[1]) : null,
];

const formatWindow = (issue: ReviewIssue, language: "zh-CN" | "en") => {
	const start = new Date(issue.window_start);
	const end = new Date(issue.window_end);
	const endLabel = new Date(end.getTime() - 24 * 60 * 60 * 1000);
	return `${start.toLocaleDateString(language === "en" ? "en-US" : "zh-CN")} - ${endLabel.toLocaleDateString(language === "en" ? "en-US" : "zh-CN")}`;
};

const getReviewCategoryChips = (
	review: ReviewIssue,
	t: (key: string) => string,
): string[] => {
	if (review.template?.include_all_categories) {
		return [t("全部分类")];
	}
	return review.category_names.length > 0 ? review.category_names : [];
};

const getTemplateFilterLabel = (
	template: ReviewTemplateFilterItem,
	t: (key: string) => string,
): string => (template.id ? template.name : t("全部回顾"));

export const getServerSideProps: GetServerSideProps<ReviewListPageProps> = async ({
	req,
	query,
}) => {
	const initialQuery = pickReviewQuery(query as Record<string, string | string[] | undefined>);
	const siteOrigin = resolveRequestOrigin(req);
	const page = Number(initialQuery.page || "1");
	const size = Number(initialQuery.size || "10");

	try {
		const [initialBasicSettings, initialIsAdmin, reviewsResponse] = await Promise.all([
			fetchServerBasicSettings(req),
			fetchServerAuthState(req),
			fetchServerReviews(req, {
				page: Number.isFinite(page) && page > 0 ? page : 1,
				size: Number.isFinite(size) && [10, 20, 50].includes(size) ? size : 10,
				template_id: initialQuery.template_id,
				search: initialQuery.search,
				published_at_start: initialQuery.published_at_start,
				published_at_end: initialQuery.published_at_end,
				visibility: initialQuery.visibility,
			}),
		]);
		let initialSelectedTemplateName: string | null = null;
		if (initialQuery.template_id) {
			initialSelectedTemplateName =
				reviewsResponse.filters?.templates?.find(
					(template) => template.id === initialQuery.template_id,
				)?.name || null;
			if (!initialSelectedTemplateName) {
				try {
					const fallbackResponse = await fetchServerReviews(req, {
						page: 1,
						size: 1,
						template_id: initialQuery.template_id,
					});
					initialSelectedTemplateName =
						fallbackResponse.filters?.templates?.find(
							(template) => template.id === initialQuery.template_id,
						)?.name ||
						fallbackResponse.data?.[0]?.template?.name ||
						null;
				} catch {
					initialSelectedTemplateName = null;
				}
			}
		}

		return {
			props: {
				initialBasicSettings,
				initialReviews: reviewsResponse.data || [],
				initialTemplateFilters: reviewsResponse.filters?.templates || [],
				initialSelectedTemplateName,
				initialPagination: reviewsResponse.pagination,
				initialQuery,
				initialIsAdmin,
				initialDataLoaded: true,
				siteOrigin,
			},
		};
	} catch {
		return {
			props: {
				initialBasicSettings: {
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
				},
				initialReviews: [],
				initialTemplateFilters: [],
				initialSelectedTemplateName: null,
				initialPagination: {
					page: 1,
					size: 10,
					total: 0,
					total_pages: 1,
				},
				initialQuery,
				initialIsAdmin: false,
				initialDataLoaded: false,
				siteOrigin,
			},
		};
	}
};

export default function ReviewListPage({
	initialReviews,
	initialTemplateFilters,
	initialSelectedTemplateName,
	initialPagination,
	initialQuery,
	initialIsAdmin,
	initialDataLoaded,
	siteOrigin,
}: ReviewListPageProps) {
	const router = useRouter();
	const { basicSettings } = useBasicSettings();
	const { isAdmin } = useAuth();
	const { t, language } = useI18n();
	const showAdminControls = initialIsAdmin || isAdmin;
	const [searchTerm, setSearchTerm] = useState(initialQuery.search || "");
	const [visibilityFilter, setVisibilityFilter] = useState(initialQuery.visibility || "");
	const [publishedDateRange, setPublishedDateRange] = useState<[Date | null, Date | null]>([
		parseDateQuery(initialQuery.published_at_start || ""),
		parseDateQuery(initialQuery.published_at_end || ""),
	]);
	const [issueActionKey, setIssueActionKey] = useState<string | null>(null);
	const [jumpToPage, setJumpToPage] = useState("");
	const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
	const [expandedVersionGroups, setExpandedVersionGroups] = useState<Record<string, boolean>>({});
	const [showManualGenerateModal, setShowManualGenerateModal] = useState(false);
	const filterDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const lastAutoFilterSignatureRef = useRef<string | null>(null);
	const lastSearchTermRef = useRef((initialQuery.search || "").trim());

	useEffect(() => {
		setSearchTerm(initialQuery.search || "");
		setVisibilityFilter(initialQuery.visibility || "");
		setPublishedDateRange([
			parseDateQuery(initialQuery.published_at_start || ""),
			parseDateQuery(initialQuery.published_at_end || ""),
		]);
	}, [initialQuery]);

	const reviews = initialReviews;
	const templateFilters = initialTemplateFilters;
	const currentPage = Math.max(1, Number(initialQuery.page || "1") || 1);
	const pageSize = [10, 20, 50].includes(Number(initialQuery.size || "10"))
		? Number(initialQuery.size || "10")
		: 10;
	const selectedTemplateId = initialQuery.template_id || "";
	const totalPages = Math.max(1, initialPagination.total_pages || 1);

	const siteName = basicSettings.site_name || "Lumina";
	const siteDescription = buildMetaDescription(
		`${siteName} ${t("回顾")} ${t("复盘内容重点沉淀周期总结")}`,
	);
	const seoImageUrl = resolveSeoAssetUrl(siteOrigin, basicSettings.site_logo_url || "/logo.png");
	const defaultTopImageUrl = useMemo(
		() => resolveMediaUrl(basicSettings.site_logo_url || "/logo.png"),
		[basicSettings.site_logo_url],
	);
	const selectedTemplateName = useMemo(
		() =>
			resolveReviewListTemplateName({
				selectedTemplateId,
				templateFilters,
				fallbackTemplateName: initialSelectedTemplateName,
			}),
		[initialSelectedTemplateName, selectedTemplateId, templateFilters],
	);
	const reviewListSeo = useMemo(
		() =>
			getReviewListPageSeo(initialQuery, {
				siteName,
				siteDescription,
				templateName: selectedTemplateName,
			}),
		[initialQuery, selectedTemplateName, siteDescription, siteName],
	);
	const canonicalUrl = useMemo(
		() => buildCanonicalUrl(siteOrigin, "/reviews", reviewListSeo.canonicalQuery),
		[siteOrigin, reviewListSeo.canonicalQuery],
	);
	const reviewListHeading = useMemo(() => {
		const pageLabel = currentPage > 1 ? ` - ${t("第")} ${currentPage} ${t("页")}` : "";
		if (selectedTemplateName) {
			return `${selectedTemplateName}${t("回顾")}${pageLabel}`;
		}
		return `${t("回顾")}${pageLabel}`;
	}, [currentPage, selectedTemplateName, t]);
	const reviewListStructuredData = reviewListSeo.indexable ? [
		{
			"@context": "https://schema.org",
			"@type": "CollectionPage",
			name: reviewListSeo.title,
			description: reviewListSeo.description,
			url: canonicalUrl,
		},
		{
			"@context": "https://schema.org",
			"@type": "ItemList",
			name: reviewListHeading,
			itemListOrder: "https://schema.org/ItemListOrderDescending",
			numberOfItems: reviews.length,
			itemListElement: reviews.map((review, index) => ({
				"@type": "ListItem",
				position: index + 1,
				url: buildCanonicalUrl(siteOrigin, `/reviews/${review.slug}`),
				name: review.title,
			})),
		},
	] : [];

	const buildNextQuery = useCallback((
		overrides?: Partial<Record<keyof ReviewListQuery, string | undefined>>,
	): ReviewListQuery => {
		const nextQuery: ReviewListQuery = {
			template_id: selectedTemplateId,
			search: searchTerm.trim(),
			published_at_start: formatDate(publishedDateRange[0]),
			published_at_end: formatDate(publishedDateRange[1]),
			visibility: showAdminControls ? visibilityFilter : "",
			page: String(currentPage),
			size: String(pageSize),
			...overrides,
		};
		Object.keys(nextQuery).forEach((key) => {
			if (!nextQuery[key]) {
				delete nextQuery[key];
			}
		});
		return nextQuery;
	}, [
		selectedTemplateId,
		searchTerm,
		publishedDateRange,
		showAdminControls,
		visibilityFilter,
		currentPage,
		pageSize,
	]);

	const navigateWithQuery = (query: ReviewListQuery) =>
		router.push(buildPathWithQuery("/reviews", query));

	const handleClearFilters = () => {
		setSearchTerm("");
		setVisibilityFilter("");
		setPublishedDateRange([null, null]);
	};

	const buildTemplateHref = (templateId: string) =>
		buildPathWithQuery(
			"/reviews",
			buildNextQuery({
				template_id: templateId || undefined,
				page: "1",
			}),
		);

	const buildPaginationHref = (page: number) =>
		buildPathWithQuery(
			"/reviews",
			buildNextQuery({
				page: String(page),
			}),
		);

	useEffect(() => {
		if (!router.isReady) return;
		const filterSignature = JSON.stringify({
			template_id: selectedTemplateId,
			search: searchTerm.trim(),
			published_at_start: formatDate(publishedDateRange[0]),
			published_at_end: formatDate(publishedDateRange[1]),
			visibility: showAdminControls ? visibilityFilter : "",
		});
		if (lastAutoFilterSignatureRef.current === null) {
			lastAutoFilterSignatureRef.current = filterSignature;
			return;
		}
		if (lastAutoFilterSignatureRef.current === filterSignature) {
			return;
		}
		lastAutoFilterSignatureRef.current = filterSignature;
		const nextPath = buildPathWithQuery(
			"/reviews",
			buildNextQuery({
				page: "1",
			}),
		);
		const currentPath = buildPathWithQuery(
			"/reviews",
			pickReviewQuery(router.query as Record<string, string | string[] | undefined>),
		);
		if (nextPath === currentPath) return;
			if (filterDebounceRef.current) {
				clearTimeout(filterDebounceRef.current);
			}
			const normalizedSearchTerm = searchTerm.trim();
			const searchChanged = lastSearchTermRef.current !== normalizedSearchTerm;
			lastSearchTermRef.current = normalizedSearchTerm;
			filterDebounceRef.current = setTimeout(
				() => {
					void router.replace(nextPath, undefined, { scroll: false });
				},
				searchChanged ? REVIEW_SEARCH_DEBOUNCE_MS : 0,
			);
		return () => {
			if (filterDebounceRef.current) {
				clearTimeout(filterDebounceRef.current);
			}
		};
	}, [
		router,
		router.isReady,
		router.query,
		buildNextQuery,
		searchTerm,
		visibilityFilter,
		publishedDateRange,
		pageSize,
		selectedTemplateId,
		showAdminControls,
	]);

	const visibilityOptions = useMemo(
		() => [
			{ value: "", label: t("全部") },
			{ value: "published", label: t("已发布") },
			{ value: "draft", label: t("草稿") },
		],
		[t],
	);

	const activeFilters = useMemo(() => {
		const filters: string[] = [];
		const templateName = templateFilters.find((template) => template.id === selectedTemplateId)?.name;
		if (templateName) filters.push(`${t("回顾模板")}：${templateName}`);
		if (searchTerm.trim()) filters.push(`${t("标题")}：${searchTerm.trim()}`);
		if (publishedDateRange[0] || publishedDateRange[1]) {
			filters.push(
				`${t("发表时间")}：${formatDate(publishedDateRange[0])} ~ ${formatDate(publishedDateRange[1])}`.trim(),
			);
		}
		if (showAdminControls && visibilityFilter) {
			filters.push(
				`${t("可见性")}：${
					visibilityFilter === "published" ? t("已发布") : t("草稿")
				}`,
			);
		}
		return filters;
	}, [
		templateFilters,
		selectedTemplateId,
		searchTerm,
		publishedDateRange,
		showAdminControls,
		visibilityFilter,
		t,
	]);

	const handleJumpToPage = async () => {
		const pageNum = parseInt(jumpToPage, 10);
		if (pageNum >= 1 && pageNum <= totalPages) {
			await navigateWithQuery(
				buildNextQuery({
					page: String(pageNum),
				}),
			);
			setJumpToPage("");
		}
	};

	const refreshCurrentList = async (
		overrides?: Partial<Record<keyof ReviewListQuery, string | undefined>>,
	) => {
		await router.replace(buildPathWithQuery("/reviews", buildNextQuery(overrides)), undefined, {
			scroll: false,
		});
	};

	const handlePublishIssue = async (issueId: string) => {
		setIssueActionKey(`publish:${issueId}`);
		try {
			await reviewApi.publishIssue(issueId);
			await refreshCurrentList();
		} finally {
			setIssueActionKey(null);
		}
	};

	const handleUnpublishIssue = async (issueId: string) => {
		setIssueActionKey(`unpublish:${issueId}`);
		try {
			await reviewApi.unpublishIssue(issueId);
			await refreshCurrentList();
		} finally {
			setIssueActionKey(null);
		}
	};

	const handleDeleteIssue = async (issueId: string) => {
		if (typeof window !== "undefined" && !window.confirm(`${t("删除")}？`)) {
			return;
		}
		setIssueActionKey(`delete:${issueId}`);
		try {
			await reviewApi.deleteIssue(issueId);
			const nextPage = reviews.length === 1 && currentPage > 1 ? String(currentPage - 1) : String(currentPage);
			await refreshCurrentList({ page: nextPage });
		} finally {
			setIssueActionKey(null);
		}
	};

	const toggleVersionGroup = (groupId: string) => {
		setExpandedVersionGroups((current) => ({
			...current,
			[groupId]: !current[groupId],
		}));
	};

	const getReviewVersions = (review: ReviewIssue): ReviewIssueVersionSummary[] =>
		review.versions && review.versions.length > 0
			? review.versions
			: [
					{
						id: review.id,
						slug: review.slug,
						title: review.title,
						status: review.status,
						generated_at: review.generated_at,
						published_at: review.published_at,
						created_at: review.created_at,
						updated_at: review.updated_at,
					},
				];

	return (
		<div className="min-h-screen bg-app flex flex-col">
			<SeoHead
				title={reviewListSeo.title}
				description={reviewListSeo.description}
				canonicalUrl={canonicalUrl}
				robots={reviewListSeo.robots}
				imageUrl={seoImageUrl}
				siteName={siteName}
				structuredData={reviewListStructuredData}
			/>
			<AppHeader />
			<div className="lg:hidden border-b border-border bg-surface panel-subtle">
				<div className="max-w-7xl mx-auto px-4 py-3">
					<div className="flex items-center gap-2 overflow-x-auto">
						{templateFilters.map((template) => (
							<Link
								key={template.id || "all"}
								href={buildTemplateHref(template.id)}
								aria-current={selectedTemplateId === template.id ? "page" : undefined}
								className={`whitespace-nowrap px-3 py-1.5 text-sm rounded-full transition ${
									selectedTemplateId === template.id
										? "bg-primary-soft text-primary-ink"
										: "bg-muted text-text-2"
								}`}
							>
								{getTemplateFilterLabel(template, t)} ({template.count})
							</Link>
						))}
					</div>
				</div>
			</div>
			<main className="flex-1">
				<div className="max-w-7xl mx-auto px-4 py-6 sm:py-8">
					<div className="sr-only">
						<h1 className="text-2xl font-semibold text-text-1">{reviewListHeading}</h1>
						<p className="mt-2 text-sm text-text-2">{reviewListSeo.description}</p>
					</div>
					<div className="flex flex-col lg:flex-row gap-6">
						<aside
							className={`hidden lg:block flex-shrink-0 w-full transition-all duration-300 ${
								sidebarCollapsed ? "lg:w-12" : "lg:w-56"
							}`}
						>
							<div className="panel-raised rounded-sm border border-border p-4 max-h-none overflow-visible lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto">
								<div className="flex items-center justify-between mb-4">
									{!sidebarCollapsed && (
										<h2 className="font-semibold text-text-1 inline-flex items-center gap-2">
											<IconTag className="h-4 w-4" />
											<span>{t("模板筛选")}</span>
										</h2>
									)}
									<button
										type="button"
										onClick={() => setSidebarCollapsed((prev) => !prev)}
										className="text-text-3 hover:text-text-2 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35"
										title={sidebarCollapsed ? t("展开") : t("收起")}
										aria-label={sidebarCollapsed ? t("展开") : t("收起")}
									>
										{sidebarCollapsed ? "»" : "«"}
									</button>
								</div>
								{!sidebarCollapsed && (
									<div className="space-y-2">
										{templateFilters.map((template) => (
											<Link
												key={template.id || "all"}
												href={buildTemplateHref(template.id)}
												aria-current={selectedTemplateId === template.id ? "page" : undefined}
												className={`block w-full text-left px-3 py-2 rounded-sm transition ${
													selectedTemplateId === template.id
														? "bg-primary-soft text-primary-ink"
														: "hover:bg-muted"
												}`}
											>
												{getTemplateFilterLabel(template, t)} ({template.count})
											</Link>
										))}
									</div>
								)}
							</div>
						</aside>

						<main className="flex-1 min-w-0" aria-busy={!initialDataLoaded}>
							<div className="sr-only">
								<h1 className="text-2xl font-semibold text-text-1">{t("周期回顾")}</h1>
								<p className="mt-2 text-sm text-text-2">{siteDescription}</p>
							</div>
							<div className="panel-raised rounded-sm border border-border p-4 sm:p-6 mb-6">
								<div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
									<div className="flex items-center gap-2">
										{showAdminControls ? (
											<Button
												type="button"
												onClick={() => setShowManualGenerateModal(true)}
												variant="primary"
												size="sm"
												className="hidden lg:inline-flex whitespace-nowrap"
											>
												<span className="inline-flex items-center gap-2">
													<IconPlus className="h-4 w-4" />
													<span>{t("立即生成")}</span>
												</span>
											</Button>
										) : null}
									</div>
									<div className="hidden lg:flex flex-wrap items-center gap-4 lg:justify-end flex-1">
										<div className="flex flex-1 min-w-0 items-center gap-2">
											<label
												htmlFor="review-title-filter"
												className="whitespace-nowrap text-sm text-text-2"
											>
												{t("标题")}：
											</label>
											<TextInput
												id="review-title-filter"
												type="text"
												value={searchTerm}
												onChange={(event) => setSearchTerm(event.target.value)}
												placeholder={t("模糊匹配标题")}
												className="flex-1 min-w-0"
											/>
										</div>
										<div className="flex flex-1 min-w-0 items-center gap-2">
											<label
												htmlFor="review-created-range"
												className="whitespace-nowrap text-sm text-text-2"
											>
												{t("发表时间")}：
											</label>
											<div className="flex-1 min-w-0">
												<DateRangePicker
													id="review-created-range"
													value={toDayjsRange(publishedDateRange)}
													onChange={(values) => {
														const [start, end] = values || [];
														setPublishedDateRange([
															start ? start.toDate() : null,
															end ? end.toDate() : null,
														]);
													}}
													className="w-full"
												/>
											</div>
										</div>
										{showAdminControls && (
											<div className="shrink-0">
												<FilterSelectInline
													label={`${t("可见性")}：`}
													value={visibilityFilter}
													onChange={setVisibilityFilter}
													showSearch={false}
													options={visibilityOptions}
												/>
											</div>
										)}
									</div>
									<div className="grid grid-cols-1 gap-4 lg:hidden">
										{showAdminControls ? (
											<Button
												type="button"
												onClick={() => setShowManualGenerateModal(true)}
												variant="primary"
												size="sm"
												className="w-full"
											>
												<span className="inline-flex items-center gap-2">
													<IconPlus className="h-4 w-4" />
													<span>{t("立即生成")}</span>
												</span>
											</Button>
										) : null}
										<FilterInput
											label={t("标题")}
											value={searchTerm}
											onChange={setSearchTerm}
											placeholder={t("模糊匹配标题")}
										/>
										<div>
											<label htmlFor="review-created-range-mobile" className="block text-sm text-text-2 mb-1.5">
												{t("发表时间")}
											</label>
											<DateRangePicker
												id="review-created-range-mobile"
												value={toDayjsRange(publishedDateRange)}
												onChange={(values) => {
													const [start, end] = values || [];
													setPublishedDateRange([
														start ? start.toDate() : null,
														end ? end.toDate() : null,
													]);
												}}
												className="w-full"
											/>
										</div>
										{showAdminControls ? (
											<FilterSelect
												label={t("可见性")}
												value={visibilityFilter}
												onChange={setVisibilityFilter}
												showSearch={false}
												options={visibilityOptions}
											/>
										) : null}
									</div>
								</div>
								<div className="mt-4 pt-4 border-t border-border">
									<div className="flex flex-wrap items-center gap-2">
										{activeFilters.length === 0 ? (
											<span className="text-sm text-text-3">{t("暂无筛选条件")}</span>
										) : (
											activeFilters.map((filter) => (
												<span
													key={filter}
													className="filter-chip px-2.5 py-1 text-sm rounded-sm"
												>
													{filter}
												</span>
											))
										)}
										<div className="ml-auto flex flex-wrap items-center gap-2">
											<button
												type="button"
												onClick={handleClearFilters}
												className={`ml-auto px-3 py-1 text-sm rounded-sm transition ${
													activeFilters.length === 0
														? "bg-muted text-text-3 cursor-not-allowed"
														: "bg-surface text-text-2 hover:bg-muted hover:text-text-1"
												}`}
												disabled={activeFilters.length === 0}
											>
												{t("清除筛选")}
											</button>
										</div>
									</div>
								</div>
							</div>

							{!initialDataLoaded ? (
								<div className="panel-subtle rounded-sm border border-border text-center py-12 text-text-3">
									{t("加载中")}
								</div>
							) : reviews.length === 0 ? (
								<div className="panel-subtle rounded-sm border border-border text-center py-12 text-text-3">
									{t("暂无回顾")}
								</div>
							) : (
								<>
									<div className="space-y-4">
										{reviews.map((review) => (
											(() => {
												const showViewStat = (review.view_count ?? 0) > 0;
												const showCommentStat = (review.comment_count ?? 0) > 0;
												const mediaStatsOverlay = (showViewStat || showCommentStat) ? (
													<div
														className="absolute inset-x-2 bottom-1.5 flex items-center justify-end gap-2 pointer-events-none text-[11px] font-semibold leading-none text-white"
														style={{ textShadow: "0 1px 8px rgba(0, 0, 0, 0.88)" }}
													>
														{showViewStat ? (
															<span className="inline-flex items-center gap-0.5">
																<IconEye className="h-4 w-4 shrink-0 drop-shadow-[0_1px_6px_rgba(0,0,0,0.92)]" />
																<span>{review.view_count}</span>
															</span>
														) : null}
														{showCommentStat ? (
															<span className="inline-flex items-center gap-0.5">
																<IconEdit className="h-4 w-4 shrink-0 drop-shadow-[0_1px_6px_rgba(0,0,0,0.92)]" />
																<span>{review.comment_count}</span>
															</span>
														) : null}
													</div>
												) : null;
												return (
											<article
												key={review.id}
												className={`panel-raised rounded-lg border border-border p-4 sm:p-6 min-h-[184px] transition relative hover:shadow-md ${
													review.status === "draft" ? "opacity-60" : ""
												}`}
											>
												{showAdminControls ? (
													<div className="absolute top-3 right-3 flex items-center gap-1">
														{review.status === "draft" ? (
															<IconButton
																onClick={() => void handlePublishIssue(review.id)}
																variant="default"
																size="sm"
																title={t("发布")}
																loading={issueActionKey === `publish:${review.id}`}
																disabled={issueActionKey !== null}
															>
																<IconEye className="h-4 w-4" />
															</IconButton>
														) : (
															<IconButton
																onClick={() => void handleUnpublishIssue(review.id)}
																variant="default"
																size="sm"
																title={t("返回草稿")}
																loading={issueActionKey === `unpublish:${review.id}`}
																disabled={issueActionKey !== null}
															>
																<IconEyeOff className="h-4 w-4" />
															</IconButton>
														)}
														<IconButton
															onClick={() => void handleDeleteIssue(review.id)}
															variant="danger"
															size="sm"
															title={t("删除")}
															loading={issueActionKey === `delete:${review.id}`}
															disabled={issueActionKey !== null}
														>
															<IconTrash className="h-4 w-4" />
														</IconButton>
													</div>
												) : null}
												<div className="flex flex-col gap-4 sm:flex-row sm:items-start">
													<Link
														href={`/reviews/${review.slug}`}
														className="relative block w-full self-start overflow-hidden rounded-lg bg-muted aspect-video sm:w-40 sm:aspect-square"
														target="_blank"
														rel="noopener noreferrer"
													>
														<img
															src={
																resolveMediaUrl(review.top_image || "") ||
																defaultTopImageUrl ||
																"/logo.png"
															}
															alt={review.title}
															className="absolute inset-0 h-full w-full object-cover"
															loading="lazy"
															decoding="async"
														/>
														<span className="language-tag absolute left-2 top-2 px-2 py-0.5 text-xs">
															{review.template?.name || t("回顾模板")}
														</span>
														{mediaStatsOverlay}
													</Link>
													<div className="flex-1 sm:pr-6 min-w-0">
														<Link
															href={`/reviews/${review.slug}`}
															target="_blank"
															rel="noopener noreferrer"
														>
															<h2 className="text-xl font-semibold text-text-1 hover:text-primary transition cursor-pointer">
																{review.title}
															</h2>
														</Link>
														<div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-text-2">
															{getReviewCategoryChips(review, t).length > 0 ? (
																<span className="inline-flex flex-wrap items-center gap-2 min-w-0">
																	{getReviewCategoryChips(review, t).map((categoryName) => (
																		<span
																			key={`${review.id}-${categoryName}`}
																			className="px-2 py-1 text-xs rounded-sm bg-muted text-text-2"
																		>
																			{categoryName}
																		</span>
																	))}
																</span>
															) : null}
															<span>{t("本期范围")}：{formatWindow(review, language)}</span>
															{review.published_at ? (
																<span>{t("发表时间")}：{formatDate(new Date(review.published_at))}</span>
															) : null}
														</div>
														{review.summary ? (
															<p className="mt-2 text-text-2 line-clamp-3">
																{review.summary}
															</p>
														) : null}
														{(review.version_count || 1) > 1 ? (
															<div className="mt-4">
																<div className="flex items-center gap-3">
																{(() => {
																	const versionToggleLabel = `${review.version_count || 0} ${t("个版本")}`;
																	return (
																<button
																	type="button"
																	onClick={() => toggleVersionGroup(review.id)}
																	className="inline-flex items-center gap-1 text-xs text-text-3 hover:text-text-1 transition"
																	aria-expanded={expandedVersionGroups[review.id] || false}
																	title={versionToggleLabel}
																	aria-label={versionToggleLabel}
																>
																	{expandedVersionGroups[review.id] ? (
																		<IconChevronUp className="h-3.5 w-3.5" />
																	) : (
																		<IconChevronDown className="h-3.5 w-3.5" />
																	)}
																	<span>{versionToggleLabel}</span>
																</button>
																	);
																})()}
																	<div className="h-px flex-1 bg-border" />
																</div>
																{expandedVersionGroups[review.id] ? (
																	<div className="mt-3 space-y-2">
																		{getReviewVersions(review).map((version, index) => (
																			<div
																				key={version.id}
																				className="rounded-sm border border-border bg-surface px-3 py-3"
																			>
																				<div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
																					<div className="min-w-0">
																						<div className="flex flex-wrap items-center gap-2 text-xs text-text-3">
																							<span className="filter-chip px-2 py-0.5 rounded-sm">
																								V{(review.version_count || 0) - index}
																							</span>
																							<span>
																								{version.status === "published"
																									? t("已发布")
																									: t("草稿")}
																							</span>
																							<span>
																								{t("创建时间")}：
																								{formatDate(new Date(version.created_at))}
																							</span>
																							{version.published_at ? (
																								<span>
																									{t("发表时间")}：
																									{formatDate(new Date(version.published_at))}
																								</span>
																							) : null}
																						</div>
																						<Link
																							href={`/reviews/${version.slug}`}
																							className="mt-1 block truncate text-sm font-medium text-primary hover:underline"
																							target="_blank"
																							rel="noopener noreferrer"
																						>
																							{version.title}
																						</Link>
																					</div>
																					{showAdminControls ? (
																						<div className="flex items-center gap-1 shrink-0">
																							{version.status === "draft" ? (
																								<IconButton
																									onClick={() => void handlePublishIssue(version.id)}
																									variant="default"
																									size="sm"
																									title={t("发布")}
																									loading={issueActionKey === `publish:${version.id}`}
																									disabled={issueActionKey !== null}
																								>
																									<IconEye className="h-4 w-4" />
																								</IconButton>
																							) : (
																								<IconButton
																									onClick={() => void handleUnpublishIssue(version.id)}
																									variant="default"
																									size="sm"
																									title={t("返回草稿")}
																									loading={issueActionKey === `unpublish:${version.id}`}
																									disabled={issueActionKey !== null}
																								>
																									<IconEyeOff className="h-4 w-4" />
																								</IconButton>
																							)}
																							<IconButton
																								onClick={() => void handleDeleteIssue(version.id)}
																								variant="danger"
																								size="sm"
																								title={t("删除")}
																								loading={issueActionKey === `delete:${version.id}`}
																								disabled={issueActionKey !== null}
																							>
																								<IconTrash className="h-4 w-4" />
																							</IconButton>
																						</div>
																					) : null}
																				</div>
																			</div>
																		))}
																	</div>
																) : null}
															</div>
														) : null}
													</div>
												</div>
											</article>
												);
											})()
										))}
									</div>

									<div className="mt-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
										<div className="flex flex-wrap items-center gap-2 text-sm text-text-2">
											<span>{t("每页显示")}</span>
											<SelectField
												value={pageSize}
												onChange={(value) =>
													void navigateWithQuery(
														buildNextQuery({
															size: String(value),
															page: "1",
														}),
													)
												}
												className="w-20"
												options={[
													{ value: 10, label: "10" },
													{ value: 20, label: "20" },
													{ value: 50, label: "50" },
												]}
											/>
											<span>
												{t("共")} {initialPagination.total} {t("条")}
											</span>
										</div>
										<div className="flex flex-wrap items-center gap-2">
											{currentPage > 1 ? (
												<Link
													href={buildPaginationHref(currentPage - 1)}
													className="inline-flex items-center justify-center rounded-sm transition font-medium focus:outline-none px-3 py-1.5 text-sm border border-border bg-surface text-text-2 hover:bg-muted"
												>
													{t("上一页")}
												</Link>
											) : (
												<span className="inline-flex items-center justify-center rounded-sm px-3 py-1.5 text-sm border border-border bg-muted text-text-3">
													{t("上一页")}
												</span>
											)}
											<span className="px-4 py-2 text-sm bg-surface border border-border rounded-sm text-text-2">
												{t("第")} {currentPage} / {totalPages} {t("页")}
											</span>
											{currentPage < totalPages ? (
												<Link
													href={buildPaginationHref(currentPage + 1)}
													className="inline-flex items-center justify-center rounded-sm transition font-medium focus:outline-none px-3 py-1.5 text-sm border border-border bg-surface text-text-2 hover:bg-muted"
												>
													{t("下一页")}
												</Link>
											) : (
												<span className="inline-flex items-center justify-center rounded-sm px-3 py-1.5 text-sm border border-border bg-muted text-text-3">
													{t("下一页")}
												</span>
											)}
											<div className="ml-2 flex flex-none items-center gap-1 whitespace-nowrap">
												<TextInput
													type="number"
													value={jumpToPage}
													onChange={(event) => setJumpToPage(event.target.value)}
													onKeyDown={(event) => event.key === "Enter" && void handleJumpToPage()}
													className="w-16 text-center"
													compact
													min={1}
													max={totalPages}
												/>
												<Button
													onClick={() => void handleJumpToPage()}
													variant="primary"
													size="sm"
													className="whitespace-nowrap"
												>
													{t("跳转")}
												</Button>
											</div>
										</div>
									</div>
								</>
							)}
						</main>
					</div>
				</div>
				<BackToTop />
				<ReviewManualGenerateModal
					isOpen={showManualGenerateModal}
					onClose={() => setShowManualGenerateModal(false)}
					initialTemplateId={selectedTemplateId}
				/>
			</main>
			<AppFooter />
		</div>
	);
}
