import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

test("review detail page no longer exposes regenerate action in toolbar", () => {
	const source = readFileSync(join(process.cwd(), "pages/columns/[slug].tsx"), "utf8");
	assert.doesNotMatch(source, /重新生成回顾|handleOpenRegenerateModal|IconRefresh/);
});

test("review detail page updates the browser slug after publish changes the canonical review url", () => {
	const source = readFileSync(join(process.cwd(), "pages/columns/[slug].tsx"), "utf8");
	assert.ok(
		source.includes("const next = await refreshAdminReview(review.id);") &&
			source.includes("await router.replace(`/columns/${next.slug}`)"),
		"expected publish flow to replace the review detail url when slug changes",
	);
});

test("column settings keeps core fields without AI controls", () => {
	const source = readFileSync(
		join(process.cwd(), "components/ReviewTemplateSettings.tsx"),
		"utf8",
	);
	assert.match(source, /t\("专栏名称"\)/);
	assert.match(source, /t\("颜色"\)/);
	assert.match(source, /updateTemplatesSort|sort_order/);
	assert.doesNotMatch(
		source,
		/生成模型|用户提示词|系统提示词|AI 生成输入|周期类型|标题模板|schedule_type|prompt_template|title_template/,
	);
	assert.doesNotMatch(source, /t\("启用"\)|form\.is_enabled|已启用|未启用/);
});

test("review detail editor helper copy uses simplified article placeholder wording", () => {
	const source = readFileSync(join(process.cwd(), "pages/columns/[slug].tsx"), "utf8");
	assert.match(
		source,
		/支持单篇文章占位符 \{\{article_slug\}\}，可在正文中通过 \/ref 插入引用。/,
	);
	assert.doesNotMatch(
		source,
		/支持全部文章占位符 \{\{review_article_sections\}\}/,
	);
});

test("manual create modal creates blank column article without AI model selection", () => {
	const source = readFileSync(
		join(process.cwd(), "components/ReviewManualGenerateModal.tsx"),
		"utf8",
	);
	assert.match(source, /t\("创建"\)/);
	assert.match(source, /\/columns\/\$\{slug\}\?edit=1/);
	assert.match(source, /\/admin\/settings\/columns/);
	assert.match(source, /IconPlus/);
	assert.doesNotMatch(source, /getModelAPIConfigs/);
	assert.doesNotMatch(source, /t\("开始生成"\)/);
	assert.doesNotMatch(source, /is_enabled/);
});

test("column settings surface uses simplified non-AI management copy", () => {
	const source = readFileSync(
		join(process.cwd(), "components/ReviewTemplateSettings.tsx"),
		"utf8",
	);
	assert.match(source, /t\("专栏列表"\)/);
	assert.match(source, /t\("新增专栏"\)/);
	assert.doesNotMatch(source, /生成模型|用户提示词|系统提示词|getModelAPIConfigs/);
});

test("admin settings exposes columns as a parent tab after categories", () => {
	const source = readFileSync(join(process.cwd(), "pages/admin.tsx"), "utf8");
	assert.match(source, /setActiveSection\("columns"\)/);
	assert.match(source, /activeSection === "columns"/);
	assert.match(source, /\/admin\/settings\/columns/);
	assert.doesNotMatch(source, /review-templates/);
});

test("column list page uses create-article CTA and column chip instead of all-categories", () => {
	const source = readFileSync(join(process.cwd(), "pages/columns/index.tsx"), "utf8");
	assert.match(source, /t\("创建文章"\)/);
	assert.match(source, /getColumnChip/);
	assert.doesNotMatch(source, /立即生成|getReviewCategoryChips|全部分类/);
});

test("column detail page enters edit mode from query and no longer shows template categories", () => {
	const source = readFileSync(join(process.cwd(), "pages/columns/[slug].tsx"), "utf8");
	assert.match(source, /router\.query\.edit/);
	assert.match(source, /setIsEditing\(true\)/);
	assert.doesNotMatch(source, /templateCategoryText|全部分类|重新生成回顾/);
});

