import type { GetServerSideProps } from "next";
import Link from "next/link";
import { useRouter } from "next/router";
import { useEffect, useMemo, useRef, useState } from "react";

import AppFooter from "@/components/AppFooter";
import AppHeader from "@/components/AppHeader";
import SeoHead from "@/components/SeoHead";
import Button from "@/components/Button";
import { BackToTop } from "@/components/BackToTop";
import { IconDoc, IconList, IconNetwork, IconTag } from "@/components/icons";
import { useBasicSettings } from "@/contexts/BasicSettingsContext";
import {
	topicApi,
	type Article,
	type BasicSettings,
	type TopicDetail,
} from "@/lib/api";
import { formatArticleDisplayDate } from "@/lib/date";
import { useI18n } from "@/lib/i18n";
import { renderSafeMarkdown } from "@/lib/safeHtml";
import {
	fetchServerBasicSettings,
	fetchServerJson,
	resolveRequestOrigin,
} from "@/lib/serverApi";
import { buildCanonicalUrl, resolveSeoAssetUrl } from "@/lib/seo";

interface TopicPageProps {
	initialBasicSettings: BasicSettings;
	initialTopic: TopicDetail | null;
	initialKey: string;
	siteOrigin: string;
}

interface TocItem {
	id: string;
	text: string;
	level: number;
}

function deriveSummaryFromContent(contentMd?: string | null, limit = 180): string {
	const chunks = String(contentMd || "")
		.split(/\n\s*\n/)
		.map((part) => part.trim())
		.filter(Boolean);
	for (const chunk of chunks) {
		if (chunk.startsWith("#") || chunk.startsWith("|") || chunk.startsWith("```")) {
			continue;
		}
		const plain = chunk
			.replace(/!\[[^\]]*]\([^)]+\)/g, " ")
			.replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
			.replace(/[`*_>#]+/g, " ")
			.replace(/\s+/g, " ")
			.trim();
		if (plain) return plain.slice(0, limit);
	}
	return "";
}

function TableOfContents({
	items,
	activeId,
	onSelect,
}: {
	items: TocItem[];
	activeId: string;
	onSelect: (id: string) => void;
}) {
	if (items.length === 0) return null;
	return (
		<nav className="max-h-64 space-y-1 overflow-y-auto overscroll-contain border-l-2 border-border pl-2 pr-1">
			{items.map((item) => (
				<a
					key={item.id}
					href={`#${item.id}`}
					onClick={() => onSelect(item.id)}
					className={`block truncate rounded px-2 py-1 text-xs transition ${
						activeId === item.id
							? "bg-primary-soft font-semibold text-primary-ink"
							: "text-text-2 hover:bg-muted hover:text-text-1"
					}`}
					style={{ paddingLeft: `${(item.level - 1) * 8 + 8}px` }}
				>
					{item.text}
				</a>
			))}
		</nav>
	);
}

export const getServerSideProps: GetServerSideProps<TopicPageProps> = async ({
	req,
	params,
}) => {
	const key = String(params?.key || "").trim();
	const siteOrigin = resolveRequestOrigin(req);
	const initialBasicSettings = await fetchServerBasicSettings(req);
	if (!key) {
		return {
			props: {
				initialBasicSettings,
				initialTopic: null,
				initialKey: "",
				siteOrigin,
			},
		};
	}
	try {
		const initialTopic = await fetchServerJson<TopicDetail>(
			req,
			`/api/topics/${encodeURIComponent(key)}?page=1&size=10`,
		);
		return {
			props: {
				initialBasicSettings,
				initialTopic,
				initialKey: key,
				siteOrigin,
			},
		};
	} catch {
		return {
			props: {
				initialBasicSettings,
				initialTopic: null,
				initialKey: key,
				siteOrigin,
			},
		};
	}
};

function getArticleDisplayTitle(article: Article): string {
	return (article.title_trans || "").trim() || article.title || "";
}

export default function TopicDetailPage({
	initialBasicSettings,
	initialTopic,
	initialKey,
	siteOrigin,
}: TopicPageProps) {
	const router = useRouter();
	const { t, language } = useI18n();
	const { basicSettings } = useBasicSettings();
	const contentRef = useRef<HTMLDivElement | null>(null);
	const activeHeadingMapRef = useRef<Map<string, number>>(new Map());

	const topicKey = useMemo(() => {
		const raw = router.query.key;
		if (typeof raw === "string" && raw.trim()) return raw.trim();
		return initialKey;
	}, [initialKey, router.query.key]);

	const [topic, setTopic] = useState<TopicDetail | null>(initialTopic);
	const [loading, setLoading] = useState(!initialTopic);
	const [error, setError] = useState("");
	const [page, setPage] = useState(1);
	const [tocItems, setTocItems] = useState<TocItem[]>([]);
	const [activeTocId, setActiveTocId] = useState("");
	const [tocCollapsed, setTocCollapsed] = useState(false);

	useEffect(() => {
		if (!topicKey) return;
		if (initialTopic && topicKey === initialKey && page === 1) {
			setTopic(initialTopic);
			setLoading(false);
			setError("");
			return;
		}
		let disposed = false;
		const run = async () => {
			setLoading(true);
			setError("");
			try {
				const data = await topicApi.get(topicKey, { page, size: 10 });
				if (!disposed) setTopic(data);
			} catch (err) {
				console.error("Failed to load topic detail:", err);
				if (!disposed) {
					setTopic(null);
					setError(t("主题不存在或尚未公开"));
				}
			} finally {
				if (!disposed) setLoading(false);
			}
		};
		void run();
		return () => {
			disposed = true;
		};
	}, [initialKey, initialTopic, page, t, topicKey]);

	const siteName =
		basicSettings.site_name || initialBasicSettings.site_name || "Lumina";
	const title = topic?.title || topicKey || t("主题");
	const description =
		deriveSummaryFromContent(topic?.content_md) ||
		topic?.summary ||
		t("浏览该主题下的关联文章与沉淀摘要");
	const canonicalUrl = buildCanonicalUrl(
		siteOrigin,
		`/topics/${encodeURIComponent(topicKey || "")}`,
	);
	const seoImageUrl = resolveSeoAssetUrl(
		siteOrigin,
		basicSettings.site_logo_url ||
			initialBasicSettings.site_logo_url ||
			"/logo.png",
	);
	const articles: Article[] = topic?.articles?.data || [];
	const totalPages = topic?.articles?.pagination?.total_pages || 0;
	const relatedTopics = [...(topic?.related_topics || [])].sort(
		(a, b) => {
			const rank = (item: { topic_type?: string | null }) => {
				const type = String(item.topic_type || "").toLowerCase();
				if (type === "entity") return 0;
				if (type === "concept") return 1;
				return 2;
			};
			const rankDiff = rank(a) - rank(b);
			if (rankDiff !== 0) return rankDiff;
			return (
				String(a.title || a.key || "").length -
				String(b.title || b.key || "").length
			);
		},
	);
	const tags = [...(topic?.tags || [])].filter(Boolean).slice(0, 10);
	const topicTypeLabel =
		topic?.topic_type === "entity"
			? t("实体")
			: topic?.topic_type === "concept"
				? t("概念")
				: t("主题");
	const updatedAtText = formatArticleDisplayDate(
		null,
		topic?.updated_at || topic?.compiled_at || null,
		language,
	);
	const contentHtml = useMemo(
		() => renderSafeMarkdown(topic?.content_md || ""),
		[topic?.content_md],
	);

	useEffect(() => {
		if (loading) return;
		if (!contentRef.current) return;
		const rafId = requestAnimationFrame(() => {
			if (!contentRef.current) return;
			const headings = contentRef.current.querySelectorAll(
				"h1, h2, h3, h4, h5, h6",
			);
			const items: TocItem[] = [];
			headings.forEach((heading, index) => {
				const id = `topic-heading-${index}`;
				heading.id = id;
				items.push({
					id,
					text: heading.textContent || "",
					level: Number.parseInt(heading.tagName[1] || "2", 10) || 2,
				});
			});
			setTocItems(items);
			setActiveTocId(items[0]?.id || "");
		});
		return () => cancelAnimationFrame(rafId);
	}, [contentHtml, loading]);

	useEffect(() => {
		if (tocItems.length === 0) return;
		const observer = new IntersectionObserver(
			(entries) => {
				const activeMap = activeHeadingMapRef.current;
				entries.forEach((entry) => {
					const targetId = entry.target.id;
					if (entry.isIntersecting) {
						activeMap.set(targetId, entry.boundingClientRect.top);
					} else {
						activeMap.delete(targetId);
					}
				});
				if (activeMap.size > 0) {
					const nextActive = Array.from(activeMap.entries()).sort(
						(a, b) => a[1] - b[1],
					)[0]?.[0];
					if (nextActive) setActiveTocId(nextActive);
				}
			},
			{ rootMargin: "-80px 0px -80% 0px", threshold: [0, 0.1, 0.5] },
		);
		activeHeadingMapRef.current.clear();
		tocItems.forEach((item) => {
			const element = document.getElementById(item.id);
			if (element) observer.observe(element);
		});
		return () => observer.disconnect();
	}, [tocItems]);

	return (
		<div className="flex min-h-screen flex-col bg-app text-text-1">
			<SeoHead
				title={`${title} - ${siteName}`}
				description={description}
				canonicalUrl={canonicalUrl}
				imageUrl={seoImageUrl}
				siteName={siteName}
			/>
			<AppHeader activeNav="feed" />

			<section className="border-b border-border bg-surface">
				<div className="mx-auto max-w-7xl px-4 py-5 sm:py-6">
					<div className="mb-3 flex justify-center">
						<h1 className="text-center text-2xl font-bold text-text-1">
							{title}
						</h1>
					</div>
					<div className="flex flex-wrap items-center justify-center gap-3 pb-1 text-sm text-text-2">
						<span className="inline-flex items-center gap-1.5 rounded-sm bg-primary-soft px-2.5 py-1 text-xs font-medium leading-none text-primary-ink">
							<IconNetwork className="h-3.5 w-3.5" />
							{topicTypeLabel}
						</span>
						{updatedAtText ? (
							<span className="inline-flex items-center gap-1 text-xs sm:text-sm">
								<span className="font-medium text-text-2">{t("更新时间")}：</span>
								<time dateTime={topic?.updated_at || topic?.compiled_at || undefined}>
									{updatedAtText}
								</time>
							</span>
						) : null}
					</div>
					{tags.length > 0 ? (
						<div className="mx-auto mt-3 flex max-w-4xl flex-wrap items-center justify-center gap-2">
							{tags.map((tag) => (
								<span
									key={tag}
									className="inline-flex items-center rounded-sm bg-muted px-2.5 py-1 text-xs text-text-2"
								>
									{tag}
								</span>
							))}
						</div>
					) : null}
				</div>
			</section>

			<main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:py-8">
				{loading ? (
					<div className="flex flex-col gap-6 lg:flex-row">
						<div className="min-w-0 w-full max-w-4xl flex-1 rounded-sm border border-border bg-surface p-4 shadow-sm sm:p-6">
							<div className="mb-6 flex items-center justify-between">
								<span className="skeleton-shimmer motion-safe:animate-pulse h-6 w-24 rounded-sm" />
							</div>
							<div className="space-y-3">
								<div className="skeleton-shimmer motion-safe:animate-pulse h-4 w-full rounded-sm" />
								<div className="skeleton-shimmer motion-safe:animate-pulse h-4 w-5/6 rounded-sm" />
								<div className="skeleton-shimmer motion-safe:animate-pulse h-4 w-full rounded-sm" />
								<div className="skeleton-shimmer motion-safe:animate-pulse h-4 w-3/4 rounded-sm" />
							</div>
						</div>
						<aside className="hidden w-full shrink-0 lg:block lg:w-[420px]">
							<div className="rounded-sm border border-border bg-surface p-4 shadow-sm">
								<div className="skeleton-shimmer motion-safe:animate-pulse mb-4 h-5 w-20 rounded-sm" />
								<div className="space-y-2">
									<div className="skeleton-shimmer motion-safe:animate-pulse h-4 w-full rounded-sm" />
									<div className="skeleton-shimmer motion-safe:animate-pulse h-4 w-5/6 rounded-sm" />
								</div>
							</div>
						</aside>
					</div>
				) : error ? (
					<div className="rounded-sm border border-border bg-surface p-8 text-center text-text-2 shadow-sm">
						{error}
					</div>
				) : (
					<div className="flex flex-col gap-6 lg:flex-row">
						<section className="min-w-0 w-full max-w-4xl flex-1 rounded-sm border border-border bg-surface p-4 shadow-sm sm:p-6 lg:mx-0">
							<div className="mb-6 flex items-center justify-between gap-3">
								<h2 className="inline-flex items-center gap-2 text-lg font-semibold text-text-1">
									<IconDoc className="h-4 w-4" />
									<span>{t("内容")}</span>
								</h2>
							</div>
							{contentHtml ? (
								<div
									ref={contentRef}
									className="article-prose prose prose-sm max-w-none overflow-x-auto break-words text-text-1"
									dangerouslySetInnerHTML={{ __html: contentHtml }}
								/>
							) : (
								<div className="text-sm text-text-3">{t("暂无主题正文")}</div>
							)}
						</section>

						<aside className="w-full shrink-0 lg:w-[420px]">
							<div className="max-h-none overflow-visible lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto">
								<div className="rounded-sm border border-border bg-surface p-4 shadow-sm">
									<div className="space-y-6">
										{tocItems.length > 0 ? (
											<div>
												<div className="mb-3 flex items-center justify-between gap-2">
													<h2 className="inline-flex items-center gap-2 text-lg font-semibold text-text-1">
														<IconList className="h-4 w-4" />
														<span>{t("目录")}</span>
													</h2>
													<button
														type="button"
														onClick={() => setTocCollapsed((prev) => !prev)}
														className="text-text-3 transition hover:text-primary"
														title={tocCollapsed ? t("展开目录") : t("收起目录")}
														aria-label={
															tocCollapsed ? t("展开目录") : t("收起目录")
														}
													>
														<span className="text-xs">
															{tocCollapsed ? t("展开") : t("收起")}
														</span>
													</button>
												</div>
												{!tocCollapsed ? (
													<TableOfContents
														items={tocItems}
														activeId={activeTocId}
														onSelect={setActiveTocId}
													/>
												) : null}
											</div>
										) : null}

										{relatedTopics.length > 0 ? (
											<div
												className={
													tocItems.length > 0 ? "border-t border-border pt-4" : ""
												}
											>
												<h2 className="mb-3 inline-flex items-center gap-2 text-lg font-semibold text-text-1">
													<IconNetwork className="h-4 w-4" />
													<span>{t("相关主题")}</span>
												</h2>
												<div className="flex max-h-[7.5rem] flex-wrap content-start gap-2 overflow-y-auto overscroll-contain pr-1">
													{relatedTopics.map((item) => (
														<Link
															key={item.key}
															href={`/topics/${encodeURIComponent(item.key)}`}
															target="_blank"
															rel="noopener noreferrer"
															className="inline-flex max-w-full items-center rounded-sm bg-muted px-2.5 py-1 text-xs text-text-2 transition hover:bg-primary-soft hover:text-primary-ink"
															title={item.summary || item.title || item.key}
														>
															<span className="truncate">
																{item.title || item.key}
															</span>
														</Link>
													))}
												</div>
											</div>
										) : null}

										<div
											className={
												tocItems.length > 0 || relatedTopics.length > 0
													? "border-t border-border pt-4"
													: ""
											}
										>
											<div className="mb-3 flex items-center justify-between gap-2">
												<h2 className="inline-flex items-center gap-2 text-lg font-semibold text-text-1">
													<IconTag className="h-4 w-4" />
													<span>{t("关联文章")}</span>
												</h2>
											</div>
											{articles.length === 0 ? (
												<div className="text-sm text-text-3">
													{t("该主题暂无关联文章")}
												</div>
											) : (
												<div className="space-y-2 text-sm text-text-2">
													{articles.map((article) => {
														const displayTitle = getArticleDisplayTitle(article);
														return (
															<div
																key={article.id || article.slug}
																className="flex items-start gap-2"
															>
																<span className="text-text-3">·</span>
																<div className="flex min-w-0 items-center gap-2">
																	{article.category ? (
																		<span
																			className="shrink-0 rounded px-2 py-0.5 text-xs"
																			style={{
																				backgroundColor: article.category.color
																					? `${article.category.color}20`
																					: "var(--bg-muted)",
																				color:
																					article.category.color ||
																					"var(--text-2)",
																			}}
																		>
																			{article.category.name}
																		</span>
																	) : null}
																	<Link
																		href={`/article/${encodeURIComponent(article.slug)}`}
																		className="truncate transition hover:text-text-1"
																		title={displayTitle}
																	>
																		{displayTitle}
																	</Link>
																</div>
															</div>
														);
													})}
												</div>
											)}
											{totalPages > 1 ? (
												<div className="mt-4 flex items-center justify-center gap-3">
													<Button
														size="sm"
														variant="secondary"
														disabled={page <= 1}
														onClick={() =>
															setPage((prev) => Math.max(1, prev - 1))
														}
													>
														{t("上一页")}
													</Button>
													<span className="text-sm text-text-3">
														{page} / {totalPages}
													</span>
													<Button
														size="sm"
														variant="secondary"
														disabled={page >= totalPages}
														onClick={() =>
															setPage((prev) => Math.min(totalPages, prev + 1))
														}
													>
														{t("下一页")}
													</Button>
												</div>
											) : null}
										</div>
									</div>
								</div>
							</div>
						</aside>
					</div>
				)}
			</main>

			<AppFooter />
			<BackToTop />
		</div>
	);
}
