import { Select } from "antd";
import type { CSSProperties } from "react";
import type { SelectProps } from "antd";

interface SelectFieldProps extends SelectProps {
	compact?: boolean;
}

export default function SelectField({
	compact = false,
	className = "",
	popupClassName = "",
	style,
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
		/>
	);
}
