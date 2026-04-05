export const shouldFetchSimilarArticlesForSlug = (
	articleSlug?: string | null,
	lastFetchedSlug?: string | null,
): articleSlug is string =>
	Boolean(articleSlug && articleSlug !== lastFetchedSlug);
