export interface HistoryItem {
  id: string;
  title: string;
  url: string;
  domain: string;
  collectedAt: string;
  categoryName?: string;
}

const HISTORY_KEY = 'collect_history';
const MAX_HISTORY_ITEMS = 20;

export async function addToHistory(item: Omit<HistoryItem, 'id' | 'collectedAt'>): Promise<void> {
  const history = await getHistory();
  
  const existingIndex = history.findIndex(h => h.url === item.url);
  if (existingIndex !== -1) {
    history.splice(existingIndex, 1);
  }

  const newItem: HistoryItem = {
    ...item,
    id: `history_${Date.now()}`,
    collectedAt: new Date().toISOString(),
  };

  history.unshift(newItem);

  if (history.length > MAX_HISTORY_ITEMS) {
    history.splice(MAX_HISTORY_ITEMS);
  }

  await chrome.storage.local.set({ [HISTORY_KEY]: history });
}

export async function getHistory(): Promise<HistoryItem[]> {
  return new Promise((resolve) => {
    chrome.storage.local.get([HISTORY_KEY], (result) => {
      resolve(result[HISTORY_KEY] || []);
    });
  });
}

export async function clearHistory(): Promise<void> {
  await chrome.storage.local.remove([HISTORY_KEY]);
}

export function formatHistoryDate(isoDate: string): string {
  const date = new Date(isoDate);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return '刚刚';
  if (diffMins < 60) return `${diffMins}分钟前`;
  if (diffHours < 24) return `${diffHours}小时前`;
  if (diffDays < 7) return `${diffDays}天前`;

  const month = date.getMonth() + 1;
  const day = date.getDate();
  return `${month}月${day}日`;
}
