import { auditActionLabel, auditEntityLabel } from "@/lib/ui/audit-action-labels";
import { PageContainer } from "@/components/layout/page-container";
import { redirect } from "next/navigation";
import Link from "next/link";
import type { ReactNode } from "react";
import { Card, PageHeader, Section } from "@/components/ui/primitives";
import { ManagementNav } from "@/components/management/management-nav";
import { AttentionList, MetricGrid, type ManagementMetric } from "@/components/management/management-widgets";
import { getAuthContext } from "@/server/context";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { canViewManagement, resolveManagementSections } from "@/modules/management/access";
import { ManagementRepository } from "@/server/repositories/management.repository";
import { payrollPeriodStatusLabel } from "@/lib/hr/labels";
import { format, intlLocale } from "@/lib/i18n/config";
import { getI18n } from "@/lib/i18n/server";
import { cn } from "@/lib/utils";

type SummaryRow = { label: string; value: ReactNode; tone?: "danger" | "warning"; testId?: string; muted?: boolean };

function SummaryCard({
  title,
  href,
  linkLabel,
  rows,
  footnote,
  testId,
}: {
  title: string;
  href?: string;
  linkLabel?: string;
  rows: SummaryRow[];
  footnote?: string;
  testId?: string;
}) {
  return (
    <Card className="flex h-full flex-col" data-testid={testId}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-ink">{title}</h3>
        {href && linkLabel ? (
          <Link href={href} className="text-xs font-medium text-primary hover:underline">
            {linkLabel}
          </Link>
        ) : null}
      </div>
      <dl className="divide-y divide-line text-sm">
        {rows.map((row) => (
          <div key={row.label} className="flex items-baseline justify-between gap-3 py-1.5" data-testid={row.testId}>
            <dt className={cn("min-w-0 text-muted", row.muted && "text-xs")}>{row.label}</dt>
            <dd
              className={cn(
                "shrink-0 text-end font-semibold tabular-nums",
                row.tone === "danger" && "text-danger",
                row.tone === "warning" && "text-warning",
                !row.tone && "text-ink",
              )}
            >
              {row.value}
            </dd>
          </div>
        ))}
      </dl>
      {footnote ? <p className="mt-3 text-xs text-muted">{footnote}</p> : null}
    </Card>
  );
}

export default async function ManagementOverviewPage() {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");
  if (!canViewManagement(ctx)) redirect("/");

  const { t, locale } = await getI18n();
  const m = t.management;
  const o = m.overview;
  const nf = intlLocale(locale);
  const n = (value: number) => value.toLocaleString(nf);
  const warnIf = (value: number, tone: "danger" | "warning" = "warning") => (value > 0 ? tone : undefined);

  const sections = resolveManagementSections(ctx);
  const supabase = await createServerSupabaseClient();
  const repo = new ManagementRepository(supabase);
  const snapshot = await repo.loadSnapshot(ctx.organization.id, ctx.profile.id, sections);

  const keyMetrics = [
    sections.projects
      ? {
          key: "active-projects",
          label: o.kpiActiveProjects,
          value: snapshot.projects.active,
          href: "/management/projects",
          tone: "info",
        }
      : null,
    sections.approvals
      ? {
          key: "pending-approvals",
          label: o.kpiPendingApprovals,
          value: snapshot.approvals.pending,
          href: "/approvals",
          tone: snapshot.approvals.overdue > 0 ? "warning" : "neutral",
        }
      : null,
    sections.people && snapshot.people
      ? {
          key: "active-employees",
          label: o.kpiActiveEmployees,
          value: snapshot.people.activeEmployees,
          href: "/employees",
          tone: "neutral",
        }
      : null,
    sections.payroll && snapshot.payroll
      ? {
          key: "payroll-review",
          label: o.kpiPayrollReview,
          value: snapshot.payroll.underReview,
          href: "/payroll",
          tone: snapshot.payroll.underReview > 0 ? "warning" : "neutral",
        }
      : null,
  ].filter(Boolean) as ManagementMetric[];

  return (
    <PageContainer data-testid="management-overview" className="space-y-5">
      <PageHeader
        title={o.title}
        description={format(o.description, { date: snapshot.asOfDate, tz: m.common.riyadhTz })}
      />
      <ManagementNav pathname="/management" />

      {keyMetrics.length > 0 ? (
        <div>
          <h2 className="mb-3 text-sm font-semibold text-ink">{o.kpisTitle}</h2>
          <MetricGrid metrics={keyMetrics} />
        </div>
      ) : null}

      <div data-testid="management-attention">
        <Section title={o.attentionTitle} description={o.attentionDescription}>
          <AttentionList items={snapshot.attention} />
        </Section>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {sections.projects ? (
          <SummaryCard
            title={o.projects.title}
            href="/management/projects"
            linkLabel={m.common.details}
            rows={[
              { label: o.projects.active, value: n(snapshot.projects.active) },
              { label: o.projects.atRisk, value: n(snapshot.projects.atRisk), tone: warnIf(snapshot.projects.atRisk, "danger") },
              {
                label: o.projects.overdue,
                value: n(snapshot.projects.overduePlannedEnd),
                tone: warnIf(snapshot.projects.overduePlannedEnd),
              },
              { label: o.projects.onHold, value: n(snapshot.projects.onHold) },
            ]}
          />
        ) : null}

        {sections.approvals ? (
          <SummaryCard
            title={o.approvals.title}
            href="/approvals"
            linkLabel={m.common.open}
            rows={[
              { label: o.approvals.pending, value: n(snapshot.approvals.pending) },
              { label: o.approvals.overdue, value: n(snapshot.approvals.overdue), tone: warnIf(snapshot.approvals.overdue, "danger") },
              { label: o.approvals.assignedToMe, value: n(snapshot.approvals.assignedToMe) },
              { label: o.approvals.recentlyRejected, value: n(snapshot.approvals.recentlyRejected) },
            ]}
          />
        ) : null}

        {sections.procurement ? (
          <SummaryCard
            title={o.procurement.title}
            href="/management/operations"
            linkLabel={m.common.details}
            rows={[
              { label: o.procurement.prAwaitingReview, value: n(snapshot.procurement.prAwaitingReview) },
              { label: o.procurement.rfqNeedsComparison, value: n(snapshot.procurement.rfqNeedsComparison) },
              { label: o.procurement.poReadyToIssue, value: n(snapshot.procurement.poReadyToIssue) },
              {
                label: o.procurement.lateDeliveries,
                value: n(snapshot.procurement.lateDeliveries),
                tone: warnIf(snapshot.procurement.lateDeliveries, "danger"),
              },
            ]}
          />
        ) : null}

        {sections.finance && snapshot.commercial ? (
          <SummaryCard
            title={o.commercial.title}
            href="/management/finance"
            linkLabel={m.common.details}
            footnote={o.commercial.amountsNote}
            rows={[
              { label: o.commercial.outstandingAr, value: n(snapshot.commercial.outstandingAr) },
              { label: o.commercial.overdueAr, value: n(snapshot.commercial.overdueAr), tone: warnIf(snapshot.commercial.overdueAr) },
              { label: o.commercial.overdueAp, value: n(snapshot.commercial.overdueAp), tone: warnIf(snapshot.commercial.overdueAp) },
              { label: o.commercial.pendingValuations, value: n(snapshot.commercial.pendingValuations) },
            ]}
          />
        ) : null}

        {sections.people && snapshot.people ? (
          <SummaryCard
            title={o.people.title}
            href="/management/people"
            linkLabel={m.common.details}
            rows={[
              { label: o.people.active, value: n(snapshot.people.activeEmployees) },
              {
                label: o.people.compliance30d,
                value: n(snapshot.people.complianceExpiring30d),
                tone: warnIf(snapshot.people.complianceExpiring30d),
              },
              {
                label: o.people.contracts30d,
                value: n(snapshot.people.contractsEnding30d),
                tone: warnIf(snapshot.people.contractsEnding30d),
              },
              { label: o.people.onLeaveToday, value: n(snapshot.people.onLeaveToday) },
            ]}
          />
        ) : null}

        {sections.attendanceLeave && snapshot.attendance ? (
          <SummaryCard
            title={o.attendance.title}
            rows={[
              { label: o.attendance.present, value: n(snapshot.attendance.present) },
              { label: o.attendance.late, value: n(snapshot.attendance.late), tone: warnIf(snapshot.attendance.late) },
              { label: o.attendance.absent, value: n(snapshot.attendance.absent), tone: warnIf(snapshot.attendance.absent, "danger") },
              {
                label: o.attendance.missingCheckout,
                value: n(snapshot.attendance.missingCheckout),
                tone: warnIf(snapshot.attendance.missingCheckout),
              },
              { label: o.attendance.pendingLeave, value: n(snapshot.attendance.pendingLeaveApprovals) },
            ]}
          />
        ) : null}

        {sections.payroll && snapshot.payroll ? (
          <SummaryCard
            title={o.payroll.title}
            href="/payroll"
            linkLabel={m.common.open}
            testId="management-payroll-card"
            rows={[
              {
                label: o.payroll.latestPeriod,
                value: (
                  <>
                    {snapshot.payroll.latestLabel ?? m.common.none}
                    {snapshot.payroll.latestStatus ? (
                      <span className="ms-1 text-xs font-normal text-muted">
                        ({payrollPeriodStatusLabel(snapshot.payroll.latestStatus, locale)})
                      </span>
                    ) : null}
                  </>
                ),
              },
              {
                label: o.payroll.latestEmployees,
                value: snapshot.payroll.latestEmployeeCount != null ? n(snapshot.payroll.latestEmployeeCount) : m.common.none,
              },
              sections.payrollAmounts && snapshot.payroll.latestNet != null
                ? {
                    label: o.payroll.latestNet,
                    testId: "management-payroll-net",
                    value: (
                      <>
                        {snapshot.payroll.latestNet.toLocaleString(nf, {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                        <span className="ms-1 text-xs font-normal text-muted">{m.common.currency}</span>
                      </>
                    ),
                  }
                : {
                    label: o.payroll.netHidden,
                    testId: "management-payroll-net-hidden",
                    value: m.common.none,
                    muted: true,
                  },
              { label: o.payroll.underReview, value: n(snapshot.payroll.underReview), tone: warnIf(snapshot.payroll.underReview) },
              { label: o.payroll.approvedAwaitingLock, value: n(snapshot.payroll.approvedAwaitingLock) },
              {
                label: o.payroll.lockedUnpaid,
                value: n(snapshot.payroll.lockedUnpaidEntries),
                tone: warnIf(snapshot.payroll.lockedUnpaidEntries),
              },
            ]}
          />
        ) : null}
      </div>

      {sections.activity ? (
        <div data-testid="management-activity">
          <Section
            title={o.activityTitle}
            actions={
              <Link href="/management/activity" className="text-xs font-medium text-primary hover:underline">
                {m.common.more}
              </Link>
            }
          >
            {snapshot.activity.length === 0 ? (
              <p className="text-sm text-muted">{o.activityEmpty}</p>
            ) : (
              <ul className="divide-y divide-line text-sm">
                {snapshot.activity.slice(0, 8).map((a) => (
                  <li key={a.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
                    <span className="min-w-0">
                      <span className="font-medium text-ink">{auditActionLabel(a.action, locale)}</span>
                      <span className="text-muted"> · {auditEntityLabel(a.entityType, locale)}</span>
                    </span>
                    <span className="text-xs tabular-nums text-muted">
                      {new Date(a.createdAt).toLocaleString(nf, { timeZone: "Asia/Riyadh" })}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      ) : null}
    </PageContainer>
  );
}
