import type { ReactNode } from 'react';

import { formatArticleDisplayDate } from '@/lib/date';
import { useI18n } from '@/lib/i18n';

interface ArticleMetaRowProps {
  items?: Array<ReactNode | null | undefined>;
  publishedAt?: string | null;
  createdAt?: string | null;
  className?: string;
  dateItemClassName?: string;
  dateLabelClassName?: string;
}

export default function ArticleMetaRow({
  items = [],
  publishedAt,
  createdAt,
  className = '',
  dateItemClassName = '',
  dateLabelClassName = 'font-medium text-text-2',
}: ArticleMetaRowProps) {
  const { t, language } = useI18n();
  const visibleItems = items.filter(Boolean);
  const dateText = formatArticleDisplayDate(publishedAt, createdAt, language);

  return (
    <div className={`flex flex-wrap items-center gap-3 text-sm text-text-2 ${className}`.trim()}>
      {visibleItems.map((item, index) => (
        <div key={`meta-item-${index}`}>
          {item}
        </div>
      ))}
      <div className={dateItemClassName}>
        <span className={dateLabelClassName}>
          {t('发表时间')}：
        </span>
        {dateText}
      </div>
    </div>
  );
}
