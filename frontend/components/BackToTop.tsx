import { useState, useEffect } from 'react';
import { useI18n } from '@/lib/i18n';

export function BackToTop() {
  const [visible, setVisible] = useState(false);
  const { t } = useI18n();

  useEffect(() => {
    const handleScroll = () => {
      setVisible(window.scrollY > 300);
    };

    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  if (!visible) return null;

  return (
    <button
      type="button"
      onClick={scrollToTop}
      className="fixed bottom-8 right-8 z-50 flex h-12 w-12 items-center justify-center rounded-full border border-border bg-surface text-text-2 shadow-md transition hover:bg-muted hover:text-text-1"
      title={t('回到顶部')}
      aria-label={t('回到顶部')}
    >
      ↑
    </button>
  );
}
