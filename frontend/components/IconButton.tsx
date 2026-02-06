import type { ButtonHTMLAttributes, ReactNode } from "react";

type IconButtonVariant = "default" | "primary" | "secondary" | "danger" | "ghost";
type IconButtonSize = "sm" | "md";

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
	children: ReactNode;
	variant?: IconButtonVariant;
	size?: IconButtonSize;
	title: string;
}

const variantStyles: Record<IconButtonVariant, string> = {
	default:
		"text-text-3 hover:text-text-1 hover:bg-muted focus:outline-none",
	primary:
		"text-text-3 hover:text-primary hover:bg-primary-soft focus:outline-none",
	secondary:
		"text-text-2 bg-surface border border-border hover:bg-muted hover:text-text-1 focus:outline-none",
	danger:
		"text-text-3 hover:text-red-600 hover:bg-red-50 focus:outline-none",
	ghost:
		"text-text-2 hover:text-text-1 hover:bg-muted/50 focus:outline-none",
};

const sizeStyles: Record<IconButtonSize, string> = {
	sm: "w-6 h-6",
	md: "w-8 h-8",
};

const iconSizes: Record<IconButtonSize, string> = {
	sm: "h-3.5 w-3.5",
	md: "h-4 w-4",
};

export default function IconButton({
	children,
	variant = "default",
	size = "md",
	title,
	className = "",
	...props
}: IconButtonProps) {
	const baseStyles =
		"inline-flex items-center justify-center rounded-sm transition disabled:opacity-50 disabled:cursor-not-allowed";

	return (
		<button
			type="button"
			title={title}
			className={`${baseStyles} ${variantStyles[variant]} ${sizeStyles[size]} ${className}`}
			{...props}
		>
			{children}
		</button>
	);
}

export { iconSizes };
