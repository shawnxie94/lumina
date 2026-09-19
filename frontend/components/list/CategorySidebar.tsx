import type { Dispatch, SetStateAction } from 'react';

import Link from 'next/link';

import { IconSearch } from '@/components/icons';
import { useI18n } from '@/lib/i18n';

export interface CategoryStat {
	id: string;
	name: string;
	color: string | null;
	article_count: number;
}

interface CategorySidebarProps {
	categoryStats: CategoryStat[];
	selectedCategory: string;
	buildCategoryHref: (categoryId?: string) => string;
	sidebarCollapsed: boolean;
	setSidebarCollapsed: Dispatch<SetStateAction<boolean>>;
}

export default function CategorySidebar({
	categoryStats,
	selectedCategory,
	buildCategoryHref,
	sidebarCollapsed,
	setSidebarCollapsed,
}: CategorySidebarProps) {
	const { t } = useI18n();

	return (
		<aside className={`hidden lg:block flex-shrink-0 w-full transition-all duration-300 ${sidebarCollapsed ? 'lg:w-12' : 'lg:w-56'}`}>
			<div className="panel-raised rounded-sm border border-border p-4 max-h-none overflow-visible lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto">
				<div className="flex items-center justify-between mb-4">
					{!sidebarCollapsed && (
						<h2 className="font-semibold text-text-1 inline-flex items-center gap-2">
							<IconSearch className="h-4 w-4" />
							<span>{t('分类筛选')}</span>
						</h2>
					)}
					<button
						type="button"
						onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
						className="text-text-3 hover:text-text-2 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35"
						title={sidebarCollapsed ? t('展开') : t('收起')}
						aria-label={sidebarCollapsed ? t('展开分类筛选') : t('收起分类筛选')}
					>
						{sidebarCollapsed ? '»' : '«'}
					</button>
				</div>
				{!sidebarCollapsed && (
					<div className="space-y-2">
						<Link
							href={buildCategoryHref(undefined)}
							aria-current={selectedCategory === '' ? 'page' : undefined}
							className={`block w-full text-left px-3 py-2 rounded-sm transition ${
								selectedCategory === '' ? 'bg-primary-soft text-primary-ink' : 'hover:bg-muted'
							}`}
						>
							{t('全部文章')} ({categoryStats.reduce((sum, c) => sum + c.article_count, 0)})
						</Link>
						{categoryStats.map((category) => (
							<Link
								href={buildCategoryHref(category.id)}
								key={category.id}
								aria-current={selectedCategory === category.id ? 'page' : undefined}
								className={`block w-full text-left px-3 py-2 rounded-sm transition ${
									selectedCategory === category.id ? 'bg-primary-soft text-primary-ink' : 'hover:bg-muted'
								}`}
							>
								{category.name} ({category.article_count})
							</Link>
						))}
					</div>
				)}
			</div>
		</aside>
	);
}
