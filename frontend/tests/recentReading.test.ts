import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import type { NextRouter } from "next/router";
import { RouterContext } from "next/dist/shared/lib/router-context.shared-runtime";
import ts from "typescript";
import { ContinueReadingBanner } from "../components/ContinueReadingBanner";
import { ReadingProvider } from "../contexts/ReadingContext";
import { BasicSettingsProvider } from "../contexts/BasicSettingsContext";

globalThis.React = React;

function storageFixture(collapsed: boolean) {
	const values = new Map([
		[
			"recentReadingArticles",
			JSON.stringify([
				{ id: "public", slug: "public", title: "Stored public article" },
			]),
		],
		["recentReadingCollapsed", String(collapsed)],
	]);
	let writes = 0;
	return {
		values,
		get writes() {
			return writes;
		},
		getItem: (key: string) => values.get(key) ?? null,
		setItem: (key: string, value: string) => {
			writes++;
			values.set(key, value);
		},
	};
}

function initialMarkup(storage?: ReturnType<typeof storageFixture>) {
	const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
	const previousStorage = Object.getOwnPropertyDescriptor(
		globalThis,
		"localStorage",
	);
	try {
		if (storage) {
			Object.defineProperty(globalThis, "window", {
				value: { localStorage: storage },
				configurable: true,
			});
			Object.defineProperty(globalThis, "localStorage", {
				value: storage,
				configurable: true,
			});
		} else {
			Reflect.deleteProperty(globalThis, "window");
			Reflect.deleteProperty(globalThis, "localStorage");
		}
		return renderToStaticMarkup(
			React.createElement(
				RouterContext.Provider,
				{
					value: {
						pathname: "/admin",
						query: {},
						asPath: "/admin",
					} as NextRouter,
				},
				React.createElement(
					BasicSettingsProvider,
					null,
					React.createElement(
						ReadingProvider,
						null,
						React.createElement(ContinueReadingBanner),
					),
				),
			),
		);
	} finally {
		if (previousWindow)
			Object.defineProperty(globalThis, "window", previousWindow);
		else Reflect.deleteProperty(globalThis, "window");
		if (previousStorage)
			Object.defineProperty(globalThis, "localStorage", previousStorage);
		else Reflect.deleteProperty(globalThis, "localStorage");
	}
}

// Execute the real banner with a controlled mount effect, then render its real JSX.
// This covers post-mount output without adding a DOM/test-renderer dependency.
function mountedBanner(storage: ReturnType<typeof storageFixture>) {
	let mounted = false;
	let committed = false;
	const effects: (() => void)[] = [];
	const source = readFileSync(
		join(process.cwd(), "components/ContinueReadingBanner.tsx"),
		"utf8",
	);
	const compiled = ts.transpileModule(source, {
		compilerOptions: {
			module: ts.ModuleKind.CommonJS,
			jsx: ts.JsxEmit.ReactJSX,
			esModuleInterop: true,
		},
	}).outputText;
	const exports: { ContinueReadingBanner?: () => React.ReactNode } = {};
	runInNewContext(compiled, {
		exports,
		document: { addEventListener: () => {}, removeEventListener: () => {} },
		require: (name: string) => {
			if (name === "react/jsx-runtime") return jsxRuntime;
			if (name === "react")
				return {
					useRef: () => ({ current: null }),
					useState: () => [
						mounted,
						(value: boolean) => {
							mounted = value;
						},
					],
					useEffect: (effect: () => void) => {
						if (!committed) effects.push(effect);
					},
				};
			if (name === "next/router")
				return { useRouter: () => ({ pathname: "/admin", query: {} }) };
			if (name === "next/link")
				return {
					__esModule: true,
					default: ({ children, ...props }: React.ComponentProps<"a">) =>
						React.createElement("a", props, children),
				};
			if (name.endsWith("ReadingContext"))
				return {
					useReading: () => ({
						recentArticles: JSON.parse(
							storage.getItem("recentReadingArticles") || "[]",
						),
						isCollapsed: storage.getItem("recentReadingCollapsed") === "true",
						isHidden: false,
						removeArticle: () => {},
						clearArticles: () => {},
						setIsCollapsed: () => {},
					}),
				};
			if (name.endsWith("i18n"))
				return { useI18n: () => ({ t: (key: string) => key }) };
			if (name.endsWith("icons"))
				return Object.fromEntries(
					["IconClock", "IconChevronRight", "IconTrash", "IconBroom"].map(
						(key) => [key, () => React.createElement("svg")],
					),
				);
			throw new Error(`Unexpected banner dependency: ${name}`);
		},
	});
	const first = renderToStaticMarkup(exports.ContinueReadingBanner?.());
	committed = true;
	for (const effect of effects) effect();
	return {
		first,
		afterMount: renderToStaticMarkup(exports.ContinueReadingBanner?.()),
	};
}

for (const collapsed of [true, false]) {
	test(`recent reading SSR/first render match, mount reveals collapsed=${collapsed}, storage survives`, () => {
		const storage = storageFixture(collapsed);
		const before = JSON.stringify(Array.from(storage.values));
		assert.equal(initialMarkup(), "");
		assert.equal(initialMarkup(storage), "");
		const { first, afterMount } = mountedBanner(storage);
		assert.equal(first, "");
		assert.match(afterMount, /最近阅读/);
		if (collapsed) {
			assert.match(afterMount, /展开最近阅读/);
			assert.doesNotMatch(afterMount, /Stored public article/);
		} else {
			assert.match(afterMount, /收起最近阅读/);
			assert.match(afterMount, /Stored public article/);
		}
		assert.equal(JSON.stringify(Array.from(storage.values)), before);
		assert.equal(storage.writes, 0);
	});
}

test("reading context syncs recent reading updates from other tabs", () => {
	const source = readFileSync(
		join(process.cwd(), "contexts/ReadingContext.tsx"),
		"utf8",
	);

	assert.match(source, /addEventListener\('storage', handleStorageChange\)/);
	assert.match(
		source,
		/event\.key !== RECENT_READING_STORAGE_KEY && event\.key !== RECENT_READING_COLLAPSED_STORAGE_KEY/,
	);
	assert.match(
		source,
		/setRecentArticles\(parseStoredArticles\(localStorage\.getItem\(RECENT_READING_STORAGE_KEY\)\)\)/,
	);
	assert.match(source, /addEventListener\('focus', refreshFromStorage\)/);
});

test("reading context hydrates from local storage during state initialization to avoid overwriting fresh reads", () => {
	const source = readFileSync(
		join(process.cwd(), "contexts/ReadingContext.tsx"),
		"utf8",
	);

	assert.match(
		source,
		/useState<ReadingArticle\[]>\(\(\) =>[\s\S]*parseStoredArticles\(localStorage\.getItem\(RECENT_READING_STORAGE_KEY\)\)/,
	);
	assert.match(
		source,
		/useState\(\(\) =>[\s\S]*localStorage\.getItem\(RECENT_READING_COLLAPSED_STORAGE_KEY\)/,
	);
	assert.doesNotMatch(source, /const \[initialized, setInitialized\]/);
});
