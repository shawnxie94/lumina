import { Select } from "antd";
import type { CSSProperties } from "react";
import type { SelectProps } from "antd";

interface SelectFieldProps extends SelectProps {
	compact?: boolean;
}

const normalizeText = (value: unknown) =>
	String(value ?? "")
		.toLowerCase()
		.replace(/\s+/g, "");

const defaultFilterOption: NonNullable<SelectProps["filterOption"]> = (
	input,
	option,
) => {
	if (!option || typeof option !== "object") return false;
	const record = option as {
		label?: unknown;
		children?: unknown;
		value?: unknown;
	};
	const optionText = normalizeText(record.label ?? record.children ?? record.value);
	const query = normalizeText(input);
	if (!query) return true;
	return optionText.includes(query);
};

export default function SelectField({
	compact = false,
	className = "",
	popupClassName = "",
	style,
	showSearch,
	optionFilterProp,
	filterOption,
	...props
}: SelectFieldProps) {
	const height = compact ? 32 : 36;
	const resolvedClassName = `select-modern-antd ${compact ? "h-8" : "h-9"} ${className}`.trim();
	const resolvedPopupClassName = `select-modern-dropdown ${popupClassName}`.trim();
	const resolvedStyle: CSSProperties = {
		height,
		...style,
	};

	return (
		<Select
			{...props}
			className={resolvedClassName}
			popupClassName={resolvedPopupClassName}
			style={resolvedStyle}
			showSearch={showSearch ?? true}
			optionFilterProp={optionFilterProp ?? "label"}
			filterOption={filterOption ?? defaultFilterOption}
		/>
	);
}
