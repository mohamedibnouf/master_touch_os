import { PageContainer } from "@/components/layout/page-container";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Info } from "lucide-react";
import { Card, PageHeader } from "@/components/ui/primitives";
import { ManagementNav } from "@/components/management/management-nav";
import { MetricGrid, type ManagementMetric } from "@/components/management/management-widgets";
import { getAuthContext } from "@/server/context";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { canViewManagement, resolveManagementSections } from "@/modules/management/access";
import { ManagementRepository } from "@/server/repositories/management.repository";
import { getI18n } from "@/lib/i18n/server";

export default async function ManagementOperationsPage() {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");
  if (!canViewManagement(ctx)) redirect("/");
  const sections = resolveManagementSections(ctx);
  if (!sections.approvals && !sections.procurement) redirect("/management");

  const { t } = await getI18n();
  const copy = t.management.operations;

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

  const hot = (value: number, tone: ManagementMetric["tone"]): ManagementMetric["tone"] =>
    value > 0 ? tone : "neutral";

  const metrics: ManagementMetric[] = [
    ...(sections.approvals
      ? [
          {
            key: "appr-pending",
            label: copy.approvalsPending,
            value: snapshot.approvals.pending,
            href: "/approvals",
            tone: "info" as const,
          },
          {
            key: "appr-overdue",
            label: copy.approvalsOverdue,
            value: snapshot.approvals.overdue,
            href: "/approvals?overdue=1",
            tone: hot(snapshot.approvals.overdue, "danger"),
          },
        ]
      : []),
    ...(sections.procurement
      ? [
          {
            key: "pr",
            label: copy.prAwaitingReview,
            value: snapshot.procurement.prAwaitingReview,
            href: "/procurement/purchase-requests",
          },
          {
            key: "rfq",
            label: copy.rfqNeedsComparison,
            value: snapshot.procurement.rfqNeedsComparison,
            href: "/procurement/rfqs",
          },
          {
            key: "po",
            label: copy.poReady,
            value: snapshot.procurement.poReadyToIssue,
            href: "/procurement/purchase-orders",
          },
          {
            key: "late",
            label: copy.lateDeliveries,
            value: snapshot.procurement.lateDeliveries,
            href: "/procurement/purchase-orders",
            tone: hot(snapshot.procurement.lateDeliveries, "danger"),
          },
        ]
      : []),
  ];

  return (
    <PageContainer data-testid="management-operations" className="space-y-5">
      <PageHeader title={copy.title} description={copy.description} />
      <ManagementNav pathname="/management/operations" />
      <MetricGrid metrics={metrics} />
      <Card className="flex items-start gap-3 bg-surface-muted text-sm text-muted">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
        <p>
          {copy.notePrefix}{" "}
          <Link href="/approvals" className="font-medium text-primary hover:underline">
            {copy.noteApprovals}
          </Link>{" "}
          {copy.noteOr}{" "}
          <Link href="/procurement" className="font-medium text-primary hover:underline">
            {copy.noteProcurement}
          </Link>{" "}
          {copy.noteSuffix}
        </p>
      </Card>
    </PageContainer>
  );
}
