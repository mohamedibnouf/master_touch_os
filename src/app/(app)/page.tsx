import { Suspense } from "react";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui/primitives";
import { KpiRowSkeleton, TableListSkeleton } from "@/components/ui/skeletons";
import { getAuthContext } from "@/server/context";
import { HomeTodayCards } from "@/components/home/home-today-cards";
import { HomeOpsPanels } from "@/components/home/home-ops-panels";

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
    <div data-testid="employee-home">
      <PageHeader
        title={`مرحباً، ${greetingName}`}
        description={`${displayDate} · ما الذي تحتاج إنجازه اليوم؟`}
      />
      <Suspense fallback={<KpiRowSkeleton count={2} />}>
        <HomeTodayCards ctx={ctx} />
      </Suspense>
      <Suspense fallback={<TableListSkeleton rows={8} />}>
        <HomeOpsPanels ctx={ctx} />
      </Suspense>
    </div>
  );
}
