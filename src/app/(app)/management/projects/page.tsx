import { PageContainer } from "@/components/layout/page-container";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Info } from "lucide-react";
import { Card, PageHeader } from "@/components/ui/primitives";
import { ManagementNav } from "@/components/management/management-nav";
import { MetricGrid } from "@/components/management/management-widgets";
import { getAuthContext } from "@/server/context";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { canViewManagement, resolveManagementSections } from "@/modules/management/access";
import { ManagementRepository } from "@/server/repositories/management.repository";
import { getI18n } from "@/lib/i18n/server";

export default async function ManagementProjectsPage() {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");
  if (!canViewManagement(ctx)) redirect("/");
  const sections = resolveManagementSections(ctx);
  if (!sections.projects) redirect("/management");

  const { t } = await getI18n();
  const copy = t.management.projects;

  const supabase = await createServerSupabaseClient();
  const snapshot = await new ManagementRepository(supabase).loadSnapshot(
    ctx.organization.id,
    ctx.profile.id,
    { ...sections, procurement: false, finance: false, people: false, attendanceLeave: false, payroll: false, activity: false },
  );

  return (
    <PageContainer data-testid="management-projects" className="space-y-5">
      <PageHeader title={copy.title} description={copy.description} />
      <ManagementNav pathname="/management/projects" />
      <MetricGrid
        metrics={[
          { key: "active", label: copy.active, value: snapshot.projects.active, href: "/projects", tone: "info" },
          {
            key: "risk",
            label: copy.atRisk,
            value: snapshot.projects.atRisk,
            href: "/projects?risk=high",
            tone: snapshot.projects.atRisk > 0 ? "danger" : "neutral",
          },
          {
            key: "overdue",
            label: copy.overdue,
            value: snapshot.projects.overduePlannedEnd,
            href: "/projects",
            tone: snapshot.projects.overduePlannedEnd > 0 ? "warning" : "neutral",
          },
          { key: "hold", label: copy.onHold, value: snapshot.projects.onHold, href: "/projects" },
        ]}
      />
      <Card className="flex items-start gap-3 bg-surface-muted text-sm text-muted">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
        <p>
          {copy.notePrefix}{" "}
          <Link href="/projects" className="font-medium text-primary hover:underline">
            {copy.noteLink}
          </Link>{" "}
          {copy.noteSuffix}
        </p>
      </Card>
    </PageContainer>
  );
}
