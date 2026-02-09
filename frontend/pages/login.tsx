import { useState, useEffect } from 'react';

import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';

import Button from '@/components/Button';
import TextInput from '@/components/ui/TextInput';
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
      <div className="min-h-screen flex items-center justify-center bg-app">
        <div className="text-text-3">{t('加载中')}</div>
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
          {isSetupMode ? t('设置管理员密码') : t('管理员登录')} -{' '}
          {basicSettings.site_name || 'Lumina'}
        </title>
      </Head>

      <div className="min-h-screen flex items-center justify-center bg-app py-8 sm:py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-md w-full space-y-6 sm:space-y-8">
          <div>
            <h2 className="mt-2 sm:mt-6 text-center text-2xl sm:text-3xl font-semibold text-text-1">
              {isSetupMode ? t('设置管理员密码') : t('管理员登录')}
            </h2>
            <p className="mt-2 text-center text-sm text-text-2">
              {isSetupMode
                ? t('首次使用，请设置管理员密码')
                : t('登录后可进行文章管理操作')}
            </p>
          </div>

          <form className="mt-4 sm:mt-8 space-y-5" onSubmit={handleSubmit}>
            <div className="space-y-3">
              <label htmlFor="password" className="sr-only">
                {t('密码')}
              </label>
              <TextInput
                id="password"
                name="password"
                type="password"
                autoComplete={isSetupMode ? 'new-password' : 'current-password'}
                required
                placeholder={t('请输入密码')}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />

              {isSetupMode && (
                <>
                  <label htmlFor="confirmPassword" className="sr-only">
                    {t('确认密码')}
                  </label>
                  <TextInput
                    id="confirmPassword"
                    name="confirmPassword"
                    type="password"
                    autoComplete="new-password"
                    required
                    placeholder={t('请再次输入密码')}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                  />
                </>
              )}
            </div>

            {error && (
              <div className="text-red-500 text-sm text-center">{error}</div>
            )}

            <div>
              <Button
                type="submit"
                disabled={submitting}
                variant="primary"
                className="w-full"
              >
                {submitting
                  ? t('处理中...')
                  : isSetupMode
                  ? t('设置密码并登录')
                  : t('登录')}
              </Button>
            </div>

            <div className="text-center">
              <Link
                href="/"
                className="text-sm text-text-3 hover:text-text-2"
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
