import type { ReactNode } from "react";

interface ModalShellProps {
	isOpen: boolean;
	onClose?: () => void;
	title: ReactNode;
	children: ReactNode;
	footer?: ReactNode;
	widthClassName?: string;
	panelClassName?: string;
	bodyClassName?: string;
	headerClassName?: string;
	footerClassName?: string;
	overlayClassName?: string;
	showCloseButton?: boolean;
}

const defaultOverlayClassName =
	"fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4";
const defaultPanelClassName = "w-full rounded-lg bg-surface shadow-xl overflow-hidden";

export default function ModalShell({
	isOpen,
	onClose,
	title,
	children,
	footer,
	widthClassName = "max-w-lg",
	panelClassName = "",
	bodyClassName = "p-4",
	headerClassName = "border-b border-border p-4",
	footerClassName = "border-t border-border bg-muted p-4",
	overlayClassName = "",
	showCloseButton = true,
}: ModalShellProps) {
	if (!isOpen) return null;

	const handleMaskClick = () => {
		onClose?.();
	};

	return (
		<div className={`${defaultOverlayClassName} ${overlayClassName}`} onClick={handleMaskClick}>
			<div
				className={`${defaultPanelClassName} ${widthClassName} ${panelClassName}`}
				onClick={(event) => event.stopPropagation()}
			>
				<div className={`flex items-center justify-between ${headerClassName}`}>
					<h3 className="text-lg font-semibold text-text-1">{title}</h3>
					{showCloseButton && (
						<button
							type="button"
							onClick={onClose}
							className="text-xl text-text-3 transition hover:text-text-1"
						>
							×
						</button>
					)}
				</div>
				<div className={bodyClassName}>{children}</div>
				{footer && <div className={footerClassName}>{footer}</div>}
			</div>
		</div>
	);
}
