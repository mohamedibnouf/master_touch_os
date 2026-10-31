"use client";

import { SkeletonPulse } from "@/components/ui/skeletons";
import { useI18n } from "@/lib/i18n/client";

/** Route skeleton for /tasks: panel + header + filter bar + grouped rows. */
export function TasksWorkspaceSkeleton() {
  const { t } = useI18n();
  return (
    <div
      data-testid="route-loading"
      role="status"
      aria-live="polite"
      aria-label={t.common.loading}
      className="lg:grid lg:grid-cols-[16.5rem_minmax(0,1fr)] lg:items-start lg:gap-5"
    >
      <span className="sr-only">{t.common.loading}</span>
      <div className="mt-surface hidden space-y-2.5 p-3 lg:block">
        <SkeletonPulse className="h-8 w-full" />
        <SkeletonPulse className="h-8 w-full" />
        <SkeletonPulse className="mt-4 h-3 w-20" />
        {Array.from({ length: 6 }).map((_, i) => (
          <SkeletonPulse key={i} className={i % 3 === 0 ? "h-7 w-3/4" : "ms-5 h-6 w-2/3"} />
        ))}
      </div>
      <div className="min-w-0 space-y-4">
        <SkeletonPulse className="h-9 w-40 lg:hidden" />
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-2">
            <SkeletonPulse className="h-3 w-24" />
            <SkeletonPulse className="h-7 w-48" />
            <SkeletonPulse className="h-4 w-72 max-w-full" />
          </div>
          <SkeletonPulse className="h-9 w-64 max-w-full" />
        </div>
        <div className="flex flex-wrap gap-2">
          <SkeletonPulse className="h-9 min-w-[12rem] flex-1" />
          <SkeletonPulse className="h-9 w-32" />
          <SkeletonPulse className="h-9 w-32" />
          <SkeletonPulse className="h-9 w-32" />
        </div>
        <SkeletonPulse className="h-[3.25rem] w-full rounded-xl" />
        {[4, 3].map((rows, g) => (
          <div key={g} className="mt-surface overflow-hidden p-0">
            <div className="flex items-center gap-2 px-4 py-3">
              <SkeletonPulse className="h-5 w-24 rounded-full" />
            </div>
            <div className="divide-y divide-line border-t border-line">
              {Array.from({ length: rows }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 px-4 py-3.5">
                  <SkeletonPulse className="size-5 rounded-full" />
                  <SkeletonPulse className="h-4 flex-1" />
                  <SkeletonPulse className="hidden h-4 w-16 sm:block" />
                  <SkeletonPulse className="hidden h-4 w-16 sm:block" />
                  <SkeletonPulse className="size-6 rounded-full" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
