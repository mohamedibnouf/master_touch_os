import { PageContainer } from "@/components/layout/page-container";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { Card, PageHeader } from "@/components/ui/primitives";
import { ManagementNav } from "@/components/management/management-nav";
import { MetricGrid, type ManagementMetric } from "@/components/management/management-widgets";
import { getAuthContext } from "@/server/context";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { canViewManagement, resolveManagementSections } from "@/modules/management/access";
import { ManagementRepository } from "@/server/repositories/management.repository";
import { getI18n } from "@/lib/i18n/server";

export default async function ManagementPeoplePage() {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");
  if (!canViewManagement(ctx)) redirect("/");
  const sections = resolveManagementSections(ctx);
  if (!sections.people && !sections.attendanceLeave) redirect("/management");

  const { t } = await getI18n();
  const copy = t.management.people;

  const supabase = await createServerSupabaseClient();
  const snapshot = await new ManagementRepository(supabase).loadSnapshot(
    ctx.organization.id,
    ctx.profile.id,
    {
      ...sections,
      projects: false,
      approvals: false,
      procurement: false,
      finance: false,
      payroll: false,
      activity: false,
    },
  );

  const hot = (value: number, tone: ManagementMetric["tone"] = "warning"): ManagementMetric["tone"] =>
    value > 0 ? tone : "neutral";

  const metrics: ManagementMetric[] = [
    ...(sections.people && snapshot.people
      ? [
          {
            key: "emp",
            label: copy.activeEmployees,
            value: snapshot.people.activeEmployees,
            href: "/employees",
            tone: "info" as const,
          },
          {
            key: "comp",
            label: copy.compliance30d,
            value: snapshot.people.complianceExpiring30d,
            href: "/employees",
            tone: hot(snapshot.people.complianceExpiring30d),
          },
          {
            key: "contracts",
            label: copy.contracts30d,
            value: snapshot.people.contractsEnding30d,
            href: "/employees",
            tone: hot(snapshot.people.contractsEnding30d),
          },
          { key: "onleave", label: copy.onLeaveToday, value: snapshot.people.onLeaveToday, href: "/leave" },
        ]
      : []),
    ...(sections.attendanceLeave && snapshot.attendance
      ? [
          {
            key: "present",
            label: copy.presentToday,
            value: snapshot.attendance.present,
            href: "/hr/attendance",
            tone: "success" as const,
          },
          {
            key: "absent",
            label: copy.absent,
            value: snapshot.attendance.absent,
            href: "/hr/attendance",
            tone: hot(snapshot.attendance.absent, "danger"),
          },
          {
            key: "mco",
            label: copy.missingCheckout,
            value: snapshot.attendance.missingCheckout,
            href: "/hr/attendance",
            tone: hot(snapshot.attendance.missingCheckout),
          },
          {
            key: "leave-pend",
            label: copy.pendingLeave,
            value: snapshot.attendance.pendingLeaveApprovals,
            href: "/hr/leave",
          },
        ]
      : []),
  ];

  return (
    <PageContainer data-testid="management-people" className="space-y-5">
      <PageHeader title={copy.title} description={copy.description} />
      <ManagementNav pathname="/management/people" />
      <MetricGrid metrics={metrics} />
      <Card className="flex items-start gap-3 bg-surface-muted text-sm text-muted">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
        <p>
          {copy.notePrefix}{" "}
          <Link href="/employees" className="font-medium text-primary hover:underline">
            {copy.noteLink}
          </Link>{" "}
          {copy.noteSuffix}
        </p>
      </Card>
    </PageContainer>
  );
}
