import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const frontendRoot = process.cwd();

function readPageSource(relativePath: string) {
  return readFileSync(join(frontendRoot, relativePath), "utf8");
}

test("comment i18n dictionary includes async state keys introduced by the shared comment section", () => {
  const i18nSource = readPageSource("lib/i18n.ts");

  assert.match(i18nSource, /["']发布中\.\.\.["']:\s*["']/);
  assert.match(i18nSource, /["']删除中\.\.\.["']:\s*["']/);
});

test("comment admin and notification keys added in this refactor exist in the i18n dictionary", () => {
  const i18nSource = readPageSource("lib/i18n.ts");

  assert.match(i18nSource, /(?:["']新评论["']|新评论):\s*["']/);
  assert.match(i18nSource, /(?:["']未知资源["']|未知资源):\s*["']/);
  assert.match(i18nSource, /["']输入文章或回顾标题搜索\.\.\.["']:\s*["']/);
});
