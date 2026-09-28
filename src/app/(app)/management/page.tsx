import { PageContainer } from "@/components/layout/page-container";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Card, PageHeader } from "@/components/ui/primitives";
import { ManagementNav } from "@/components/management/management-nav";
import { AttentionList, MetricGrid } from "@/components/management/management-widgets";
import { getAuthContext } from "@/server/context";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { canViewManagement, resolveManagementSections } from "@/modules/management/access";
import { ManagementRepository } from "@/server/repositories/management.repository";
import { payrollPeriodStatusLabel } from "@/lib/hr/labels";

export default async function ManagementOverviewPage() {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");
  if (!canViewManagement(ctx)) redirect("/");

  const sections = resolveManagementSections(ctx);
  const supabase = await createServerSupabaseClient();
  const repo = new ManagementRepository(supabase);
  const snapshot = await repo.loadSnapshot(ctx.organization.id, ctx.profile.id, sections);

  const keyMetrics = [
    sections.projects
      ? { key: "active-projects", label: "مشاريع نشطة", value: snapshot.projects.active, href: "/management/projects" }
      : null,
    sections.approvals
      ? { key: "pending-approvals", label: "موافقات معلّقة", value: snapshot.approvals.pending, href: "/approvals" }
      : null,
    sections.people && snapshot.people
      ? { key: "active-employees", label: "موظفون نشطون", value: snapshot.people.activeEmployees, href: "/employees" }
      : null,
    sections.payroll && snapshot.payroll
      ? {
          key: "payroll-review",
          label: "مسيرات للمراجعة",
          value: snapshot.payroll.underReview,
          href: "/payroll",
        }
      : null,
  ].filter(Boolean) as Array<{ key: string; label: string; value: number; href?: string }>;

  return (
    <PageContainer data-testid="management-overview" className="space-y-5">
      <PageHeader
        title="مركز القيادة التنفيذية"
        description={`ذكاء إداري حتمي — تاريخ المرجع ${snapshot.asOfDate} (آسيا/الرياض). عناصر الانتباه من محرك المخاطر 5.2.`}
      />
      <ManagementNav pathname="/management" />

      <Card className="mb-6" data-testid="management-attention">
        <h2 className="mb-3 font-semibold text-navy">ما يحتاج انتباهك</h2>
        <AttentionList items={snapshot.attention} />
      </Card>

      <div className="mb-6">
        <h2 className="mb-3 font-semibold text-navy">مؤشرات رئيسية</h2>
        <MetricGrid metrics={keyMetrics} />
      </div>

      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        {sections.projects ? (
          <Card>
            <div className="mb-2 flex items-center justify-between gap-2">
              <h3 className="font-semibold text-navy">المشاريع</h3>
              <Link href="/management/projects" className="text-sm text-navy underline">
                التفاصيل
              </Link>
            </div>
            <ul className="space-y-1 text-sm">
              <li>نشطة: {snapshot.projects.active}</li>
              <li>عالية المخاطر: {snapshot.projects.atRisk}</li>
              <li>متجاوزة التاريخ المخطط: {snapshot.projects.overduePlannedEnd}</li>
              <li>معلّقة: {snapshot.projects.onHold}</li>
            </ul>
          </Card>
        ) : null}

        {sections.approvals ? (
          <Card>
            <div className="mb-2 flex items-center justify-between gap-2">
              <h3 className="font-semibold text-navy">الموافقات</h3>
              <Link href="/approvals" className="text-sm text-navy underline">
                فتح
              </Link>
            </div>
            <ul className="space-y-1 text-sm">
              <li>معلّقة: {snapshot.approvals.pending}</li>
              <li>متأخرة: {snapshot.approvals.overdue}</li>
              <li>مسندة إليك: {snapshot.approvals.assignedToMe}</li>
              <li>مرفوضة (14 يوماً): {snapshot.approvals.recentlyRejected}</li>
            </ul>
          </Card>
        ) : null}

        {sections.procurement ? (
          <Card>
            <div className="mb-2 flex items-center justify-between gap-2">
              <h3 className="font-semibold text-navy">المشتريات</h3>
              <Link href="/management/operations" className="text-sm text-navy underline">
                التفاصيل
              </Link>
            </div>
            <ul className="space-y-1 text-sm">
              <li>طلبات شراء للمراجعة: {snapshot.procurement.prAwaitingReview}</li>
              <li>تحتاج مقارنة عروض: {snapshot.procurement.rfqNeedsComparison}</li>
              <li>أوامر جاهزة للإصدار: {snapshot.procurement.poReadyToIssue}</li>
              <li>توريدات متأخرة: {snapshot.procurement.lateDeliveries}</li>
            </ul>
          </Card>
        ) : null}

        {sections.finance && snapshot.commercial ? (
          <Card>
            <div className="mb-2 flex items-center justify-between gap-2">
              <h3 className="font-semibold text-navy">التجاري / العملاء</h3>
              <Link href="/management/finance" className="text-sm text-navy underline">
                التفاصيل
              </Link>
            </div>
            <ul className="space-y-1 text-sm">
              <li>ذمم مفتوحة: {snapshot.commercial.outstandingAr}</li>
              <li>فواتير عملاء متأخرة: {snapshot.commercial.overdueAr}</li>
              <li>فواتير موردين متأخرة: {snapshot.commercial.overdueAp}</li>
              <li>مستخلصات معلّقة: {snapshot.commercial.pendingValuations}</li>
            </ul>
            <p className="mt-2 text-xs text-muted">المبالغ المالية تُعرض فقط في الشاشات التشغيلية حسب صلاحياتك.</p>
          </Card>
        ) : null}

        {sections.people && snapshot.people ? (
          <Card>
            <div className="mb-2 flex items-center justify-between gap-2">
              <h3 className="font-semibold text-navy">الأفراد</h3>
              <Link href="/management/people" className="text-sm text-navy underline">
                التفاصيل
              </Link>
            </div>
            <ul className="space-y-1 text-sm">
              <li>نشطون: {snapshot.people.activeEmployees}</li>
              <li>امتثال خلال 30 يوماً: {snapshot.people.complianceExpiring30d}</li>
              <li>عقود تنتهي خلال 30 يوماً: {snapshot.people.contractsEnding30d}</li>
              <li>في إجازة اليوم: {snapshot.people.onLeaveToday}</li>
            </ul>
          </Card>
        ) : null}

        {sections.attendanceLeave && snapshot.attendance ? (
          <Card>
            <h3 className="mb-2 font-semibold text-navy">الحضور والإجازات</h3>
            <ul className="space-y-1 text-sm">
              <li>حاضرون اليوم: {snapshot.attendance.present}</li>
              <li>متأخرون: {snapshot.attendance.late}</li>
              <li>غائبون: {snapshot.attendance.absent}</li>
              <li>بلا انصراف: {snapshot.attendance.missingCheckout}</li>
              <li>إجازات بانتظار الموافقة: {snapshot.attendance.pendingLeaveApprovals}</li>
            </ul>
          </Card>
        ) : null}

        {sections.payroll && snapshot.payroll ? (
          <Card data-testid="management-payroll-card">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h3 className="font-semibold text-navy">الرواتب</h3>
              <Link href="/payroll" className="text-sm text-navy underline">
                فتح
              </Link>
            </div>
            <ul className="space-y-1 text-sm">
              <li>
                آخر فترة: {snapshot.payroll.latestLabel ?? "—"}{" "}
                {snapshot.payroll.latestStatus
                  ? `(${payrollPeriodStatusLabel(snapshot.payroll.latestStatus)})`
                  : ""}
              </li>
              <li>موظفو آخر فترة: {snapshot.payroll.latestEmployeeCount ?? "—"}</li>
              {sections.payrollAmounts && snapshot.payroll.latestNet != null ? (
                <li data-testid="management-payroll-net">
                  صافي آخر فترة:{" "}
                  {snapshot.payroll.latestNet.toLocaleString("ar-SA", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}{" "}
                  SAR
                </li>
              ) : (
                <li data-testid="management-payroll-net-hidden" className="text-muted">
                  صافي المسير مخفي — يتطلب صلاحية عرض الرواتب.
                </li>
              )}
              <li>بانتظار المراجعة: {snapshot.payroll.underReview}</li>
              <li>معتمدة بانتظار القفل: {snapshot.payroll.approvedAwaitingLock}</li>
              <li>مقفلة غير مصروفة: {snapshot.payroll.lockedUnpaidEntries}</li>
            </ul>
          </Card>
        ) : null}
      </div>

      {sections.activity ? (
        <Card data-testid="management-activity">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="font-semibold text-navy">نشاط حرج حديث</h2>
            <Link href="/management/activity" className="text-sm text-navy underline">
              المزيد
            </Link>
          </div>
          {snapshot.activity.length === 0 ? (
            <p className="text-sm text-muted">لا يوجد سجل تدقيق حديث.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {snapshot.activity.slice(0, 8).map((a) => (
                <li key={a.id} className="flex flex-wrap justify-between gap-2 border-b border-line pb-2">
                  <span>
                    <span className="font-medium text-navy">{a.action}</span>
                    <span className="text-muted"> · {a.entityType}</span>
                  </span>
                  <span className="text-muted tabular-nums">
                    {new Date(a.createdAt).toLocaleString("ar-SA", { timeZone: "Asia/Riyadh" })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : null}
    </PageContainer>
  );
}
