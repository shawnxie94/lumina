import { useEffect, useState } from "react";

import { useI18n } from "@/lib/i18n";
import Button from "@/components/Button";
import ModalShell from "@/components/ui/ModalShell";

export interface ConfirmModalProps {
	isOpen: boolean;
	title: string;
	message: string;
	confirmText?: string;
	cancelText?: string;
	onConfirm: () => void | Promise<void>;
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
	const [confirming, setConfirming] = useState(false);
	const confirmLabel = confirmText || t("确定");
	const cancelLabel = cancelText || t("取消");

	useEffect(() => {
		if (!isOpen) {
			setConfirming(false);
		}
	}, [isOpen]);

	const handleCancel = () => {
		if (confirming) return;
		onCancel();
	};

	const handleConfirm = async () => {
		if (confirming) return;
		setConfirming(true);
		try {
			await onConfirm();
		} finally {
			setConfirming(false);
		}
	};

	return (
		<ModalShell
			isOpen={isOpen}
			onClose={handleCancel}
			title={title}
			widthClassName="max-w-sm"
			showCloseButton={false}
			footer={(
				<div className="flex justify-end gap-2">
					<Button type="button" variant="secondary" onClick={handleCancel} disabled={confirming}>
						{cancelLabel}
					</Button>
					<Button type="button" variant="danger" onClick={handleConfirm} loading={confirming} disabled={confirming}>
						{confirmLabel}
					</Button>
				</div>
			)}
		>
			<p className="text-sm text-text-2">{message}</p>
		</ModalShell>
	);
}
