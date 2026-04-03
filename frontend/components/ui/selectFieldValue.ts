export const EMPTY_SELECT_VALUE_SENTINEL = "__lumina_empty_select_value__";

type SelectOptionLike = {
	value?: unknown;
	[key: string]: unknown;
};

export const normalizeSingleSelectValue = (value: unknown) =>
	value === "" ? EMPTY_SELECT_VALUE_SENTINEL : value;

export const denormalizeSingleSelectValue = (value: unknown) =>
	value === EMPTY_SELECT_VALUE_SENTINEL ? "" : value;

export const normalizeSingleSelectOptions = <T extends SelectOptionLike>(
	options?: T[],
): T[] | undefined =>
	options?.map((option) =>
		option.value === ""
			? ({ ...option, value: EMPTY_SELECT_VALUE_SENTINEL } as T)
			: option,
	);
