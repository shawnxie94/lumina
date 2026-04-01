import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import vm from "node:vm";

import ts from "typescript";

const helperPath = path.resolve(
	process.cwd(),
	"lib/aiHistoryVisibility.ts",
);

const source = fs.readFileSync(helperPath, "utf8");
const transpiled = ts.transpileModule(source, {
	compilerOptions: {
		module: ts.ModuleKind.CommonJS,
		target: ts.ScriptTarget.ES2020,
	},
});

const module = { exports: {} };
const require = createRequire(import.meta.url);
const context = {
	module,
	exports: module.exports,
	require,
	console,
};

vm.runInNewContext(transpiled.outputText, context, { filename: helperPath });

const { shouldShowAiHistoryButton } = module.exports;

assert.equal(
	shouldShowAiHistoryButton(true, "summary", {
		summary: null,
		summary_has_history: true,
	}),
	true,
	"当前内容已清空但仍有历史时应展示历史按钮",
);

assert.equal(
	shouldShowAiHistoryButton(true, "summary", {
		summary: null,
		summary_has_history: false,
	}),
	false,
	"未生成的摘要不应展示历史按钮",
);

assert.equal(
	shouldShowAiHistoryButton(true, "summary", {
		summary: "已有摘要",
	}),
	true,
	"已有摘要时应展示历史按钮",
);

assert.equal(
	shouldShowAiHistoryButton(true, "infographic", {
		infographic_html: null,
		infographic_image_url: "/backend/media/demo.webp",
	}),
	true,
	"仅图片信息图也应展示历史按钮",
);

assert.equal(
	shouldShowAiHistoryButton(false, "quotes", {
		quotes: "访客不可见",
	}),
	false,
	"非管理员不应展示历史按钮",
);

console.log("ai history visibility checks passed");
