import '@/styles/globals.css';
import type { AppProps } from 'next/app';
import Head from 'next/head';
import { SessionProvider } from 'next-auth/react';

import { ToastProvider } from '@/components/Toast';
import { ContinueReadingBanner } from '@/components/ContinueReadingBanner';
import { AuthProvider } from '@/contexts/AuthContext';
import { ReadingProvider } from '@/contexts/ReadingContext';
import { BasicSettingsProvider } from '@/contexts/BasicSettingsContext';

export default function App({ Component, pageProps }: AppProps) {
  return (
    <>
      <Head>
        <link rel="icon" href="/favicon.png" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <link rel="manifest" href="/manifest.webmanifest" />
        <meta name="application-name" content="Lumina" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-title" content="Lumina" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <meta
          name="theme-color"
          content="#f7f7f8"
          media="(prefers-color-scheme: light)"
        />
        <meta
          name="theme-color"
          content="#0f1115"
          media="(prefers-color-scheme: dark)"
        />
      </Head>
      <SessionProvider session={(pageProps as { session?: any }).session}>
        <AuthProvider>
          <BasicSettingsProvider>
            <ReadingProvider>
              <ToastProvider>
                <Component {...pageProps} />
                <ContinueReadingBanner />
              </ToastProvider>
            </ReadingProvider>
          </BasicSettingsProvider>
        </AuthProvider>
      </SessionProvider>
    </>
  );
}
