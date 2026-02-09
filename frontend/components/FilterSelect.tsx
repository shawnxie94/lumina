import { Select } from "antd";
import FormField from "@/components/ui/FormField";

interface FilterSelectOption {
	value: string;
	label: string;
}

interface FilterSelectProps {
	label: string;
	value: string;
	onChange: (value: string) => void;
	options: FilterSelectOption[];
	placeholder?: string;
	id?: string;
}

export default function FilterSelect({
	label,
	value,
	onChange,
	options,
	placeholder,
	id,
}: FilterSelectProps) {
	const selectId = id || `filter-select-${label}`;

	return (
		<FormField label={label} htmlFor={selectId}>
			<Select
				id={selectId}
				value={value}
				onChange={onChange}
				options={options}
				placeholder={placeholder}
				className="select-modern-antd w-full"
				popupClassName="select-modern-dropdown"
				style={{ height: 36 }}
			/>
		</FormField>
	);
}
