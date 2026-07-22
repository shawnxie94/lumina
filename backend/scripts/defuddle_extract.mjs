#!/usr/bin/env node
/**
 * Local HTML article extraction via Defuddle (aligned with extension).
 * Input JSON on stdin: { "html": "...", "url": "https://..." }
 * Output JSON on stdout.
 */
import { parseHTML } from "linkedom";
import { Defuddle } from "defuddle/node";
import { readFileSync } from "node:fs";

function readStdin() {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function fail(message, code = 1) {
  process.stderr.write(String(message || "defuddle_extract failed") + "\n");
  process.exit(code);
}

const raw = readStdin().trim();
if (!raw) {
  fail("empty stdin");
}

let input;
try {
  input = JSON.parse(raw);
} catch (error) {
  fail(`invalid json: ${error instanceof Error ? error.message : String(error)}`);
}

const html = typeof input.html === "string" ? input.html : "";
const url =
  (typeof input.url === "string" && input.url.trim()) ||
  "https://example.invalid/";

if (!html.trim()) {
  fail("html is required");
}

try {
  const { document } = parseHTML(html);
  const result = await Defuddle(document, url);
  const contentHtml = result?.content || "";
  const payload = {
    title: result?.title || "",
    content_html: contentHtml,
    author: result?.author || "",
    published: result?.published || "",
    image: result?.image || "",
    description: result?.description || "",
    word_count: result?.wordCount || 0,
    parse_time_ms: result?.parseTime || 0,
    engine: "defuddle",
    engine_version: "0.19.1",
  };
  process.stdout.write(JSON.stringify(payload));
} catch (error) {
  fail(error instanceof Error ? error.stack || error.message : String(error));
}
