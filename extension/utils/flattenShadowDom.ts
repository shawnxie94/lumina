const SHADOW_FLATTEN_TIMEOUT_MS = 3000;

function documentHasShadowRoot(doc: Document): boolean {
	try {
		const elements = doc.querySelectorAll("*");
		for (let i = 0; i < elements.length; i++) {
			if (elements[i].shadowRoot) return true;
		}
	} catch {
		// ignore
	}
	return false;
}

/**
 * Stamp open shadow roots onto data-defuddle-shadow for Defuddle (isolated world).
 * Times out so extraction never hangs on hostile pages.
 */
export async function flattenShadowDom(
	doc: Document = document,
	timeoutMs: number = SHADOW_FLATTEN_TIMEOUT_MS,
): Promise<void> {
	if (!documentHasShadowRoot(doc)) {
		return;
	}

	await Promise.race([
		injectFlattenScript(doc),
		new Promise<void>((resolve) => {
			setTimeout(resolve, timeoutMs);
		}),
	]);
}

function injectFlattenScript(doc: Document): Promise<void> {
	return new Promise((resolve) => {
		const script = doc.createElement("script");
		script.src = chrome.runtime.getURL("flatten-shadow-dom.js");
		script.onload = () => {
			script.remove();
			resolve();
		};
		script.onerror = () => {
			script.remove();
			resolve();
		};
		(doc.head || doc.documentElement).appendChild(script);
	});
}
