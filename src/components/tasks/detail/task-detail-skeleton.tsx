"use client";

import { SkeletonPulse } from "@/components/ui/skeletons";
import { useI18n } from "@/lib/i18n/client";

/** Route skeleton shaped like the task detail page (header, main column, side panel). */
export function TaskDetailSkeleton() {
  const { t } = useI18n();
  return (
    <div data-testid="route-loading" role="status" aria-live="polite" aria-label={t.common.loading}>
      <span className="sr-only">{t.common.loading}</span>
      <SkeletonPulse className="mb-4 h-3 w-64 max-w-full" />
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <SkeletonPulse className="h-8 w-96 max-w-full" />
        <div className="flex gap-2">
          <SkeletonPulse className="h-9 w-32 rounded-full" />
          <SkeletonPulse className="h-9 w-28 rounded-full" />
          <SkeletonPulse className="h-9 w-9" />
        </div>
      </div>
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_21rem] xl:grid-cols-[minmax(0,1fr)_23rem]">
        <div className="space-y-5">
          <div className="mt-surface p-5">
            <SkeletonPulse className="h-4 w-24" />
            <SkeletonPulse className="mt-4 h-4 w-full" />
            <SkeletonPulse className="mt-2 h-4 w-5/6" />
            <SkeletonPulse className="mt-2 h-4 w-2/3" />
          </div>
          <div className="mt-surface space-y-3 p-5">
            <SkeletonPulse className="h-4 w-28" />
            <SkeletonPulse className="h-10 w-full" />
            <SkeletonPulse className="h-10 w-full" />
          </div>
          <div className="mt-surface space-y-4 p-5">
            <SkeletonPulse className="h-4 w-24" />
            {[0, 1].map((i) => (
              <div key={i} className="flex gap-3">
                <SkeletonPulse className="h-8 w-8 rounded-full" />
                <SkeletonPulse className="h-14 flex-1" />
              </div>
            ))}
          </div>
        </div>
        <div className="space-y-5">
          <div className="mt-surface p-4">
            <SkeletonPulse className="h-4 w-28" />
            <div className="mt-4 flex items-center justify-between gap-4">
              <SkeletonPulse className="h-8 w-28" />
              <SkeletonPulse className="h-12 w-32 rounded-full" />
            </div>
          </div>
          <div className="mt-surface space-y-3 p-4">
            <SkeletonPulse className="h-4 w-24" />
            <SkeletonPulse className="h-8 w-full" />
          </div>
          <div className="mt-surface space-y-3 p-4">
            <SkeletonPulse className="h-4 w-20" />
            <SkeletonPulse className="h-9 w-full" />
            <SkeletonPulse className="h-9 w-full" />
          </div>
        </div>
      </div>
    </div>
  );
}
