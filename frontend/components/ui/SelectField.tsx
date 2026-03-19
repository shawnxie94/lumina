import { Select } from "antd";
import type { CSSProperties } from "react";
import type { SelectProps } from "antd";

interface SelectFieldProps extends SelectProps {
	compact?: boolean;
	multiline?: boolean;
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
	multiline = false,
	className = "",
	popupClassName = "",
	style,
	showSearch,
	optionFilterProp,
	filterOption,
	...props
}: SelectFieldProps) {
	const height = compact ? 32 : 36;
	const isMultiMode = props.mode === "multiple" || props.mode === "tags";
	const sizeClass = multiline && isMultiMode ? "" : compact ? "h-8" : "h-9";
	const multilineClass = multiline && isMultiMode ? "select-modern-antd-multiline" : "";
	const resolvedClassName = `select-modern-antd ${sizeClass} ${multilineClass} ${className}`.trim();
	const resolvedPopupClassName = `select-modern-dropdown ${popupClassName}`.trim();
	const resolvedStyle: CSSProperties = {
		...(multiline && isMultiMode ? { minHeight: height } : { height }),
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
