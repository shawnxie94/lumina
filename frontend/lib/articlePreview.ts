export const ADMIN_PREVIEW_QUERY_KEY = "admin_preview";

const pickFirst = (value: string | string[] | undefined): string => {
	if (Array.isArray(value)) return value[0] || "";
	return value || "";
};

export const isAdminPreviewEnabled = (
	value: string | string[] | undefined,
): boolean => pickFirst(value) === "1";

export const buildAdminPreviewArticleHref = (
	slug: string,
	options?: {
		from?: string;
	},
): string => {
	const query = new URLSearchParams();
	const from = options?.from?.trim();
	if (from) {
		query.set("from", from);
	}
	query.set(ADMIN_PREVIEW_QUERY_KEY, "1");
	const queryString = query.toString();
	return `/article/${slug}${queryString ? `?${queryString}` : ""}`;
};

export const buildArticleHref = (
	slug: string,
	options?: {
		from?: string;
		adminPreview?: boolean;
		preserveFrom?: boolean;
	},
): string => {
	const shouldPreserveFrom = options?.preserveFrom === true;
	if (options?.adminPreview) {
		return buildAdminPreviewArticleHref(slug, {
			from: shouldPreserveFrom ? options.from : undefined,
		});
	}
	const from = shouldPreserveFrom ? options?.from?.trim() : "";
	return from
		? `/article/${slug}?from=${encodeURIComponent(from)}`
		: `/article/${slug}`;
};
