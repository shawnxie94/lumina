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
	info: "bg-primary-soft text-primary-ink",
	success: "bg-green-100 text-green-700",
	warning: "bg-yellow-100 text-yellow-700",
	danger: "bg-red-100 text-red-700",
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
