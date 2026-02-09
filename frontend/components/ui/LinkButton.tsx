import Link from "next/link";
import type { ReactNode } from "react";
import { buttonSizeStyles, buttonVariantStyles, type ButtonSize, type ButtonVariant } from "@/components/Button";

interface LinkButtonProps {
	href: string;
	children: ReactNode;
	variant?: ButtonVariant;
	size?: ButtonSize;
	className?: string;
	target?: string;
	rel?: string;
}

export default function LinkButton({
	href,
	children,
	variant = "secondary",
	size = "md",
	className = "",
	target,
	rel,
}: LinkButtonProps) {
	const baseClassName =
		"inline-flex items-center justify-center rounded-sm transition font-medium focus:outline-none";
	const resolvedClassName = `${baseClassName} ${buttonVariantStyles[variant]} ${buttonSizeStyles[size]} ${className}`;
	const isExternal = /^https?:\/\//.test(href);

	if (isExternal) {
		return (
			<a href={href} className={resolvedClassName} target={target} rel={rel}>
				{children}
			</a>
		);
	}

	return (
		<Link href={href} className={resolvedClassName}>
			{children}
		</Link>
	);
}
