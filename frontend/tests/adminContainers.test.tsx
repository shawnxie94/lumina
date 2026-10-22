import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import BasicSettingsContainer from "../components/admin/BasicSettingsContainer";
import AiUsageContainer from "../components/admin/AiUsageContainer";
import { BasicSettingsProvider } from "../contexts/BasicSettingsContext";
import { ToastProvider } from "../components/Toast";

globalThis.React = React;

// Controlled hook lifecycle harness for the real container source (no browser DOM).
function basicHarness(load: () => Promise<unknown>) {
	let language = "zh";
	const notifications: string[] = [];
	const saved: unknown[] = [];
	const contextUpdates: unknown[] = [];
	const states: unknown[] = [];
	const effects: { deps: unknown[]; cleanup?: () => void }[] = [];
	let index = 0;
	const react = {
		useState: (initial: unknown) => {
			const slot = index++;
			if (!(slot in states)) states[slot] = initial;
			return [
				states[slot],
				(value: unknown) => {
					states[slot] =
						typeof value === "function" ? value(states[slot]) : value;
				},
			];
		},
		useRef: (initial: unknown) => {
			const slot = index++;
			if (!(slot in states)) states[slot] = { current: initial };
			return states[slot];
		},
		useEffect: (effect: () => () => void, deps: unknown[]) => {
			const slot = index++;
			const previous = effects[slot];
			if (
				!previous ||
				deps.some((dep, i) => !Object.is(dep, previous.deps[i]))
			) {
				previous?.cleanup?.();
				effects[slot] = { deps, cleanup: effect() };
			}
		},
	};
	const source = readFileSync(
		new URL("../components/admin/BasicSettingsContainer.tsx", import.meta.url),
		"utf8",
	);
	const compiled = ts.transpileModule(source, {
		compilerOptions: {
			module: ts.ModuleKind.CommonJS,
			jsx: ts.JsxEmit.ReactJSX,
		},
	}).outputText;
	const exports: { default?: () => { props: Record<string, unknown> } } = {};
	runInNewContext(compiled, {
		exports,
		console: { ...console, error: () => {} },
		require: (name: string) => {
			if (name === "react") return react;
			if (name === "react/jsx-runtime")
				return { jsx: (_type: unknown, props: unknown) => ({ props }) };
			if (name.endsWith("BasicSettingsSection")) return { default: () => null };
			if (name === "@/lib/api")
				return {
					basicSettingsApi: {
						getSettings: load,
						updateSettings: async (form: unknown) => {
							saved.push(form);
						},
					},
				};
			if (name.endsWith("BasicSettingsContext"))
				return {
					useBasicSettings: () => ({
						basicSettings: { site_name: "Initial" },
						updateBasicSettings: (form: unknown) => {
							contextUpdates.push(form);
						},
					}),
				};
			if (name.endsWith("Toast"))
				return {
					useToast: () => ({
						showToast: (message: string) => notifications.push(message),
					}),
				};
			if (name.endsWith("i18n"))
				return {
					useI18n: () => {
						const locale = language;
						return { t: (key: string) => `${locale}:${key}` };
					},
				};
			throw new Error(`Unexpected module: ${name}`);
		},
	});
	return {
		render: () => {
			index = 0;
			return exports.default?.().props || {};
		},
		locale: (value: string) => {
			language = value;
		},
		notifications,
		saved,
		contextUpdates,
		states,
		unmount: () => {
			for (const effect of effects) effect?.cleanup?.();
		},
	};
}

const settle = async () => {
	for (let i = 0; i < 6; i++) await Promise.resolve();
};

test("Basic locale changes preserve unsaved edits and never reload; unmount rejects old load", async () => {
	let calls = 0;
	let resolve: (data: unknown) => void = () => {};
	const harness = basicHarness(() => {
		calls++;
		return new Promise((yes) => {
			resolve = yes;
		});
	});
	harness.render();
	resolve({ site_name: "Loaded" });
	await settle();
	const props = harness.render();
	(props.setBasicSettingsForm as (value: unknown) => void)({
		site_name: "Unsaved",
	});
	harness.locale("en");
	assert.equal(
		(harness.render().basicSettingsForm as { site_name: string }).site_name,
		"Unsaved",
	);
	assert.equal(calls, 1);
	await (harness.render().handleSaveBasicSettings as () => Promise<void>)();
	assert.equal(
		(harness.saved[0] as { site_name: string }).site_name,
		"Unsaved",
	);
	assert.equal(harness.saved[0], harness.contextUpdates[0]);
	assert.deepEqual(harness.notifications, ["en:基础配置已保存"]);
	harness.unmount();
	const stale = basicHarness(
		() =>
			new Promise((yes) => {
				resolve = yes;
			}),
	);
	stale.render();
	stale.unmount();
	resolve({ site_name: "Late" });
	await settle();
	assert.equal((stale.states[0] as { site_name: string }).site_name, "Initial");
});

test("Basic pending-load failure uses the latest locale without restarting load", async () => {
	let reject: (error: Error) => void = () => {};
	let calls = 0;
	const harness = basicHarness(() => {
		calls++;
		return new Promise((_yes, no) => {
			reject = no;
		});
	});
	harness.render();
	harness.locale("en");
	harness.render();
	reject(new Error("controlled load failure"));
	await settle();
	assert.equal(calls, 1);
	assert.deepEqual(harness.notifications, ["en:基础配置加载失败"]);
	harness.unmount();
});

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

test("usage summary dependencies exclude pagination while list retains it", () => {
	const source = readFileSync(
		new URL("../components/admin/AiUsageContainer.tsx", import.meta.url),
		"utf8",
	);
	const file = ts.createSourceFile(
		"AiUsageContainer.tsx",
		source,
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.TSX,
	);
	const dependencies = new Map<string, string>();
	const visit = (node: ts.Node) => {
		if (
			ts.isCallExpression(node) &&
			node.expression.getText(file) === "useEffect"
		) {
			const body = node.arguments[0].getText(file);
			if (/\.summary\(/.test(body))
				dependencies.set("summary", node.arguments[1].getText(file));
			if (/\.list\(/.test(body))
				dependencies.set("list", node.arguments[1].getText(file));
		}
		ts.forEachChild(node, visit);
	};
	visit(file);
	assert.match(dependencies.get("summary") || "", /usageParams/);
	assert.doesNotMatch(dependencies.get("summary") || "", /usagePage/);
	assert.match(dependencies.get("list") || "", /usagePage, usagePageSize/);
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
