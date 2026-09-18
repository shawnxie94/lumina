export const formatCostValue = (value: number | null | undefined, digits = 6) => {
	if (value == null || Number.isNaN(value)) return "-";
	return value.toFixed(digits);
};

export const formatPrice = (value: number | null | undefined, digits = 6) => {
	if (value == null || Number.isNaN(value)) return "-";
	if (value === 0) return "0";
	return value.toFixed(digits);
};
