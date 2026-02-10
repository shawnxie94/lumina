import type { ReactNode } from "react";

interface FormFieldProps {
	label?: ReactNode;
	htmlFor?: string;
	required?: boolean;
	children: ReactNode;
	hint?: ReactNode;
	className?: string;
	labelClassName?: string;
}

const defaultLabelClassName = "mb-1.5 block text-sm text-text-2";

export default function FormField({
	label,
	htmlFor,
	required = false,
	children,
	hint,
	className = "",
	labelClassName = "",
}: FormFieldProps) {
	return (
		<div className={className}>
			{label && (
				<label
					htmlFor={htmlFor}
					className={`${defaultLabelClassName} ${labelClassName}`}
				>
					<span>{label}</span>
					{required && <span className="ml-1 text-danger">*</span>}
				</label>
			)}
			{children}
			{hint && <div className="mt-1 text-xs text-text-3">{hint}</div>}
		</div>
	);
}
