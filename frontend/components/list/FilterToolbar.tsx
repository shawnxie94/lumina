import type { Dispatch, ReactNode, SetStateAction } from 'react';

import Button from '@/components/Button';
import { IconPlus, IconSearch } from '@/components/icons';
import FilterSelectInline from '@/components/FilterSelectInline';
import { useI18n } from '@/lib/i18n';
import type { QuickDateOption } from '@/lib/listFilters';

interface FilterToolbarProps {
	isMobile: boolean;
	showFilters: boolean;
	setShowFilters: Dispatch<SetStateAction<boolean>>;
	isAdmin: boolean;
	setShowCreateModal: Dispatch<SetStateAction<boolean>>;
	quickDateFilter: QuickDateOption;
	handleQuickDateChange: (option: QuickDateOption) => void;
	visibilityFilter: string;
	setVisibilityFilter: Dispatch<SetStateAction<string>>;
	sortBy: string;
	setSortBy: Dispatch<SetStateAction<string>>;
	setPage: Dispatch<SetStateAction<number>>;
	showAdminDesktop: boolean;
	selectedArticleSlugs: Set<string>;
	advancedFiltersBody: ReactNode;
	filterSummary: ReactNode;
	batchActions: ReactNode;
}

export default function FilterToolbar({
	isMobile,
	showFilters,
	setShowFilters,
	isAdmin,
	setShowCreateModal,
	quickDateFilter,
	handleQuickDateChange,
	visibilityFilter,
	setVisibilityFilter,
	sortBy,
	setSortBy,
	setPage,
	showAdminDesktop,
	selectedArticleSlugs,
	advancedFiltersBody,
	filterSummary,
	batchActions,
}: FilterToolbarProps) {
	const { t } = useI18n();

	return (
		<>
			{!isMobile && (
				<div className="panel-raised rounded-sm border border-border p-4 sm:p-6 mb-6">
					{!isMobile && (
						<>
							<div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
								<div className="flex items-center gap-2">
									<button
										type="button"
										onClick={() => setShowFilters(!showFilters)}
										className={`hidden lg:inline-flex whitespace-nowrap px-4 py-1 text-sm rounded-sm transition ${showFilters ? 'bg-primary-soft text-primary-ink' : 'bg-muted text-text-2 hover:bg-surface'}`}
									>
										<span className="inline-flex items-center gap-2">
											<IconSearch className="h-4 w-4" />
											<span>{t('高级筛选')}</span>
										</span>
									</button>
									{isAdmin && (
										<Button
											type="button"
											onClick={() => setShowCreateModal(true)}
											variant="primary"
											size="sm"
											className="hidden lg:inline-flex whitespace-nowrap"
										>
											<span className="inline-flex items-center gap-2">
												<IconPlus className="h-4 w-4" />
												<span>{t('创建文章')}</span>
											</span>
										</Button>
									)}
								</div>
								<div className="hidden lg:flex flex-wrap items-center gap-4 lg:justify-end">
									<FilterSelectInline
										label={`${t('创建时间')}：`}
										value={quickDateFilter}
										onChange={(value) => handleQuickDateChange(value as QuickDateOption)}
										showSearch={false}
										options={[
											{ value: '', label: t('全部') },
											{ value: '1d', label: t('1天内') },
											{ value: '3d', label: t('3天内') },
											{ value: '1w', label: t('1周内') },
											{ value: '1m', label: t('1个月') },
											{ value: '3m', label: t('3个月') },
											{ value: '6m', label: t('6个月') },
											{ value: '1y', label: t('1年内') },
										]}
									/>
									{isAdmin && (
										<FilterSelectInline
											label={`${t('可见性')}：`}
											value={visibilityFilter}
											onChange={(value) => { setVisibilityFilter(value); setPage(1); }}
											showSearch={false}
											options={[
												{ value: '', label: t('全部') },
												{ value: 'visible', label: t('可见') },
												{ value: 'hidden', label: t('隐藏') },
											]}
										/>
									)}
									<FilterSelectInline
										label={`${t('排序')}：`}
										value={sortBy}
										onChange={(value) => { setSortBy(value); setPage(1); }}
										showSearch={false}
										options={[
											{ value: 'published_at_desc', label: t('发表时间倒序') },
											{ value: 'created_at_desc', label: t('创建时间倒序') },
											{ value: 'note_recommendation_level_desc', label: t('推荐等级倒序') },
										]}
									/>
								</div>
							</div>

							{showFilters && (
								<div className="mt-4 pt-4 border-t border-border">
									{advancedFiltersBody}
								</div>
							)}

							<div className="mt-4 pt-4 border-t border-border">
								{filterSummary}
							</div>
						</>
					)}
					{showAdminDesktop && selectedArticleSlugs.size > 0 && batchActions}
				</div>
			)}
		</>
	);
}
