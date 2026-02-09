import type { InputHTMLAttributes } from "react";

interface CheckboxInputProps extends InputHTMLAttributes<HTMLInputElement> {}

export default function CheckboxInput({ className = "", ...props }: CheckboxInputProps) {
	return (
		<input
			{...props}
			type="checkbox"
			className={`h-4 w-4 rounded border-border text-blue-600 focus:ring-blue-500/20 ${className}`}
		/>
	);
}
