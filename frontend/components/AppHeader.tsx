import Link from 'next/link';

import { useAuth } from '@/contexts/AuthContext';
import { IconGithub, IconLock, IconLogout, IconSettings } from '@/components/icons';

export default function AppHeader() {
  const { isAdmin, logout } = useAuth();

  return (
    <header className="bg-surface border-b border-border shadow-sm">
      <div className="max-w-7xl mx-auto px-4 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-8">
            <Link href="/" className="inline-flex items-center gap-2 text-text-1">
              <img src="/favicon.png" alt="Lumina" className="h-7 w-7" />
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
