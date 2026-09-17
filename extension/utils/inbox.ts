export interface InboxItem {
	id: string;
	url: string;
	title: string;
	domain: string;
	savedAt: string;
	author?: string;
	/** ISO string or YYYY-MM-DD; editor normalizes to YYYY-MM-DD. */
	publishedAt?: string;
	topImage?: string | null;
	contentMd: string;
	contentHtml?: string;
	contentStructured?: unknown;
	isSelection?: boolean;
}

export type InboxItemPatch = Partial<
	Pick<
		InboxItem,
		| "title"
		| "author"
		| "publishedAt"
		| "topImage"
		| "contentMd"
		| "contentHtml"
		| "url"
	>
>;

const INBOX_KEY = "staging_inbox";
const MAX_INBOX_ITEMS = 50;

export async function getInboxItems(): Promise<InboxItem[]> {
	return new Promise((resolve) => {
		chrome.storage.local.get([INBOX_KEY], (result) => {
			const items = result[INBOX_KEY];
			resolve(Array.isArray(items) ? (items as InboxItem[]) : []);
		});
	});
}

export async function addInboxItem(
	item: Omit<InboxItem, "id" | "savedAt">,
): Promise<InboxItem> {
	const items = await getInboxItems();

	// Re-staging the same URL refreshes the entry and moves it to top.
	const existingIndex = items.findIndex(
		(existing) => existing.url && existing.url === item.url,
	);
	if (existingIndex !== -1) {
		items.splice(existingIndex, 1);
	}

	const newItem: InboxItem = {
		...item,
		id: `inbox_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
		savedAt: new Date().toISOString(),
	};

	items.unshift(newItem);
	if (items.length > MAX_INBOX_ITEMS) {
		items.splice(MAX_INBOX_ITEMS);
	}

	await chrome.storage.local.set({ [INBOX_KEY]: items });
	return newItem;
}

export async function updateInboxItem(
	id: string,
	patch: InboxItemPatch,
): Promise<InboxItem | null> {
	const items = await getInboxItems();
	const index = items.findIndex((item) => item.id === id);
	if (index === -1) return null;

	items[index] = { ...items[index], ...patch };
	await chrome.storage.local.set({ [INBOX_KEY]: items });
	return items[index];
}

export async function removeInboxItem(id: string): Promise<void> {
	const items = await getInboxItems();
	const next = items.filter((item) => item.id !== id);
	await chrome.storage.local.set({ [INBOX_KEY]: next });
}

export async function clearInbox(): Promise<void> {
	await chrome.storage.local.remove([INBOX_KEY]);
}

/** First non-heading text of the markdown body, for list previews. */
export function getInboxItemSnippet(item: InboxItem, maxLength = 64): string {
	const text = (item.contentMd || "")
		.split("\n")
		.map((line) => line.replace(/^#+\s*/, "").trim())
		.filter(Boolean)
		.join(" ")
		.replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
		.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
		.replace(/[*_`>#]/g, "")
		.replace(/\s+/g, " ")
		.trim();
	if (!text) return "";
	return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}
