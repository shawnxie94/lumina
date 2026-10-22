import assert from "node:assert/strict";
import test from "node:test";
import { startSerialPolling, type PollEnvironment } from "../lib/serialPolling";
import { createArticleBodyRenderer } from "../lib/articleBody";

function clock() {
	let visible = true;
	let listener = () => {};
	let callback: (() => void) | undefined;
	const env: PollEnvironment = {
		setTimer: (fn) => {
			assert.equal(callback, undefined);
			callback = fn;
			return 1 as unknown as ReturnType<typeof setTimeout>;
		},
		clearTimer: () => {
			callback = undefined;
		},
		visible: () => visible,
		subscribe: (fn) => {
			listener = fn;
			return () => {
				listener = () => {};
			};
		},
	};
	return {
		env,
		tick: () => {
			const fn = callback;
			callback = undefined;
			fn?.();
		},
		pending: () => !!callback,
		visibility: (value: boolean) => {
			visible = value;
			listener();
		},
	};
}
const flush = async () => {
	await Promise.resolve();
	await Promise.resolve();
};

for (const name of ["article", "similar"]) {
	test(`${name}: serial completion delay, visibility, retry, terminal and dispose`, async () => {
		const timer = clock();
		let resolve: (value: string) => void = () => {};
		let reject: (error: Error) => void = () => {};
		let calls = 0;
		let errors = 0;
		const applied: string[] = [];
		const dispose = startSerialPolling(
			{
				load: () => {
					calls++;
					return new Promise<string>((yes, no) => {
						resolve = yes;
						reject = no;
					});
				},
				apply: (value) => applied.push(value),
				terminal: (value) => value === "done",
				delay: 5,
				onError: () => {
					errors++;
				},
			},
			timer.env,
		);
		timer.tick();
		timer.tick();
		assert.equal(calls, 1);
		assert.equal(timer.pending(), false);
		timer.visibility(false);
		timer.visibility(true);
		timer.tick();
		assert.equal(calls, 1);
		resolve("pending");
		await flush();
		assert.equal(timer.pending(), true);
		timer.visibility(false);
		timer.tick();
		assert.equal(calls, 1);
		timer.visibility(true);
		timer.tick();
		assert.equal(calls, 2);
		reject(new Error("transient"));
		await flush();
		assert.equal(errors, 1);
		timer.tick();
		assert.equal(calls, 3);
		resolve("done");
		await flush();
		assert.deepEqual(applied, ["pending", "done"]);
		assert.equal(timer.pending(), false);
		timer.visibility(true);
		timer.tick();
		assert.equal(calls, 3);
		dispose();
	});
	test(`${name}: slug switch/unmount rejects an unresolved old request`, async () => {
		const timer = clock();
		let resolve: (value: string) => void = () => {};
		const applied: string[] = [];
		const dispose = startSerialPolling(
			{
				load: () =>
					new Promise<string>((yes) => {
						resolve = yes;
					}),
				apply: (value) => applied.push(value),
				terminal: () => false,
				delay: 5,
				immediate: true,
			},
			timer.env,
		);
		dispose();
		resolve("old slug");
		await flush();
		assert.deepEqual(applied, []);
		assert.equal(timer.pending(), false);
	});
}

test("body renderer caches string inputs independently and sanitizes untrusted output", () => {
	let renders = 0;
	const render = createArticleBodyRenderer((body) => {
		renders++;
		return `<p>${body}</p><script>bad()</script>`;
	});
	assert.equal(render("Original", "", "Translation", false), "<p>Original</p>");
	assert.equal(renders, 1);
	// Invisible changes invalidate only that branch, without parsing it.
	render("Original", "", "New translation", false);
	assert.equal(renders, 1);
	for (let metadataUpdate = 0; metadataUpdate < 10; metadataUpdate++)
		render("Original", "", "Translation", false);
	assert.equal(
		render("Original", "", "Translation", true),
		"<p>Translation</p>",
	);
	assert.equal(renders, 2);
	render("Changed", "", "Translation", true);
	assert.equal(renders, 2);
	assert.equal(render("Changed", "", "Translation", false), "<p>Changed</p>");
	assert.equal(renders, 3);
	assert.doesNotMatch(
		render("", '<img src="x" onerror="bad()">', "", false),
		/onerror/,
	);
});

test("translation-first parses once; sanitized empty translation never falls back", () => {
	let renders = 0;
	const render = createArticleBodyRenderer((body) => {
		renders++;
		return body === "unsafe" ? "<script>bad()</script>" : `<p>${body}</p>`;
	});
	assert.equal(render("Original", "", "unsafe", true), "");
	assert.equal(renders, 1);
	assert.equal(render("Changed original", "", "unsafe", true), "");
	assert.equal(renders, 1);
	assert.equal(
		render("Changed original", "", "unsafe", false),
		"<p>Changed original</p>",
	);
	assert.equal(renders, 2);
	assert.equal(
		render("Changed original", "", "", true),
		"<p>Changed original</p>",
	);
	assert.equal(renders, 2);
});
