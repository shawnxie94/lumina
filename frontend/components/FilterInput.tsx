import type { ChangeEvent } from "react";

interface FilterInputProps {
	label: string;
	value: string;
	onChange: (value: string) => void;
	placeholder?: string;
	type?: "text" | "number";
	id?: string;
}

export default function FilterInput({
	label,
	value,
	onChange,
	placeholder,
	type = "text",
	id,
}: FilterInputProps) {
	const inputId = id || `filter-input-${label}`;

	const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
		onChange(event.target.value);
	};

	return (
		<div>
			<label htmlFor={inputId} className="block text-sm text-text-2 mb-1.5">
				{label}
			</label>
			<input
				id={inputId}
				type={type}
				value={value}
				onChange={handleChange}
				placeholder={placeholder}
				className="w-full h-9 px-3 border border-border rounded-sm bg-surface text-text-1 text-sm placeholder:text-sm placeholder:text-text-3 shadow-sm focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent"
			/>
		</div>
	);
}
