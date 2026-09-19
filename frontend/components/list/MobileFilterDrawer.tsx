import type { Dispatch, ReactNode, SetStateAction } from 'react';

import { IconSearch } from '@/components/icons';
import { useI18n } from '@/lib/i18n';

interface MobileFilterDrawerProps {
	isMobile: boolean;
	showMobileFilters: boolean;
	setShowFilters: Dispatch<SetStateAction<boolean>>;
	setShowMobileFilters: Dispatch<SetStateAction<boolean>>;
	advancedFiltersBody: ReactNode;
}

export default function MobileFilterDrawer({
	isMobile,
	showMobileFilters,
	setShowFilters,
	setShowMobileFilters,
	advancedFiltersBody,
}: MobileFilterDrawerProps) {
	const { t } = useI18n();

	return (
		<>
			{isMobile && (
				<>
					<button
						type="button"
						onClick={() => {
							setShowFilters(true);
							setShowMobileFilters(true);
						}}
						className="fixed right-4 top-24 flex items-center justify-center w-10 h-10 rounded-full bg-surface border border-border shadow-lg text-text-2 hover:text-text-1 hover:bg-muted transition z-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35"
						title={t('高级筛选')}
						aria-label={t('打开高级筛选')}
					>
						<IconSearch className="h-4 w-4" />
					</button>
					{showMobileFilters && (
						<div
							className="fixed inset-0 z-50 bg-black/40 flex justify-end"
							onClick={() => setShowMobileFilters(false)}
						>
							<div
								className="h-full w-[86vw] max-w-sm bg-surface shadow-xl overflow-y-auto"
								onClick={(event) => event.stopPropagation()}
							>
								<div className="flex items-center justify-between px-4 py-3 border-b border-border bg-surface">
									<span className="text-sm font-semibold text-text-1">
										{t('高级筛选')}
									</span>
									<button
										type="button"
										onClick={() => setShowMobileFilters(false)}
										className="text-text-3 hover:text-text-1 transition text-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35"
										aria-label={t('关闭')}
									>
										×
									</button>
								</div>
								<div className="p-4">{advancedFiltersBody}</div>
							</div>
						</div>
					)}
				</>
			)}
		</>
	);
}
