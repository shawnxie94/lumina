import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from "react";

import { useI18n } from "@/lib/i18n";

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
const focusableSelector =
	'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

let openModalCount = 0;
let previousBodyOverflow = "";
let previousBodyPaddingRight = "";

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
	const { t } = useI18n();
	const panelRef = useRef<HTMLDivElement | null>(null);
	const previousFocusRef = useRef<HTMLElement | null>(null);
	const titleId = useId();

	useEffect(() => {
		if (!isOpen) return;
		previousFocusRef.current = document.activeElement as HTMLElement | null;
		const panel = panelRef.current;
		if (!panel) return;
		const firstFocusable = panel.querySelector<HTMLElement>(focusableSelector);
		(firstFocusable || panel).focus();
		return () => {
			previousFocusRef.current?.focus();
		};
	}, [isOpen]);

	useEffect(() => {
		if (!isOpen || typeof document === "undefined" || typeof window === "undefined") {
			return;
		}
		const body = document.body;
		if (openModalCount === 0) {
			previousBodyOverflow = body.style.overflow;
			previousBodyPaddingRight = body.style.paddingRight;
			const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
			if (scrollbarWidth > 0) {
				body.style.paddingRight = `${scrollbarWidth}px`;
			}
			body.style.overflow = "hidden";
		}
		openModalCount += 1;
		return () => {
			openModalCount = Math.max(0, openModalCount - 1);
			if (openModalCount === 0) {
				body.style.overflow = previousBodyOverflow;
				body.style.paddingRight = previousBodyPaddingRight;
			}
		};
	}, [isOpen]);

	if (!isOpen) return null;

	const handleMaskClick = () => {
		onClose?.();
	};

	const handlePanelKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
		if (event.key === "Escape") {
			onClose?.();
			return;
		}
		if (event.key !== "Tab") return;
		const panel = panelRef.current;
		if (!panel) return;
		const focusable = Array.from(panel.querySelectorAll<HTMLElement>(focusableSelector));
		if (focusable.length === 0) {
			event.preventDefault();
			panel.focus();
			return;
		}
		const first = focusable[0];
		const last = focusable[focusable.length - 1];
		const active = document.activeElement;
		if (event.shiftKey && active === first) {
			event.preventDefault();
			last.focus();
		}
		if (!event.shiftKey && active === last) {
			event.preventDefault();
			first.focus();
		}
	};

	return (
		<div className={`${defaultOverlayClassName} ${overlayClassName}`} onClick={handleMaskClick}>
			<div
				ref={panelRef}
				role="dialog"
				aria-modal="true"
				aria-labelledby={titleId}
				tabIndex={-1}
				className={`${defaultPanelClassName} ${widthClassName} ${panelClassName}`}
				onClick={(event) => event.stopPropagation()}
				onKeyDown={handlePanelKeyDown}
			>
				<div className={`flex items-center justify-between ${headerClassName}`}>
					<h3 id={titleId} className="text-lg font-semibold text-text-1">
						{title}
					</h3>
					{showCloseButton && onClose && (
						<button
							type="button"
							onClick={onClose}
							className="text-xl text-text-3 transition hover:text-text-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35"
							aria-label={t("关闭")}
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
