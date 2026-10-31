/**
 * /tasks workspace — view models, URL helpers and status / priority styling.
 * Pure (no I/O, no hooks): safe for server and client components.
 *
 * Display strings that depend on Intl (due dates) are produced on the server and passed to the
 * client islands as plain strings, so server and browser ICU differences cannot cause hydration
 * mismatches.
 */

import { format, intlLocale, pickLocalized, type Locale } from "@/lib/i18n/config";
import type { Dictionary } from "@/lib/i18n/dictionaries/ar";
import { isDueToday, isOverdue, taskCapabilities, taskDisplayTitle, taskEntityHref, taskHref } from "@/modules/tasks/logic";
import type { TaskListItem, TaskPerson, TaskPriority, TaskStatus } from "@/modules/tasks/types";

export type WorkspaceView = "list" | "board" | "calendar";
export const WORKSPACE_VIEWS: readonly WorkspaceView[] = ["list", "board", "calendar"];

export type WorkspaceSort = "manual" | "due" | "priority" | "updated";
export const WORKSPACE_SORTS: readonly WorkspaceSort[] = ["manual", "due", "priority", "updated"];

export type DueFilter = "overdue" | "today" | "week" | "none";
export const DUE_FILTERS: readonly DueFilter[] = ["overdue", "today", "week", "none"];

/** Search params the workspace understands (everything else is dropped from generated links). */
export const WORKSPACE_PARAM_KEYS = [
  "list",
  "space",
  "assignee",
  "status",
  "priority",
  "due",
  "q",
  "sort",
  "closed",
  "view",
  "month",
] as const;
export type WorkspaceParamKey = (typeof WORKSPACE_PARAM_KEYS)[number];
export type WorkspaceParams = Partial<Record<WorkspaceParamKey, string>>;

type RawParams = Record<string, string | string[] | undefined>;

export function pickWorkspaceParams(raw: RawParams): WorkspaceParams {
  const out: WorkspaceParams = {};
  for (const key of WORKSPACE_PARAM_KEYS) {
    const v = raw[key];
    const value = (Array.isArray(v) ? v.join(",") : v)?.trim();
    if (value) out[key] = value;
  }
  return out;
}

/** `/tasks?...` keeping `base` and applying `overrides` (null / "" removes a key). */
export function tasksHref(base: WorkspaceParams, overrides: Partial<Record<WorkspaceParamKey, string | null>> = {}): string {
  const qs = new URLSearchParams();
  for (const key of WORKSPACE_PARAM_KEYS) {
    const value = key in overrides ? overrides[key] : base[key];
    if (value) qs.set(key, value);
  }
  const s = qs.toString();
  return s ? `/tasks?${s}` : "/tasks";
}

// ---------------------------------------------------------------------------
// Styling
// ---------------------------------------------------------------------------

/** Status colors: todo neutral, in_progress info, review warning, done success, cancelled muted. */
export const STATUS_STYLE: Record<TaskStatus, { dot: string; soft: string; text: string; bar: string }> = {
  todo: { dot: "bg-muted", soft: "bg-surface-strong", text: "text-ink", bar: "bg-muted/60" },
  in_progress: { dot: "bg-info", soft: "bg-info-soft", text: "text-info", bar: "bg-info" },
  review: { dot: "bg-warning", soft: "bg-warning-soft", text: "text-warning", bar: "bg-warning" },
  done: { dot: "bg-success", soft: "bg-success-soft", text: "text-success", bar: "bg-success" },
  cancelled: { dot: "bg-muted/50", soft: "bg-surface-muted", text: "text-muted", bar: "bg-muted/30" },
};

/** Priority colors: urgent danger, high warning, normal info, low muted. */
export const PRIORITY_STYLE: Record<TaskPriority, { text: string; soft: string }> = {
  urgent: { text: "text-danger", soft: "bg-danger-soft" },
  high: { text: "text-warning", soft: "bg-warning-soft" },
  normal: { text: "text-info", soft: "bg-info-soft" },
  low: { text: "text-muted", soft: "bg-surface-strong" },
};

// ---------------------------------------------------------------------------
// View model
// ---------------------------------------------------------------------------

export type TaskPersonView = { id: string; name: string; initials: string };

export type TaskView = {
  id: string;
  href: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  sortOrder: number;
  dueAt: string | null;
  /** Localized Riyadh date, e.g. "3 Nov". */
  dueLabel: string | null;
  dueTone: "overdue" | "today" | "normal" | null;
  assignees: TaskPersonView[];
  subtaskDone: number;
  subtaskTotal: number;
  commentCount: number;
  entity: { label: string; href: string | null } | null;
  isAuto: boolean;
  isSubtask: boolean;
  /** List name, shown when the view spans several lists. */
  listName: string | null;
  listColor: string | null;
  canChangeStatus: boolean;
};

export type ListMeta = { name: string; projectId: string | null; color: string | null };

export function personInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function personView(p: TaskPerson, locale: Locale): TaskPersonView {
  const name = pickLocalized(locale, p.full_name_ar, p.full_name_en) || "—";
  return { id: p.profile_id, name, initials: personInitials(name) };
}

export function dueDateFormatter(locale: Locale, withYear = false): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat(intlLocale(locale), {
    day: "numeric",
    month: "short",
    ...(withYear ? { year: "numeric" } : {}),
    calendar: "gregory",
    timeZone: "Asia/Riyadh",
  });
}

export function buildTaskViews(
  tasks: readonly TaskListItem[],
  options: {
    locale: Locale;
    t: Dictionary;
    lists: ReadonlyMap<string, ListMeta>;
    showListName: boolean;
    viewer: { userId: string; canCreate: boolean; canManage: boolean };
    now?: Date;
  },
): TaskView[] {
  const { locale, t, lists, showListName, viewer } = options;
  const now = options.now ?? new Date();
  const fmt = dueDateFormatter(locale);
  const thisYear = now.getUTCFullYear();
  const fmtYear = dueDateFormatter(locale, true);
  return tasks.map((task) => {
    const list = lists.get(task.list_id);
    const caps = taskCapabilities({
      task,
      assigneeIds: task.assignees.map((a) => a.profile_id),
      userId: viewer.userId,
      canCreate: viewer.canCreate,
      canManage: viewer.canManage,
    });
    let dueLabel: string | null = null;
    let dueTone: TaskView["dueTone"] = null;
    if (task.due_at) {
      const due = new Date(task.due_at);
      dueLabel = (due.getUTCFullYear() === thisYear ? fmt : fmtYear).format(due);
      dueTone = isOverdue(task, now) ? "overdue" : isDueToday(task, now) ? "today" : "normal";
    }
    const entityLabel = task.entity_type ? t.tasks.entityType[task.entity_type] : null;
    return {
      id: task.id,
      href: taskHref(task.id),
      title: taskDisplayTitle(task, locale),
      status: task.status,
      priority: task.priority,
      sortOrder: Number(task.sort_order) || 0,
      dueAt: task.due_at,
      dueLabel,
      dueTone,
      assignees: task.assignees.map((a) => personView(a, locale)),
      subtaskDone: task.subtask_done_count,
      subtaskTotal: task.subtask_count,
      commentCount: task.comment_count,
      entity: entityLabel
        ? { label: entityLabel, href: taskEntityHref(task.entity_type, task.entity_id, { projectId: list?.projectId }) }
        : null,
      isAuto: task.source !== "manual",
      isSubtask: Boolean(task.parent_task_id),
      listName: showListName ? (list?.name ?? null) : null,
      listColor: showListName ? (list?.color ?? null) : null,
      canChangeStatus: caps.canChangeStatus,
    };
  });
}

/** Accessible label for a toggle: "Mark … as done" / "Reopen …". */
export function toggleLabel(t: Dictionary, view: Pick<TaskView, "title" | "status">): string {
  return format(view.status === "done" ? t.tasksWorkspace.list.reopen : t.tasksWorkspace.list.markDone, {
    title: view.title,
  });
}
