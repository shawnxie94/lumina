import type { ButtonHTMLAttributes, ReactNode } from "react";

type SelectableButtonVariant = "tab" | "pill" | "menu" | "submenu";

interface SelectableButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
	children: ReactNode;
	active: boolean;
	variant?: SelectableButtonVariant;
}

const variantBaseClassName: Record<SelectableButtonVariant, string> = {
	tab: "px-6 py-3 text-sm font-medium rounded-t-sm",
	pill: "px-4 py-2 text-sm rounded-sm",
	menu: "w-full px-4 py-3 text-left rounded-sm",
	submenu: "w-full px-6 py-2 text-left text-sm rounded-sm",
};

const variantInactiveClassName: Record<SelectableButtonVariant, string> = {
	tab: "text-text-2 hover:text-text-1 hover:bg-muted",
	pill: "bg-muted text-text-2 hover:bg-surface hover:text-text-1",
	menu: "text-text-2 hover:text-text-1 hover:bg-muted",
	submenu: "text-text-2 hover:text-text-1 hover:bg-muted",
};

export default function SelectableButton({
	children,
	active,
	variant = "pill",
	className = "",
	type,
	...props
}: SelectableButtonProps) {
	const activeClassName =
		variant === "tab" || variant === "pill"
			? "bg-primary-soft text-primary-ink"
			: "bg-muted text-text-1";
	const inactiveClassName = variantInactiveClassName[variant];

	return (
		<button
			type={type ?? "button"}
			className={`${variantBaseClassName[variant]} transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35 focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:cursor-not-allowed disabled:opacity-50 ${active ? activeClassName : inactiveClassName} ${className}`}
			{...props}
		>
			{children}
		</button>
	);
}
