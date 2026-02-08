export type NotificationLevel = 'error' | 'warning' | 'info';
export type NotificationSource = 'task' | 'api' | 'system' | 'custom';

export type NotificationItem = {
  id: string;
  title: string;
  message: string;
  level: NotificationLevel;
  source: NotificationSource;
  category?: string;
  createdAt: string;
};

const STORAGE_KEY = 'lumina-notifications';
const DISMISSED_KEY = 'lumina-notification-dismissed';
const MAX_NOTIFICATIONS = 200;

const subscribers = new Set<(items: NotificationItem[]) => void>();
let notifications: NotificationItem[] = [];
let dismissedIds = new Set<string>();
let hasLoaded = false;

const isBrowser = () => typeof window !== 'undefined';

const loadFromStorage = () => {
  if (!isBrowser() || hasLoaded) return;
  hasLoaded = true;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed)) {
        notifications = parsed.filter((item) => item && typeof item.id === 'string');
      }
    }
    const dismissed = localStorage.getItem(DISMISSED_KEY);
    if (dismissed) {
      const parsed = JSON.parse(dismissed);
      if (Array.isArray(parsed)) {
        dismissedIds = new Set(parsed.filter((id) => typeof id === 'string'));
      }
    }
  } catch {
    notifications = [];
    dismissedIds = new Set();
  }
};

const persist = () => {
  if (!isBrowser()) return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(notifications));
  localStorage.setItem(DISMISSED_KEY, JSON.stringify(Array.from(dismissedIds)));
};

const emit = () => {
  const snapshot = [...notifications];
  subscribers.forEach((listener) => listener(snapshot));
};

const normalize = (items: NotificationItem[]) => {
  notifications = items
    .filter((item) => item && typeof item.id === 'string')
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, MAX_NOTIFICATIONS);
};

const upsert = (item: NotificationItem) => {
  if (dismissedIds.has(item.id)) return;
  const index = notifications.findIndex((existing) => existing.id === item.id);
  if (index >= 0) {
    notifications[index] = item;
  } else {
    notifications = [item, ...notifications];
  }
  normalize(notifications);
};

export const notificationStore = {
  get: () => {
    loadFromStorage();
    return [...notifications];
  },
  subscribe: (listener: (items: NotificationItem[]) => void) => {
    loadFromStorage();
    subscribers.add(listener);
    listener([...notifications]);
    return () => subscribers.delete(listener);
  },
  add: (item: NotificationItem) => {
    loadFromStorage();
    upsert(item);
    persist();
    emit();
  },
  addMany: (items: NotificationItem[]) => {
    loadFromStorage();
    items.forEach((item) => upsert(item));
    persist();
    emit();
  },
  replaceSource: (source: NotificationSource, items: NotificationItem[]) => {
    loadFromStorage();
    const filtered = notifications.filter((item) => item.source !== source);
    notifications = filtered;
    items.forEach((item) => upsert(item));
    persist();
    emit();
  },
  remove: (id: string) => {
    loadFromStorage();
    dismissedIds.add(id);
    notifications = notifications.filter((item) => item.id !== id);
    persist();
    emit();
  },
  clear: () => {
    loadFromStorage();
    notifications.forEach((item) => dismissedIds.add(item.id));
    notifications = [];
    persist();
    emit();
  },
};
