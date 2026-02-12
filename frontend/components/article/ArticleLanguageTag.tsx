import type { Article } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

interface ArticleLanguageTagProps {
  article: Article;
  className?: string;
}

export default function ArticleLanguageTag({ article, className = '' }: ArticleLanguageTagProps) {
  const { t } = useI18n();
  const label = article.original_language === 'zh' ? t('中文') : t('英文');

  return (
    <span className={`language-tag ${className}`.trim()}>
      {label}
    </span>
  );
}
