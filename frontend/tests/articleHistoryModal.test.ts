import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

test("article version history modal keeps a fixed panel height and scrolls within the modal", () => {
	const source = readFileSync(
		join(process.cwd(), "pages/article/[id].tsx"),
		"utf8",
	);

	assert.match(
		source,
		/panelClassName="flex h-\[min\(90vh,48rem\)\] flex-col"/,
	);
	assert.match(
		source,
		/bodyClassName="min-h-0 flex-1 overflow-hidden p-4"/,
	);
	assert.match(
		source,
		/className="grid h-full min-h-0 gap-4 lg:grid-cols-\[320px_minmax\(0,1fr\)\]"/,
	);
	assert.match(
		source,
		/className="min-h-0 overflow-y-auto space-y-3"/,
	);
	assert.match(
		source,
		/className="min-h-0 overflow-y-auto rounded-lg border border-border bg-muted p-4"/,
	);
});
