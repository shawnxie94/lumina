import {
	closestCenter,
	DndContext,
	type DragEndEvent,
	type SensorDescriptor,
	type SensorOptions,
} from "@dnd-kit/core";
import {
	SortableContext,
	useSortable,
	verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Dispatch, SetStateAction } from "react";
import Button from "@/components/Button";
import IconButton from "@/components/IconButton";
import FormField from "@/components/ui/FormField";
import ModalShell from "@/components/ui/ModalShell";
import TextArea from "@/components/ui/TextArea";
import TextInput from "@/components/ui/TextInput";
import { IconEdit, IconGrip, IconTrash } from "@/components/icons";
import { useI18n } from "@/lib/i18n";

export const PRESET_COLORS = [
	"#EF4444",
	"#F97316",
	"#F59E0B",
	"#EAB308",
	"#84CC16",
	"#22C55E",
	"#10B981",
	"#14B8A6",
	"#06B6D4",
	"#0EA5E9",
	"#3B82F6",
	"#6366F1",
	"#8B5CF6",
	"#A855F7",
	"#D946EF",
	"#EC4899",
	"#F43F5E",
	"#78716C",
	"#64748B",
	"#6B7280",
];

export interface Category {
	id: string;
	name: string;
	description: string | null;
	color: string;
	sort_order: number;
	article_count: number;
}

interface SortableCategoryItemProps {
	category: Category;
	onEdit: (category: Category) => void;
	onDelete: (id: string) => void;
}

function SortableCategoryItem({
	category,
	onEdit,
	onDelete,
}: SortableCategoryItemProps) {
	const { t } = useI18n();
	const {
		attributes,
		listeners,
		setNodeRef,
		transform,
		transition,
		isDragging,
	} = useSortable({ id: category.id });

	const style = {
		transform: CSS.Transform.toString(transform),
		transition,
		opacity: isDragging ? 0.5 : 1,
	};

	return (
		<div
			ref={setNodeRef}
			style={style}
			className="border rounded-lg px-3 py-2 hover:shadow-sm transition flex items-center justify-between bg-surface"
		>
			<div className="flex items-center gap-3">
				<button
					{...attributes}
					{...listeners}
					className="cursor-grab active:cursor-grabbing text-text-3 hover:text-text-2 px-1"
					title={t("拖动排序")}
					aria-label={t("拖动排序")}
				>
					<IconGrip className="h-4 w-4" />
				</button>
				<div
					className="w-8 h-8 rounded flex items-center justify-center text-white font-bold text-sm"
					style={{ backgroundColor: category.color }}
				>
					{category.name.charAt(0).toUpperCase()}
				</div>
				<div>
					<div className="flex flex-wrap items-center gap-2">
						<h3 className="font-semibold text-text-1 text-sm">
							{category.name}
						</h3>
						<span className="text-xs text-text-3">
							{category.article_count}
						</span>
					</div>
					<p className="text-xs text-text-2">
						{category.description || t("暂无描述")}
					</p>
				</div>
			</div>

			<div className="flex gap-1">
				<IconButton
					onClick={() => onEdit(category)}
					variant="primary"
					size="sm"
					title={t("编辑")}
				>
					<IconEdit className="h-4 w-4" />
				</IconButton>
				<IconButton
					onClick={() => onDelete(category.id)}
					variant="danger"
					size="sm"
					title={t("删除")}
				>
					<IconTrash className="h-4 w-4" />
				</IconButton>
			</div>
		</div>
	);
}

type CategoryFormData = {
	name: string;
	description: string;
	color: string;
	sort_order: number;
};

type CategoriesSectionProps = {
	categories: Category[];
	categoryLoading: boolean;
	categorySaving: boolean;
	categoryFormData: CategoryFormData;
	editingCategory: Category | null;
	showCategoryModal: boolean;
	sensors: SensorDescriptor<SensorOptions>[];
	handleCreateCategoryNew: () => void;
	handleDeleteCategory: (id: string) => Promise<void>;
	handleDragEnd: (event: DragEndEvent) => Promise<void>;
	handleEditCategory: (category: Category) => void;
	handleSaveCategory: () => Promise<void>;
	setCategoryFormData: Dispatch<SetStateAction<CategoryFormData>>;
	setShowCategoryModal: Dispatch<SetStateAction<boolean>>;
};

export default function CategoriesSection({
	categories,
	categoryLoading,
	categorySaving,
	categoryFormData,
	editingCategory,
	showCategoryModal,
	sensors,
	handleCreateCategoryNew,
	handleDeleteCategory,
	handleDragEnd,
	handleEditCategory,
	handleSaveCategory,
	setCategoryFormData,
	setShowCategoryModal,
}: CategoriesSectionProps) {
	const { t } = useI18n();

	return (
		<>
		<div className="bg-surface rounded-sm shadow-sm border border-border p-6 w-full min-w-0">
			<div className="mb-6 flex flex-wrap items-start justify-between gap-3">
				<div className="space-y-1">
					<h2 className="text-lg font-semibold text-text-1">
						{t("分类列表")}
					</h2>
				</div>
				<div className="flex flex-wrap items-center gap-2">
					<Button
						onClick={handleCreateCategoryNew}
						variant="primary"
					>
						+ {t("新增分类")}
					</Button>
				</div>
			</div>

			{categoryLoading ? (
				<div className="rounded-sm border border-border bg-muted px-4 py-8 text-center text-sm text-text-3">
					{t("加载中...")}
				</div>
			) : categories.length === 0 ? (
				<div className="rounded-sm border border-border bg-muted px-4 py-8 text-center text-sm text-text-3">
					<div className="mb-4">{t("暂无分类")}</div>
					<Button
						onClick={handleCreateCategoryNew}
						variant="primary"
					>
						{t("新增分类")}
					</Button>
				</div>
			) : (
				<DndContext
					sensors={sensors}
					collisionDetection={closestCenter}
					onDragEnd={handleDragEnd}
				>
					<SortableContext
						items={categories.map((c) => c.id)}
						strategy={verticalListSortingStrategy}
					>
						<div className="space-y-3">
							{categories.map((category) => (
								<SortableCategoryItem
									key={category.id}
									category={category}
									onEdit={handleEditCategory}
									onDelete={handleDeleteCategory}
								/>
							))}
						</div>
					</SortableContext>
				</DndContext>
			)}
		</div>

			{/* Category Modal */}
			{showCategoryModal && (
				<ModalShell
					isOpen={showCategoryModal}
					onClose={() => setShowCategoryModal(false)}
					title={editingCategory ? t("编辑分类") : t("新增分类")}
					widthClassName="max-w-md"
					panelClassName="max-h-[90vh] overflow-y-auto"
					headerClassName="border-b border-border p-6"
					bodyClassName="space-y-4 p-6"
					footerClassName="border-t border-border bg-muted p-6"
					footer={
						<div className="flex justify-end gap-2">
							<Button
								onClick={() => setShowCategoryModal(false)}
								variant="secondary"
							>
								{t("取消")}
							</Button>
							<Button
								onClick={handleSaveCategory}
								variant="primary"
								loading={categorySaving}
								disabled={categorySaving}
							>
								{editingCategory ? t("保存") : t("创建")}
							</Button>
						</div>
					}
				>
					<FormField label={t("分类名称")} required>
						<TextInput
							type="text"
							value={categoryFormData.name}
							onChange={(e) =>
								setCategoryFormData({
									...categoryFormData,
									name: e.target.value,
								})
							}
							required
						/>
					</FormField>

					<FormField label={t("描述")}>
						<TextArea
							value={categoryFormData.description}
							onChange={(e) =>
								setCategoryFormData({
									...categoryFormData,
									description: e.target.value,
								})
							}
							rows={3}
							placeholder={t("描述将用于辅助AI自动分类判断")}
						/>
					</FormField>

					<FormField label={t("颜色")}>
						<div className="grid grid-cols-10 gap-2">
							{PRESET_COLORS.map((color) => (
								<button
									key={color}
									type="button"
									onClick={() =>
										setCategoryFormData({ ...categoryFormData, color })
									}
									className={`h-8 w-8 rounded-lg transition ${
										categoryFormData.color === color
											? "ring-2 ring-primary ring-offset-2"
											: "hover:scale-110"
									}`}
									style={{ backgroundColor: color }}
								/>
							))}
						</div>
					</FormField>
				</ModalShell>
			)}
		</>
	);
}
