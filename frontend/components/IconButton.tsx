import type { ButtonHTMLAttributes, ReactNode } from "react";

type IconButtonVariant = "default" | "primary" | "secondary" | "danger" | "ghost";
type IconButtonSize = "sm" | "md";

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
	children: ReactNode;
	variant?: IconButtonVariant;
	size?: IconButtonSize;
	title: string;
	loading?: boolean;
}

const variantStyles: Record<IconButtonVariant, string> = {
	default: "text-text-3 hover:text-text-1 hover:bg-muted",
	primary: "text-text-3 hover:text-primary hover:bg-primary-soft",
	secondary:
		"text-text-2 bg-surface border border-border hover:bg-muted hover:text-text-1",
	danger: "text-text-3 hover:text-danger-ink hover:bg-danger-soft",
	ghost: "text-text-2 hover:text-text-1 hover:bg-muted/50",
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
	loading = false,
	disabled,
	className = "",
	...props
}: IconButtonProps) {
	const baseStyles =
		"inline-flex items-center justify-center rounded-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35 focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:opacity-50 disabled:cursor-not-allowed";

	return (
		<button
			type="button"
			title={title}
			aria-label={props["aria-label"] || title}
			aria-busy={loading || undefined}
			className={`${baseStyles} ${variantStyles[variant]} ${sizeStyles[size]} ${className}`}
			disabled={disabled || loading}
			{...props}
		>
			{loading ? <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" /> : children}
		</button>
	);
}

export { iconSizes };
