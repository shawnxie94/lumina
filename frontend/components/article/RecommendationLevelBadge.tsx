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

const RECOMMENDATION_LEVEL_STRENGTH: Record<RecommendationLevel, number> = {
  strongly_recommended: 4,
  recommended: 3,
  neutral: 2,
  not_recommended: 1,
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
  variant?: 'default' | 'image-overlay';
  className?: string;
}

function RecommendationSignalIcon({ level }: { level: RecommendationLevel }) {
  const activeDots = RECOMMENDATION_LEVEL_STRENGTH[level];
  const dots = [3, 9, 15, 21];

  return (
    <svg
      aria-hidden="true"
      className="h-3 w-6 shrink-0"
      viewBox="0 0 24 10"
      style={{ filter: 'drop-shadow(0 1px 1.5px rgba(0, 0, 0, 0.45))' }}
    >
      {dots.map((x, index) => (
        <circle
          key={x}
          cx={x}
          cy="5"
          r="2.5"
          fill={index < activeDots ? 'var(--text-2)' : '#ffffff'}
        />
      ))}
    </svg>
  );
}

export default function RecommendationLevelBadge({
  level,
  variant = 'default',
  className = '',
}: RecommendationLevelBadgeProps) {
  const { t } = useI18n();
  const normalizedLevel = normalizeRecommendationLevel(level);
  const label = t(RECOMMENDATION_LEVEL_LABELS[normalizedLevel]);
  const isImageOverlay = variant === 'image-overlay';

  return (
    <span
      className={`inline-flex shrink-0 items-center whitespace-nowrap text-xs ${
        isImageOverlay
          ? 'h-5'
          : `border px-2 py-1 font-medium rounded-sm ${RECOMMENDATION_LEVEL_TONES[normalizedLevel]}`
      } ${className}`.trim()}
      title={`${t('推荐等级')}：${label}`}
      aria-label={`${t('推荐等级')}：${label}`}
    >
      {isImageOverlay ? <RecommendationSignalIcon level={normalizedLevel} /> : label}
    </span>
  );
}
