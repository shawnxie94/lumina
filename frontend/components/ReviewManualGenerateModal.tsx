import { useEffect, useState } from "react";
import { useRouter } from "next/router";

import Button from "@/components/Button";
import IconButton from "@/components/IconButton";
import ModalShell from "@/components/ui/ModalShell";
import FormField from "@/components/ui/FormField";
import SelectField from "@/components/ui/SelectField";
import TextInput from "@/components/ui/TextInput";
import { IconPlus } from "@/components/icons";
import { useToast } from "@/components/Toast";
import { type ReviewTemplate, reviewApi } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

interface ReviewManualGenerateModalProps {
	isOpen: boolean;
	onClose: () => void;
	initialTemplateId?: string;
	lockTemplateSelection?: boolean;
	title?: string;
}

export default function ReviewManualGenerateModal({
	isOpen,
	onClose,
	initialTemplateId,
	lockTemplateSelection = false,
	title,
}: ReviewManualGenerateModalProps) {
	const { t } = useI18n();
	const { showToast } = useToast();
	const router = useRouter();
	const [templates, setTemplates] = useState<ReviewTemplate[]>([]);
	const [selectedTemplateId, setSelectedTemplateId] = useState("");
	const [articleTitle, setArticleTitle] = useState("");
	const [bootstrapLoading, setBootstrapLoading] = useState(false);
	const [submitting, setSubmitting] = useState(false);

	useEffect(() => {
		if (!isOpen) return;
		let active = true;
		const bootstrap = async () => {
			setBootstrapLoading(true);
			try {
				const data = await reviewApi.getTemplates();
				if (!active) return;
				setTemplates(data);
				const preferred =
					initialTemplateId &&
					data.some((item) => item.id === initialTemplateId)
						? initialTemplateId
						: data[0]?.id || "";
				setSelectedTemplateId(preferred);
				setArticleTitle("");
			} catch (error) {
				console.error("Failed to load column create config:", error);
				if (active) showToast(t("专栏创建配置加载失败"), "error");
			} finally {
				if (active) setBootstrapLoading(false);
			}
		};
		void bootstrap();
		return () => {
			active = false;
		};
	}, [initialTemplateId, isOpen, showToast, t]);

	const handleCreate = async () => {
		if (!selectedTemplateId) {
			showToast(t("请先选择专栏"), "error");
			return;
		}
		setSubmitting(true);
		try {
			const result = await reviewApi.runTemplateManual(selectedTemplateId, {
				title: articleTitle.trim() || undefined,
			});
			showToast(t("专栏文章已创建"), "success");
			const slug = result.issue_slug;
			if (slug) {
				window.location.assign(`/columns/${slug}?edit=1`);
			} else {
				onClose();
				router.push("/columns");
			}
		} catch (error) {
			console.error("Failed to create column article:", error);
			showToast(t("专栏文章创建失败"), "error");
		} finally {
			setSubmitting(false);
		}
	};

	const handleOpenColumnSettings = () => {
		onClose();
		void router.push("/admin/settings/columns");
	};

	return (
		<ModalShell
			isOpen={isOpen}
			onClose={onClose}
			title={title || t("创建文章")}
			widthClassName="max-w-lg"
			panelClassName="max-h-[90vh] overflow-y-auto"
			headerClassName="border-b border-border p-6"
			bodyClassName="space-y-5 p-6"
			footerClassName="border-t border-border bg-muted p-6"
			footer={
				<div className="flex items-center justify-end gap-2">
					<Button onClick={onClose} variant="secondary" disabled={submitting}>
						{t("取消")}
					</Button>
					<Button
						onClick={handleCreate}
						variant="primary"
						loading={submitting}
						disabled={submitting || bootstrapLoading || !selectedTemplateId}
					>
						{t("创建")}
					</Button>
				</div>
			}
		>
			<FormField label={t("专栏")}>
				<div className="flex items-center gap-2">
					<SelectField
						value={selectedTemplateId}
						onChange={(value) => setSelectedTemplateId(String(value || ""))}
						className="min-w-0 flex-1"
						disabled={lockTemplateSelection || bootstrapLoading}
						options={templates.map((template) => ({
							value: template.id,
							label: template.name,
						}))}
					/>
					<IconButton
						type="button"
						onClick={handleOpenColumnSettings}
						variant="secondary"
						size="md"
						title={t("管理专栏")}
						aria-label={t("管理专栏")}
						className="shrink-0"
						disabled={submitting}
					>
						<IconPlus className="h-4 w-4" />
					</IconButton>
				</div>
			</FormField>
			<FormField label={t("文章标题")}>
				<TextInput
					value={articleTitle}
					onChange={(event) => setArticleTitle(event.target.value)}
					placeholder={t("可选，默认新建文章")}
					className="w-full"
				/>
			</FormField>
		</ModalShell>
	);
}
