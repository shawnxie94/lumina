#!/usr/bin/env node
/**
 * Golden fixtures for the simplified browser extraction core (Defuddle).
 * Validates the npm engine path used by the extension. Soft assertions
 * surface known gaps without failing the suite (aligned with TRD soft quality gate).
 *
 * Usage: node scripts/verify-extraction-fixtures.mjs
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const fixtureDir = join(__dirname, "fixtures/extraction");
const require = createRequire(import.meta.url);

function loadLinkedom() {
  try {
    return require("linkedom");
  } catch {
    return require(join(root, "node_modules/defuddle/node_modules/linkedom"));
  }
}

const { parseHTML } = loadLinkedom();
const { Defuddle } = await import(
  pathToFileURL(join(root, "node_modules/defuddle/dist/node.js")).href
);

const expectations = JSON.parse(
  readFileSync(join(fixtureDir, "expectations.json"), "utf8"),
);

function stripTags(html) {
  return (html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function includesAny(haystack, needles) {
  const h = (haystack || "").toLowerCase();
  return needles.some((n) => h.includes(String(n).toLowerCase()));
}

function hasAnyTag(html, tags) {
  return tags.some((tag) => new RegExp(`<${tag}\\b`, "i").test(html || ""));
}

const files = readdirSync(fixtureDir).filter((f) => f.endsWith(".html"));
let failed = 0;
let softWarnings = 0;

for (const file of files) {
  const exp = expectations[file];
  if (!exp) {
    console.error(`FAIL ${file}: missing expectations entry`);
    failed += 1;
    continue;
  }

  const html = readFileSync(join(fixtureDir, file), "utf8");
  const { document } = parseHTML(html);
  const result = await Defuddle(document, exp.url || "https://example.com/");
  const content = result.content || "";
  const text = stripTags(content);
  const wordCount = result.wordCount || text.split(/\s+/).filter(Boolean).length;
  const errors = [];
  const softs = [];

  if (wordCount < (exp.minWordCount || 0)) {
    errors.push(`wordCount ${wordCount} < ${exp.minWordCount}`);
  }
  if (exp.titleIncludes?.length && !includesAny(result.title || "", exp.titleIncludes)) {
    errors.push(
      `title missing any of ${JSON.stringify(exp.titleIncludes)} (got ${JSON.stringify(result.title)})`,
    );
  }
  if (
    exp.authorIncludesAny?.length &&
    !includesAny(result.author || "", exp.authorIncludesAny)
  ) {
    errors.push(
      `author missing any of ${JSON.stringify(exp.authorIncludesAny)} (got ${JSON.stringify(result.author)})`,
    );
  }
  for (const must of exp.contentMustInclude || []) {
    if (!includesAny(`${content} ${text}`, [must])) {
      errors.push(`content missing ${JSON.stringify(must)}`);
    }
  }
  for (const ban of exp.contentMustNotInclude || []) {
    if (includesAny(`${content} ${text}`, [ban])) {
      errors.push(`content still contains noise ${JSON.stringify(ban)}`);
    }
  }
  for (const ban of exp.softContentShouldNotInclude || []) {
    if (includesAny(`${content} ${text}`, [ban])) {
      softs.push(`noise still present ${JSON.stringify(ban)}`);
    }
  }
  if (exp.preferTagsAny?.length && !hasAnyTag(content, exp.preferTagsAny)) {
    errors.push(`expected one of tags ${JSON.stringify(exp.preferTagsAny)}`);
  }
  if (exp.softPreferTagsAny?.length && !hasAnyTag(content, exp.softPreferTagsAny)) {
    softs.push(
      `math/structure tags not preserved ${JSON.stringify(exp.softPreferTagsAny)}`,
    );
  }

  softWarnings += softs.length;
  if (errors.length) {
    failed += 1;
    console.error(`FAIL ${file}`);
    for (const e of errors) console.error(`  - ${e}`);
    for (const s of softs) console.error(`  ~ soft: ${s}`);
    console.error(
      `  meta: title=${JSON.stringify(result.title)} author=${JSON.stringify(result.author)} words=${wordCount}`,
    );
  } else if (softs.length) {
    console.log(
      `PASS ${file} with soft warnings (words=${wordCount}, title=${JSON.stringify(result.title)})`,
    );
    for (const s of softs) console.log(`  ~ soft: ${s}`);
  } else {
    console.log(
      `PASS ${file} (words=${wordCount}, title=${JSON.stringify(result.title)})`,
    );
  }
}

if (failed) {
  console.error(`\n${failed} fixture(s) failed (${softWarnings} soft warning(s))`);
  process.exit(1);
}
console.log(
  `\nAll ${files.length} extraction fixtures passed (${softWarnings} soft warning(s))`,
);
