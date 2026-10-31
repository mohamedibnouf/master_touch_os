import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { PageContainer } from "@/components/layout/page-container";
import { EmptyState, PageHeader } from "@/components/ui/primitives";
import {
  makeFormatters,
  PerformanceCharts,
  PerformanceDefinitions,
  PerformanceKpis,
  PerformanceLeaderboard,
  type LeaderboardRow,
} from "@/components/tasks/performance/performance-dashboard";
import { PerformanceFilters } from "@/components/tasks/performance/performance-filters";
import { PerformancePrintButton } from "@/components/tasks/performance/performance-print-button";
import {
  aggregateRows,
  resolvePeriod,
  resolveSort,
  sortRows,
  topPerformerId,
} from "@/components/tasks/performance/performance-model";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { format, intlLocale, pickLocalized } from "@/lib/i18n/config";
import { getI18n } from "@/lib/i18n/server";
import { getAuthContext } from "@/server/context";
import { hasPermission } from "@/server/policies/authorize";
import { createTaskRepository } from "@/server/repositories/task.repository";

type SearchParams = {
  period?: string;
  from?: string;
  to?: string;
  space?: string;
  person?: string;
  sort?: string;
  dir?: string;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function TaskPerformancePage({
  searchParams,
}: {
  searchParams: Promise<Record<keyof SearchParams, string | string[] | undefined>>;
}) {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");
  if (!hasPermission(ctx, "task.read")) redirect("/");
  const isManager = hasPermission(ctx, "task.performance.read");

  const raw = await searchParams;
  const params: SearchParams = {
    period: one(raw.period),
    from: one(raw.from),
    to: one(raw.to),
    space: one(raw.space),
    person: one(raw.person),
    sort: one(raw.sort),
    dir: one(raw.dir),
  };

  const { t, locale } = await getI18n();
  const copy = t.tasksPerformance;
  const fmt = makeFormatters(locale, copy);
  const period = resolvePeriod(params);
  const { key: sortKey, dir: sortDir } = resolveSort(params.sort, params.dir);

  const orgId = ctx.organization.id;
  const repo = createTaskRepository(await createServerSupabaseClient());
  const spaces = await repo.listSpacesTree(orgId);
  const spaceId = params.space && spaces.some((s) => s.id === params.space) ? params.space : null;
  const requestedPerson = isManager && params.person && UUID_RE.test(params.person) ? params.person : null;

  const [perfRows, members, status] = await Promise.all([
    repo.listPerformance(orgId, period.from, period.to, spaceId),
    isManager ? repo.listMembers(orgId) : Promise.resolve([]),
    repo.performanceStatusBreakdown(orgId, period.from, period.to, {
      spaceId,
      profileId: isManager ? requestedPerson : ctx.profile.id,
    }),
  ]);

  const memberNames = new Map(members.map((m) => [m.profile_id, pickLocalized(locale, m.full_name_ar, m.full_name_en)]));
  const named: LeaderboardRow[] = (isManager ? perfRows : perfRows.filter((r) => r.profile_id === ctx.profile.id)).map(
    (r) => ({
      ...r,
      displayName:
        pickLocalized(locale, r.full_name_ar, r.full_name_en) || memberNames.get(r.profile_id) || copy.table.unknownPerson,
    }),
  );

  const focusRow = requestedPerson ? named.find((r) => r.profile_id === requestedPerson) ?? null : null;
  const focusName = requestedPerson
    ? focusRow?.displayName || memberNames.get(requestedPerson) || copy.table.unknownPerson
    : null;
  const kpiRows = requestedPerson ? (focusRow ? [focusRow] : []) : named;
  const totals = aggregateRows(kpiRows);
  const sorted = sortRows(named, sortKey, sortDir, intlLocale(locale));
  const topId = topPerformerId(named);

  const scopeLabel = !isManager
    ? copy.scope.self
    : focusName
      ? format(copy.scope.person, { name: focusName })
      : copy.scope.team;

  const hasData = named.length > 0 || status.total > 0;
  const dateFmt = new Intl.DateTimeFormat(intlLocale(locale), {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
  const showDate = (ymd: string) => dateFmt.format(new Date(`${ymd}T00:00:00Z`));

  const spaceOptions = spaces.map((s) => ({ id: s.id, label: pickLocalized(locale, s.name_ar, s.name_en) }));
  const peopleOptions = isManager
    ? [
        ...members.map((m) => ({ id: m.profile_id, label: memberNames.get(m.profile_id) || copy.table.unknownPerson })),
        ...named
          .filter((r) => !memberNames.has(r.profile_id))
          .map((r) => ({ id: r.profile_id, label: r.displayName })),
      ].sort((a, b) => a.label.localeCompare(b.label, intlLocale(locale)))
    : null;

  const baseParams: Record<string, string | null> = {
    period: period.preset,
    from: period.preset === "custom" ? period.from : null,
    to: period.preset === "custom" ? period.to : null,
    space: spaceId,
    person: requestedPerson,
  };
  const BackIcon = locale === "ar" ? ArrowRight : ArrowLeft;

  return (
    <PageContainer data-testid="tasks-performance" className="space-y-5">
      <PageHeader
        title={copy.title}
        description={isManager ? copy.descriptionTeam : copy.descriptionSelf}
        meta={format(copy.periodMeta, { from: showDate(period.from), to: showDate(period.to) })}
        actions={
          <>
            <Link
              href="/tasks"
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-[var(--radius-control)] px-3 text-sm font-medium text-muted hover:bg-surface-muted hover:text-ink print:hidden md:min-h-9"
            >
              <BackIcon className="h-4 w-4" aria-hidden />
              {copy.backToTasks}
            </Link>
            <PerformancePrintButton />
          </>
        }
      />

      <PerformanceFilters
        key={`${period.preset}:${period.from}:${period.to}`}
        preset={period.preset}
        from={period.from}
        to={period.to}
        spaceId={spaceId}
        personId={requestedPerson}
        sort={params.sort ?? null}
        dir={params.dir ?? null}
        spaces={spaceOptions}
        people={peopleOptions}
      />

      {!isManager ? (
        <p className="rounded-[var(--radius-control)] border border-line bg-surface-muted px-4 py-3 text-sm text-muted" data-testid="perf-self-note">
          {copy.scope.selfNote}
        </p>
      ) : null}

      {hasData ? (
        <>
          <PerformanceKpis totals={totals} scopeLabel={scopeLabel} copy={copy} fmt={fmt} />
          <PerformanceCharts
            rows={named}
            totals={totals}
            status={status}
            showByPerson={isManager && !requestedPerson && named.length > 1}
            copy={copy}
            statusLabels={t.tasks.status}
            fmt={fmt}
          />
          {isManager && sorted.length > 0 ? (
            <PerformanceLeaderboard
              rows={sorted}
              sort={sortKey}
              dir={sortDir}
              baseParams={baseParams}
              topId={named.length > 1 ? topId : null}
              focusId={requestedPerson}
              copy={copy}
              fmt={fmt}
            />
          ) : null}
        </>
      ) : (
        <EmptyState
          title={copy.empty.title}
          description={isManager ? copy.empty.description : copy.empty.selfDescription}
          action={
            <Link
              href="/tasks"
              className="inline-flex min-h-9 items-center rounded-[var(--radius-control)] border border-line bg-surface px-4 text-sm font-medium text-ink hover:bg-surface-muted print:hidden"
            >
              {copy.empty.action}
            </Link>
          }
        />
      )}

      <PerformanceDefinitions copy={copy} />
    </PageContainer>
  );
}
