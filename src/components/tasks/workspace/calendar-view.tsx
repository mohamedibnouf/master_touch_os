import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { format, intlLocale, type Locale } from "@/lib/i18n/config";
import type { Dictionary } from "@/lib/i18n/dictionaries/ar";
import { dueDayInRiyadh } from "@/modules/tasks/logic";
import { PRIORITY_STYLE, STATUS_STYLE, type TaskView } from "./model";

const MAX_PER_DAY = 3;

/** Month grid (weeks start Saturday) of tasks on their Riyadh due day. */
export function TaskCalendarView({
  views,
  days,
  year,
  month,
  today,
  prevHref,
  nextHref,
  todayHref,
  locale,
  t,
}: {
  views: TaskView[];
  /** YYYY-MM-DD days of the grid (multiple of 7, Saturday first). */
  days: string[];
  year: number;
  month: number;
  today: string;
  prevHref: string;
  nextHref: string;
  todayHref: string;
  locale: Locale;
  t: Dictionary;
}) {
  const tc = t.tasksWorkspace.calendar;
  const byDay = new Map<string, TaskView[]>();
  for (const v of views) {
    const day = dueDayInRiyadh(v.dueAt);
    if (!day) continue;
    const arr = byDay.get(day) ?? [];
    arr.push(v);
    byDay.set(day, arr);
  }
  for (const arr of byDay.values()) {
    arr.sort((a, b) => (a.dueAt ?? "").localeCompare(b.dueAt ?? ""));
  }

  const monthKey = `${year}-${String(month).padStart(2, "0")}`;
  const monthTitle = new Intl.DateTimeFormat(intlLocale(locale), {
    month: "long",
    year: "numeric",
    calendar: "gregory",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, 15)));
  const weekdayFmt = new Intl.DateTimeFormat(intlLocale(locale), { weekday: "short", timeZone: "UTC" });
  const dayNumFmt = new Intl.NumberFormat(intlLocale(locale));
  const weekdays = days.slice(0, 7).map((d) => weekdayFmt.format(new Date(`${d}T12:00:00Z`)));
  const PrevIcon = locale === "ar" ? ChevronRight : ChevronLeft;
  const NextIcon = locale === "ar" ? ChevronLeft : ChevronRight;

  return (
    <section data-testid="tasks-view-calendar" aria-label={tc.aria} className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-ink">{monthTitle}</h2>
        <div className="flex items-center gap-1.5">
          <Link
            href={prevHref}
            aria-label={tc.previous}
            className="inline-flex size-9 items-center justify-center rounded-[var(--radius-control)] border border-line bg-surface text-ink hover:bg-surface-muted"
          >
            <PrevIcon className="size-4" aria-hidden />
          </Link>
          <Link
            href={todayHref}
            className="inline-flex h-9 items-center rounded-[var(--radius-control)] border border-line bg-surface px-3 text-sm font-medium text-ink hover:bg-surface-muted"
          >
            {tc.today}
          </Link>
          <Link
            href={nextHref}
            aria-label={tc.next}
            className="inline-flex size-9 items-center justify-center rounded-[var(--radius-control)] border border-line bg-surface text-ink hover:bg-surface-muted"
          >
            <NextIcon className="size-4" aria-hidden />
          </Link>
        </div>
      </div>

      <div className="mt-surface overflow-hidden p-0">
        <div className="grid grid-cols-7 border-b border-line bg-surface-muted/70">
          {weekdays.map((w) => (
            <div key={w} className="px-1.5 py-2 text-center text-[11px] font-semibold text-muted sm:text-xs">
              {w}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {days.map((day, i) => {
            const inMonth = day.startsWith(monthKey);
            const isToday = day === today;
            const items = byDay.get(day) ?? [];
            const shown = items.slice(0, MAX_PER_DAY);
            const extra = items.length - shown.length;
            return (
              <div
                key={day}
                data-day={day}
                className={cn(
                  "min-h-20 min-w-0 border-line p-1 sm:min-h-28 sm:p-1.5",
                  i % 7 !== 6 && "border-e",
                  i < days.length - 7 && "border-b",
                  !inMonth && "bg-surface-muted/50",
                )}
              >
                <div className="mb-1 flex items-center justify-between">
                  <span
                    className={cn(
                      "inline-flex size-6 items-center justify-center rounded-full text-xs tabular-nums",
                      isToday ? "bg-primary font-semibold text-primary-foreground" : inMonth ? "text-ink" : "text-muted/70",
                    )}
                  >
                    {dayNumFmt.format(Number(day.slice(8, 10)))}
                  </span>
                  {items.length > 0 ? (
                    <span className="text-[10px] tabular-nums text-muted sm:hidden">{items.length}</span>
                  ) : null}
                </div>
                <ul className="hidden space-y-1 sm:block">
                  {shown.map((v) => (
                    <li key={v.id}>
                      <CalendarChip view={v} />
                    </li>
                  ))}
                </ul>
                {/* Phones: dots only; the "+N" popover lists everything. */}
                {items.length > 0 ? (
                  <div className="flex flex-wrap gap-0.5 sm:hidden" aria-hidden>
                    {items.slice(0, 6).map((v) => (
                      <span key={v.id} className={cn("size-1.5 rounded-full", STATUS_STYLE[v.status].dot)} />
                    ))}
                  </div>
                ) : null}
                {extra > 0 || items.length > 0 ? (
                  <details className={cn("relative mt-1", extra <= 0 && "sm:hidden")}>
                    <summary className="cursor-pointer list-none rounded px-1 text-[11px] font-medium text-primary hover:bg-primary-soft [&::-webkit-details-marker]:hidden">
                      <span className="hidden sm:inline">{format(tc.more, { count: extra })}</span>
                      <span className="sm:hidden">{format(tc.more, { count: items.length })}</span>
                    </summary>
                    <div className="mt-pop-in absolute start-0 z-30 mt-1 w-56 max-w-[80vw] space-y-1 rounded-xl border border-line bg-surface p-2 shadow-[var(--shadow-2)]">
                      {items.map((v) => (
                        <CalendarChip key={v.id} view={v} />
                      ))}
                    </div>
                  </details>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
      <p className="text-xs text-muted">{tc.noDueHint}</p>
    </section>
  );
}

function CalendarChip({ view }: { view: TaskView }) {
  const closed = view.status === "done" || view.status === "cancelled";
  return (
    <Link
      href={view.href}
      title={view.title}
      className={cn(
        "flex items-center gap-1.5 truncate rounded-md border border-line bg-surface px-1.5 py-1 text-[11px] leading-tight text-ink shadow-sm hover:border-border-strong hover:text-primary",
        view.dueTone === "overdue" && "border-danger-border bg-danger-soft text-danger",
        closed && "text-muted line-through",
      )}
    >
      <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", STATUS_STYLE[view.status].dot)} />
      <span className={cn("truncate", PRIORITY_STYLE[view.priority].text === "text-danger" && !closed && "font-semibold")} dir="auto">
        {view.title}
      </span>
    </Link>
  );
}
