import type { ReactNode } from "react";

type StatusTone = "neutral" | "info" | "success" | "warning" | "danger";
type StatusSize = "xs" | "sm";

interface StatusTagProps {
	children: ReactNode;
	tone?: StatusTone;
	size?: StatusSize;
	className?: string;
}

const toneClassName: Record<StatusTone, string> = {
	neutral: "bg-muted text-text-2",
	info: "bg-info-soft text-info-ink",
	success: "bg-success-soft text-success-ink",
	warning: "bg-warning-soft text-warning-ink",
	danger: "bg-danger-soft text-danger-ink",
};

const sizeClassName: Record<StatusSize, string> = {
	xs: "px-2 py-1 text-xs",
	sm: "px-2 py-1 text-sm",
};

export default function StatusTag({
	children,
	tone = "neutral",
	size = "xs",
	className = "",
}: StatusTagProps) {
	return (
		<span className={`inline-flex items-center rounded ${sizeClassName[size]} ${toneClassName[tone]} ${className}`}>
			{children}
		</span>
	);
}
