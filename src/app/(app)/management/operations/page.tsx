import { PageContainer } from "@/components/layout/page-container";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Card, PageHeader } from "@/components/ui/primitives";
import { ManagementNav } from "@/components/management/management-nav";
import { MetricGrid } from "@/components/management/management-widgets";
import { getAuthContext } from "@/server/context";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { canViewManagement, resolveManagementSections } from "@/modules/management/access";
import { ManagementRepository } from "@/server/repositories/management.repository";

export default async function ManagementOperationsPage() {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");
  if (!canViewManagement(ctx)) redirect("/");
  const sections = resolveManagementSections(ctx);
  if (!sections.approvals && !sections.procurement) redirect("/management");

  const supabase = await createServerSupabaseClient();
  const snapshot = await new ManagementRepository(supabase).loadSnapshot(
    ctx.organization.id,
    ctx.profile.id,
    {
      ...sections,
      projects: false,
      finance: false,
      people: false,
      attendanceLeave: false,
      payroll: false,
      activity: false,
    },
  );

  const metrics = [
    ...(sections.approvals
      ? [
          { key: "appr-pending", label: "موافقات معلّقة", value: snapshot.approvals.pending, href: "/approvals" },
          { key: "appr-overdue", label: "موافقات متأخرة", value: snapshot.approvals.overdue, href: "/approvals?overdue=1" },
        ]
      : []),
    ...(sections.procurement
      ? [
          { key: "pr", label: "طلبات شراء للمراجعة", value: snapshot.procurement.prAwaitingReview, href: "/procurement/purchase-requests" },
          { key: "rfq", label: "تحتاج مقارنة", value: snapshot.procurement.rfqNeedsComparison, href: "/procurement/rfqs" },
          { key: "po", label: "أوامر جاهزة", value: snapshot.procurement.poReadyToIssue, href: "/procurement/purchase-orders" },
          { key: "late", label: "توريدات متأخرة", value: snapshot.procurement.lateDeliveries, href: "/procurement/purchase-orders" },
        ]
      : []),
  ];

  return (
    <PageContainer data-testid="management-operations" className="space-y-5">
      <PageHeader title="ذكاء العمليات" description="موافقات ومشتريات — ملخص حتمي" />
      <ManagementNav pathname="/management/operations" />
      <MetricGrid metrics={metrics} />
      <Card className="mt-6 text-sm text-muted">
        انتقل إلى{" "}
        <Link href="/approvals" className="text-navy underline">
          الموافقات
        </Link>{" "}
        أو{" "}
        <Link href="/procurement" className="text-navy underline">
          المشتريات
        </Link>{" "}
        للتنفيذ.
      </Card>
    </PageContainer>
  );
}
