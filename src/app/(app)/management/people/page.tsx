import { redirect } from "next/navigation";
import Link from "next/link";
import { Card, PageHeader } from "@/components/ui/primitives";
import { ManagementNav } from "@/components/management/management-nav";
import { MetricGrid } from "@/components/management/management-widgets";
import { getAuthContext } from "@/server/context";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { canViewManagement, resolveManagementSections } from "@/modules/management/access";
import { ManagementRepository } from "@/server/repositories/management.repository";

export default async function ManagementPeoplePage() {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");
  if (!canViewManagement(ctx)) redirect("/");
  const sections = resolveManagementSections(ctx);
  if (!sections.people && !sections.attendanceLeave) redirect("/management");

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

  const metrics = [
    ...(sections.people && snapshot.people
      ? [
          { key: "emp", label: "موظفون نشطون", value: snapshot.people.activeEmployees, href: "/employees" },
          { key: "comp", label: "امتثال خلال 30 يوماً", value: snapshot.people.complianceExpiring30d, href: "/employees" },
          { key: "contracts", label: "عقود تنتهي خلال 30 يوماً", value: snapshot.people.contractsEnding30d, href: "/employees" },
          { key: "onleave", label: "في إجازة اليوم", value: snapshot.people.onLeaveToday, href: "/leave" },
        ]
      : []),
    ...(sections.attendanceLeave && snapshot.attendance
      ? [
          { key: "present", label: "حاضرون اليوم", value: snapshot.attendance.present, href: "/hr/attendance" },
          { key: "absent", label: "غائبون", value: snapshot.attendance.absent, href: "/hr/attendance" },
          { key: "mco", label: "بلا انصراف", value: snapshot.attendance.missingCheckout, href: "/hr/attendance" },
          { key: "leave-pend", label: "إجازات معلّقة", value: snapshot.attendance.pendingLeaveApprovals, href: "/hr/leave" },
        ]
      : []),
  ];

  return (
    <div data-testid="management-people">
      <PageHeader title="ذكاء الأفراد" description="ملخص آمن — بدون رواتب أو بيانات بنكية" />
      <ManagementNav pathname="/management/people" />
      <MetricGrid metrics={metrics} />
      <Card className="mt-6 text-sm text-muted">
        لا تُعرض هنا أرقام التعويض أو الآيبان أو صافي الرواتب الفردية. التفاصيل الحساسة عبر{" "}
        <Link href="/employees" className="text-navy underline">
          سجل الموظفين
        </Link>{" "}
        حسب الصلاحية فقط.
      </Card>
    </div>
  );
}
