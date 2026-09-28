export function SkeletonPulse({ className }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-line/80 ${className ?? ""}`} />;
}

export function PageHeaderSkeleton() {
  return (
    <div className="mb-6 space-y-2">
      <SkeletonPulse className="h-7 w-40 max-w-full" />
      <SkeletonPulse className="h-4 w-72 max-w-full" />
    </div>
  );
}

export function KpiRowSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="mt-surface p-4 md:p-5">
          <SkeletonPulse className="h-3 w-24" />
          <SkeletonPulse className="mt-3 h-8 w-16" />
        </div>
      ))}
    </div>
  );
}

export function TableListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="mt-surface overflow-hidden">
      <div className="space-y-3 p-4">
        {Array.from({ length: rows }).map((_, i) => (
          <SkeletonPulse key={i} className="h-10 w-full" />
        ))}
      </div>
    </div>
  );
}

export function DetailCardSkeleton() {
  return (
    <div className="rounded-lg border border-line bg-card p-4 md:p-5">
      <SkeletonPulse className="h-5 w-48 max-w-full" />
      <SkeletonPulse className="mt-4 h-4 w-full" />
      <SkeletonPulse className="mt-2 h-4 w-5/6" />
      <SkeletonPulse className="mt-2 h-4 w-2/3" />
    </div>
  );
}

export function FormSkeleton() {
  return (
    <div className="rounded-lg border border-line bg-card p-4 md:p-5">
      <SkeletonPulse className="mb-4 h-5 w-32" />
      <div className="grid gap-3 md:grid-cols-2">
        <SkeletonPulse className="h-11 w-full" />
        <SkeletonPulse className="h-11 w-full" />
        <SkeletonPulse className="h-11 w-full" />
        <SkeletonPulse className="h-11 w-full" />
      </div>
    </div>
  );
}

export function PageRouteSkeleton() {
  return (
    <div data-testid="route-loading" role="status" aria-live="polite" aria-label="جارٍ التحميل">
      <span className="sr-only">جارٍ التحميل…</span>
      <PageHeaderSkeleton />
      <KpiRowSkeleton />
      <TableListSkeleton />
    </div>
  );
}
