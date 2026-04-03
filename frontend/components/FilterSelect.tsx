import FormField from "@/components/ui/FormField";
import SelectField from "@/components/ui/SelectField";

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
	showSearch?: boolean;
}

export default function FilterSelect({
	label,
	value,
	onChange,
	options,
	placeholder,
	id,
	showSearch,
}: FilterSelectProps) {
	const selectId = id || `filter-select-${label}`;

	return (
		<FormField label={label} htmlFor={selectId}>
			<SelectField
				id={selectId}
				value={value}
				onChange={onChange}
				options={options}
				placeholder={placeholder}
				showSearch={showSearch}
				className="w-full"
			/>
		</FormField>
	);
}
