import type { KeyboardEvent, MouseEvent } from 'react';

import Link from 'next/link';

import ArticleLanguageTag from '@/components/article/ArticleLanguageTag';
import ArticleMetaRow from '@/components/article/ArticleMetaRow';
import RecommendationLevelBadge from '@/components/article/RecommendationLevelBadge';
import IconButton from '@/components/IconButton';
import CheckboxInput from '@/components/ui/CheckboxInput';
import { IconEdit, IconEye, IconEyeOff, IconTrash } from '@/components/icons';
import { type Article, resolveMediaUrl } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

interface ArticleCardProps {
	article: Article;
	articleHref: string;
	selected: boolean;
	showAdminDesktop: boolean;
	isAdmin: boolean;
	isMobile: boolean;
	siteLogoUrl: string;
	onOpenArticle: (event: MouseEvent<HTMLElement>, article: Article) => void;
	onCardKeyDown: (event: KeyboardEvent<HTMLElement>, article: Article) => void;
	onToggleSelect: (slug: string) => void;
	onToggleVisibility: (slug: string, currentVisibility: boolean) => void;
	onDelete: (slug: string) => void;
}

export default function ArticleCard({
	article,
	articleHref,
	selected,
	showAdminDesktop,
	isAdmin,
	isMobile,
	siteLogoUrl,
	onOpenArticle,
	onCardKeyDown,
	onToggleSelect,
	onToggleVisibility,
	onDelete,
}: ArticleCardProps) {
	const { t } = useI18n();
	const articleLinkTarget = isMobile ? undefined : '_blank';
	const articleLinkRel = isMobile ? undefined : 'noopener noreferrer';
	const defaultTopImageUrl = resolveMediaUrl(siteLogoUrl || '/logo.png');
	const displayTitle = article.title_trans?.trim() || article.title;
	const cardTopImageUrl = resolveMediaUrl(article.top_image || siteLogoUrl || '/logo.png');
	const showViewStat = (article.view_count ?? 0) > 0;
	const showCommentStat = (article.comment_count ?? 0) > 0;
	const mediaStatsOverlay = (showViewStat || showCommentStat) ? (
		<div
			className="absolute inset-x-2 bottom-1.5 flex items-center justify-end gap-2 pointer-events-none text-[11px] font-semibold leading-none text-white"
			style={{ textShadow: '0 1px 8px rgba(0, 0, 0, 0.88)' }}
		>
			{showViewStat ? (
				<span className="inline-flex items-center gap-0.5">
					<IconEye className="h-4 w-4 shrink-0 drop-shadow-[0_1px_6px_rgba(0,0,0,0.92)]" />
					<span>{article.view_count}</span>
				</span>
			) : null}
			{showCommentStat ? (
				<span className="inline-flex items-center gap-0.5">
					<IconEdit className="h-4 w-4 shrink-0 drop-shadow-[0_1px_6px_rgba(0,0,0,0.92)]" />
					<span>{article.comment_count}</span>
				</span>
			) : null}
		</div>
	) : null;
	const mediaBlock = (
		showAdminDesktop ? (
			<div className="relative w-full sm:w-40 aspect-video sm:aspect-square overflow-hidden rounded-lg bg-muted">
				<img
					src={cardTopImageUrl || defaultTopImageUrl}
					alt={displayTitle}
					className="absolute inset-0 h-full w-full object-cover"
					loading="lazy"
					decoding="async"
				/>
				<ArticleLanguageTag article={article} className="absolute left-2 top-2 px-2 py-0.5 text-xs" />
				<RecommendationLevelBadge
					level={article.note_recommendation_level}
					variant="image-overlay"
					className="absolute right-2 top-2"
				/>
				{mediaStatsOverlay}
			</div>
		) : (
			<Link
				href={articleHref}
				target={articleLinkTarget}
				rel={articleLinkRel}
				className="relative block w-full sm:w-40 aspect-video sm:aspect-square overflow-hidden rounded-lg bg-muted"
			>
				<img
					src={cardTopImageUrl || defaultTopImageUrl}
					alt={displayTitle}
					className="absolute inset-0 h-full w-full object-cover"
					loading="lazy"
					decoding="async"
				/>
				<ArticleLanguageTag article={article} className="absolute left-2 top-2 px-2 py-0.5 text-xs" />
				<RecommendationLevelBadge
					level={article.note_recommendation_level}
					variant="image-overlay"
					className="absolute right-2 top-2"
				/>
				{mediaStatsOverlay}
			</Link>
		)
	);

	return (
		<article
			id={`article-${article.slug}`}
			onClick={showAdminDesktop ? (event) => onOpenArticle(event, article) : undefined}
			onKeyDown={showAdminDesktop ? (event) => onCardKeyDown(event, article) : undefined}
			role={showAdminDesktop ? 'button' : undefined}
			tabIndex={showAdminDesktop ? 0 : undefined}
			aria-label={showAdminDesktop ? t('选择文章') : undefined}
			aria-pressed={showAdminDesktop ? selected : undefined}
			className={`panel-raised rounded-lg border border-border p-4 sm:p-6 min-h-[184px] transition relative scroll-mt-24 ${
				showAdminDesktop
					? 'cursor-pointer hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40'
					: 'hover:shadow-md'
			} ${!article.is_visible && isAdmin ? 'opacity-60' : ''} ${selected ? 'ring-2 ring-primary/70 ring-offset-2 bg-primary-soft/25' : ''}`}
		>
			{showAdminDesktop && (
				<div className="absolute top-3 right-3 flex items-center gap-1">
					<IconButton
						onClick={(e) => {
							e.stopPropagation();
							onToggleVisibility(article.slug, article.is_visible);
						}}
						variant="default"
						size="sm"
						title={article.is_visible ? t('点击隐藏') : t('点击显示')}
					>
						{article.is_visible ? (
							<IconEye className="h-4 w-4" />
						) : (
							<IconEyeOff className="h-4 w-4" />
						)}
					</IconButton>
					<IconButton
						onClick={(e) => {
							e.stopPropagation();
							onDelete(article.slug);
						}}
						variant="danger"
						size="sm"
						title={t('删除')}
					>
						<IconTrash className="h-4 w-4" />
					</IconButton>
				</div>
			)}
			<div className="flex flex-col sm:flex-row gap-4">
				{showAdminDesktop && (
					<CheckboxInput
						checked={selected}
						onChange={() => onToggleSelect(article.slug)}
						onClick={(e) => e.stopPropagation()}
						className="mt-1"
					/>
				)}
				{mediaBlock}
				<div className="flex-1 sm:pr-6">
					<Link
						href={articleHref}
						onClick={(e) => e.stopPropagation()}
						target={articleLinkTarget}
						rel={articleLinkRel}
					>
						<h3 className="text-xl font-semibold text-text-1 hover:text-primary transition cursor-pointer">
							{displayTitle}
						</h3>
					</Link>
					<ArticleMetaRow
						className="mt-2"
						publishedAt={article.published_at}
						createdAt={article.created_at}
						items={[
							article.category ? (
								<span
									className="category-chip px-2 py-1 rounded-sm"
									style={{
										backgroundColor: article.category.color ? `${article.category.color}20` : 'var(--bg-muted)',
										color: article.category.color || 'var(--text-2)',
									}}
								>
									{article.category.name}
								</span>
							) : null,
							article.author ? <span>{t('作者')}: {article.author}</span> : null,
						]}
					/>
					{article.summary && (
						<p className="mt-2 text-text-2 line-clamp-3">
							{article.summary}
						</p>
					)}
				</div>
			</div>
		</article>
	);
}
