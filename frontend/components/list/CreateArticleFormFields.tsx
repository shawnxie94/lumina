import type { Dispatch, SetStateAction } from 'react';

import FormField from '@/components/ui/FormField';
import SelectField from '@/components/ui/SelectField';
import TextInput from '@/components/ui/TextInput';
import type { Category } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

interface CreateArticleFormFieldsProps {
	createTitle: string;
	setCreateTitle: Dispatch<SetStateAction<string>>;
	createAuthor: string;
	setCreateAuthor: Dispatch<SetStateAction<string>>;
	createPublishedAt: string;
	setCreatePublishedAt: Dispatch<SetStateAction<string>>;
	createCategoryId: string;
	setCreateCategoryId: Dispatch<SetStateAction<string>>;
	createSourceUrl: string;
	setCreateSourceUrl: Dispatch<SetStateAction<string>>;
	createTopImage: string;
	setCreateTopImage: Dispatch<SetStateAction<string>>;
	categories: Category[];
}

export default function CreateArticleFormFields({
	createTitle,
	setCreateTitle,
	createAuthor,
	setCreateAuthor,
	createPublishedAt,
	setCreatePublishedAt,
	createCategoryId,
	setCreateCategoryId,
	createSourceUrl,
	setCreateSourceUrl,
	createTopImage,
	setCreateTopImage,
	categories,
}: CreateArticleFormFieldsProps) {
	const { t } = useI18n();

	return (
		<>
			<FormField label={t('标题')} required>
				<TextInput
					type="text"
					value={createTitle}
					onChange={(e) => setCreateTitle(e.target.value)}
					placeholder={t('请输入文章标题')}
				/>
			</FormField>

			<div className="grid grid-cols-1 md:grid-cols-3 gap-3">
				<FormField label={t('作者')}>
					<TextInput
						type="text"
						value={createAuthor}
						onChange={(e) => setCreateAuthor(e.target.value)}
						placeholder={t('请输入作者')}
					/>
				</FormField>
				<FormField label={t('发表时间')}>
					<TextInput
						type="date"
						value={createPublishedAt}
						onChange={(e) => setCreatePublishedAt(e.target.value)}
					/>
				</FormField>
				<FormField label={t('分类')}>
					<SelectField
						value={createCategoryId}
						onChange={(value) => setCreateCategoryId(value)}
						className="w-full"
						options={[
							{ value: '', label: t('未分类') },
							...categories.map((category) => ({
								value: category.id,
								label: category.name,
							})),
						]}
					/>
				</FormField>
			</div>

			<div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
				<FormField label={t('来源 URL')}>
					<TextInput
						type="text"
						value={createSourceUrl}
						onChange={(e) => setCreateSourceUrl(e.target.value)}
						placeholder={t('请输入来源链接')}
					/>
				</FormField>

				<FormField label={t('头图 URL')}>
					<TextInput
						type="text"
						value={createTopImage}
						onChange={(e) => setCreateTopImage(e.target.value)}
						placeholder={t('输入图片 URL')}
					/>
				</FormField>
			</div>
		</>
	);
}
