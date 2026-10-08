import { PageContainer } from "@/components/layout/page-container";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Card, PageHeader } from "@/components/ui/primitives";
import { ManagementNav } from "@/components/management/management-nav";
import { MetricGrid, RiskFindingsList } from "@/components/management/management-widgets";
import { getAuthContext } from "@/server/context";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { canViewManagement, resolveManagementSections } from "@/modules/management/access";
import { ManagementRepository } from "@/server/repositories/management.repository";
import {
  countByCategory,
  countBySeverity,
  filterFindings,
} from "@/modules/management/risk/engine";
import type { ManagementRiskCategory, ManagementRiskSeverity } from "@/modules/management/types";
import { loadGuardianFindingsForViewer } from "@/server/use-cases/guardian";
import { GuardianFindingsPanel } from "@/components/management/guardian-findings";

const SEVERITIES: ManagementRiskSeverity[] = ["CRITICAL", "HIGH", "MEDIUM", "LOW"];
const CATEGORIES: ManagementRiskCategory[] = [
  "PROJECT_DELAY",
  "APPROVAL_DELAY",
  "PROCUREMENT",
  "COMMERCIAL",
  "HR",
  "ATTENDANCE",
  "LEAVE",
  "PAYROLL",
  "COMPLIANCE",
];

type SearchParams = Promise<{ severity?: string; category?: string }>;

export default async function ManagementRisksPage({
  searchParams,
}: {
  searchParams?: SearchParams;
}) {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");
  if (!canViewManagement(ctx)) redirect("/");

  const sp = searchParams ? await searchParams : {};
  const severityFilter =
    sp.severity && SEVERITIES.includes(sp.severity as ManagementRiskSeverity)
      ? (sp.severity as ManagementRiskSeverity)
      : null;
  const categoryFilter =
    sp.category && CATEGORIES.includes(sp.category as ManagementRiskCategory)
      ? (sp.category as ManagementRiskCategory)
      : null;

  const sections = resolveManagementSections(ctx);
  const supabase = await createServerSupabaseClient();
  // Risks page only needs rule inputs — skip ECC head-count fan-out.
  const { asOfDate, risks } = await new ManagementRepository(supabase).loadRiskFindings(
    ctx.organization.id,
    sections,
  );
  let guardian: Awaited<ReturnType<typeof loadGuardianFindingsForViewer>> | null = null;
  try {
    guardian = await loadGuardianFindingsForViewer();
  } catch {
    guardian = null;
  }

  const filtered = filterFindings(risks, {
    severity: severityFilter,
    category: categoryFilter,
  });
  const bySeverity = countBySeverity(risks);
  const byCategory = countByCategory(risks);

  const severityMetrics = SEVERITIES.map((s) => ({
    key: `sev-${s}`,
    label: s,
    value: bySeverity[s],
    href: `/management/risks?severity=${s}`,
  }));

  function filterHref(next: { severity?: string | null; category?: string | null }) {
    const q = new URLSearchParams();
    const sev = next.severity === undefined ? severityFilter : next.severity;
    const cat = next.category === undefined ? categoryFilter : next.category;
    if (sev) q.set("severity", sev);
    if (cat) q.set("category", cat);
    const qs = q.toString();
    return qs ? `/management/risks?${qs}` : "/management/risks";
  }

  return (
    <PageContainer data-testid="management-risks" className="space-y-5">
      <PageHeader
        title="محرك المخاطر"
        description={`نتائج حتمية مبنية على قواعد صريحة — ${asOfDate} (آسيا/الرياض). ليست تنبؤات ذكاء اصطناعي.`}
      />
      <ManagementNav pathname="/management/risks" />

      <div className="mb-4" data-testid="management-risks-totals">
        <MetricGrid
          metrics={[
            {
              key: "total-findings",
              label: "إجمالي النتائج",
              value: risks.length,
              href: "/management/risks",
            },
            ...severityMetrics,
          ]}
        />
      </div>

      <Card className="mb-4" data-testid="management-risks-filters">
        <h2 className="mb-3 font-semibold text-navy">تصفية</h2>
        <div className="flex flex-wrap gap-2">
          <Link
            href={filterHref({ severity: null })}
            className={`rounded-[var(--radius-control)] px-3 py-1.5 text-sm ${!severityFilter ? "bg-primary/10 font-medium text-primary" : "bg-surface-muted text-ink"}`}
            data-testid="filter-severity-all"
          >
            كل الشدّة
          </Link>
          {SEVERITIES.map((s) => (
            <Link
              key={s}
              href={filterHref({ severity: s })}
              className={`rounded-[var(--radius-control)] px-3 py-1.5 text-sm ${severityFilter === s ? "bg-primary/10 font-medium text-primary" : "bg-surface-muted text-ink"}`}
              data-testid={`filter-severity-${s}`}
            >
              {s} ({bySeverity[s]})
            </Link>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Link
            href={filterHref({ category: null })}
            className={`rounded-[var(--radius-control)] px-3 py-1.5 text-sm ${!categoryFilter ? "bg-primary/10 font-medium text-primary" : "bg-surface-muted text-ink"}`}
            data-testid="filter-category-all"
          >
            كل الفئات
          </Link>
          {CATEGORIES.filter((c) => (byCategory[c] ?? 0) > 0 || categoryFilter === c).map((c) => (
            <Link
              key={c}
              href={filterHref({ category: c })}
              className={`rounded-[var(--radius-control)] px-3 py-1.5 text-sm ${categoryFilter === c ? "bg-primary/10 font-medium text-primary" : "bg-surface-muted text-ink"}`}
              data-testid={`filter-category-${c}`}
            >
              {c} ({byCategory[c] ?? 0})
            </Link>
          ))}
        </div>
      </Card>

      {guardian?.schemaReady ? (
        <Card data-testid="guardian-register">
          <h2 className="mb-3 font-semibold text-navy">سجل الحارس (نتائج دائمة)</h2>
          <GuardianFindingsPanel findings={guardian.findings} lastScan={guardian.lastScan} alerts={guardian.alerts} />
        </Card>
      ) : null}

      <Card>
        <h2 className="mb-3 font-semibold text-navy">
          النتائج ({filtered.length}
          {severityFilter || categoryFilter ? ` من ${risks.length}` : ""})
        </h2>
        <RiskFindingsList findings={filtered} />
      </Card>
    </PageContainer>
  );
}
