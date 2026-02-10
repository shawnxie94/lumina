import { forwardRef } from "react";
import type { InputHTMLAttributes } from "react";

interface TextInputProps extends InputHTMLAttributes<HTMLInputElement> {
	compact?: boolean;
}

const TextInput = forwardRef<HTMLInputElement, TextInputProps>(
	({ className = "", compact = false, ...props }, ref) => {
		const baseClassName = compact
			? "h-8 px-2.5"
			: "h-9 px-3";

		return (
			<input
				ref={ref}
				className={`w-full ${baseClassName} border border-border rounded-sm bg-surface text-text-1 text-sm placeholder:text-sm placeholder:text-text-3 shadow-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35 focus-visible:ring-offset-2 focus-visible:ring-offset-surface focus-visible:border-accent disabled:opacity-50 disabled:cursor-not-allowed ${className}`}
				{...props}
			/>
		);
	},
);

TextInput.displayName = "TextInput";

export default TextInput;
