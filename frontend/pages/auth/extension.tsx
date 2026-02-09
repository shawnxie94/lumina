import { useState, useEffect } from 'react';

import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';

import Button from '@/components/Button';
import { IconCheck, IconLock, IconPlug } from '@/components/icons';
import TextInput from '@/components/ui/TextInput';
import { useAuth } from '@/contexts/AuthContext';
import { useBasicSettings } from '@/contexts/BasicSettingsContext';
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
      <div className="min-h-screen flex items-center justify-center bg-app">
        <div className="text-text-3">{t('加载中')}</div>
      </div>
    );
  }

  if (!isInitialized) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-app">
        <div className="text-center">
          <div className="text-text-3 mb-4">{t('系统未初始化')}</div>
          <Link href="/login" className="text-primary hover:underline">
            {t('去设置管理员密码')}
          </Link>
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
        <div className="min-h-screen flex items-center justify-center bg-app">
          <div className="text-center">
            <div className="text-6xl mb-4 inline-flex items-center justify-center text-primary">
              <IconCheck className="h-12 w-12" />
            </div>
            <h1 className="text-2xl font-semibold text-text-1 mb-2">{t('授权成功')}</h1>
            <p className="text-text-2 mb-4">{t('浏览器扩展已获得管理员权限')}</p>
            <p className="text-sm text-text-3">{t('你可以关闭此页面，返回扩展继续使用')}</p>
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
        <div className="min-h-screen flex items-center justify-center bg-app">
          <div className="text-center">
            <div className="text-4xl mb-4 inline-flex items-center justify-center text-primary">
              <IconLock className="h-8 w-8" />
            </div>
            <h1 className="text-xl font-semibold text-text-1 mb-2">{t('正在授权扩展...')}</h1>
            {error && <p className="text-red-600 mb-4">{error}</p>}
            {!error && <p className="text-text-3">{t('请稍候')}</p>}
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

      <div className="min-h-screen flex items-center justify-center bg-app py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-md w-full space-y-8">
          <div>
            <h2 className="mt-6 text-center text-3xl font-semibold text-text-1 inline-flex items-center justify-center gap-2 w-full">
              <IconPlug className="h-5 w-5" />
              <span>{t('扩展授权')}</span>
            </h2>
            <p className="mt-2 text-center text-sm text-text-2">
              {t('登录管理员账号以授权浏览器扩展')}
            </p>
          </div>

          <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
            <div>
              <label htmlFor="password" className="sr-only">
                {t('密码')}
              </label>
              <TextInput
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                placeholder={t('请输入管理员密码')}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>

            {error && (
              <div className="text-red-600 text-sm text-center">{error}</div>
            )}

            <div>
              <Button
                type="submit"
                disabled={submitting}
                variant="primary"
                className="w-full"
              >
                {submitting ? t('登录中...') : t('登录并授权')}
              </Button>
            </div>
          </form>
        </div>
      </div>
    </>
  );
}
