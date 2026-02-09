import { Select } from "antd";

interface FilterSelectInlineOption {
	value: string;
	label: string;
}

interface FilterSelectInlineProps {
	label: string;
	value: string;
	onChange: (value: string) => void;
	options: FilterSelectInlineOption[];
	placeholder?: string;
	id?: string;
	className?: string;
}

export default function FilterSelectInline({
	label,
	value,
	onChange,
	options,
	placeholder,
	id,
	className = "",
}: FilterSelectInlineProps) {
	const selectId = id || `filter-select-inline-${label}`;

	return (
		<div className={`flex items-center gap-2 ${className}`}>
			<label htmlFor={selectId} className="whitespace-nowrap text-sm text-text-2">
				{label}
			</label>
			<Select
				id={selectId}
				value={value}
				onChange={onChange}
				options={options}
				placeholder={placeholder}
				className="select-modern-antd"
				popupClassName="select-modern-dropdown"
				style={{ height: 36 }}
			/>
		</div>
	);
}
