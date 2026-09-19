import type { Dispatch, MutableRefObject, RefObject, SetStateAction } from 'react';

import Link from 'next/link';

import Button from '@/components/Button';
import SelectField from '@/components/ui/SelectField';
import TextInput from '@/components/ui/TextInput';
import { useI18n } from '@/lib/i18n';

interface PaginationBarProps {
	isMobile: boolean;
	page: number;
	totalPages: number;
	total: number;
	pageSize: number;
	jumpToPage: string;
	setJumpToPage: Dispatch<SetStateAction<string>>;
	setPage: Dispatch<SetStateAction<number>>;
	setPageSize: Dispatch<SetStateAction<number>>;
	suppressNextPageFetchRef: MutableRefObject<boolean>;
	buildPaginationHref: (targetPage: number) => string;
	handleJumpToPage: () => void;
	loadingMore: boolean;
	hasMore: boolean;
	loadMoreRef: RefObject<HTMLDivElement>;
}

export default function PaginationBar({
	isMobile,
	page,
	totalPages,
	total,
	pageSize,
	jumpToPage,
	setJumpToPage,
	setPage,
	setPageSize,
	suppressNextPageFetchRef,
	buildPaginationHref,
	handleJumpToPage,
	loadingMore,
	hasMore,
	loadMoreRef,
}: PaginationBarProps) {
	const { t } = useI18n();

	return (
		<>
			{!isMobile && (
				<div className="mt-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
					<div className="flex flex-wrap items-center gap-2 text-sm text-text-2">
						<span>{t('每页显示')}</span>
						<SelectField
							value={pageSize}
							onChange={(value) => {
								suppressNextPageFetchRef.current = false;
								setPageSize(Number(value));
								setPage(1);
							}}
							className="w-20"
							options={[
								{ value: 10, label: '10' },
								{ value: 20, label: '20' },
								{ value: 50, label: '50' },
								{ value: 100, label: '100' },
							]}
						/>
						<span>{t('条')}，{t('共')} {total} {t('条')}</span>
					</div>
					<div className="flex flex-wrap items-center gap-2">
						{page > 1 ? (
							<Link
								href={buildPaginationHref(Math.max(1, page - 1))}
								className="inline-flex items-center justify-center rounded-sm transition font-medium focus:outline-none px-3 py-1.5 text-sm border border-border bg-surface text-text-2 hover:bg-muted"
							>
								{t('上一页')}
							</Link>
						) : (
							<span className="inline-flex items-center justify-center rounded-sm px-3 py-1.5 text-sm border border-border bg-muted text-text-3">
								{t('上一页')}
							</span>
						)}
						<span className="px-4 py-2 text-sm bg-surface border border-border rounded-sm text-text-2">
							{t('第')} {page} / {totalPages} {t('页')}
						</span>
						{page < totalPages ? (
							<Link
								href={buildPaginationHref(page + 1)}
								className="inline-flex items-center justify-center rounded-sm transition font-medium focus:outline-none px-3 py-1.5 text-sm border border-border bg-surface text-text-2 hover:bg-muted"
							>
								{t('下一页')}
							</Link>
						) : (
							<span className="inline-flex items-center justify-center rounded-sm px-3 py-1.5 text-sm border border-border bg-muted text-text-3">
								{t('下一页')}
							</span>
						)}
						<div className="ml-2 flex flex-none items-center gap-1 whitespace-nowrap">
							<TextInput
								type="number"
								value={jumpToPage}
								onChange={(e) => setJumpToPage(e.target.value)}
								onKeyDown={(e) => e.key === 'Enter' && handleJumpToPage()}
								className="w-16 text-center"
								compact
								min={1}
								max={totalPages}
							/>
							<Button
								onClick={handleJumpToPage}
								variant="primary"
								size="sm"
								className="whitespace-nowrap"
							>
								{t('跳转')}
							</Button>
						</div>
					</div>
				</div>
			)}
			{isMobile && (
				<div className="mt-6 text-center text-sm text-text-3">
					{loadingMore ? t('加载中...') : hasMore ? t('上拉加载更多') : t('没有更多了')}
					<div ref={loadMoreRef} className="h-6" />
				</div>
			)}
		</>
	);
}
