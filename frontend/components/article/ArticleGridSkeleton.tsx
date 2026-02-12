interface ArticleGridSkeletonProps {
  count?: number;
  className?: string;
}

export default function ArticleGridSkeleton({
  count = 6,
  className = '',
}: ArticleGridSkeletonProps) {
  return (
    <div
      className={`mt-4 grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 motion-safe:animate-pulse ${className}`.trim()}
      aria-live="polite"
      aria-busy="true"
    >
      {Array.from({ length: count }).map((_, index) => (
        <div
          key={`article-grid-skeleton-${index}`}
          className="overflow-hidden rounded-2xl border border-border-strong bg-surface/80 shadow-sm"
        >
          <div className="aspect-video w-full skeleton-shimmer" />
          <div className="space-y-3 p-4">
            <div className="h-4 w-4/5 rounded skeleton-shimmer" />
            <div className="h-3 w-2/3 rounded skeleton-shimmer" />
            <div className="h-3 w-full rounded skeleton-shimmer" />
            <div className="h-3 w-3/4 rounded skeleton-shimmer" />
          </div>
        </div>
      ))}
    </div>
  );
}
