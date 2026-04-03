export const buildArticleHref = (
	slug: string,
	options?: {
		from?: string;
		adminPreview?: boolean;
		preserveFrom?: boolean;
	},
): string => {
	const from = options?.preserveFrom ? options.from?.trim() : "";
	return from
		? `/article/${slug}?from=${encodeURIComponent(from)}`
		: `/article/${slug}`;
};
