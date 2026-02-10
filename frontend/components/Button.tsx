import type { ButtonHTMLAttributes, ReactNode } from "react";
import { useI18n } from "@/lib/i18n";

export type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";
export type ButtonSize = "sm" | "md" | "lg";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
	children: ReactNode;
	variant?: ButtonVariant;
	size?: ButtonSize;
	loading?: boolean;
}

export const buttonVariantStyles: Record<ButtonVariant, string> = {
	primary:
		"bg-primary text-white hover:opacity-90 focus:ring-2 focus:ring-primary/20",
	secondary:
		"bg-surface text-text-2 border border-border hover:bg-muted hover:text-text-1 focus:ring-2 focus:ring-accent/20",
	danger:
		"bg-danger text-white hover:bg-danger-hover focus:ring-2 focus:ring-danger/20",
	ghost:
		"bg-transparent text-text-2 hover:bg-muted hover:text-text-1 focus:ring-2 focus:ring-accent/20",
};

export const buttonSizeStyles: Record<ButtonSize, string> = {
	sm: "px-3 py-1.5 text-sm",
	md: "px-4 py-2 text-sm",
	lg: "px-6 py-3 text-base",
};

export default function Button({
	children,
	variant = "secondary",
	size = "md",
	loading = false,
	disabled,
	className = "",
	...props
}: ButtonProps) {
	const { t } = useI18n();
	const baseStyles =
		"inline-flex items-center justify-center rounded-sm transition font-medium focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed";

	return (
		<button
			type="button"
			className={`${baseStyles} ${buttonVariantStyles[variant]} ${buttonSizeStyles[size]} ${className}`}
			disabled={disabled || loading}
			{...props}
		>
			{loading ? (
				<>
					<svg
						className="animate-spin -ml-1 mr-2 h-4 w-4"
						xmlns="http://www.w3.org/2000/svg"
						fill="none"
						viewBox="0 0 24 24"
					>
						<circle
							className="opacity-25"
							cx="12"
							cy="12"
							r="10"
							stroke="currentColor"
							strokeWidth="4"
						/>
						<path
							className="opacity-75"
							fill="currentColor"
							d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
						/>
					</svg>
					{t("处理中...")}
				</>
			) : (
				children
			)}
		</button>
	);
}
