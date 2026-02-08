import { useState, useEffect } from 'react';

import { useRouter } from 'next/router';
import Head from 'next/head';

import { useAuth } from '@/contexts/AuthContext';
import { useBasicSettings } from '@/contexts/BasicSettingsContext';
import { IconCheck, IconLock, IconPlug } from '@/components/icons';
import { getToken } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

export default function ExtensionAuthPage() {
  const router = useRouter();
  const { isAdmin, isLoading, login, isInitialized } = useAuth();
  const { t } = useI18n();
  const { basicSettings } = useBasicSettings();
  const { extension_id } = router.query;

  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [authorized, setAuthorized] = useState(false);

  useEffect(() => {
    if (!isLoading && isAdmin && extension_id) {
      sendTokenToExtension();
    }
  }, [isLoading, isAdmin, extension_id]);

  const sendTokenToExtension = async () => {
    const token = getToken();
    if (!token || !extension_id) return;

    if (typeof window === 'undefined') return;

    const chromeApi = (window as { chrome?: { runtime?: { sendMessage?: Function } } }).chrome;
    if (!chromeApi?.runtime?.sendMessage) {
      setError(t('无法与扩展通信，请确保扩展已安装并启用'));
      return;
    }

    try {
      await chromeApi.runtime.sendMessage(extension_id as string, {
        type: 'AUTH_TOKEN',
        token,
      });
      setAuthorized(true);
    } catch (err) {
      console.error('Failed to send token to extension:', err);
      setError(t('无法与扩展通信，请确保扩展已安装并启用'));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!password) {
      setError(t('请输入密码'));
      return;
    }

    setSubmitting(true);
    try {
      await login(password);
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : t('登录失败');
      const axiosError = err as { response?: { data?: { detail?: string } } };
      setError(axiosError.response?.data?.detail || errorMessage);
    } finally {
      setSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-gray-500">{t('加载中')}</div>
      </div>
    );
  }

  if (!isInitialized) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="text-gray-500 mb-4">{t('系统未初始化')}</div>
          <a href="/login" className="text-blue-600 hover:underline">
            {t('去设置管理员密码')}
          </a>
        </div>
      </div>
    );
  }

  if (authorized) {
    return (
      <>
    <Head>
      <title>{t('授权成功')} - {basicSettings.site_name || 'Lumina'}</title>
    </Head>
        <div className="min-h-screen flex items-center justify-center bg-gray-50">
          <div className="text-center">
            <div className="text-6xl mb-4 inline-flex items-center justify-center">
              <IconCheck className="h-12 w-12" />
            </div>
            <h1 className="text-2xl font-bold text-gray-900 mb-2">{t('授权成功')}</h1>
            <p className="text-gray-600 mb-4">{t('浏览器扩展已获得管理员权限')}</p>
            <p className="text-sm text-gray-500">{t('你可以关闭此页面，返回扩展继续使用')}</p>
          </div>
        </div>
      </>
    );
  }

  if (isAdmin) {
    return (
      <>
    <Head>
      <title>{t('扩展授权')} - {basicSettings.site_name || 'Lumina'}</title>
    </Head>
        <div className="min-h-screen flex items-center justify-center bg-gray-50">
          <div className="text-center">
            <div className="text-4xl mb-4 inline-flex items-center justify-center">
              <IconLock className="h-8 w-8" />
            </div>
            <h1 className="text-xl font-bold text-gray-900 mb-2">{t('正在授权扩展...')}</h1>
            {error && <p className="text-red-500 mb-4">{error}</p>}
            {!error && <p className="text-gray-500">{t('请稍候')}</p>}
          </div>
        </div>
      </>
    );
  }

  return (
    <>
    <Head>
      <title>{t('扩展授权登录')} - {basicSettings.site_name || 'Lumina'}</title>
    </Head>

      <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-md w-full space-y-8">
          <div>
            <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900 inline-flex items-center justify-center gap-2">
              <IconPlug className="h-5 w-5" />
              <span>{t('扩展授权')}</span>
            </h2>
            <p className="mt-2 text-center text-sm text-gray-600">
              {t('登录管理员账号以授权浏览器扩展')}
            </p>
          </div>

          <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
            <div>
                <label htmlFor="password" className="sr-only">
                {t('密码')}
                </label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                className="appearance-none rounded-md relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 focus:outline-none focus:ring-blue-500 focus:border-blue-500 focus:z-10 sm:text-sm"
                placeholder={t('请输入管理员密码')}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>

            {error && (
              <div className="text-red-500 text-sm text-center">{error}</div>
            )}

            <div>
              <button
                type="submit"
                disabled={submitting}
                className="group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {submitting ? t('登录中...') : t('登录并授权')}
              </button>
            </div>
          </form>
        </div>
      </div>
    </>
  );
}
