import { redirect } from "next/navigation";
import { Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { ManagementNav } from "@/components/management/management-nav";
import { getAuthContext } from "@/server/context";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { canViewManagement, resolveManagementSections } from "@/modules/management/access";
import { ManagementRepository } from "@/server/repositories/management.repository";
import { maybeAiDigestSummary } from "@/modules/notifications/digest";

export default async function ManagementDigestPage() {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");
  if (!canViewManagement(ctx)) redirect("/");

  const sections = resolveManagementSections(ctx);
  const supabase = await createServerSupabaseClient();
  const snapshot = await new ManagementRepository(supabase).loadSnapshot(ctx.organization.id, ctx.profile.id, sections);

  const facts = {
    asOfDate: snapshot.asOfDate,
    overdueApprovals: snapshot.approvals.overdue,
    projectsNeedingAttention: snapshot.projects.atRisk,
    highRisks: snapshot.risks.filter((r) => r.severity === "HIGH").length,
    criticalRisks: snapshot.risks.filter((r) => r.severity === "CRITICAL").length,
    payrollUnderReview: snapshot.payroll?.underReview ?? 0,
    attendanceExceptions:
      (snapshot.attendance?.late ?? 0) +
      (snapshot.attendance?.absent ?? 0) +
      (snapshot.attendance?.missingCheckout ?? 0),
    attentionTitles: snapshot.attention.slice(0, 8).map((a) => a.titleAr),
  };

  const digest = await maybeAiDigestSummary(facts);

  return (
    <div data-testid="management-digest">
      <PageHeader title="الملخص الإداري اليومي" description="حقائق حتمية من مركز القيادة. الذكاء الاصطناعي اختياري ولا يخترع أرقاماً." />
      <ManagementNav pathname="/management/digest" />
      <Card>
        <p className="mb-3 text-xs text-muted">المصدر: {digest.source === "ai" ? "حتمي + خلاصة مساعدة" : "حتمي فقط"}</p>
        <pre className="whitespace-pre-wrap text-sm leading-7">{digest.text}</pre>
      </Card>
      {snapshot.attention.length === 0 ? (
        <div className="mt-4">
          <EmptyState title="لا عناصر انتباه اليوم." />
        </div>
      ) : null}
    </div>
  );
}
