import type { SelectProps } from "antd";

import type { Tag } from "@/lib/api";

import SelectField from "@/components/ui/SelectField";

interface TagSelectFieldProps
	extends Omit<SelectProps<string[]>, "options" | "mode" | "value" | "onChange"> {
	tags: Tag[];
	value: string[];
	onChange: (value: string[]) => void;
	mode?: "multiple" | "tags";
	multiline?: boolean;
}

export default function TagSelectField({
	tags,
	value,
	onChange,
	mode = "multiple",
	multiline = true,
	className = "",
	...props
}: TagSelectFieldProps) {
	return (
		<SelectField
			{...props}
			mode={mode}
			multiline={multiline}
			value={value}
			onChange={(nextValue) => onChange((nextValue as string[]) || [])}
			className={className}
			options={tags.map((tag) => ({
				value: mode === "tags" ? tag.name : tag.id,
				label: tag.name,
			}))}
		/>
	);
}
