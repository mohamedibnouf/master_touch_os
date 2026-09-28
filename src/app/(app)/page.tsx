import { Suspense } from "react";
import { redirect } from "next/navigation";
import { KpiRowSkeleton, TableListSkeleton } from "@/components/ui/skeletons";
import { PageContainer } from "@/components/layout/page-container";
import { getAuthContext } from "@/server/context";
import { HomeTodayCards } from "@/components/home/home-today-cards";
import { HomeAttentionRail, HomeOpsLower } from "@/components/home/home-ops-panels";

export default async function DashboardPage() {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");

  const greetingName = ctx.profile.full_name_ar || ctx.profile.full_name_en || "مرحباً";
  const displayDate = new Date().toLocaleDateString("ar-SA", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Asia/Riyadh",
  });

  return (
    <PageContainer data-testid="employee-home" className="space-y-4 md:space-y-5">
      <header className="flex min-w-0 flex-col gap-2 rounded-[var(--radius-surface)] border border-navy/10 bg-navy/[0.04] px-4 py-3 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold tracking-[0.16em] text-bronze">MASTER TOUCH</p>
          <h1 className="mt-1 text-xl font-semibold leading-relaxed text-navy">
            مرحباً، <span dir="auto">{greetingName}</span>
          </h1>
          <p className="mt-0.5 text-sm text-muted">ماذا يحتاج انتباهك اليوم؟</p>
        </div>
        <p className="shrink-0 text-sm font-medium text-navy">{displayDate}</p>
      </header>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-12 xl:items-stretch xl:gap-5">
        <div className="min-w-0 xl:col-span-8">
          <Suspense fallback={<KpiRowSkeleton count={1} />}>
            <HomeTodayCards ctx={ctx} />
          </Suspense>
        </div>
        <div className="min-w-0 xl:col-span-4">
          <Suspense fallback={<KpiRowSkeleton count={1} />}>
            <HomeAttentionRail ctx={ctx} />
          </Suspense>
        </div>
        <div className="min-w-0 xl:col-span-12">
          <Suspense fallback={<TableListSkeleton rows={6} />}>
            <HomeOpsLower ctx={ctx} />
          </Suspense>
        </div>
      </div>
    </PageContainer>
  );
}
