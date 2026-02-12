interface FeedListSkeletonProps {
  count: number;
  showAdminDesktop: boolean;
}

export default function FeedListSkeleton({
  count,
  showAdminDesktop,
}: FeedListSkeletonProps) {
  return (
    <div className="space-y-4" aria-live="polite" aria-busy="true">
      {showAdminDesktop && (
        <div className="mb-4">
          <div className="flex items-center gap-2">
            <span className="skeleton-shimmer motion-safe:animate-pulse h-4 w-4 rounded-xs" />
            <span className="skeleton-shimmer motion-safe:animate-pulse h-4 w-44 rounded-xs" />
          </div>
        </div>
      )}
      {Array.from({ length: count }).map((_, index) => (
        <div
          key={`list-skeleton-${index}`}
          className="panel-raised rounded-lg border border-border p-4 sm:p-6 min-h-[184px] relative overflow-hidden"
        >
          {showAdminDesktop && (
            <div className="absolute top-3 right-3 flex items-center gap-1">
              <span className="skeleton-shimmer motion-safe:animate-pulse h-6 w-6 rounded-sm" />
              <span className="skeleton-shimmer motion-safe:animate-pulse h-6 w-6 rounded-sm" />
            </div>
          )}
          <div className="flex flex-col sm:flex-row gap-4">
            {showAdminDesktop && (
              <span className="skeleton-shimmer motion-safe:animate-pulse mt-1 h-4 w-4 rounded-xs shrink-0" />
            )}
            <div className="skeleton-shimmer motion-safe:animate-pulse w-full sm:w-40 aspect-video sm:aspect-square rounded-lg shrink-0" />
            <div className="flex-1 space-y-3 sm:pr-6">
              <div className="space-y-2">
                <div className="skeleton-shimmer motion-safe:animate-pulse h-6 w-4/5 rounded-sm" />
                <div className="skeleton-shimmer motion-safe:animate-pulse h-6 w-3/5 rounded-sm" />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="skeleton-shimmer motion-safe:animate-pulse h-5 w-16 rounded-full" />
                <span className="skeleton-shimmer motion-safe:animate-pulse h-4 w-24 rounded-sm" />
                <span className="skeleton-shimmer motion-safe:animate-pulse h-4 w-36 rounded-sm" />
              </div>
              <div className="space-y-2 pt-1">
                <div className="skeleton-shimmer motion-safe:animate-pulse h-4 w-full rounded-sm" />
                <div className="skeleton-shimmer motion-safe:animate-pulse h-4 w-5/6 rounded-sm" />
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
