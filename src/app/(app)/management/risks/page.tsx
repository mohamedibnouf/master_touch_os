import { PageContainer } from "@/components/layout/page-container";
import { redirect } from "next/navigation";
import Link from "next/link";
import { PageHeader, Section } from "@/components/ui/primitives";
import { ManagementNav } from "@/components/management/management-nav";
import {
  MetricGrid,
  RiskFindingsList,
  categoryLabel,
  severityLabel,
  type ManagementMetric,
} from "@/components/management/management-widgets";
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
import { format } from "@/lib/i18n/config";
import { getI18n } from "@/lib/i18n/server";
import { cn } from "@/lib/utils";

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

const SEVERITY_METRIC_TONE: Record<ManagementRiskSeverity, ManagementMetric["tone"]> = {
  CRITICAL: "danger",
  HIGH: "danger",
  MEDIUM: "warning",
  LOW: "neutral",
};

type SearchParams = Promise<{ severity?: string; category?: string }>;

function chipClass(active: boolean) {
  return cn(
    "rounded-full border px-3 py-1 text-sm transition-colors",
    active
      ? "border-primary/30 bg-primary-soft font-medium text-primary"
      : "border-line bg-surface text-ink hover:border-border-strong hover:bg-surface-muted",
  );
}

export default async function ManagementRisksPage({
  searchParams,
}: {
  searchParams?: SearchParams;
}) {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");
  if (!canViewManagement(ctx)) redirect("/");

  const { t } = await getI18n();
  const copy = t.management.risks;

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

  const severityMetrics: ManagementMetric[] = SEVERITIES.map((s) => ({
    key: `sev-${s}`,
    label: severityLabel(t, s),
    value: bySeverity[s],
    href: `/management/risks?severity=${s}`,
    tone: bySeverity[s] > 0 ? SEVERITY_METRIC_TONE[s] : "neutral",
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
        title={copy.title}
        description={format(copy.description, { date: asOfDate, tz: t.management.common.riyadhTz })}
      />
      <ManagementNav pathname="/management/risks" />

      <div data-testid="management-risks-totals">
        <MetricGrid
          metrics={[
            {
              key: "total-findings",
              label: copy.totalFindings,
              value: risks.length,
              href: "/management/risks",
              tone: "info",
            },
            ...severityMetrics,
          ]}
        />
      </div>

      <div data-testid="management-risks-filters">
        <Section title={copy.filterTitle}>
          <div className="flex flex-wrap items-center gap-2">
            <span className="me-1 text-xs font-medium text-muted">{copy.severityLabel}</span>
            <Link
              href={filterHref({ severity: null })}
              className={chipClass(!severityFilter)}
              data-testid="filter-severity-all"
            >
              {copy.allSeverities}
            </Link>
            {SEVERITIES.map((s) => (
              <Link
                key={s}
                href={filterHref({ severity: s })}
                className={chipClass(severityFilter === s)}
                data-testid={`filter-severity-${s}`}
              >
                {severityLabel(t, s)} <span className="tabular-nums text-muted">({bySeverity[s]})</span>
              </Link>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="me-1 text-xs font-medium text-muted">{copy.categoryLabel}</span>
            <Link
              href={filterHref({ category: null })}
              className={chipClass(!categoryFilter)}
              data-testid="filter-category-all"
            >
              {copy.allCategories}
            </Link>
            {CATEGORIES.filter((c) => (byCategory[c] ?? 0) > 0 || categoryFilter === c).map((c) => (
              <Link
                key={c}
                href={filterHref({ category: c })}
                className={chipClass(categoryFilter === c)}
                data-testid={`filter-category-${c}`}
              >
                {categoryLabel(t, c)} <span className="tabular-nums text-muted">({byCategory[c] ?? 0})</span>
              </Link>
            ))}
          </div>
        </Section>
      </div>

      {guardian?.schemaReady ? (
        <div data-testid="guardian-register">
          <Section title={copy.guardianTitle}>
            <GuardianFindingsPanel findings={guardian.findings} lastScan={guardian.lastScan} alerts={guardian.alerts} />
          </Section>
        </div>
      ) : null}

      <Section
        title={
          severityFilter || categoryFilter
            ? format(copy.findingsTitleFiltered, { count: filtered.length, total: risks.length })
            : format(copy.findingsTitle, { count: filtered.length })
        }
      >
        <RiskFindingsList findings={filtered} />
      </Section>
    </PageContainer>
  );
}
