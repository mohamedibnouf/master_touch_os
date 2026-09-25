import { redirect } from "next/navigation";
import Link from "next/link";
import { Card, PageHeader } from "@/components/ui/primitives";
import { ManagementNav } from "@/components/management/management-nav";
import { MetricGrid } from "@/components/management/management-widgets";
import { getAuthContext } from "@/server/context";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { canViewManagement, resolveManagementSections } from "@/modules/management/access";
import { ManagementRepository } from "@/server/repositories/management.repository";

export default async function ManagementProjectsPage() {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");
  if (!canViewManagement(ctx)) redirect("/");
  const sections = resolveManagementSections(ctx);
  if (!sections.projects) redirect("/management");

  const supabase = await createServerSupabaseClient();
  const snapshot = await new ManagementRepository(supabase).loadSnapshot(
    ctx.organization.id,
    ctx.profile.id,
    { ...sections, procurement: false, finance: false, people: false, attendanceLeave: false, payroll: false, activity: false },
  );

  return (
    <div data-testid="management-projects">
      <PageHeader title="ذكاء المشاريع" description="ملخص حتمي من بيانات المشاريع الحالية" />
      <ManagementNav pathname="/management/projects" />
      <MetricGrid
        metrics={[
          { key: "active", label: "نشطة", value: snapshot.projects.active, href: "/projects" },
          { key: "risk", label: "عالية المخاطر", value: snapshot.projects.atRisk, href: "/projects?risk=high" },
          { key: "overdue", label: "تجاوزت التاريخ المخطط", value: snapshot.projects.overduePlannedEnd, href: "/projects" },
          { key: "hold", label: "معلّقة", value: snapshot.projects.onHold, href: "/projects" },
        ]}
      />
      <Card className="mt-6">
        <p className="text-sm text-muted">
          التفاصيل التشغيلية والمراحل والمرفقات تُدار من{" "}
          <Link href="/projects" className="text-navy underline">
            سجل المشاريع
          </Link>
          — هذه الصفحة ليست مصدراً ثانياً للحقيقة.
        </p>
      </Card>
    </div>
  );
}
