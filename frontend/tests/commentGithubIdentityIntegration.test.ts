import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const frontendRoot = process.cwd();

function readPageSource(relativePath: string) {
  return readFileSync(join(frontendRoot, relativePath), "utf8");
}

test("nextauth session preserves github username separately from oauth subject id", () => {
  const source = readPageSource("pages/api/auth/[...nextauth].ts");

  assert.match(source, /issuer:\s*['"]https:\/\/github\.com\/login\/oauth['"]/);
  assert.match(source, /token\.github_username/);
  assert.match(source, /normalizedProfile\?\.login/);
  assert.match(source, /normalizedProfile\?\.preferred_username/);
  assert.match(source, /session\.user\.github_username =/);
});

test("comment post proxies send github username through to backend payloads", () => {
  const articleSource = readPageSource("pages/api/comments/[articleId].ts");
  const reviewSource = readPageSource("pages/api/review-comments/[reviewSlug].ts");

  assert.match(articleSource, /github_username:\s*session\.user\.github_username/);
  assert.match(reviewSource, /github_username:\s*session\.user\.github_username/);
});
