import { useI18n } from "@/lib/i18n";
import Button from "@/components/Button";
import ModalShell from "@/components/ui/ModalShell";

export interface ConfirmModalProps {
	isOpen: boolean;
	title: string;
	message: string;
	confirmText?: string;
	cancelText?: string;
	onConfirm: () => void;
	onCancel: () => void;
}

export default function ConfirmModal({
	isOpen,
	title,
	message,
	confirmText,
	cancelText,
	onConfirm,
	onCancel,
}: ConfirmModalProps) {
	const { t } = useI18n();
	const confirmLabel = confirmText || t("确定");
	const cancelLabel = cancelText || t("取消");

	return (
		<ModalShell
			isOpen={isOpen}
			onClose={onCancel}
			title={title}
			widthClassName="max-w-sm"
			footer={(
				<div className="flex justify-end gap-2">
					<Button type="button" variant="secondary" onClick={onCancel}>
						{cancelLabel}
					</Button>
					<Button type="button" variant="danger" onClick={onConfirm}>
						{confirmLabel}
					</Button>
				</div>
			)}
		>
			<p className="text-sm text-text-2">{message}</p>
		</ModalShell>
	);
}
