import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

test("reading context syncs recent reading updates from other tabs", () => {
	const source = readFileSync(
		join(process.cwd(), "contexts/ReadingContext.tsx"),
		"utf8",
	);

	assert.match(source, /addEventListener\('storage', handleStorageChange\)/);
	assert.match(
		source,
		/event\.key !== RECENT_READING_STORAGE_KEY && event\.key !== RECENT_READING_COLLAPSED_STORAGE_KEY/,
	);
	assert.match(source, /setRecentArticles\(parseStoredArticles\(localStorage\.getItem\(RECENT_READING_STORAGE_KEY\)\)\)/);
	assert.match(source, /addEventListener\('focus', refreshFromStorage\)/);
});

test("reading context hydrates from local storage during state initialization to avoid overwriting fresh reads", () => {
	const source = readFileSync(
		join(process.cwd(), "contexts/ReadingContext.tsx"),
		"utf8",
	);

	assert.match(
		source,
		/useState<ReadingArticle\[]>\(\(\) =>[\s\S]*parseStoredArticles\(localStorage\.getItem\(RECENT_READING_STORAGE_KEY\)\)/,
	);
	assert.match(
		source,
		/useState\(\(\) =>[\s\S]*localStorage\.getItem\(RECENT_READING_COLLAPSED_STORAGE_KEY\)/,
	);
	assert.doesNotMatch(source, /const \[initialized, setInitialized\]/);
});
