import { useState, useEffect } from 'react';

import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';

import { useAuth } from '@/contexts/AuthContext';
import { useBasicSettings } from '@/contexts/BasicSettingsContext';
import { useI18n } from '@/lib/i18n';

export default function LoginPage() {
  const router = useRouter();
  const { isAdmin, isLoading, isInitialized, login, setup } = useAuth();
  const { t } = useI18n();
  const { basicSettings } = useBasicSettings();

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const isSetupMode = !isInitialized;

  useEffect(() => {
    if (!isLoading && isAdmin) {
      router.push('/');
    }
  }, [isLoading, isAdmin, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!password) {
      setError(t('请输入密码'));
      return;
    }

    if (isSetupMode) {
      if (password.length < 6) {
        setError(t('密码长度至少6位'));
        return;
      }
      if (password !== confirmPassword) {
        setError(t('两次输入的密码不一致'));
        return;
      }
    }

    setSubmitting(true);
    try {
      if (isSetupMode) {
        await setup(password);
      } else {
        await login(password);
      }
      router.push('/');
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : t('操作失败');
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

  if (isAdmin) {
    return null;
  }

  return (
    <>
    <Head>
      <title>
        {isSetupMode ? t('设置管理员密码') : t('管理员登录')} -{" "}
        {basicSettings.site_name || 'Lumina'}
      </title>
    </Head>

      <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-md w-full space-y-8">
          <div>
            <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
              {isSetupMode ? t('设置管理员密码') : t('管理员登录')}
            </h2>
            <p className="mt-2 text-center text-sm text-gray-600">
              {isSetupMode
                ? t('首次使用，请设置管理员密码')
                : t('登录后可进行文章管理操作')}
            </p>
          </div>

          <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
            <div className="rounded-md shadow-sm -space-y-px">
              <div>
                <label htmlFor="password" className="sr-only">
                  {t('密码')}
                </label>
                <input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete={isSetupMode ? 'new-password' : 'current-password'}
                  required
                  className={`appearance-none rounded-none relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 ${
                    isSetupMode ? 'rounded-t-md' : 'rounded-md'
                  } focus:outline-none focus:ring-blue-500 focus:border-blue-500 focus:z-10 sm:text-sm`}
                  placeholder={t('请输入密码')}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              {isSetupMode && (
                <div>
                  <label htmlFor="confirmPassword" className="sr-only">
                    {t('确认密码')}
                  </label>
                  <input
                    id="confirmPassword"
                    name="confirmPassword"
                    type="password"
                    autoComplete="new-password"
                    required
                    className="appearance-none rounded-none relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-b-md focus:outline-none focus:ring-blue-500 focus:border-blue-500 focus:z-10 sm:text-sm"
                    placeholder={t('请再次输入密码')}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                  />
                </div>
              )}
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
                {submitting
                  ? t('处理中...')
                  : isSetupMode
                  ? t('设置密码并登录')
                  : t('登录')}
              </button>
            </div>

            <div className="text-center">
              <Link
                href="/"
                className="text-sm text-gray-500 hover:text-gray-700"
              >
                {t('以访客身份浏览')} →
              </Link>
            </div>
          </form>
        </div>
      </div>
    </>
  );
}
