import '@/styles/globals.css';
import type { AppProps } from 'next/app';

import { ToastProvider } from '@/components/Toast';
import { AuthProvider } from '@/contexts/AuthContext';

export default function App({ Component, pageProps }: AppProps) {
  return (
    <AuthProvider>
      <ToastProvider>
        <Component {...pageProps} />
      </ToastProvider>
    </AuthProvider>
  );
}