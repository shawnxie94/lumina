import Link from 'next/link';
import { useRouter } from 'next/router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useAuth } from '@/contexts/AuthContext';
import { useBasicSettings } from '@/contexts/BasicSettingsContext';
import { articleApi } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { notificationStore, type NotificationItem } from '@/lib/notifications';
import {
  IconBell,
  IconGithub,
  IconLock,
  IconLogout,
  IconSettings,
  IconSun,
  IconMoon,
  IconMonitor,
  IconTrash,
  IconGlobe,
} from '@/components/icons';

const ERROR_PAGE_SIZE = 50;

type ErrorTaskItem = {
  id: string;
  article_id: string | null;
  article_title?: string | null;
  task_type: string;
  content_type: string | null;
  status: string;
  last_error: string | null;
  updated_at: string;
  created_at: string;
  finished_at: string | null;
};

export default function AppHeader() {
  const router = useRouter();
  const { isAdmin, isLoading: authLoading, logout } = useAuth();
  const { t, language } = useI18n();
  const { basicSettings, languagePreference, setLanguagePreference } =
    useBasicSettings();
  const [theme, setTheme] = useState<'light' | 'dark' | 'system'>('system');
  const [themeMenuOpen, setThemeMenuOpen] = useState(false);
  const themeMenuRef = useRef<HTMLDivElement | null>(null);
  const [languageMenuOpen, setLanguageMenuOpen] = useState(false);
  const languageMenuRef = useRef<HTMLDivElement | null>(null);
  const [errorMenuOpen, setErrorMenuOpen] = useState(false);
  const errorMenuRef = useRef<HTMLDivElement | null>(null);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [errorLoading, setErrorLoading] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const stored = localStorage.getItem('theme');
    const initial =
      stored === 'light' || stored === 'dark' || stored === 'system'
        ? stored
        : 'system';
    setTheme(initial);
    if (initial === 'system') {
      document.documentElement.removeAttribute('data-theme');
    } else {
      document.documentElement.setAttribute('data-theme', initial);
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (theme !== 'system') return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = () => {
      document.documentElement.removeAttribute('data-theme');
    };
    if (media.addEventListener) {
      media.addEventListener('change', handleChange);
    } else {
      media.addListener(handleChange);
    }
    return () => {
      if (media.removeEventListener) {
        media.removeEventListener('change', handleChange);
      } else {
        media.removeListener(handleChange);
      }
    };
  }, [theme]);

  useEffect(() => {
    if (!themeMenuOpen) return;
    const handleClick = (event: MouseEvent) => {
      if (!themeMenuRef.current) return;
      if (themeMenuRef.current.contains(event.target as Node)) return;
      setThemeMenuOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [themeMenuOpen]);

  useEffect(() => {
    if (!languageMenuOpen) return;
    const handleClick = (event: MouseEvent) => {
      if (!languageMenuRef.current) return;
      if (languageMenuRef.current.contains(event.target as Node)) return;
      setLanguageMenuOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [languageMenuOpen]);

  useEffect(() => {
    if (!errorMenuOpen) return;
    const handleClick = (event: MouseEvent) => {
      if (!errorMenuRef.current) return;
      if (errorMenuRef.current.contains(event.target as Node)) return;
      setErrorMenuOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [errorMenuOpen]);

  useEffect(() => {
    const unsubscribe = notificationStore.subscribe((items) => {
      setNotifications(items);
    });
    return () => {
      unsubscribe();
    };
  }, []);

  const getTaskTypeLabel = useCallback(
    (task: ErrorTaskItem) => {
      if (task.task_type === 'process_article_cleaning') return t('清洗');
      if (task.task_type === 'process_article_validation') return t('校验');
      if (task.task_type === 'process_article_classification') return t('分类');
      if (task.task_type === 'process_article_translation') return t('翻译');
      if (task.task_type === 'process_article_embedding') return t('向量化');
      if (task.task_type === 'process_ai_content') {
        if (task.content_type === 'summary') return t('摘要');
        if (task.content_type === 'key_points') return t('总结');
        if (task.content_type === 'outline') return t('大纲');
        if (task.content_type === 'quotes') return t('金句');
        return t('AI内容');
      }
      if (task.task_type === 'process_article_ai') return t('旧流程');
      return t('其他');
    },
    [t],
  );

  const fetchErrorTasks = useCallback(async () => {
    if (!isAdmin) return;
    setErrorLoading(true);
    try {
      const response = await articleApi.getAITasks({
        page: 1,
        size: ERROR_PAGE_SIZE,
        status: 'failed',
      });
      const items = (response.data as ErrorTaskItem[]).map((task) => {
        const title =
          task.article_title || `${getTaskTypeLabel(task)}${t('任务')}`;
        return {
          id: `task:${task.id}`,
          title,
          message: task.last_error || t('未知错误'),
          level: 'error' as const,
          source: 'task' as const,
          category: getTaskTypeLabel(task),
          createdAt: task.finished_at || task.updated_at || task.created_at,
        };
      });
      notificationStore.replaceSource('task', items);
    } catch (error) {
      console.error('Failed to fetch error tasks:', error);
    } finally {
      setErrorLoading(false);
    }
  }, [isAdmin, getTaskTypeLabel]);

  useEffect(() => {
    if (!isAdmin) {
      notificationStore.replaceSource('task', []);
      return;
    }
    fetchErrorTasks();
    const timer = setInterval(fetchErrorTasks, 60000);
    return () => clearInterval(timer);
  }, [fetchErrorTasks, isAdmin]);

  const applyTheme = (nextTheme: 'light' | 'dark' | 'system') => {
    setTheme(nextTheme);
    if (typeof window !== 'undefined') {
      localStorage.setItem('theme', nextTheme);
      if (nextTheme === 'system') {
        document.documentElement.removeAttribute('data-theme');
      } else {
        document.documentElement.setAttribute('data-theme', nextTheme);
      }
    }
  };
  const themeOptions = useMemo(
    () => [
      { value: 'light' as const, label: t('明亮'), icon: IconSun },
      { value: 'dark' as const, label: t('暗黑'), icon: IconMoon },
      { value: 'system' as const, label: t('系统'), icon: IconMonitor },
    ],
    [t],
  );

  const languageOptions = useMemo(
    () => [
      { value: 'zh-CN' as const, label: t('中文') },
      { value: 'en' as const, label: t('英文') },
      { value: 'system' as const, label: t('跟随系统默认') },
    ],
    [t],
  );

  const activeTheme = themeOptions.find((option) => option.value === theme);
  const notificationCount = notifications.length;

  const handleDismissNotification = useCallback((id: string) => {
    notificationStore.remove(id);
  }, []);

  const handleClearAllNotifications = useCallback(() => {
    if (!notifications.length) return;
    notificationStore.clear();
  }, [notifications.length]);

  const getSourceLabel = useCallback(
    (item: NotificationItem) => {
      if (item.source === 'task') return t('任务错误');
      if (item.source === 'api') return t('接口错误');
      if (item.source === 'system') return t('系统通知');
      return t('通知');
    },
    [t],
  );

  const getLevelClass = useCallback((level: NotificationItem['level']) => {
    if (level === 'error') return 'text-danger';
    if (level === 'warning') return 'text-warning-ink';
    return 'text-info-ink';
  }, []);

  const siteName = basicSettings.site_name || 'Lumina';
  const siteLogo = basicSettings.site_logo_url || '/favicon.png';
  const resolvedAdmin = !authLoading && isAdmin;
  const resolvedGuest = !authLoading && !isAdmin;
  const loginHref = useMemo(() => {
    const currentPath = router.asPath || '/';
    if (currentPath.startsWith('/login')) {
      return '/login';
    }
    return `/login?redirect=${encodeURIComponent(currentPath)}`;
  }, [router.asPath]);
  const isHomeRoute = router.pathname === '/';
  const isFeedRoute = router.pathname === '/list';

  return (
    <header className="bg-surface border-b border-border shadow-sm">
      <div className="max-w-7xl mx-auto px-4 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-8">
            <Link href="/" className="inline-flex items-center gap-2 text-text-1">
              <img
                src={siteLogo}
                alt={siteName}
                className="h-7 w-7 logo-mark"
                width={28}
                height={28}
                decoding="async"
              />
              <span className="text-2xl font-bold">{siteName}</span>
            </Link>
            <div className="hidden lg:flex items-center gap-2 text-base font-medium">
              <Link
                href="/"
                className={`px-3 py-1 rounded-sm transition ${
                  isHomeRoute ? 'bg-muted text-text-1' : 'text-text-2 hover:bg-muted hover:text-text-1'
                }`}
              >
                {t('主页')}
              </Link>
              <Link
                href="/list"
                className={`px-3 py-1 rounded-sm transition ${
                  isFeedRoute ? 'bg-muted text-text-1' : 'text-text-2 hover:bg-muted hover:text-text-1'
                }`}
              >
                {t('信息流')}
              </Link>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {resolvedAdmin && (
              <div className="relative hidden lg:block" ref={errorMenuRef}>
                <button
                  type="button"
                  onClick={() => setErrorMenuOpen((prev) => !prev)}
                  className="relative flex items-center justify-center h-9 w-9 rounded-sm text-text-3 hover:text-text-1 hover:bg-muted transition"
                  title={t('通知中心')}
                  aria-label={t('通知中心')}
                >
                  <IconBell className="h-4 w-4" />
                  {notificationCount > 0 && (
                    <span className="absolute -top-1 -right-1 min-w-[18px] px-1 text-[10px] leading-5 bg-danger text-white rounded-full text-center">
                      {notificationCount > 99 ? '99+' : notificationCount}
                    </span>
                  )}
                </button>
                {errorMenuOpen && (
                  <div className="absolute right-0 mt-2 w-80 rounded-md border border-border bg-surface shadow-md z-20">
                    <div className="flex items-center justify-between px-3 py-2 border-b border-border">
                      <div className="text-sm font-medium text-text-1">
                        {t('通知中心')}
                      </div>
                      <button
                        type="button"
                        onClick={handleClearAllNotifications}
                        className="flex items-center gap-1 text-xs text-text-3 hover:text-text-1 transition"
                        title={t('清理全部')}
                        aria-label={t('清理全部')}
                      >
                        <IconTrash className="h-3.5 w-3.5" />
                        {t('清理')}
                      </button>
                    </div>
                    <div className="max-h-80 overflow-auto">
                      {errorLoading && (
                        <div className="px-3 py-4 text-xs text-text-3">
                          {t('加载中')}
                        </div>
                      )}
                      {!errorLoading && notifications.length === 0 && (
                        <div className="px-3 py-4 text-xs text-text-3">
                          {t('暂无通知')}
                        </div>
                      )}
                      {!errorLoading &&
                        notifications.map((item) => (
                          <div
                            key={item.id}
                            className="flex items-start gap-3 px-3 py-2 border-b border-border last:border-b-0 hover:bg-muted transition"
                          >
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <div className="text-sm font-medium text-text-1 truncate">
                                  {item.title}
                                </div>
                                <div
                                  className={`text-xs ${getLevelClass(item.level)}`}
                                >
                                  {getSourceLabel(item)}
                                </div>
                                {item.category && (
                                  <div className="text-xs text-text-3">
                                    {item.category}
                                  </div>
                                )}
                              </div>
                              <div className="text-xs text-text-2 mt-1">
                                {item.message}
                              </div>
                              <div className="text-[11px] text-text-3 mt-1">
                                {new Date(item.createdAt).toLocaleString(
                                  language === 'en' ? 'en-US' : 'zh-CN',
                                )}
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => handleDismissNotification(item.id)}
                              className="text-text-3 hover:text-text-1 transition"
                              title={t('清理')}
                              aria-label={t('清理')}
                            >
                              <IconTrash className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        ))}
                    </div>
                  </div>
                )}
              </div>
            )}
            <div className="relative" ref={themeMenuRef}>
              <button
                type="button"
                onClick={() => setThemeMenuOpen((prev) => !prev)}
                className="flex items-center gap-1 px-3 py-1 rounded-sm text-sm text-text-3 hover:text-text-1 hover:bg-muted transition"
                title={t('切换主题')}
                aria-label={t('切换主题')}
              >
                {activeTheme && <activeTheme.icon className="h-4 w-4" />}
              </button>
              {themeMenuOpen && (
                <div className="absolute right-0 mt-2 w-28 rounded-md border border-border bg-surface shadow-md p-1 z-10">
                  {themeOptions.map((option) => {
                    const isActive = theme === option.value;
                    const Icon = option.icon;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => {
                          applyTheme(option.value);
                          setThemeMenuOpen(false);
                        }}
                        className={`w-full flex items-center gap-2 px-2 py-1 rounded text-xs transition ${
                          isActive
                            ? 'bg-muted text-text-1'
                            : 'text-text-2 hover:text-text-1 hover:bg-muted'
                        }`}
                      >
                        <Icon className="h-3.5 w-3.5" />
                        <span>{option.label}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="relative" ref={languageMenuRef}>
              <button
                type="button"
                onClick={() => setLanguageMenuOpen((prev) => !prev)}
                className="flex items-center justify-center w-8 h-8 rounded-sm text-text-3 hover:text-text-1 hover:bg-muted transition"
                title={t('语言')}
                aria-label={t('语言')}
              >
                <IconGlobe className="h-4 w-4" />
              </button>
              {languageMenuOpen && (
                <div className="absolute right-0 mt-2 w-40 rounded-md border border-border bg-surface shadow-md p-1 z-10">
                  {languageOptions.map((option) => {
                    const isActive =
                      option.value === 'system'
                        ? languagePreference === null
                        : languagePreference === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => {
                          setLanguagePreference(option.value);
                          setLanguageMenuOpen(false);
                        }}
                        className={`w-full flex items-center gap-2 px-2 py-1 rounded text-xs transition ${
                          isActive
                            ? 'bg-muted text-text-1'
                            : 'text-text-2 hover:text-text-1 hover:bg-muted'
                        }`}
                      >
                        <span>{option.label}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            {resolvedAdmin && (
              <Link
                href="/admin"
                className="hidden lg:flex items-center gap-1 px-3 py-1 rounded-sm text-sm text-text-3 hover:text-text-1 hover:bg-muted transition"
                title={t('管理')}
                aria-label={t('管理')}
              >
                <IconSettings className="h-4 w-4" />
              </Link>
            )}
            {resolvedAdmin ? (
              <button
                onClick={logout}
                className="hidden lg:flex items-center gap-1 px-3 py-1 rounded-sm text-sm text-text-3 hover:text-danger-ink hover:bg-danger-soft transition"
                title={t('退出登录')}
                aria-label={t('退出登录')}
                type="button"
              >
                <IconLogout className="h-4 w-4" />
              </button>
            ) : resolvedGuest ? (
              <Link
                href={loginHref}
                className="hidden lg:flex items-center gap-1 px-3 py-1 rounded-sm text-sm text-text-3 hover:text-primary hover:bg-primary-soft transition"
                title={t('管理员登录')}
                aria-label={t('管理员登录')}
              >
                <IconLock className="h-4 w-4" />
              </Link>
            ) : (
              <div className="hidden lg:block h-8 w-8" aria-hidden="true" />
            )}
          </div>

          <div className="mt-3 flex lg:hidden items-center gap-2 text-sm font-medium">
            <Link
              href="/"
              className={`px-3 py-1 rounded-sm transition ${
                isHomeRoute ? 'bg-muted text-text-1' : 'text-text-2 hover:bg-muted hover:text-text-1'
              }`}
            >
              {t('主页')}
            </Link>
            <Link
              href="/list"
              className={`px-3 py-1 rounded-sm transition ${
                isFeedRoute ? 'bg-muted text-text-1' : 'text-text-2 hover:bg-muted hover:text-text-1'
              }`}
            >
              {t('信息流')}
            </Link>
          </div>
        </div>
      </div>
    </header>
  );
}
