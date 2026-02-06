import '@/styles/globals.css';
import type { AppProps } from 'next/app';
import Head from 'next/head';
import { SessionProvider } from 'next-auth/react';

import { ToastProvider } from '@/components/Toast';
import { ContinueReadingBanner } from '@/components/ContinueReadingBanner';
import { AuthProvider } from '@/contexts/AuthContext';
import { ReadingProvider } from '@/contexts/ReadingContext';

export default function App({ Component, pageProps }: AppProps) {
  return (
    <>
      <Head>
        <link rel="icon" href="/favicon.png" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
      </Head>
      <SessionProvider session={(pageProps as { session?: any }).session}>
        <AuthProvider>
          <ReadingProvider>
            <ToastProvider>
              <Component {...pageProps} />
              <ContinueReadingBanner />
            </ToastProvider>
          </ReadingProvider>
        </AuthProvider>
      </SessionProvider>
    </>
  );
}
