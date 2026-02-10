import type { ReactNode } from "react";

interface SectionToggleButtonProps {
	label: ReactNode;
	expanded: boolean;
	onToggle: () => void;
	onMainClick?: () => void;
	active?: boolean;
	icon?: ReactNode;
	expandedIndicator?: ReactNode;
	collapsedIndicator?: ReactNode;
	toggleAriaLabel?: string;
	className?: string;
}

export default function SectionToggleButton({
	label,
	expanded,
	onToggle,
	onMainClick,
	active = false,
	icon,
	expandedIndicator,
	collapsedIndicator,
	toggleAriaLabel,
	className = "",
}: SectionToggleButtonProps) {
	const containerClassName = `w-full rounded-sm transition text-text-2 ${
		active ? "bg-muted text-text-1" : "hover:text-text-1 hover:bg-muted"
	} ${className}`;
	const indicator = expanded ? expandedIndicator : collapsedIndicator;

	if (onMainClick) {
		return (
			<div className={`${containerClassName} flex items-center`}>
				<button
					type="button"
					onClick={onMainClick}
					className="flex-1 inline-flex items-center gap-2 px-4 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35 focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
				>
					{icon}
					<span>{label}</span>
				</button>
				<button
					type="button"
					onClick={onToggle}
					className="px-3 py-3 text-current focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35 focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
					aria-label={toggleAriaLabel}
				>
					{indicator}
				</button>
			</div>
		);
	}

	return (
		<button
			type="button"
			onClick={onToggle}
			className={`${containerClassName} flex w-full items-center justify-between px-4 py-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35 focus-visible:ring-offset-2 focus-visible:ring-offset-surface`}
		>
			<span>{label}</span>
			<span className="text-text-3">{indicator}</span>
		</button>
	);
}
