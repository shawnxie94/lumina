import { Select } from "antd";

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
		<div>
			<label htmlFor={selectId} className="block text-sm text-text-2 mb-1.5">
				{label}
			</label>
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
		</div>
	);
}
