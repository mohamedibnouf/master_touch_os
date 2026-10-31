import Link from "next/link";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Award,
  CheckCircle2,
  Clock,
  Hourglass,
  Info,
  Timer,
  Trophy,
} from "lucide-react";
import { Card, Section, StatCard, TableScroll } from "@/components/ui/primitives";
import { DonutChart, HorizontalBarList, StackedCountBars } from "@/components/charts/semantic-charts";
import { format, intlLocale, type Locale } from "@/lib/i18n/config";
import type { Dictionary } from "@/lib/i18n/dictionaries/ar";
import { displayInitials } from "@/lib/ui/initials";
import { cn } from "@/lib/utils";
import type { TaskPerformanceRow } from "@/modules/tasks/types";
import {
  completionPercent,
  defaultDir,
  onTimeTone,
  performanceHref,
  type PerformanceTotals,
  type SortDir,
  type SortKey,
} from "./performance-model";

type Copy = Dictionary["tasksPerformance"];

export type LeaderboardRow = TaskPerformanceRow & { displayName: string };

export type StatusBreakdown = {
  todo: number;
  in_progress: number;
  review: number;
  done: number;
  overdue: number;
  total: number;
};

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

export function makeFormatters(locale: Locale, copy: Copy) {
  const nf = intlLocale(locale);
  const num = (value: number, digits = 0) =>
    value.toLocaleString(nf, { maximumFractionDigits: digits, minimumFractionDigits: 0 });
  return {
    num,
    percent: (value: number | null) =>
      value === null ? copy.units.none : format(copy.units.percent, { n: num(value, 1) }),
    /** Cycle time: hours below two days, then days. */
    cycle: (hours: number | null) => {
      if (hours === null) return copy.units.none;
      if (hours < 48) return format(copy.units.hours, { n: num(hours, 1) });
      return format(copy.units.days, { n: num(hours / 24, 1) });
    },
    /** Minutes → "12.5h" (or "45m" under an hour). */
    hours: (minutes: number) => {
      if (minutes <= 0) return format(copy.units.hours, { n: num(0) });
      if (minutes < 60) return format(copy.units.minutes, { n: num(minutes) });
      return format(copy.units.hours, { n: num(minutes / 60, 1) });
    },
  };
}

type Formatters = ReturnType<typeof makeFormatters>;

// ---------------------------------------------------------------------------
// KPIs
// ---------------------------------------------------------------------------

export function PerformanceKpis({
  totals,
  scopeLabel,
  copy,
  fmt,
}: {
  totals: PerformanceTotals;
  scopeLabel: string;
  copy: Copy;
  fmt: Formatters;
}) {
  const k = copy.kpi;
  const iconClass = "size-5";
  return (
    <section data-testid="perf-kpis" aria-label={scopeLabel}>
      <h2 className="mb-3 text-sm font-semibold text-ink">{scopeLabel}</h2>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6 print:grid-cols-3">
        <StatCard
          label={k.completed}
          value={fmt.num(totals.completed)}
          hint={format(k.completedHint, { assigned: fmt.num(totals.assigned) })}
          tone="info"
          icon={<CheckCircle2 className={iconClass} />}
        />
        <StatCard
          label={k.onTimeRate}
          value={fmt.percent(totals.onTimeRate)}
          hint={format(k.onTimeHint, { onTime: fmt.num(totals.completedOnTime), late: fmt.num(totals.completedLate) })}
          tone={onTimeTone(totals.onTimeRate)}
          icon={<Clock className={iconClass} />}
        />
        <StatCard
          label={k.overdue}
          value={fmt.num(totals.overdueOpen)}
          hint={totals.overdueOpen > 0 ? k.overdueHint : k.overdueNone}
          tone={totals.overdueOpen > 0 ? "danger" : "neutral"}
          icon={<AlertTriangle className={iconClass} />}
        />
        <StatCard
          label={k.cycle}
          value={fmt.cycle(totals.avgCycleHours)}
          hint={k.cycleHint}
          tone="neutral"
          icon={<Hourglass className={iconClass} />}
        />
        <StatCard
          label={k.logged}
          value={fmt.hours(totals.loggedMinutes)}
          hint={
            totals.estimateMinutesDone > 0
              ? format(k.loggedHint, { estimate: fmt.hours(totals.estimateMinutesDone) })
              : k.loggedNoEstimate
          }
          tone={
            totals.estimateMinutesDone > 0 && totals.loggedMinutes > totals.estimateMinutesDone * 1.25
              ? "warning"
              : "neutral"
          }
          icon={<Timer className={iconClass} />}
        />
        <StatCard
          label={k.points}
          value={fmt.num(totals.points, 1)}
          hint={k.pointsHint}
          tone="success"
          icon={<Award className={iconClass} />}
        />
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Charts
// ---------------------------------------------------------------------------

export function PerformanceCharts({
  rows,
  totals,
  status,
  showByPerson,
  copy,
  statusLabels,
  fmt,
}: {
  rows: LeaderboardRow[];
  totals: PerformanceTotals;
  status: StatusBreakdown;
  showByPerson: boolean;
  copy: Copy;
  statusLabels: Record<"todo" | "in_progress" | "review" | "done", string>;
  fmt: Formatters;
}) {
  const c = copy.charts;
  const byPerson = rows
    .filter((r) => r.assigned > 0 || r.completed > 0)
    .sort((a, b) => b.completed - a.completed || completionPercent(b) - completionPercent(a))
    .slice(0, 10)
    .map((r) => ({
      id: r.profile_id,
      label: r.displayName,
      href: `/tasks?assignee=${encodeURIComponent(r.profile_id)}`,
      percent: completionPercent(r),
      hint: format(c.completionHint, { completed: fmt.num(r.completed), assigned: fmt.num(r.assigned) }),
    }));

  return (
    <div className="grid gap-4 lg:grid-cols-12 print:grid-cols-2">
      {showByPerson ? (
        <Card className="min-w-0 lg:col-span-12 xl:col-span-5 print:break-inside-avoid">
          <HorizontalBarList title={c.completionByPerson} emptyLabel={c.empty} rows={byPerson} />
        </Card>
      ) : null}
      <Card className={cn("min-w-0 print:break-inside-avoid", showByPerson ? "lg:col-span-6 xl:col-span-3" : "lg:col-span-5")}>
        <DonutChart
          title={c.onTimeVsLate}
          emptyLabel={c.empty}
          segments={[
            { label: c.onTime, value: totals.completedOnTime, tone: "success" },
            { label: c.late, value: totals.completedLate, tone: "warning" },
          ]}
          centerValue={fmt.percent(totals.onTimeRate)}
          centerLabel={c.onTimeCenter}
        />
      </Card>
      <Card className={cn("min-w-0 print:break-inside-avoid", showByPerson ? "lg:col-span-6 xl:col-span-4" : "lg:col-span-7")}>
        <StackedCountBars
          title={c.statusBreakdown}
          emptyLabel={c.empty}
          rows={[
            { label: statusLabels.todo, value: status.todo, tone: "neutral" },
            { label: statusLabels.in_progress, value: status.in_progress, tone: "info" },
            { label: statusLabels.review, value: status.review, tone: "warning" },
            { label: statusLabels.done, value: status.done, tone: "success" },
            { label: c.overdueOpen, value: status.overdue, tone: "danger" },
          ]}
        />
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Leaderboard
// ---------------------------------------------------------------------------

function Avatar({ name, highlight }: { name: string; highlight?: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
        highlight ? "bg-primary text-primary-foreground" : "bg-surface-strong text-muted",
      )}
    >
      {displayInitials(name)}
    </span>
  );
}

export function PerformanceLeaderboard({
  rows,
  sort,
  dir,
  baseParams,
  topId,
  focusId,
  copy,
  fmt,
}: {
  rows: LeaderboardRow[];
  sort: SortKey;
  dir: SortDir;
  /** Current filters, preserved by the sort links. */
  baseParams: Record<string, string | null>;
  topId: string | null;
  focusId: string | null;
  copy: Copy;
  fmt: Formatters;
}) {
  const tb = copy.table;
  const columns: Array<{ key: SortKey; label: string; align: "start" | "end" }> = [
    { key: "name", label: tb.person, align: "start" },
    { key: "assigned", label: tb.assigned, align: "end" },
    { key: "completed", label: tb.completed, align: "end" },
    { key: "on_time", label: tb.onTime, align: "end" },
    { key: "overdue", label: tb.overdue, align: "end" },
    { key: "cycle", label: tb.cycle, align: "end" },
    { key: "logged", label: tb.logged, align: "end" },
    { key: "points", label: tb.points, align: "end" },
  ];

  return (
    <div data-testid="perf-leaderboard" className="print:break-before-auto">
      <Section title={tb.title} description={tb.description}>
        <TableScroll>
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-line bg-surface-muted text-xs text-muted">
                <th scope="col" className="w-10 px-3 py-2 text-start font-semibold">
                  {tb.rank}
                </th>
                {columns.map((col) => {
                  const active = sort === col.key;
                  const nextDir: SortDir = active ? (dir === "asc" ? "desc" : "asc") : defaultDir(col.key);
                  const Icon = active ? (dir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
                  return (
                    <th
                      key={col.key}
                      scope="col"
                      aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}
                      className={cn("px-3 py-2 font-semibold", col.align === "end" ? "text-end" : "text-start")}
                    >
                      <Link
                        href={performanceHref({ ...baseParams, sort: col.key, dir: nextDir })}
                        scroll={false}
                        aria-label={format(tb.sortBy, { column: col.label })}
                        className={cn(
                          "inline-flex items-center gap-1 rounded-sm outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-primary/25 print:pointer-events-none",
                          active && "text-ink",
                        )}
                      >
                        {col.label}
                        <Icon className={cn("h-3 w-3 print:hidden", !active && "opacity-40")} aria-hidden />
                      </Link>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => {
                const isTop = row.profile_id === topId;
                const isFocus = row.profile_id === focusId;
                return (
                  <tr
                    key={row.profile_id}
                    data-testid="perf-leaderboard-row"
                    data-top={isTop ? "true" : undefined}
                    className={cn(
                      "border-b border-line/70 last:border-0 transition-colors hover:bg-surface-muted/60",
                      isTop && "bg-primary-soft/40",
                      isFocus && "bg-surface-muted",
                    )}
                  >
                    <td className="px-3 py-2.5 text-xs tabular-nums text-muted">{fmt.num(index + 1)}</td>
                    <td className="px-3 py-2.5">
                      <div className="flex min-w-0 items-center gap-2.5">
                        <Avatar name={row.displayName} highlight={isTop} />
                        <Link
                          href={`/tasks?assignee=${encodeURIComponent(row.profile_id)}`}
                          title={format(tb.openTasks, { name: row.displayName })}
                          className="min-w-0 truncate font-medium text-ink hover:text-primary hover:underline print:no-underline"
                          dir="auto"
                        >
                          {row.displayName}
                        </Link>
                        {isTop ? (
                          <span
                            className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary-soft px-2 py-0.5 text-[11px] font-medium text-primary"
                            title={tb.top}
                          >
                            <Trophy className="h-3 w-3" aria-hidden />
                            <span className="hidden sm:inline">{tb.top}</span>
                            <span className="sr-only sm:hidden">{tb.top}</span>
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-end tabular-nums text-ink">{fmt.num(row.assigned)}</td>
                    <td className="px-3 py-2.5 text-end tabular-nums font-medium text-ink">{fmt.num(row.completed)}</td>
                    <td
                      className={cn(
                        "px-3 py-2.5 text-end tabular-nums",
                        onTimeTone(row.on_time_rate) === "success" && "text-success",
                        onTimeTone(row.on_time_rate) === "warning" && "text-warning",
                        onTimeTone(row.on_time_rate) === "danger" && "text-danger",
                        onTimeTone(row.on_time_rate) === "neutral" && "text-muted",
                      )}
                    >
                      {fmt.percent(row.on_time_rate)}
                    </td>
                    <td
                      className={cn(
                        "px-3 py-2.5 text-end tabular-nums",
                        row.overdue_open > 0 ? "font-semibold text-danger" : "text-muted",
                      )}
                    >
                      {fmt.num(row.overdue_open)}
                    </td>
                    <td className="px-3 py-2.5 text-end tabular-nums text-ink">{fmt.cycle(row.avg_cycle_hours)}</td>
                    <td className="px-3 py-2.5 text-end tabular-nums text-ink">{fmt.hours(row.logged_minutes)}</td>
                    <td className="px-3 py-2.5 text-end tabular-nums font-semibold text-ink">
                      {fmt.num(row.points_earned, 1)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableScroll>
      </Section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Definitions
// ---------------------------------------------------------------------------

export function PerformanceDefinitions({ copy }: { copy: Copy }) {
  const d = copy.definitions;
  const items = [d.period, d.onTime, d.points, d.overdue, d.cycle, d.logged, d.shared];
  return (
    <details className="mt-surface group p-4 md:p-5 print:block" data-testid="perf-definitions">
      <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-semibold text-ink outline-none focus-visible:ring-2 focus-visible:ring-primary/25 [&::-webkit-details-marker]:hidden">
        <Info className="h-4 w-4 text-primary" aria-hidden />
        {d.title}
      </summary>
      <ul className="mt-3 space-y-2 text-sm leading-relaxed text-muted">
        {items.map((text) => (
          <li key={text} className="flex gap-2">
            <span aria-hidden className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-border-strong" />
            <span>{text}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}
