import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
	buildReviewTaskMonitorUrl,
	FALLBACK_REVIEW_TIMEZONE,
	REVIEW_TEMPLATE_HELP_PANEL_GAP,
	REVIEW_TEMPLATE_MODAL_PANEL_CLASSNAME,
	filterReviewTemplateModelOptions,
	resolveReviewTemplateHelpPlacement,
	resolveReviewTemplateDefaultTimezone,
	shouldShowReviewTemplateModalRunAction,
} from "../lib/reviewTemplate";

test("resolveReviewTemplateDefaultTimezone returns browser timezone when available", () => {
	const timezone = resolveReviewTemplateDefaultTimezone(() => "America/Los_Angeles");

	assert.equal(timezone, "America/Los_Angeles");
});

test("resolveReviewTemplateDefaultTimezone falls back when browser timezone is missing", () => {
	const timezone = resolveReviewTemplateDefaultTimezone(() => "");

	assert.equal(timezone, FALLBACK_REVIEW_TIMEZONE);
});

test("filterReviewTemplateModelOptions keeps only enabled general-purpose models", () => {
	const options = filterReviewTemplateModelOptions([
		{
			id: "general-enabled",
			name: "General Enabled",
			is_enabled: true,
			model_type: "general",
		},
		{
			id: "vector-enabled",
			name: "Vector Enabled",
			is_enabled: true,
			model_type: "vector",
		},
		{
			id: "general-disabled",
			name: "General Disabled",
			is_enabled: false,
			model_type: "general",
		},
		{
			id: "legacy-enabled",
			name: "Legacy Enabled",
			is_enabled: true,
			model_type: null,
		},
	]);

	assert.deepEqual(
		options.map((item) => item.id),
		["general-enabled", "legacy-enabled"],
	);
});

test("review template modal panel allows help popovers to overflow horizontally", () => {
	assert.match(REVIEW_TEMPLATE_MODAL_PANEL_CLASSNAME, /overflow-x-visible/);
	assert.match(REVIEW_TEMPLATE_MODAL_PANEL_CLASSNAME, /overflow-y-auto/);
});

test("review template modal footer hides the inline run action", () => {
	assert.equal(shouldShowReviewTemplateModalRunAction(), false);
});

test("resolveReviewTemplateHelpPlacement keeps the panel inside the viewport horizontally", () => {
	const placement = resolveReviewTemplateHelpPlacement({
		triggerRect: {
			top: 120,
			left: 12,
			width: 20,
			height: 20,
		},
		panelWidth: 320,
		panelHeight: 180,
		viewport: {
			width: 390,
			height: 844,
		},
	});

	assert.equal(placement.left, 16);
	assert.equal(placement.top, 120 + 20 + REVIEW_TEMPLATE_HELP_PANEL_GAP);
});

test("resolveReviewTemplateHelpPlacement prefers staying within modal bounds", () => {
	const placement = resolveReviewTemplateHelpPlacement({
		triggerRect: {
			top: 110,
			left: 600,
			width: 20,
			height: 20,
		},
		panelWidth: 320,
		panelHeight: 180,
		viewport: {
			width: 1440,
			height: 900,
		},
		bounds: {
			left: 480,
			top: 80,
			right: 1180,
			bottom: 780,
		},
	});

	assert.equal(placement.left, 480);
	assert.equal(placement.top, 110 + 20 + REVIEW_TEMPLATE_HELP_PANEL_GAP);
});

test("resolveReviewTemplateHelpPlacement flips above when there is not enough space below", () => {
	const placement = resolveReviewTemplateHelpPlacement({
		triggerRect: {
			top: 760,
			left: 360,
			width: 20,
			height: 20,
		},
		panelWidth: 320,
		panelHeight: 180,
		viewport: {
			width: 500,
			height: 844,
		},
		bounds: {
			left: 16,
			top: 16,
			right: 484,
			bottom: 828,
		},
	});

	assert.equal(placement.left, 60);
	assert.equal(placement.top, 760 - 180 - REVIEW_TEMPLATE_HELP_PANEL_GAP);
});

test("buildReviewTaskMonitorUrl builds monitoring task detail link", () => {
	const url = buildReviewTaskMonitorUrl("task-123");

	assert.equal(
		url,
		"/admin/monitoring/tasks?task_type=generate_review_issue&task_id=task-123&open_task_detail=1",
	);
});

test("review detail page exposes a regenerate action in the content toolbar", () => {
	const source = readFileSync(
		join(process.cwd(), "pages/reviews/[slug].tsx"),
		"utf8",
	);

	assert.ok(
		source.includes('review.status !== "published" ? (') &&
			source.includes("onClick={handleOpenRegenerateModal}") &&
			source.includes('title={t("重新生成回顾")}') &&
			source.includes('<IconRefresh className="h-4 w-4" />'),
		"expected regenerate icon action to appear only for draft reviews",
	);
});

test("review detail page wires regenerate modal with locked template and preselected articles", () => {
	const source = readFileSync(
		join(process.cwd(), "pages/reviews/[slug].tsx"),
		"utf8",
	);

	assert.match(source, /<ReviewManualGenerateModal[\s\S]*?lockTemplateSelection/);
	assert.match(
		source,
		/initialTemplateId=\{review\.template\?\.id \|\| undefined\}/,
	);
	assert.match(
		source,
		/initialSelectedArticleIds=\{review\.selected_article_ids \|\| \[\]\}/,
	);
	assert.match(
		source,
		/initialDateStart=\{toDateInputValue\(review\.window_start\)\}/,
	);
	assert.match(
		source,
		/initialDateEnd=\{\(\(\) => \{[\s\S]*?const value = toDateInputValue\(review\.window_end\);[\s\S]*?date\.setDate\(date\.getDate\(\) - 1\);[\s\S]*?date\.toISOString\(\)\.slice\(0, 10\);[\s\S]*?\}\)\(\)\}/,
	);
});

test("review detail page updates the browser slug after publish changes the canonical review url", () => {
	const source = readFileSync(
		join(process.cwd(), "pages/reviews/[slug].tsx"),
		"utf8",
	);

	assert.ok(
		source.includes("const next = await refreshAdminReview(review.id);") &&
			source.includes('await router.replace(`/reviews/${next.slug}`)'),
		"expected publish flow to replace the review detail url when slug changes",
	);
});

test("review template settings keeps the schedule controls on one row", () => {
	const source = readFileSync(
		join(process.cwd(), "components/ReviewTemplateSettings.tsx"),
		"utf8",
	);

	assert.match(
		source,
		/<div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">[\s\S]*?label=\{t\("周期类型"\)\}[\s\S]*?label=\{t\("锚点日期"\)\}[\s\S]*?label=\{t\("触发时刻"\)\}[\s\S]*?label=\{t\("AI 生成输入"\)\}/,
	);
});

test("review template settings places model selection above the optional advanced section", () => {
	const source = readFileSync(
		join(process.cwd(), "components/ReviewTemplateSettings.tsx"),
		"utf8",
	);

	const userPromptIndex = source.indexOf('label={t("用户提示词")}');
	const modelIndex = source.indexOf('label={t("生成模型")}');
	const advancedIndex = source.indexOf('<SectionToggleButton');
	const temperatureIndex = source.indexOf('label={t("温度")}');

	assert.ok(userPromptIndex >= 0, "expected 用户提示词 field");
	assert.ok(modelIndex > userPromptIndex, "expected 生成模型 field below 用户提示词");
	assert.ok(
		advancedIndex > modelIndex,
		"expected 高级设置折叠区 below 生成模型",
	);
	assert.ok(
		temperatureIndex > advancedIndex,
		"expected 温度 field inside 高级设置折叠区",
	);
});

test("review template default prompt uses per-article placeholder outline example", () => {
	const source = readFileSync(
		join(process.cwd(), "components/ReviewTemplateSettings.tsx"),
		"utf8",
	);

	assert.match(source, /不要输出文章列表、分类标题或任何文章占位标记/);
	assert.match(source, /这部分会由系统按分类自动插入/);
	assert.match(source, /不要额外新增“相关文章”“延伸阅读”等自定义列表区块/);
	assert.doesNotMatch(source, /## 分类名1/);
	assert.doesNotMatch(source, /### \{\{article_slug_1\}\}/);
});

test("review detail editor helper copy uses updated article placeholder wording", () => {
	const source = readFileSync(
		join(process.cwd(), "pages/reviews/[slug].tsx"),
		"utf8",
	);

	assert.match(
		source,
		/支持全部文章占位符 \{\{review_article_sections\}\} 和单篇文章占位符 \{\{article_slug\}\}。/,
	);
	assert.doesNotMatch(
		source,
		/支持保留旧版 \{\{review_article_sections\}\}，或使用 \{\{article_slug\}\} 单篇文章占位符。/,
	);
});

test("app header maps review generation task failures to 周期回顾 label", () => {
	const source = readFileSync(
		join(process.cwd(), "components/AppHeader.tsx"),
		"utf8",
	);

	assert.match(source, /if \(task\.task_type === 'generate_review_issue'\) return t\('周期回顾'\);/);
});
