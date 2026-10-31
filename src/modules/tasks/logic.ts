/**
 * Task workspace — pure helpers (no I/O). Safe to import from client and server code.
 * Date logic is Asia/Riyadh (fixed UTC+03:00) via src/lib/time/riyadh.ts.
 */

import { commercialEntityHref } from "@/lib/commercial/entity-routes";
import { addDaysYmd, riyadhDateOf, RIYADH_UTC_OFFSET, todayInRiyadh } from "@/lib/time/riyadh";
import {
  OPEN_TASK_STATUSES,
  TASK_ENTITY_TYPES,
  type Task,
  type TaskCapabilities,
  type TaskEntityType,
  type TaskPriority,
  type TaskStatus,
} from "./types";

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

// ---------------------------------------------------------------------------
// Status / priority
// ---------------------------------------------------------------------------

/** Default points by priority (mirrors tasks_before_write in 091). */
export const DEFAULT_POINTS: Readonly<Record<TaskPriority, number>> = {
  urgent: 5,
  high: 3,
  normal: 2,
  low: 1,
};

export function defaultPointsForPriority(priority: TaskPriority): number {
  return DEFAULT_POINTS[priority] ?? 2;
}

export function isOpenStatus(status: TaskStatus): boolean {
  return (OPEN_TASK_STATUSES as readonly TaskStatus[]).includes(status);
}

export function isTaskEntityType(value: string): value is TaskEntityType {
  return (TASK_ENTITY_TYPES as readonly string[]).includes(value);
}

/** Lower rank sorts first. */
export const PRIORITY_RANK: Readonly<Record<TaskPriority, number>> = { urgent: 0, high: 1, normal: 2, low: 3 };
export const STATUS_RANK: Readonly<Record<TaskStatus, number>> = {
  in_progress: 0,
  review: 1,
  todo: 2,
  done: 3,
  cancelled: 4,
};

// ---------------------------------------------------------------------------
// Dates (Asia/Riyadh)
// ---------------------------------------------------------------------------

type DueLike = Pick<Task, "status" | "due_at">;

/** Open task whose due instant has passed. */
export function isOverdue(task: DueLike, now: Date = new Date()): boolean {
  if (!task.due_at || !isOpenStatus(task.status)) return false;
  const due = new Date(task.due_at).getTime();
  return Number.isFinite(due) && due < now.getTime();
}

/** Open task due on today's Riyadh calendar day (and not yet overdue). */
export function isDueToday(task: DueLike, now: Date = new Date()): boolean {
  if (!task.due_at || !isOpenStatus(task.status)) return false;
  return riyadhDateOf(task.due_at) === todayInRiyadh(now) && !isOverdue(task, now);
}

/** Riyadh calendar day of a due timestamp (YYYY-MM-DD), for calendar cells. */
export function dueDayInRiyadh(dueAt: string | null): string | null {
  if (!dueAt) return null;
  const d = new Date(dueAt);
  return Number.isNaN(d.getTime()) ? null : riyadhDateOf(d);
}

/**
 * A due DATE picked in the UI (YYYY-MM-DD, Riyadh) → end of that Riyadh day as UTC ISO
 * (23:59:59 +03:00), so a task due "today" is not overdue until the day ends.
 */
export function riyadhDueDateToIso(ymd: string): string {
  if (!YMD_RE.test(ymd)) throw new Error("INVALID_DATE");
  const iso = new Date(`${ymd}T23:59:59${RIYADH_UTC_OFFSET}`);
  if (Number.isNaN(iso.getTime()) || riyadhDateOf(iso) !== ymd) throw new Error("INVALID_DATE");
  return iso.toISOString();
}

/** Inclusive Riyadh date range → [startIso, endIsoExclusive) UTC bounds for queries. */
export function riyadhRangeToUtc(fromYmd: string, toYmd: string): { startIso: string; endIso: string } {
  if (!YMD_RE.test(fromYmd) || !YMD_RE.test(toYmd)) throw new Error("INVALID_DATE");
  const start = new Date(`${fromYmd}T00:00:00${RIYADH_UTC_OFFSET}`);
  const end = new Date(`${addDaysYmd(toYmd, 1)}T00:00:00${RIYADH_UTC_OFFSET}`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) throw new Error("INVALID_DATE");
  return { startIso: start.toISOString(), endIso: end.toISOString() };
}

/**
 * Month grid bounds for a calendar view: first/last visible day (weeks start on Saturday
 * by default, Saudi convention; pass 0 for Sunday, 1 for Monday). `month` is 1–12.
 */
export function calendarGridRange(
  year: number,
  month: number,
  weekStartsOn: 0 | 1 | 6 = 6,
): { from: string; to: string; days: string[] } {
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error("INVALID_DATE");
  }
  const first = new Date(Date.UTC(year, month - 1, 1));
  const last = new Date(Date.UTC(year, month, 0));
  const lead = (first.getUTCDay() - weekStartsOn + 7) % 7;
  const trail = (weekStartsOn + 6 - last.getUTCDay() + 7) % 7;
  const from = addDaysYmd(first.toISOString().slice(0, 10), -lead);
  const to = addDaysYmd(last.toISOString().slice(0, 10), trail);
  const days: string[] = [];
  for (let d = from; d <= to; d = addDaysYmd(d, 1)) days.push(d);
  return { from, to, days };
}

// ---------------------------------------------------------------------------
// Performance math (mirrors task_performance in 091)
// ---------------------------------------------------------------------------

type CompletionLike = Pick<Task, "status" | "due_at" | "completed_at">;

/** Hours from creation to completion, one decimal; null when not completed. */
export function cycleHours(createdAt: string, completedAt: string | null): number | null {
  if (!completedAt) return null;
  const ms = new Date(completedAt).getTime() - new Date(createdAt).getTime();
  if (!Number.isFinite(ms)) return null;
  return Math.round((Math.max(0, ms) / 3_600_000) * 10) / 10;
}

/** Done, and completed no later than its due instant (or has no due date). */
export function isCompletedOnTime(task: CompletionLike): boolean {
  if (task.status !== "done" || !task.completed_at) return false;
  if (!task.due_at) return true;
  return new Date(task.completed_at).getTime() <= new Date(task.due_at).getTime();
}

/** Points credited for a task: full when done on time, half when late, 0 otherwise. */
export function pointsEarned(task: CompletionLike & Pick<Task, "points">): number {
  if (task.status !== "done" || !task.completed_at) return 0;
  return isCompletedOnTime(task) ? task.points : task.points * 0.5;
}

/** Minutes elapsed on a running timer (floored, never negative). */
export function runningMinutes(startedAt: string, now: Date = new Date()): number {
  const ms = now.getTime() - new Date(startedAt).getTime();
  return Number.isFinite(ms) ? Math.max(0, Math.floor(ms / 60_000)) : 0;
}

/** Minutes between two instants, rounded (as the SQL trigger does on stop). */
export function minutesBetween(startedAt: string, endedAt: string): number {
  const ms = new Date(endedAt).getTime() - new Date(startedAt).getTime();
  return Number.isFinite(ms) ? Math.max(0, Math.round(ms / 60_000)) : 0;
}

/** 135 → { hours: 2, minutes: 15 } for "2h 15m" / "2س 15د" formatting. */
export function splitMinutes(total: number): { hours: number; minutes: number } {
  const safe = Math.max(0, Math.round(total || 0));
  return { hours: Math.floor(safe / 60), minutes: safe % 60 };
}

// ---------------------------------------------------------------------------
// Sorting
// ---------------------------------------------------------------------------

export type TaskSortKey = "manual" | "due" | "priority" | "status" | "created" | "title";

type Sortable = Pick<Task, "sort_order" | "due_at" | "priority" | "status" | "created_at" | "title">;

function byCreated(a: Sortable, b: Sortable): number {
  return a.created_at.localeCompare(b.created_at);
}

/** Comparator for Array.prototype.sort. Ties fall back to manual order, then creation. */
export function compareTasks(sortBy: TaskSortKey = "manual") {
  return (a: Sortable, b: Sortable): number => {
    let diff = 0;
    switch (sortBy) {
      case "due": {
        const ad = a.due_at ? new Date(a.due_at).getTime() : Number.POSITIVE_INFINITY;
        const bd = b.due_at ? new Date(b.due_at).getTime() : Number.POSITIVE_INFINITY;
        diff = ad === bd ? 0 : ad < bd ? -1 : 1;
        break;
      }
      case "priority":
        diff = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
        break;
      case "status":
        diff = STATUS_RANK[a.status] - STATUS_RANK[b.status];
        break;
      case "created":
        diff = -byCreated(a, b);
        break;
      case "title":
        diff = a.title.localeCompare(b.title, "ar");
        break;
      default:
        diff = 0;
    }
    if (diff !== 0) return diff;
    const so = Number(a.sort_order) - Number(b.sort_order);
    return so !== 0 ? so : byCreated(a, b);
  };
}

/**
 * sort_order for a task dropped between two neighbours (either may be missing).
 * Uses the midpoint; append / prepend step is 1024.
 */
export function sortOrderBetween(before: number | null | undefined, after: number | null | undefined): number {
  const b = before ?? null;
  const a = after ?? null;
  if (b === null && a === null) return 1024;
  if (b === null) return (a as number) - 1024;
  if (a === null) return b + 1024;
  if (b === a) return b;
  return (b + a) / 2;
}

// ---------------------------------------------------------------------------
// Links, titles, capabilities
// ---------------------------------------------------------------------------

/**
 * App route for a task's linked record. `projectId` (the task list's project) is needed for
 * workflow steps and narrows RFI / NCR links. Returns null when the type has no page.
 */
export function taskEntityHref(
  entityType: string | null,
  entityId: string | null,
  context: { projectId?: string | null } = {},
): string | null {
  if (!entityType || !entityId) return null;
  const projectQuery = context.projectId ? `&project=${encodeURIComponent(context.projectId)}` : "";
  switch (entityType) {
    case "project":
      return `/projects/${entityId}`;
    case "workflow_instance_step":
      return context.projectId ? `/projects/${context.projectId}?tab=stages&stage=${entityId}` : null;
    case "approval_request":
      return "/approvals";
    case "document":
      return `/documents/${entityId}`;
    case "rfi":
      return `/engineering?module=rfi${projectQuery}`;
    case "ncr":
      return `/engineering?module=ncr${projectQuery}`;
    case "employee":
      return `/employees/${entityId}`;
    case "leave_request":
      return `/leave/${entityId}`;
    default:
      return commercialEntityHref(entityType, entityId);
  }
}

/** Detail page of a task. */
export function taskHref(taskId: string): string {
  return `/tasks/${taskId}`;
}

/** Title in the viewer's language (English title when present for 'en'). */
export function taskDisplayTitle(task: Pick<Task, "title" | "title_en">, locale: "ar" | "en"): string {
  if (locale === "en" && task.title_en && task.title_en.trim()) return task.title_en;
  return task.title;
}

export function isAutoTask(task: Pick<Task, "source">): boolean {
  return task.source !== "manual";
}

/**
 * What the viewer may do on a task. Mirrors the 091 RLS policies (can_edit_task) and the
 * auto-task guard; the database stays the authority.
 */
export function taskCapabilities(input: {
  task: Pick<Task, "source" | "created_by">;
  assigneeIds: readonly string[];
  userId: string;
  canCreate: boolean;
  canManage: boolean;
}): TaskCapabilities {
  const { task, assigneeIds, userId, canCreate, canManage } = input;
  const involved = task.created_by === userId || assigneeIds.includes(userId);
  const canEditRow = canManage || (canCreate && involved);
  const auto = isAutoTask(task);
  return {
    canEdit: canEditRow,
    canChangeStatus: canEditRow,
    canAssign: canEditRow,
    canDelete: !auto && (canManage || (canCreate && task.created_by === userId)),
    canComment: canCreate,
    canTrackTime: canCreate,
    isAutoTask: auto,
  };
}
