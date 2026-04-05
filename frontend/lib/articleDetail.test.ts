import assert from "node:assert/strict";
import test from "node:test";

import { shouldFetchSimilarArticlesForSlug } from "./articleDetail";

test("fetches similar articles for hydrated article detail on first load", () => {
	assert.equal(
		shouldFetchSimilarArticlesForSlug(
			"supply-chain-attack-on-axios-pulls-malicious-b8730275",
			null,
		),
		true,
	);
});

test("skips similar article refetch when slug has not changed", () => {
	assert.equal(
		shouldFetchSimilarArticlesForSlug(
			"supply-chain-attack-on-axios-pulls-malicious-b8730275",
			"supply-chain-attack-on-axios-pulls-malicious-b8730275",
		),
		false,
	);
});

test("refetches similar articles after navigating to a different article", () => {
	assert.equal(
		shouldFetchSimilarArticlesForSlug(
			"encoding-team-standards-30e07579",
			"supply-chain-attack-on-axios-pulls-malicious-b8730275",
		),
		true,
	);
});
