import assert from "node:assert/strict";
import test from "node:test";

import { resolveMediaUrl } from "../lib/api";

const setWindow = (value: Window | undefined) => {
	if (value) {
		Object.defineProperty(globalThis, "window", {
			value,
			configurable: true,
			writable: true,
		});
		return;
	}
	Reflect.deleteProperty(globalThis, "window");
};

test("resolveMediaUrl keeps backend media paths stable across server and client", () => {
	const originalWindow = (globalThis as typeof globalThis & { window?: Window }).window;

	try {
		setWindow(undefined);
		assert.equal(
			resolveMediaUrl("/backend/media/2026/03/example.png"),
			"/backend/media/2026/03/example.png",
		);

		setWindow({
			location: {
				hostname: "localhost",
				port: "3000",
				origin: "http://localhost:3000",
			},
		} as Window);
		assert.equal(
			resolveMediaUrl("/backend/media/2026/03/example.png"),
			"/backend/media/2026/03/example.png",
		);
	} finally {
		setWindow(originalWindow);
	}
});

test("resolveMediaUrl normalizes local absolute media urls to backend-relative paths", () => {
	const originalWindow = (globalThis as typeof globalThis & { window?: Window }).window;

	try {
		setWindow({
			location: {
				hostname: "localhost",
				port: "3000",
				origin: "http://localhost:3000",
			},
		} as Window);

		assert.equal(
			resolveMediaUrl("http://localhost:8000/backend/media/2026/03/example.png"),
			"/backend/media/2026/03/example.png",
		);
		assert.equal(
			resolveMediaUrl("http://localhost:8000/media/2026/03/example.png"),
			"/backend/media/2026/03/example.png",
		);
	} finally {
		setWindow(originalWindow);
	}
});
