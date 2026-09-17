/** Cheap probe: true when the content script is already loaded in the tab. */
export async function pingContentScript(tabId: number): Promise<boolean> {
	try {
		await chrome.tabs.sendMessage(tabId, { type: "PING" });
		return true;
	} catch {
		return false;
	}
}

export async function ensureContentScriptLoaded(
	tabId: number,
	options?: { onError?: (error: Error) => void },
): Promise<boolean> {
	if (await pingContentScript(tabId)) {
		return true;
	}
	try {
		await chrome.scripting.executeScript({
			target: { tabId },
			files: ["content-scripts/content.js"],
		});
		return true;
	} catch (err) {
		if (options?.onError) {
			options.onError(err instanceof Error ? err : new Error(String(err)));
		}
		return false;
	}
}
