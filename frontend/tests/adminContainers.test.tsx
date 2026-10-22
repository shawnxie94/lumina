import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import BasicSettingsContainer from "../components/admin/BasicSettingsContainer";
import AiUsageContainer from "../components/admin/AiUsageContainer";
import { BasicSettingsProvider } from "../contexts/BasicSettingsContext";
import { ToastProvider } from "../components/Toast";

globalThis.React = React;

test("independent admin containers render their existing section contracts", () => {
	const basic = renderToStaticMarkup(
		<BasicSettingsProvider>
			<ToastProvider>
				<BasicSettingsContainer />
			</ToastProvider>
		</BasicSettingsProvider>,
	);
	assert.match(basic, /基础配置|Basic/);
	const usage = renderToStaticMarkup(
		<BasicSettingsProvider>
			<ToastProvider>
				<AiUsageContainer onOpenTask={() => {}} />
			</ToastProvider>
		</BasicSettingsProvider>,
	);
	assert.match(usage, /Tokens/);
});

test("admin no longer owns Basic form or usage monitoring state/fetch/handlers", () => {
	const page = readFileSync(
		new URL("../pages/admin.tsx", import.meta.url),
		"utf8",
	);
	assert.doesNotMatch(
		page,
		/basicSettingsForm|fetchBasicSettings|handleSaveBasicSettings|setUsageLogs|fetchUsageLogs|fetchUsageSummary|openUsageCost/,
	);
	assert.match(page, /<BasicSettingsContainer\s*\/>/);
	assert.match(page, /<AiUsageContainer onOpenTask=/);
	for (const name of ["BasicSettingsContainer", "AiUsageContainer"])
		assert.match(
			page,
			new RegExp(
				`dynamic\\(\\(\\) => import\\("@/components/admin/${name}"\\)`,
			),
		);
	const basic = readFileSync(
		new URL("../components/admin/BasicSettingsContainer.tsx", import.meta.url),
		"utf8",
	);
	assert.match(basic, /useState<BasicSettings>/);
	assert.match(basic, /basicSettingsApi\s*\.getSettings/);
	assert.match(basic, /basicSettingsApi\.updateSettings/);
	const usage = readFileSync(
		new URL("../components/admin/AiUsageContainer.tsx", import.meta.url),
		"utf8",
	);
	assert.match(usage, /useState<AIUsageLogItem\[\]>/);
	assert.match(usage, /aiUsageApi\s*\.list/);
	assert.match(usage, /aiUsageApi\s*\.summary/);
});
