import { useMemo } from 'react';
import type { Dispatch, SetStateAction } from 'react';

import DateRangePicker from '@/components/DateRangePicker';
import FilterInput from '@/components/FilterInput';
import FilterSelect from '@/components/FilterSelect';
import type { Category } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import type { QuickDateOption } from '@/lib/listFilters';
import { formatDate, toDayjsRange } from '@/lib/listQuery';

export interface AdvancedFiltersProps {
	isAdmin: boolean;
	isMobile: boolean;
	searchTerm: string;
	setSearchTerm: Dispatch<SetStateAction<string>>;
	sourceDomain: string;
	setSourceDomain: Dispatch<SetStateAction<string>>;
	sources: string[];
	author: string;
	setAuthor: Dispatch<SetStateAction<string>>;
	authors: string[];
	visibilityFilter: string;
	setVisibilityFilter: Dispatch<SetStateAction<string>>;
	sortBy: string;
	setSortBy: Dispatch<SetStateAction<string>>;
	quickDateFilter: QuickDateOption;
	setQuickDateFilter: Dispatch<SetStateAction<QuickDateOption>>;
	handleQuickDateChange: (option: QuickDateOption) => void;
	publishedDateRange: [Date | null, Date | null];
	setPublishedDateRange: Dispatch<SetStateAction<[Date | null, Date | null]>>;
	createdDateRange: [Date | null, Date | null];
	setCreatedDateRange: Dispatch<SetStateAction<[Date | null, Date | null]>>;
	setPage: Dispatch<SetStateAction<number>>;
}

export interface FilterSummaryProps {
	categories: Category[];
	selectedCategory: string;
	searchTerm: string;
	sourceDomain: string;
	author: string;
	isAdmin: boolean;
	visibilityFilter: string;
	publishedStartDate: Date | null;
	publishedEndDate: Date | null;
	createdStartDate: Date | null;
	createdEndDate: Date | null;
	sortBy: string;
	handleClearFilters: () => void;
}

export default function AdvancedFilters({
	isAdmin,
	isMobile,
	searchTerm,
	setSearchTerm,
	sourceDomain,
	setSourceDomain,
	sources,
	author,
	setAuthor,
	authors,
	visibilityFilter,
	setVisibilityFilter,
	sortBy,
	setSortBy,
	quickDateFilter,
	setQuickDateFilter,
	handleQuickDateChange,
	publishedDateRange,
	setPublishedDateRange,
	createdDateRange,
	setCreatedDateRange,
	setPage,
}: AdvancedFiltersProps) {
	const { t } = useI18n();

	return (
		<>
			<div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
				<FilterInput
					label={t('文章标题')}
					value={searchTerm}
					onChange={(value) => { setSearchTerm(value); setPage(1); }}
					placeholder={t('模糊匹配标题')}
				/>
				<FilterSelect
					label={t('来源')}
					value={sourceDomain}
					onChange={(value) => { setSourceDomain(value); setPage(1); }}
					options={[{ value: '', label: t('全部来源') }, ...sources.map((s) => ({ value: s, label: s }))]}
				/>
				<FilterSelect
					label={t('作者')}
					value={author}
					onChange={(value) => { setAuthor(value); setPage(1); }}
					options={[{ value: '', label: t('全部作者') }, ...authors.map((a) => ({ value: a, label: a }))]}
				/>
			</div>
			{isMobile && (
				<div className="grid grid-cols-1 gap-4 mb-4">
					<FilterSelect
						label={t('创建时间')}
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
						<FilterSelect
							label={t('可见性')}
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
					<FilterSelect
						label={t('排序')}
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
			)}
			<div className="hidden lg:grid grid-cols-3 gap-4 mb-2">
				<div>
					<label htmlFor="published-date-range" className="block text-sm text-text-2 mb-1.5">{t('发表时间')}</label>
					<DateRangePicker
						id="published-date-range"
						value={toDayjsRange(publishedDateRange)}
						onChange={(values) => {
							const [start, end] = values || [];
							setPublishedDateRange([start ? start.toDate() : null, end ? end.toDate() : null]);
							setPage(1);
						}}
						className="w-full"
					/>
				</div>
				<div>
					<label htmlFor="created-date-range" className="block text-sm text-text-2 mb-1.5">{t('创建时间')}</label>
					<DateRangePicker
						id="created-date-range"
						value={toDayjsRange(createdDateRange)}
						onChange={(values) => {
							const [start, end] = values || [];
							setCreatedDateRange([start ? start.toDate() : null, end ? end.toDate() : null]);
							setQuickDateFilter('');
							setPage(1);
						}}
						className="w-full"
					/>
				</div>
			</div>
		</>
	);
}

export function FilterSummary({
	categories,
	selectedCategory,
	searchTerm,
	sourceDomain,
	author,
	isAdmin,
	visibilityFilter,
	publishedStartDate,
	publishedEndDate,
	createdStartDate,
	createdEndDate,
	sortBy,
	handleClearFilters,
}: FilterSummaryProps) {
	const { t } = useI18n();

	const activeFilters = useMemo(() => {
		const filters: string[] = [];
		const categoryName = categories.find((c) => c.id === selectedCategory)?.name;
		if (categoryName) filters.push(`${t('分类')}：${categoryName}`);
		if (searchTerm) filters.push(`${t('标题')}：${searchTerm}`);
		if (sourceDomain) filters.push(`${t('来源')}：${sourceDomain}`);
		if (author) filters.push(`${t('作者')}：${author}`);
		if (isAdmin && visibilityFilter) {
			filters.push(visibilityFilter === 'visible' ? `${t('可见')}：${t('是')}` : `${t('可见')}：${t('否')}`);
		}
		if (publishedStartDate || publishedEndDate) {
			filters.push(`${t('发表')}：${formatDate(publishedStartDate)} ~ ${formatDate(publishedEndDate)}`.trim());
		}
		if (createdStartDate || createdEndDate) {
			filters.push(`${t('创建')}：${formatDate(createdStartDate)} ~ ${formatDate(createdEndDate)}`.trim());
		}
		if (sortBy === 'published_at_desc') filters.push(`${t('排序')}：${t('发表时间倒序')}`);
		if (sortBy === 'created_at_desc') filters.push(`${t('排序')}：${t('创建时间倒序')}`);
		if (sortBy === 'note_recommendation_level_desc') filters.push(`${t('排序')}：${t('推荐等级倒序')}`);
		return filters;
	}, [
		categories,
		selectedCategory,
		searchTerm,
		sourceDomain,
		author,
		publishedStartDate,
		publishedEndDate,
		createdStartDate,
		createdEndDate,
		sortBy,
		isAdmin,
		visibilityFilter,
		t,
	]);

	return (
		<div className="flex flex-wrap items-center gap-2">
			{activeFilters.length === 0 ? (
				<span className="text-sm text-text-3">{t('暂无筛选条件')}</span>
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
			<button
				type="button"
				onClick={handleClearFilters}
				className={`ml-auto px-3 py-1 text-sm rounded-sm transition ${activeFilters.length === 0 ? 'bg-muted text-text-3 cursor-not-allowed' : 'bg-surface text-text-2 hover:bg-muted hover:text-text-1'}`}
				disabled={activeFilters.length === 0}
			>
				{t('清除筛选')}
			</button>
		</div>
	);
}
