import { Select } from "antd";
import type { CSSProperties } from "react";
import type { SelectProps } from "antd";

import {
	denormalizeSingleSelectValue,
	normalizeSingleSelectOptions,
	normalizeSingleSelectValue,
} from "@/components/ui/selectFieldValue";

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
	options,
	value,
	onChange,
	...props
}: SelectFieldProps) {
	const height = compact ? 32 : 36;
	const isMultiMode = props.mode === "multiple" || props.mode === "tags";
	const sizeClass = multiline && isMultiMode ? "" : compact ? "h-8" : "h-9";
	const multiLayoutClass = isMultiMode
		? multiline
			? "select-modern-antd-multiline"
			: "select-modern-antd-singleline-multiple"
		: "";
	const resolvedClassName = `select-modern-antd ${sizeClass} ${multiLayoutClass} ${className}`.trim();
	const resolvedPopupClassName = `select-modern-dropdown ${popupClassName}`.trim();
	const resolvedOptions = isMultiMode
		? options
		: normalizeSingleSelectOptions(options as Array<Record<string, unknown>> | undefined);
	const resolvedValue = isMultiMode ? value : normalizeSingleSelectValue(value);
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
			options={resolvedOptions}
			value={resolvedValue}
			onChange={(nextValue, option) => {
				if (!onChange) return;
				onChange(
					isMultiMode ? nextValue : denormalizeSingleSelectValue(nextValue),
					option,
				);
			}}
			showSearch={showSearch ?? true}
			optionFilterProp={optionFilterProp ?? "label"}
			filterOption={filterOption ?? defaultFilterOption}
		/>
	);
}
