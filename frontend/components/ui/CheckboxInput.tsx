import type { InputHTMLAttributes } from "react";

interface CheckboxInputProps extends InputHTMLAttributes<HTMLInputElement> {}

export default function CheckboxInput({ className = "", ...props }: CheckboxInputProps) {
	return (
		<input
			{...props}
			type="checkbox"
			className={`h-4 w-4 rounded border-border text-primary focus-visible:ring-2 focus-visible:ring-primary/35 focus-visible:ring-offset-2 focus-visible:ring-offset-surface ${className}`}
		/>
	);
}
