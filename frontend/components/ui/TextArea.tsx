import { forwardRef } from "react";
import type { TextareaHTMLAttributes } from "react";

interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
	compact?: boolean;
}

const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(
	({ className = "", compact = false, ...props }, ref) => {
		const paddingClassName = compact ? "px-2.5 py-1.5" : "px-3 py-2";

		return (
			<textarea
				ref={ref}
				className={`w-full ${paddingClassName} border border-border rounded-sm bg-surface text-text-1 text-sm placeholder:text-sm placeholder:text-text-3 shadow-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35 focus-visible:ring-offset-2 focus-visible:ring-offset-surface focus-visible:border-accent disabled:opacity-50 disabled:cursor-not-allowed ${className}`}
				{...props}
			/>
		);
	},
);

TextArea.displayName = "TextArea";

export default TextArea;
