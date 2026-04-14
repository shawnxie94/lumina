import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const frontendRoot = process.cwd();

function readPageSource(relativePath: string) {
	return readFileSync(join(frontendRoot, relativePath), "utf8");
}

test("admin i18n dictionary includes model api form keys introduced by the new api type fields", () => {
	const i18nSource = readPageSource("lib/i18n.ts");

	assert.match(i18nSource, /(?:["']API类型["']|API类型):\s*["']/);
	assert.match(i18nSource, /["']上下文窗口（tokens）["']:\s*["']/);
	assert.match(i18nSource, /["']输出预留（tokens）["']:\s*["']/);
});

test("admin i18n dictionary includes backup action and status keys introduced by latest backup flow", () => {
	const i18nSource = readPageSource("lib/i18n.ts");

	assert.match(i18nSource, /(?:["']下载最新备份["']|下载最新备份):\s*["']/);
	assert.match(i18nSource, /(?:["']生成备份["']|生成备份):\s*["']/);
	assert.match(
		i18nSource,
		/(?:["']最新备份已生成，可开始下载["']|最新备份已生成，可开始下载):\s*["']/,
	);
	assert.match(i18nSource, /["']点击生成最新备份，完成后可直接下载。["']:\s*["']/);
	assert.match(i18nSource, /["']最新备份已生成：\{time\} · \{size\}["']:\s*["']/);
});
