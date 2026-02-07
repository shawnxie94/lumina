export async function ensureContentScriptLoaded(
	tabId: number,
	options?: { onError?: (error: Error) => void },
): Promise<boolean> {
	try {
		await chrome.tabs.sendMessage(tabId, { type: "PING" });
		return true;
	} catch {
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
}
