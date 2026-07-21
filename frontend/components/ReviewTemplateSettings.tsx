import {
	DndContext,
	closestCenter,
	KeyboardSensor,
	PointerSensor,
	useSensor,
	useSensors,
	type DragEndEvent,
} from "@dnd-kit/core";
import {
	arrayMove,
	SortableContext,
	sortableKeyboardCoordinates,
	useSortable,
	verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useEffect, useState } from "react";

import Button from "@/components/Button";
import ConfirmModal from "@/components/ConfirmModal";
import IconButton from "@/components/IconButton";
import ModalShell from "@/components/ui/ModalShell";
import FormField from "@/components/ui/FormField";
import TextArea from "@/components/ui/TextArea";
import TextInput from "@/components/ui/TextInput";
import { IconEdit, IconGrip, IconTrash } from "@/components/icons";
import { useToast } from "@/components/Toast";
import { type ReviewTemplate, reviewApi } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

const PRESET_COLORS = [
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

type ReviewTemplateFormState = {
	name: string;
	description: string;
	color: string;
};

const createEmptyForm = (): ReviewTemplateFormState => ({
	name: "",
	description: "",
	color: PRESET_COLORS[0],
});

const cloneTemplateToForm = (template: ReviewTemplate): ReviewTemplateFormState => ({
	name: template.name,
	description: template.description || "",
	color: template.color || PRESET_COLORS[10] || "#3B82F6",
});

type SortableColumnItemProps = {
	template: ReviewTemplate;
	onEdit: (template: ReviewTemplate) => void;
	onDelete: (template: ReviewTemplate) => void;
};

function SortableColumnItem({ template, onEdit, onDelete }: SortableColumnItemProps) {
	const { t } = useI18n();
	const {
		attributes,
		listeners,
		setNodeRef,
		transform,
		transition,
		isDragging,
	} = useSortable({ id: template.id });

	const style = {
		transform: CSS.Transform.toString(transform),
		transition,
		opacity: isDragging ? 0.5 : 1,
	};
	const color = template.color || "#3B82F6";

	return (
		<div
			ref={setNodeRef}
			style={style}
			className="border rounded-lg px-3 py-2 hover:shadow-sm transition flex items-center justify-between bg-surface"
		>
			<div className="flex items-center gap-3 min-w-0">
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
					className="w-8 h-8 rounded flex items-center justify-center text-white font-bold text-sm shrink-0"
					style={{ backgroundColor: color }}
				>
					{(template.name || "?").charAt(0).toUpperCase()}
				</div>
				<div className="min-w-0">
					<div className="flex flex-wrap items-center gap-2">
						<h3 className="font-semibold text-text-1 text-sm truncate">
							{template.name}
						</h3>
					</div>
					<p className="text-xs text-text-2 truncate">
						{template.description || t("暂无描述")}
					</p>
				</div>
			</div>

			<div className="flex gap-1 shrink-0">
				<IconButton
					onClick={() => onEdit(template)}
					variant="primary"
					size="sm"
					title={t("编辑")}
				>
					<IconEdit className="h-4 w-4" />
				</IconButton>
				<IconButton
					onClick={() => onDelete(template)}
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

export default function ReviewTemplateSettings() {
	const { t } = useI18n();
	const { showToast } = useToast();
	const [templates, setTemplates] = useState<ReviewTemplate[]>([]);
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [showModal, setShowModal] = useState(false);
	const [editingTemplate, setEditingTemplate] = useState<ReviewTemplate | null>(null);
	const [confirmDeleteTemplate, setConfirmDeleteTemplate] = useState<ReviewTemplate | null>(
		null,
	);
	const [form, setForm] = useState<ReviewTemplateFormState>(createEmptyForm());
	const [nextSortOrder, setNextSortOrder] = useState(0);

	const sensors = useSensors(
		useSensor(PointerSensor),
		useSensor(KeyboardSensor, {
			coordinateGetter: sortableKeyboardCoordinates,
		}),
	);

	const loadData = async () => {
		const templateData = await reviewApi.getTemplates();
		setTemplates(templateData);
		const maxSort =
			templateData.length > 0
				? Math.max(...templateData.map((item) => item.sort_order ?? 0)) + 1
				: 0;
		setNextSortOrder(maxSort);
	};

	useEffect(() => {
		let active = true;
		const bootstrap = async () => {
			try {
				await loadData();
			} catch (error) {
				console.error("Failed to load column settings:", error);
				if (active) showToast(t("专栏配置加载失败"), "error");
			} finally {
				if (active) setLoading(false);
			}
		};
		void bootstrap();
		return () => {
			active = false;
		};
	}, [showToast, t]);

	const openCreateModal = () => {
		setEditingTemplate(null);
		setForm(createEmptyForm());
		setShowModal(true);
	};

	const openEditModal = (template: ReviewTemplate) => {
		setEditingTemplate(template);
		setForm(cloneTemplateToForm(template));
		setShowModal(true);
	};

	const handleSave = async () => {
		if (!form.name.trim()) {
			showToast(t("请输入专栏名称"), "error");
			return;
		}
		setSaving(true);
		const payload = {
			name: form.name,
			description: form.description,
			color: form.color || "#3B82F6",
			sort_order: editingTemplate?.sort_order ?? nextSortOrder,
		};
		try {
			if (editingTemplate) {
				await reviewApi.updateTemplate(editingTemplate.id, payload);
			} else {
				await reviewApi.createTemplate(payload);
			}
			await loadData();
			setShowModal(false);
			setEditingTemplate(null);
			showToast(t("专栏配置已保存"), "success");
		} catch (error) {
			console.error("Failed to save column:", error);
			showToast(t("专栏配置保存失败"), "error");
		} finally {
			setSaving(false);
		}
	};

	const handleDelete = async () => {
		if (!confirmDeleteTemplate) return;
		try {
			await reviewApi.deleteTemplate(confirmDeleteTemplate.id);
			await loadData();
			showToast(t("专栏已删除"), "success");
		} catch (error) {
			console.error("Failed to delete column:", error);
			showToast(t("专栏删除失败"), "error");
		} finally {
			setConfirmDeleteTemplate(null);
		}
	};

	const handleDragEnd = async (event: DragEndEvent) => {
		const { active, over } = event;
		if (!over || active.id === over.id) return;

		const oldIndex = templates.findIndex((item) => item.id === active.id);
		const newIndex = templates.findIndex((item) => item.id === over.id);
		if (oldIndex < 0 || newIndex < 0) return;

		const nextTemplates = arrayMove(templates, oldIndex, newIndex).map((item, index) => ({
			...item,
			sort_order: index,
		}));
		setTemplates(nextTemplates);

		try {
			await reviewApi.updateTemplatesSort(
				nextTemplates.map((item, index) => ({
					id: item.id,
					sort_order: index,
				})),
			);
		} catch (error) {
			console.error("Failed to update column sort order:", error);
			showToast(t("排序更新失败"), "error");
			await loadData();
		}
	};

	return (
		<div className="bg-surface rounded-sm shadow-sm border border-border p-6 w-full min-w-0">
			<div className="mb-6 flex flex-wrap items-start justify-between gap-3">
				<div className="space-y-1">
					<h2 className="text-lg font-semibold text-text-1">{t("专栏列表")}</h2>
				</div>
				<div className="flex flex-wrap items-center gap-2">
					<Button onClick={openCreateModal} variant="primary">
						+ {t("新增专栏")}
					</Button>
				</div>
			</div>

			{loading ? (
				<div className="rounded-sm border border-border bg-muted px-4 py-8 text-center text-sm text-text-3">
					{t("加载中...")}
				</div>
			) : templates.length === 0 ? (
				<div className="rounded-sm border border-border bg-muted px-4 py-8 text-center text-sm text-text-3">
					<div className="mb-4">{t("暂无专栏")}</div>
					<Button onClick={openCreateModal} variant="primary">
						{t("新增专栏")}
					</Button>
				</div>
			) : (
				<DndContext
					sensors={sensors}
					collisionDetection={closestCenter}
					onDragEnd={handleDragEnd}
				>
					<SortableContext
						items={templates.map((item) => item.id)}
						strategy={verticalListSortingStrategy}
					>
						<div className="space-y-3">
							{templates.map((template) => (
								<SortableColumnItem
									key={template.id}
									template={template}
									onEdit={openEditModal}
									onDelete={setConfirmDeleteTemplate}
								/>
							))}
						</div>
					</SortableContext>
				</DndContext>
			)}

			<ModalShell
				isOpen={showModal}
				onClose={() => {
					setShowModal(false);
					setEditingTemplate(null);
				}}
				title={editingTemplate ? t("编辑专栏") : t("新增专栏")}
				widthClassName="max-w-md"
				panelClassName="max-h-[90vh] overflow-y-auto"
				headerClassName="border-b border-border p-6"
				bodyClassName="space-y-4 p-6"
				footerClassName="border-t border-border bg-muted p-6"
				footer={
					<div className="flex justify-end gap-2">
						<Button
							onClick={() => {
								setShowModal(false);
								setEditingTemplate(null);
							}}
							variant="secondary"
							disabled={saving}
						>
							{t("取消")}
						</Button>
						<Button onClick={handleSave} variant="primary" loading={saving} disabled={saving}>
							{editingTemplate ? t("保存") : t("创建")}
						</Button>
					</div>
				}
			>
				<FormField label={t("专栏名称")} required>
					<TextInput
						value={form.name}
						onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
						placeholder={t("例如：技术周刊")}
						required
					/>
				</FormField>

				<FormField label={t("描述")}>
					<TextArea
						rows={3}
						value={form.description}
						onChange={(event) =>
							setForm((prev) => ({ ...prev, description: event.target.value }))
						}
						placeholder={t("可选，用于说明这个专栏的定位")}
					/>
				</FormField>

				<FormField label={t("颜色")}>
					<div className="grid grid-cols-10 gap-2">
						{PRESET_COLORS.map((color) => (
							<button
								key={color}
								type="button"
								onClick={() => setForm((prev) => ({ ...prev, color }))}
								className={`h-8 w-8 rounded-lg transition ${
									form.color === color
										? "ring-2 ring-primary ring-offset-2"
										: "hover:scale-110"
								}`}
								style={{ backgroundColor: color }}
							/>
						))}
					</div>
				</FormField>
			</ModalShell>

			<ConfirmModal
				isOpen={Boolean(confirmDeleteTemplate)}
				title={t("删除专栏")}
				message={t("确定要删除这个专栏吗？此操作不可撤销。")}
				confirmText={t("删除")}
				cancelText={t("取消")}
				onConfirm={handleDelete}
				onCancel={() => setConfirmDeleteTemplate(null)}
			/>
		</div>
	);
}
