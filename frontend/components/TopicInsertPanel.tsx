import { useEffect, useMemo, useState } from "react";

import Button from "@/components/Button";
import {
	IconDoc,
	IconLink,
	IconSearch,
	IconNetwork,
} from "@/components/icons";
import ModalShell from "@/components/ui/ModalShell";
import TextInput from "@/components/ui/TextInput";
import { topicApi, type Article, type TopicSummary } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import {
	buildTopicArticlePlaceholder,
	buildTopicPlaceholder,
} from "@/lib/topicPlaceholders";

interface TopicInsertPanelProps {
	isOpen: boolean;
	onClose: () => void;
	onInsert: (markdown: string) => void;
}

type ViewMode = "topics" | "articles";

export default function TopicInsertPanel({
	isOpen,
	onClose,
	onInsert,
}: TopicInsertPanelProps) {
	const { t } = useI18n();
	const [query, setQuery] = useState("");
	const [topics, setTopics] = useState<TopicSummary[]>([]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState("");
	const [viewMode, setViewMode] = useState<ViewMode>("topics");
	const [activeTopic, setActiveTopic] = useState<TopicSummary | null>(null);
	const [articles, setArticles] = useState<Article[]>([]);
	const [articlesLoading, setArticlesLoading] = useState(false);
	const [articlesError, setArticlesError] = useState("");

	useEffect(() => {
		if (!isOpen) {
			setQuery("");
			setTopics([]);
			setLoading(false);
			setError("");
			setViewMode("topics");
			setActiveTopic(null);
			setArticles([]);
			setArticlesLoading(false);
			setArticlesError("");
		}
	}, [isOpen]);

	useEffect(() => {
		if (!isOpen || viewMode !== "topics") return;
		let disposed = false;
		const timer = window.setTimeout(async () => {
			setLoading(true);
			setError("");
			try {
				const response = await topicApi.list({
					q: query.trim() || undefined,
					page: 1,
					size: 30,
				});
				if (!disposed) {
					setTopics(response.data || []);
				}
			} catch (err) {
				console.error("Failed to load topics for insert panel:", err);
				if (!disposed) {
					setTopics([]);
					setError(t("主题列表加载失败"));
				}
			} finally {
				if (!disposed) setLoading(false);
			}
		}, 200);
		return () => {
			disposed = true;
			window.clearTimeout(timer);
		};
	}, [isOpen, query, t, viewMode]);

	const handleOpenTopicArticles = async (topic: TopicSummary) => {
		setActiveTopic(topic);
		setViewMode("articles");
		setArticlesLoading(true);
		setArticlesError("");
		setArticles([]);
		try {
			const detail = await topicApi.get(topic.key, { page: 1, size: 50 });
			setArticles(detail.articles?.data || []);
		} catch (err) {
			console.error("Failed to load topic articles:", err);
			setArticlesError(t("主题文章加载失败"));
		} finally {
			setArticlesLoading(false);
		}
	};

	const subtitle = useMemo(() => {
		if (viewMode === "articles" && activeTopic) {
			return activeTopic.title || activeTopic.key;
		}
		return t("按主题取用文章或插入主题引用");
	}, [activeTopic, t, viewMode]);

	return (
		<ModalShell
			isOpen={isOpen}
			onClose={onClose}
			title={t("按主题取用")}
			widthClassName="max-w-3xl"
			bodyClassName="space-y-4 p-4 lg:p-5"
		>
			<div className="flex flex-wrap items-start justify-between gap-3">
				<p className="text-sm text-text-2">{subtitle}</p>
				{viewMode === "articles" ? (
					<Button
						variant="ghost"
						size="sm"
						onClick={() => {
							setViewMode("topics");
							setActiveTopic(null);
							setArticles([]);
							setArticlesError("");
						}}
					>
						{t("返回主题列表")}
					</Button>
				) : null}
			</div>

			{viewMode === "topics" ? (
				<>
					<div className="relative">
						<IconSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-3" />
						<TextInput
							value={query}
							onChange={(event) => setQuery(event.target.value)}
							placeholder={t("搜索主题")}
							className="pl-9"
						/>
					</div>
					{loading ? (
						<div className="rounded-sm border border-border bg-muted/20 px-4 py-6 text-sm text-text-3">
							{t("加载中")}
						</div>
					) : error ? (
						<div className="rounded-sm border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger-ink">
							{error}
						</div>
					) : topics.length === 0 ? (
						<div className="rounded-sm border border-border bg-muted/20 px-4 py-6 text-sm text-text-3">
							{t("暂无主题")}
						</div>
					) : (
						<div className="max-h-[28rem] space-y-2 overflow-y-auto">
							{topics.map((topic) => (
								<div
									key={topic.key}
									className="flex flex-wrap items-center justify-between gap-3 rounded-sm border border-border bg-surface px-3 py-3"
								>
									<div className="min-w-0">
										<div className="flex items-center gap-2 text-sm font-medium text-text-1">
											<IconNetwork className="h-4 w-4 shrink-0 text-text-3" />
											<span className="truncate">{topic.title || topic.key}</span>
										</div>
										<div className="mt-1 text-xs text-text-3">
											{t("文章数")} {topic.article_count || 0}
											{topic.summary ? ` · ${topic.summary}` : ""}
										</div>
									</div>
									<div className="flex items-center gap-2">
										<Button
											size="sm"
											variant="ghost"
											onClick={() => onInsert(buildTopicPlaceholder(topic.key))}
										>
											<span className="inline-flex items-center gap-1">
												<IconLink className="h-3.5 w-3.5" />
												{t("插入主题")}
											</span>
										</Button>
										<Button size="sm" onClick={() => void handleOpenTopicArticles(topic)}>
											<span className="inline-flex items-center gap-1">
												<IconDoc className="h-3.5 w-3.5" />
												{t("取用文章")}
											</span>
										</Button>
									</div>
								</div>
							))}
						</div>
					)}
				</>
			) : (
				<>
					{articlesLoading ? (
						<div className="rounded-sm border border-border bg-muted/20 px-4 py-6 text-sm text-text-3">
							{t("加载中")}
						</div>
					) : articlesError ? (
						<div className="rounded-sm border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger-ink">
							{articlesError}
						</div>
					) : articles.length === 0 ? (
						<div className="rounded-sm border border-border bg-muted/20 px-4 py-6 text-sm text-text-3">
							{t("该主题暂无关联文章")}
						</div>
					) : (
						<div className="max-h-[28rem] space-y-2 overflow-y-auto">
							{articles.map((article) => {
								const title = article.title_trans?.trim() || article.title;
								return (
									<div
										key={article.id}
										className="flex flex-wrap items-center justify-between gap-3 rounded-sm border border-border bg-surface px-3 py-3"
									>
										<div className="min-w-0">
											<div className="truncate text-sm font-medium text-text-1">
												{title}
											</div>
											<div className="mt-1 text-xs text-text-3">
												{article.source_domain || article.author || article.slug}
											</div>
										</div>
										<Button
											size="sm"
											onClick={() =>
												onInsert(buildTopicArticlePlaceholder(article.slug))
											}
										>
											{t("插入文章占位符")}
										</Button>
									</div>
								);
							})}
						</div>
					)}
				</>
			)}
		</ModalShell>
	);
}
