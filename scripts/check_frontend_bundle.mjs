import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { gzipSync } from "node:zlib";

const build = resolve(import.meta.dirname, "../frontend/.next");
const manifest = JSON.parse(
	readFileSync(resolve(build, "build-manifest.json"), "utf8"),
);
const lazy = JSON.parse(
	readFileSync(resolve(build, "react-loadable-manifest.json"), "utf8"),
);
// Measured locally from this S2–S5 production build (2026-10-22).
// Sum per-file gzip bytes for the route + _app, with 5% regression allowance.
const baseline = { "/admin": 678599, "/article/[id]": 611462 };
for (const route of Object.keys(baseline)) {
	const files = new Set(
		[...manifest.pages["/_app"], ...manifest.pages[route]].filter((file) =>
			file.endsWith(".js"),
		),
	);
	let bytes = 0;
	for (const file of files)
		bytes += gzipSync(readFileSync(resolve(build, file))).byteLength;
	const budget = Math.ceil(baseline[route] * 1.05);
	console.log(
		`${route}: initial JS gzip ${bytes} bytes; baseline ${baseline[route]}; budget ${budget}`,
	);
	assert.ok(bytes <= budget, `${route} exceeds measured baseline + 5%`);
}
for (const name of ["BasicSettingsContainer", "AiUsageContainer"]) {
	const entry = Object.entries(lazy).find(([key]) => key.includes(name));
	assert.ok(entry, `Missing production lazy boundary: ${name}`);
	const adminFiles = new Set(manifest.pages["/admin"]);
	assert.ok(
		entry[1].files.some(
			(file) => file.endsWith(".js") && !adminFiles.has(file),
		),
		`${name} is bundled eagerly into admin`,
	);
}
