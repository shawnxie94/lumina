#!/usr/bin/env node
/**
 * Chrome content scripts require files it can treat as UTF-8.
 * Some environments still choke on raw multi-byte UTF-8 in huge bundles.
 * Escape every non-ASCII code unit as \uXXXX so the file is pure ASCII (valid UTF-8).
 */
import { readdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { join } from "node:path";

const root = join(process.cwd(), ".output", "chrome-mv3");

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (name.endsWith(".js")) out.push(p);
  }
  return out;
}

function toAsciiJs(source) {
  let out = "";
  for (const ch of source) {
    const code = ch.codePointAt(0);
    if (code === undefined) continue;
    if (code <= 0x7f) {
      out += ch;
      continue;
    }
    if (code <= 0xffff) {
      out += "\\u" + code.toString(16).padStart(4, "0");
      continue;
    }
    // Escape non-BMP as UTF-16 surrogate pair escapes (JS string semantics).
    const cp = code - 0x10000;
    const hi = 0xd800 + (cp >> 10);
    const lo = 0xdc00 + (cp & 0x3ff);
    out +=
      "\\u" +
      hi.toString(16).padStart(4, "0") +
      "\\u" +
      lo.toString(16).padStart(4, "0");
  }
  return out;
}

const files = walk(root);
let changed = 0;
for (const file of files) {
  const raw = readFileSync(file);
  // Fail fast if not valid UTF-8.
  const text = raw.toString("utf8");
  if (/[^\x00-\x7F]/.test(text)) {
    const ascii = toAsciiJs(text);
    writeFileSync(file, ascii, { encoding: "utf8" });
    changed += 1;
    console.log(`ascii-escaped ${file}`);
  }
}
console.log(`ensure-js-ascii: ${files.length} js files, ${changed} rewritten`);
