import { PageContainer } from "@/components/layout/page-container";
import { redirect } from "next/navigation";
import { Badge, EmptyState, PageHeader, Section } from "@/components/ui/primitives";
import { ManagementNav } from "@/components/management/management-nav";
import { getAuthContext } from "@/server/context";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { canViewManagement, resolveManagementSections } from "@/modules/management/access";
import { ManagementRepository } from "@/server/repositories/management.repository";
import { maybeAiDigestSummary } from "@/modules/notifications/digest";
import { getI18n } from "@/lib/i18n/server";

export default async function ManagementDigestPage() {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");
  if (!canViewManagement(ctx)) redirect("/");

  const { t, locale } = await getI18n();
  const copy = t.management.digest;

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
    attentionTitles: snapshot.attention.slice(0, 8).map((a) => (locale === "en" ? a.titleEn || a.titleAr : a.titleAr)),
  };

  const digest = await maybeAiDigestSummary(facts, undefined, locale);

  return (
    <PageContainer data-testid="management-digest" className="space-y-5">
      <PageHeader title={copy.title} description={copy.description} />
      <ManagementNav pathname="/management/digest" />
      <Section
        className="border-s-4 border-s-primary"
        title={copy.title}
        actions={
          <Badge tone={digest.source === "ai" ? "info" : "neutral"}>
            {copy.sourceLabel} {digest.source === "ai" ? copy.sourceAi : copy.sourceDeterministic}
          </Badge>
        }
      >
        <pre className="whitespace-pre-wrap font-sans text-sm leading-7 text-ink">{digest.text}</pre>
      </Section>
      {snapshot.attention.length === 0 ? <EmptyState title={copy.empty} /> : null}
    </PageContainer>
  );
}
