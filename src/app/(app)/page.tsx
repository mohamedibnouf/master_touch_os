import { PageContainer } from "@/components/layout/page-container";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { KpiRowSkeleton, TableListSkeleton } from "@/components/ui/skeletons";
import { getAuthContext } from "@/server/context";
import { HomeTodayCards } from "@/components/home/home-today-cards";
import { HomeAttentionRail, HomeOpsLower } from "@/components/home/home-ops-panels";
import { HomeDashboardViz } from "@/components/home/home-dashboard-viz";
import { loadDashboardViz } from "@/server/use-cases/dashboard-viz";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { ManagementAiInsights } from "@/components/ai/management-ai-insights";
import { canViewManagementAi } from "@/modules/ai/security/permissions";
import { getAiPlatformConfig } from "@/modules/ai/config-env";
import { getManagementInsightFactsAction } from "@/server/use-cases/ai-platform";

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

  const supabase = await createServerSupabaseClient();
  const viz = await loadDashboardViz(ctx, supabase);
  const showAi = canViewManagementAi(ctx);
  const aiStatus = showAi ? getAiPlatformConfig() : null;
  const insightFacts = showAi ? await getManagementInsightFactsAction() : null;

  return (
    <PageContainer data-testid="employee-home" className="space-y-4 md:space-y-5">
      <header className="flex min-w-0 flex-col gap-1 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight text-ink">
            مرحباً، <span dir="auto">{greetingName}</span>
          </h1>
          <p className="mt-1 text-sm text-muted">ماذا يحتاج انتباهك اليوم؟</p>
        </div>
        <p className="shrink-0 text-sm text-muted">{displayDate}</p>
      </header>

      {viz ? <HomeDashboardViz viz={viz} /> : null}

      {insightFacts?.ok ? (
        <ManagementAiInsights enabled={Boolean(aiStatus?.enabled)} initialFacts={insightFacts.data.facts} />
      ) : null}

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
