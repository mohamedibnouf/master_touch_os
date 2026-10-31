/**
 * /tasks/performance — pure helpers (no I/O): URL period presets on the Riyadh calendar,
 * leaderboard sorting and team totals. Safe on server and client.
 */

import { addDaysYmd, todayInRiyadh } from "@/lib/time/riyadh";
import type { TaskPerformanceRow } from "@/modules/tasks/types";

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;
/** task_performance() rejects ranges longer than this (091). */
export const MAX_RANGE_DAYS = 1100;

export const PERIOD_PRESETS = ["this_week", "this_month", "last_month", "this_quarter", "custom"] as const;
export type PeriodPreset = (typeof PERIOD_PRESETS)[number];
export const DEFAULT_PERIOD: Exclude<PeriodPreset, "custom"> = "this_month";

export type ResolvedPeriod = { preset: PeriodPreset; from: string; to: string };

function isValidYmd(value: string | undefined | null): value is string {
  if (!value || !YMD_RE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

function ymd(y: number, monthIndex: number, day: number): string {
  return new Date(Date.UTC(y, monthIndex, day)).toISOString().slice(0, 10);
}

/** Inclusive Riyadh calendar range of a preset for the given Riyadh "today" (weeks start Saturday). */
export function presetRange(preset: Exclude<PeriodPreset, "custom">, today: string): { from: string; to: string } {
  const [y, m] = today.split("-").map(Number);
  const mi = m - 1;
  switch (preset) {
    case "this_week": {
      const dow = new Date(`${today}T00:00:00Z`).getUTCDay(); // 0 Sun … 6 Sat
      const from = addDaysYmd(today, -((dow - 6 + 7) % 7));
      return { from, to: addDaysYmd(from, 6) };
    }
    case "last_month":
      return { from: ymd(y, mi - 1, 1), to: ymd(y, mi, 0) };
    case "this_quarter": {
      const q = Math.floor(mi / 3) * 3;
      return { from: ymd(y, q, 1), to: ymd(y, q + 3, 0) };
    }
    case "this_month":
    default:
      return { from: ymd(y, mi, 1), to: ymd(y, mi + 1, 0) };
  }
}

/**
 * URL → period. Unknown presets fall back to this month; a custom range needs two valid
 * dates (swapped when reversed) within MAX_RANGE_DAYS, else it falls back too.
 */
export function resolvePeriod(
  params: { period?: string | null; from?: string | null; to?: string | null },
  now: Date = new Date(),
): ResolvedPeriod {
  const today = todayInRiyadh(now);
  const preset = (PERIOD_PRESETS as readonly string[]).includes(params.period ?? "")
    ? (params.period as PeriodPreset)
    : params.period == null && (params.from || params.to)
      ? "custom"
      : DEFAULT_PERIOD;
  if (preset === "custom") {
    let from = params.from ?? null;
    let to = params.to ?? null;
    if (isValidYmd(from) && !isValidYmd(to)) to = from;
    if (!isValidYmd(from) && isValidYmd(to)) from = to;
    if (isValidYmd(from) && isValidYmd(to)) {
      if (from > to) [from, to] = [to, from];
      if (daysBetween(from, to) <= MAX_RANGE_DAYS) return { preset, from, to };
    }
    return { preset: DEFAULT_PERIOD, ...presetRange(DEFAULT_PERIOD, today) };
  }
  return { preset, ...presetRange(preset, today) };
}

// ---------------------------------------------------------------------------
// Leaderboard sorting
// ---------------------------------------------------------------------------

export const SORT_KEYS = ["points", "completed", "assigned", "on_time", "overdue", "cycle", "logged", "name"] as const;
export type SortKey = (typeof SORT_KEYS)[number];
export type SortDir = "asc" | "desc";
export const DEFAULT_SORT: SortKey = "points";

/** Natural first-click direction: names A→Z, faster cycle and fewer overdue first; the rest high→low. */
export function defaultDir(key: SortKey): SortDir {
  return key === "name" || key === "cycle" || key === "overdue" ? "asc" : "desc";
}

export function resolveSort(sort?: string | null, dir?: string | null): { key: SortKey; dir: SortDir } {
  const key = (SORT_KEYS as readonly string[]).includes(sort ?? "") ? (sort as SortKey) : DEFAULT_SORT;
  const d = dir === "asc" || dir === "desc" ? dir : defaultDir(key);
  return { key, dir: d };
}

type NamedRow = TaskPerformanceRow & { displayName: string };

function sortValue(row: NamedRow, key: SortKey): number | string | null {
  switch (key) {
    case "points":
      return row.points_earned;
    case "completed":
      return row.completed;
    case "assigned":
      return row.assigned;
    case "on_time":
      return row.on_time_rate;
    case "overdue":
      return row.overdue_open;
    case "cycle":
      return row.avg_cycle_hours;
    case "logged":
      return row.logged_minutes;
    case "name":
      return row.displayName;
  }
}

/** Stable sort; null values (no completions) always go last; ties fall back to points, then name. */
export function sortRows<T extends NamedRow>(rows: readonly T[], key: SortKey, dir: SortDir, locale = "ar"): T[] {
  const sign = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const av = sortValue(a, key);
    const bv = sortValue(b, key);
    if (av === null && bv !== null) return 1;
    if (bv === null && av !== null) return -1;
    let diff = 0;
    if (typeof av === "string" && typeof bv === "string") diff = av.localeCompare(bv, locale);
    else if (typeof av === "number" && typeof bv === "number") diff = av - bv;
    if (diff !== 0) return diff * sign;
    if (b.points_earned !== a.points_earned) return b.points_earned - a.points_earned;
    return a.displayName.localeCompare(b.displayName, locale);
  });
}

/** Profile with the most points (ties: more completed); null when nobody earned points. */
export function topPerformerId(rows: readonly TaskPerformanceRow[]): string | null {
  let best: TaskPerformanceRow | null = null;
  for (const r of rows) {
    if (r.points_earned <= 0) continue;
    if (
      !best ||
      r.points_earned > best.points_earned ||
      (r.points_earned === best.points_earned && r.completed > best.completed)
    ) {
      best = r;
    }
  }
  return best?.profile_id ?? null;
}

// ---------------------------------------------------------------------------
// Totals
// ---------------------------------------------------------------------------

export type PerformanceTotals = {
  people: number;
  assigned: number;
  completed: number;
  completedOnTime: number;
  completedLate: number;
  overdueOpen: number;
  /** 0–100, one decimal; null when nothing was completed. */
  onTimeRate: number | null;
  /** Completion-weighted average, one decimal; null when nothing was completed. */
  avgCycleHours: number | null;
  loggedMinutes: number;
  estimateMinutesDone: number;
  points: number;
};

export function aggregateRows(rows: readonly TaskPerformanceRow[]): PerformanceTotals {
  let assigned = 0;
  let completed = 0;
  let onTime = 0;
  let overdue = 0;
  let logged = 0;
  let estimate = 0;
  let points = 0;
  let cycleWeighted = 0;
  let cycleWeight = 0;
  for (const r of rows) {
    assigned += r.assigned;
    completed += r.completed;
    onTime += r.completed_on_time;
    overdue += r.overdue_open;
    logged += r.logged_minutes;
    estimate += r.estimate_minutes_done;
    points += r.points_earned;
    if (r.avg_cycle_hours !== null && r.completed > 0) {
      cycleWeighted += r.avg_cycle_hours * r.completed;
      cycleWeight += r.completed;
    }
  }
  const round1 = (v: number) => Math.round(v * 10) / 10;
  return {
    people: rows.length,
    assigned,
    completed,
    completedOnTime: onTime,
    completedLate: Math.max(0, completed - onTime),
    overdueOpen: overdue,
    onTimeRate: completed > 0 ? round1((onTime * 100) / completed) : null,
    avgCycleHours: cycleWeight > 0 ? round1(cycleWeighted / cycleWeight) : null,
    loggedMinutes: logged,
    estimateMinutesDone: estimate,
    points: round1(points),
  };
}

/** Completion share of the tasks on a person's plate in the period (0–100, integer). */
export function completionPercent(row: Pick<TaskPerformanceRow, "assigned" | "completed">): number {
  if (row.assigned <= 0) return row.completed > 0 ? 100 : 0;
  return Math.min(100, Math.round((row.completed * 100) / row.assigned));
}

/** Tone for an on-time rate: calm green from 85%, amber from 60%, red below. */
export function onTimeTone(rate: number | null): "success" | "warning" | "danger" | "neutral" {
  if (rate === null) return "neutral";
  if (rate >= 85) return "success";
  if (rate >= 60) return "warning";
  return "danger";
}

/** Query string for the page, dropping empty values. */
export function performanceHref(params: Record<string, string | null | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) sp.set(k, v);
  const qs = sp.toString();
  return qs ? `/tasks/performance?${qs}` : "/tasks/performance";
}
