import dayjs, { type Dayjs } from 'dayjs';

import type { QuickDateOption } from '@/lib/listFilters';

export const formatDate = (date: Date | null): string => {
  if (!date) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export const toDayjsRange = (range: [Date | null, Date | null]): [Dayjs | null, Dayjs | null] => [
  range[0] ? dayjs(range[0]) : null,
  range[1] ? dayjs(range[1]) : null,
];

export const getDateRangeFromQuickOption = (option: QuickDateOption): [Date | null, Date | null] => {
  if (!option) return [null, null];

  const now = new Date();
  const startDate = new Date();

  switch (option) {
    case '1d':
      startDate.setDate(now.getDate() - 1);
      break;
    case '3d':
      startDate.setDate(now.getDate() - 3);
      break;
    case '1w':
      startDate.setDate(now.getDate() - 7);
      break;
    case '1m':
      startDate.setMonth(now.getMonth() - 1);
      break;
    case '3m':
      startDate.setMonth(now.getMonth() - 3);
      break;
    case '6m':
      startDate.setMonth(now.getMonth() - 6);
      break;
    case '1y':
      startDate.setFullYear(now.getFullYear() - 1);
      break;
  }

  return [startDate, now];
};

export const getQueryValue = (value: string | string[] | undefined): string => {
  if (Array.isArray(value)) return value[0] || '';
  return value || '';
};

export const parseDateQuery = (value: string): Date | null => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

export const serializeQuery = (query: Record<string, string>): string =>
  Object.entries(query)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('&');

export const LIST_QUERY_KEYS = [
  'category_id',
  'search',
  'source_domain',
  'author',
  'visibility',
  'quick_date',
  'sort_by',
  'published_at_start',
  'published_at_end',
  'created_at_start',
  'created_at_end',
  'page',
  'size',
] as const;

export const pickListQuery = (
  query: Record<string, string | string[] | undefined>,
): Record<string, string> => {
  const picked: Record<string, string> = {};
  LIST_QUERY_KEYS.forEach((key) => {
    const value = getQueryValue(query[key]);
    if (value) {
      picked[key] = value;
    }
  });
  return picked;
};
