import type { ReactNode } from 'react';

import { formatArticleDisplayDate } from '@/lib/date';
import { useI18n } from '@/lib/i18n';

interface ArticleMetaRowProps {
  items?: Array<ReactNode | null | undefined>;
  publishedAt?: string | null;
  createdAt?: string | null;
  className?: string;
  singleLine?: boolean;
  itemClassName?: string;
  dateItemClassName?: string;
  dateLabelClassName?: string;
}

export default function ArticleMetaRow({
  items = [],
  publishedAt,
  createdAt,
  className = '',
  singleLine = false,
  itemClassName = '',
  dateItemClassName = '',
  dateLabelClassName = 'font-medium text-text-2',
}: ArticleMetaRowProps) {
  const { t, language } = useI18n();
  const visibleItems = items.filter(Boolean);
  const dateText = formatArticleDisplayDate(publishedAt, createdAt, language);

  return (
    <div className={`flex ${singleLine ? 'flex-nowrap overflow-hidden' : 'flex-wrap'} items-center gap-3 text-sm text-text-2 ${className}`.trim()}>
      {visibleItems.map((item, index) => (
        <div key={`meta-item-${index}`} className={`${singleLine ? 'min-w-0 truncate' : ''} ${itemClassName}`.trim()}>
          {item}
        </div>
      ))}
      <div className={`${singleLine ? 'min-w-0 truncate' : ''} ${dateItemClassName}`.trim()}>
        <span className={dateLabelClassName}>
          {t('发表时间')}：
        </span>
        {dateText}
      </div>
    </div>
  );
}
