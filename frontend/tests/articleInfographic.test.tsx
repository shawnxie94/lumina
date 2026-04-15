import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(
	join(process.cwd(), "components/article/ArticleInfographic.tsx"),
	"utf8",
);

test("article infographic preview card derives aspect ratio from measured size", () => {
	assert.match(source, /function resolveInfographicAspectRatio/);
	assert.match(source, /const \[measuredSize, setMeasuredSize\] = useState/);
	assert.match(source, /onMeasure=\{setMeasuredSize\}/);
	assert.match(
		source,
		/aspectRatio:\s*resolveInfographicAspectRatio\(measuredSize\)/,
	);
	assert.doesNotMatch(
		source,
		/className="aspect-\[3\/4\] w-full overflow-hidden/,
	);
});

test("article infographic lightbox constrains width and height with measured ratio", () => {
	assert.match(source, /const \[measuredSize, setMeasuredSize\] = useState/);
	assert.match(
		source,
		/const aspectRatio = resolveInfographicAspectRatio\(measuredSize\)/,
	);
	assert.match(source, /const maxHeight = "92vh"/);
	assert.match(
		source,
		/height:\s*`min\(92vh, calc\(96vw \/ \$\{aspectRatio\}\)\)`/,
	);
	assert.match(
		source,
		/width:\s*`min\(96vw, calc\(92vh \* \$\{aspectRatio\}\)\)`/,
	);
	assert.doesNotMatch(source, /className="relative aspect-\[3\/4\]"/);
});
