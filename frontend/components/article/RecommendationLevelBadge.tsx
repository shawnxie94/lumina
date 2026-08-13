import { useI18n } from '@/lib/i18n';

export type RecommendationLevel =
  | 'strongly_recommended'
  | 'recommended'
  | 'neutral'
  | 'not_recommended';

const DEFAULT_RECOMMENDATION_LEVEL: RecommendationLevel = 'neutral';

const RECOMMENDATION_LEVEL_LABELS: Record<RecommendationLevel, string> = {
  strongly_recommended: '强烈推荐',
  recommended: '推荐',
  neutral: '一般',
  not_recommended: '不推荐',
};

const RECOMMENDATION_LEVEL_TONES: Record<RecommendationLevel, string> = {
  strongly_recommended: 'border-success-soft bg-success-soft text-success-ink',
  recommended: 'border-info-soft bg-info-soft text-info-ink',
  neutral: 'border-warning-soft bg-warning-soft text-warning-ink',
  not_recommended: 'border-danger-soft bg-danger-soft text-danger-ink',
};

const normalizeRecommendationLevel = (
  value?: string | null,
): RecommendationLevel => {
  if (value && value in RECOMMENDATION_LEVEL_LABELS) {
    return value as RecommendationLevel;
  }
  return DEFAULT_RECOMMENDATION_LEVEL;
};

interface RecommendationLevelBadgeProps {
  level?: string | null;
}

export default function RecommendationLevelBadge({
  level,
}: RecommendationLevelBadgeProps) {
  const { t } = useI18n();
  const normalizedLevel = normalizeRecommendationLevel(level);
  const label = t(RECOMMENDATION_LEVEL_LABELS[normalizedLevel]);

  return (
    <span
      className={`inline-flex shrink-0 items-center whitespace-nowrap rounded-sm border px-2 py-1 text-xs font-medium ${RECOMMENDATION_LEVEL_TONES[normalizedLevel]}`}
      title={`${t('推荐等级')}：${label}`}
      aria-label={`${t('推荐等级')}：${label}`}
    >
      {label}
    </span>
  );
}
