import type { ChangeEvent } from "react";
import FormField from "@/components/ui/FormField";
import TextInput from "@/components/ui/TextInput";

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
		<FormField label={label} htmlFor={inputId}>
			<TextInput
				id={inputId}
				type={type}
				value={value}
				onChange={handleChange}
				placeholder={placeholder}
			/>
		</FormField>
	);
}
