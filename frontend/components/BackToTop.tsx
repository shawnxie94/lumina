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
      onClick={scrollToTop}
      className="fixed bottom-8 right-8 w-12 h-12 bg-blue-600 text-white rounded-full shadow-md hover:bg-blue-700 transition flex items-center justify-center z-50"
      title={t('回到顶部')}
    >
      ↑
    </button>
  );
}
