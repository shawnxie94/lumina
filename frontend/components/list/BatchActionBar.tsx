import type { Dispatch, SetStateAction } from 'react';

import Button from '@/components/Button';
import CheckboxInput from '@/components/ui/CheckboxInput';
import SelectField from '@/components/ui/SelectField';
import { Category } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

interface BatchActionBarProps {
	selectedCount: number;
	batchAction: 'none' | 'export' | 'visibility' | 'category' | 'delete';
	isAdmin: boolean;
	categories: Category[];
	batchCategoryId: string;
	setBatchCategoryId: Dispatch<SetStateAction<string>>;
	handleExport: () => void;
	handleBatchVisibility: (isVisible: boolean) => void;
	handleBatchCategory: () => void;
	handleBatchDelete: () => void;
}

export default function BatchActionBar({
	selectedCount,
	batchAction,
	isAdmin,
	categories,
	batchCategoryId,
	setBatchCategoryId,
	handleExport,
	handleBatchVisibility,
	handleBatchCategory,
	handleBatchDelete,
}: BatchActionBarProps) {
	const { t } = useI18n();
	const batchActionPending = batchAction !== 'none';

	return (
		<div className="mt-4 pt-4 border-t border-border">
			<div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
				<div className="flex flex-wrap items-center gap-3">
					<span className="text-sm text-text-2">{t('已选')} {selectedCount} {t('篇')}</span>
					<Button
						type="button"
						onClick={handleExport}
						disabled={batchActionPending}
						variant="ghost"
						size="sm"
						className="min-w-[104px]"
					>
						{batchAction === 'export' ? t('导出中...') : `${t('导出选中')} (${selectedCount})`}
					</Button>
				</div>
				{isAdmin && (
					<div className="flex flex-wrap items-center gap-3">
						<Button
							type="button"
							onClick={() => handleBatchVisibility(true)}
							disabled={batchActionPending}
							variant="ghost"
							size="sm"
							className="min-w-[88px]"
						>
							{batchAction === 'visibility' ? t('处理中...') : t('设为可见')}
						</Button>
						<Button
							type="button"
							onClick={() => handleBatchVisibility(false)}
							disabled={batchActionPending}
							variant="ghost"
							size="sm"
							className="min-w-[88px]"
						>
							{batchAction === 'visibility' ? t('处理中...') : t('设为隐藏')}
						</Button>
						<div className="flex items-center gap-2">
							<SelectField
								value={batchCategoryId}
								onChange={(value) => setBatchCategoryId(value)}
								className="w-36"
								disabled={batchActionPending}
								options={[
									{ value: '', label: t('选择分类') },
									{ value: '__clear__', label: t('清空分类') },
									...categories.map((category) => ({ value: category.id, label: category.name })),
								]}
							/>
							<Button
								type="button"
								onClick={handleBatchCategory}
								disabled={batchActionPending}
								variant="ghost"
								size="sm"
								className="min-w-[88px]"
							>
								{batchAction === 'category' ? t('处理中...') : t('应用分类')}
							</Button>
						</div>
						<Button
							type="button"
							onClick={handleBatchDelete}
							disabled={batchActionPending}
							variant="danger"
							size="sm"
							className="min-w-[96px]"
						>
							{batchAction === 'delete' ? t('删除中...') : t('批量删除')}
						</Button>
					</div>
				)}
			</div>
		</div>
	);
}

interface SelectAllBarProps {
	selectedCount: number;
	totalCount: number;
	onSelectAll: () => void;
}

export function SelectAllBar({ selectedCount, totalCount, onSelectAll }: SelectAllBarProps) {
	const { t } = useI18n();

	return (
		<div className="mb-4">
			<div className="flex flex-wrap items-center gap-2">
				<CheckboxInput
					checked={selectedCount === totalCount}
					onChange={onSelectAll}
				/>
				<span className="text-sm text-text-2">
					{t('全选')} ({selectedCount}/{totalCount})
				</span>
			</div>
		</div>
	);
}
