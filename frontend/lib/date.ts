import type { Language } from '@/lib/i18n';

export const getLocaleByLanguage = (language: Language): string =>
  language === 'en' ? 'en-US' : 'zh-CN';

export const formatArticleDisplayDate = (
  publishedAt: string | null | undefined,
  createdAt: string | null | undefined,
  language: Language,
): string => {
  const raw = publishedAt || createdAt;
  if (!raw) return '';
  return new Date(raw).toLocaleDateString(getLocaleByLanguage(language));
};
