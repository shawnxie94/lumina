export type QuickDateOption = "" | "1d" | "3d" | "1w" | "1m" | "3m" | "6m" | "1y";

export const quickDateOptions: QuickDateOption[] = ["", "1d", "3d", "1w", "1m", "3m", "6m", "1y"];

export const parseQuickDateOption = (value?: string): QuickDateOption => {
  const normalizedValue = value || "";
  return quickDateOptions.includes(normalizedValue as QuickDateOption)
    ? (normalizedValue as QuickDateOption)
    : "";
};
