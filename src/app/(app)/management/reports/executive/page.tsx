import { redirect } from "next/navigation";
import Link from "next/link";
import { Card } from "@/components/ui/primitives";
import { ManagementNav } from "@/components/management/management-nav";
import {
  DecisionBriefView,
  ReportChrome,
  ReportMetricGrid,
  ReportRiskSection,
} from "@/components/management/report-chrome";
import { AttentionList } from "@/components/management/management-widgets";
import { getAuthContext } from "@/server/context";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { canViewManagement, resolveManagementSections } from "@/modules/management/access";
import { ManagementRepository } from "@/server/repositories/management.repository";
import { createReportContext } from "@/modules/management/reports/context";
import { buildExecutiveReport } from "@/modules/management/reports/builders";

export default async function ExecutiveReportPage() {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");
  if (!canViewManagement(ctx)) redirect("/");

  const sections = resolveManagementSections(ctx);
  const supabase = await createServerSupabaseClient();
  const repo = new ManagementRepository(supabase);
  const snapshot = await repo.loadSnapshot(ctx.organization.id, ctx.profile.id, sections);
  const context = createReportContext(ctx, sections);
  const report = buildExecutiveReport({ context, snapshot });

  return (
    <div data-testid="management-report-executive">
      <div className="print:hidden">
        <ManagementNav pathname="/management/reports" />
      </div>
      <ReportChrome title="الملخص التنفيذي" context={report.context}>
        <p className="mb-4 text-sm text-muted">{report.freshnessNoteAr}</p>
        <div className="mb-6">
          <ReportMetricGrid metrics={report.metrics} />
        </div>
        <div className="mb-6">
          <DecisionBriefView sections={report.decisionBrief} />
        </div>
        <Card className="mb-6" data-testid="executive-attention">
          <h2 className="mb-3 font-semibold text-navy">انتباه مطلوب</h2>
          <AttentionList items={report.attention} />
        </Card>
        <ReportRiskSection findings={report.topRisks} title="أعلى المخاطر الحالية" />
        {sections.activity ? (
          <Card className="mt-4 break-inside-avoid" data-testid="executive-activity">
            <h2 className="mb-3 font-semibold text-navy">نشاط حديث (محدود)</h2>
            {report.activity.length === 0 ? (
              <p className="text-sm text-muted">لا يوجد سجل تدقيق حديث.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {report.activity.map((a) => (
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
            <p className="mt-2 text-xs text-muted">
              نافذة سجل التدقيق محدودة — ليست إعادة بناء تاريخية كاملة.{" "}
              <Link href="/management/activity" className="underline">
                المزيد
              </Link>
            </p>
          </Card>
        ) : null}
      </ReportChrome>
    </div>
  );
}
