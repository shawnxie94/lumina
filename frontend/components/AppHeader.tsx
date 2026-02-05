import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';

import { useAuth } from '@/contexts/AuthContext';
import {
  IconGithub,
  IconLock,
  IconLogout,
  IconSettings,
  IconSun,
  IconMoon,
  IconMonitor,
} from '@/components/icons';

export default function AppHeader() {
  const { isAdmin, logout } = useAuth();
  const [theme, setTheme] = useState<'light' | 'dark' | 'system'>('system');
  const [themeMenuOpen, setThemeMenuOpen] = useState(false);
  const themeMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const stored = localStorage.getItem('theme');
    const preferred =
      window.matchMedia &&
      window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light';
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
      { value: 'light' as const, label: '明亮', icon: IconSun },
      { value: 'dark' as const, label: '暗黑', icon: IconMoon },
      { value: 'system' as const, label: '系统', icon: IconMonitor },
    ],
    [],
  );

  const activeTheme = themeOptions.find((option) => option.value === theme);

  return (
    <header className="bg-surface border-b border-border shadow-sm">
      <div className="max-w-7xl mx-auto px-4 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-8">
            <Link href="/" className="inline-flex items-center gap-2 text-text-1">
              <img
                src="/favicon.png"
                alt="Lumina"
                className="h-7 w-7 logo-mark"
              />
              <span className="text-2xl font-bold">Lumina</span>
            </Link>
            <div className="flex items-center gap-2 text-base font-medium">
              <Link
                href="/"
                className="px-3 py-1 rounded-sm transition text-text-1 hover:bg-muted"
              >
                文章
              </Link>
              <span className="px-3 py-1 rounded-sm text-text-3">播客</span>
              <span className="px-3 py-1 rounded-sm text-text-3">视频</span>
              <span className="px-3 py-1 rounded-sm text-text-3">书籍</span>
              <span className="px-3 py-1 rounded-sm text-text-3">想法</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <a
              href="https://github.com/shawnxie94/lumina"
              target="_blank"
              rel="noreferrer"
              aria-label="访问 GitHub"
              className="flex items-center gap-1 px-3 py-1 rounded-sm text-sm text-text-3 hover:text-text-1 hover:bg-muted transition"
            >
              <IconGithub className="h-4 w-4" />
              <span>GitHub</span>
            </a>
            <div className="relative" ref={themeMenuRef}>
              <button
                type="button"
                onClick={() => setThemeMenuOpen((prev) => !prev)}
                className="flex items-center gap-1 px-3 py-1 rounded-sm text-sm text-text-3 hover:text-text-1 hover:bg-muted transition"
                title="切换主题"
              >
                {activeTheme && <activeTheme.icon className="h-4 w-4" />}
                <span>{activeTheme?.label ?? '主题'}</span>
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
            {isAdmin && (
              <Link
                href="/settings"
                className="flex items-center gap-1 px-3 py-1 rounded-sm text-sm text-text-3 hover:text-text-1 hover:bg-muted transition"
                title="设置"
              >
                <IconSettings className="h-4 w-4" />
                <span>设置</span>
              </Link>
            )}
            {isAdmin ? (
              <button
                onClick={logout}
                className="flex items-center gap-1 px-3 py-1 rounded-sm text-sm text-text-3 hover:text-red-600 hover:bg-red-50 transition"
                title="退出登录"
                type="button"
              >
                <IconLogout className="h-4 w-4" />
                <span>登出</span>
              </button>
            ) : (
              <Link
                href="/login"
                className="flex items-center gap-1 px-3 py-1 rounded-sm text-sm text-text-3 hover:text-primary hover:bg-primary-soft transition"
                title="管理员登录"
              >
                <IconLock className="h-4 w-4" />
                <span>登录</span>
              </Link>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
