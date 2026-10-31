/**
 * Task workspace — zod input schemas for the server actions in src/server/use-cases/tasks.ts,
 * plus `parseTaskFilters` for page search params.
 *
 * Form conventions: an absent field is `undefined` (= leave unchanged on update); an empty
 * string or `null` on an update clears a nullable field. (The actions map absent FormData
 * fields — `formData.get()` → null — to undefined before parsing.)
 */

import { z } from "zod";
import { isPostgresUuid } from "@/lib/postgres-uuid";
import {
  TASK_ENTITY_TYPES,
  TASK_PRIORITIES,
  TASK_STATUSES,
  type TaskFilters,
  type TaskPriority,
  type TaskStatus,
} from "./types";

export const postgresUuid = z.string().refine(isPostgresUuid, { message: "Invalid uuid" });

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME_LOCAL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;

const blankToUndefined = (v: unknown) => (v === null || v === undefined || v === "" ? undefined : v);
const blankToNull = (v: unknown) => (v === "" ? null : v);
const trimmed = (v: unknown) => (typeof v === "string" ? v.trim() : v);

/** Required trimmed text. */
const text = (max: number) => z.preprocess(trimmed, z.string().min(1).max(max));
/** Optional on create: blank → undefined. */
const optText = (max: number) => z.preprocess((v) => blankToUndefined(trimmed(v)), z.string().max(max).optional());
/** On update: absent → undefined (unchanged), blank → null (clear). */
const clearableText = (max: number) =>
  z.preprocess((v) => blankToNull(trimmed(v)), z.string().max(max).nullable().optional());

const optUuid = z.preprocess(blankToUndefined, postgresUuid.optional());
const clearableUuid = z.preprocess(blankToNull, postgresUuid.nullable().optional());
const optInt = (min: number, max: number) =>
  z.preprocess(blankToUndefined, z.coerce.number().int().min(min).max(max).optional());
const clearableInt = (min: number, max: number) =>
  z.preprocess(blankToNull, z.coerce.number().int().min(min).max(max).nullable().optional());
const optYmd = z.preprocess(blankToUndefined, z.string().regex(YMD).optional());
const clearableYmd = z.preprocess(blankToNull, z.string().regex(YMD).nullable().optional());
/** `<input type="datetime-local">` value typed in Riyadh time. */
const clearableDateTimeLocal = z.preprocess(blankToNull, z.string().regex(DATETIME_LOCAL).nullable().optional());

export const taskStatusSchema = z.enum(TASK_STATUSES);
export const taskPrioritySchema = z.enum(TASK_PRIORITIES);
export const taskEntityTypeSchema = z.enum(TASK_ENTITY_TYPES);

const hexColor = z.preprocess(
  (v) => blankToUndefined(trimmed(v)),
  z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
);

// ---------------------------------------------------------------------------
// Spaces & lists
// ---------------------------------------------------------------------------

export const createSpaceSchema = z.object({
  nameAr: text(120),
  nameEn: text(120),
  color: hexColor,
  icon: optText(40),
  departmentId: optUuid,
  sortOrder: optInt(-100000, 100000),
});
export type CreateSpaceInput = z.infer<typeof createSpaceSchema>;

export const updateSpaceSchema = z.object({
  spaceId: postgresUuid,
  nameAr: optText(120),
  nameEn: optText(120),
  color: hexColor,
  icon: clearableText(40),
  departmentId: clearableUuid,
  sortOrder: optInt(-100000, 100000),
});
export type UpdateSpaceInput = z.infer<typeof updateSpaceSchema>;

const formBool = z.preprocess((v) => {
  if (v === undefined || v === null || v === "") return undefined;
  if (typeof v === "boolean") return v;
  return v === "true" || v === "on" || v === "1";
}, z.boolean().optional());

export const archiveSpaceSchema = z.object({
  spaceId: postgresUuid,
  /** false = restore. Default true. */
  archived: formBool,
});

export const createListSchema = z.object({
  spaceId: postgresUuid,
  nameAr: text(160),
  nameEn: optText(160),
  sortOrder: optInt(-100000, 100000),
});
export type CreateListInput = z.infer<typeof createListSchema>;

export const updateListSchema = z.object({
  listId: postgresUuid,
  nameAr: optText(160),
  nameEn: optText(160),
  /** Move to another space (manual lists only). */
  spaceId: optUuid,
  sortOrder: optInt(-100000, 100000),
});
export type UpdateListInput = z.infer<typeof updateListSchema>;

export const archiveListSchema = z.object({
  listId: postgresUuid,
  archived: formBool,
});

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

const assigneeIdsSchema = z.preprocess((v) => {
  if (v === undefined || v === null || v === "") return undefined;
  if (Array.isArray(v)) return v.filter((x) => x !== "");
  return String(v)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}, z.array(postgresUuid).max(20).optional());

/**
 * Create a task. Quick-add needs only `title` + `listId`; a subtask needs `title` +
 * `parentTaskId` (its list is the parent's). Due: `dueDate` (Riyadh day, due end of day) or
 * `dueAt` (datetime-local in Riyadh time); `dueAt` wins when both are given.
 */
export const createTaskSchema = z
  .object({
    listId: optUuid,
    parentTaskId: optUuid,
    title: text(500),
    titleEn: optText(500),
    description: optText(20000),
    status: z.preprocess(blankToUndefined, taskStatusSchema.optional()),
    priority: z.preprocess(blankToUndefined, taskPrioritySchema.optional()),
    startDate: optYmd,
    dueDate: optYmd,
    dueAt: z.preprocess(blankToUndefined, z.string().regex(DATETIME_LOCAL).optional()),
    estimateMinutes: optInt(0, 100000),
    points: optInt(0, 100),
    entityType: z.preprocess(blankToUndefined, taskEntityTypeSchema.optional()),
    entityId: optUuid,
    assigneeIds: assigneeIdsSchema,
  })
  .refine((v) => Boolean(v.listId || v.parentTaskId), { path: ["listId"], message: "listId required" })
  .refine((v) => Boolean(v.entityType) === Boolean(v.entityId), { path: ["entityId"], message: "entity pair" });
export type CreateTaskInput = z.infer<typeof createTaskSchema>;

/** Partial update; absent = unchanged, blank = cleared. Auto tasks ignore locked fields. */
export const updateTaskSchema = z
  .object({
    taskId: postgresUuid,
    title: optText(500),
    titleEn: clearableText(500),
    description: clearableText(20000),
    priority: z.preprocess(blankToUndefined, taskPrioritySchema.optional()),
    status: z.preprocess(blankToUndefined, taskStatusSchema.optional()),
    startDate: clearableYmd,
    dueDate: clearableYmd,
    dueAt: clearableDateTimeLocal,
    estimateMinutes: clearableInt(0, 100000),
    points: optInt(0, 100),
    /** Move to another list (top-level manual tasks only). */
    listId: optUuid,
    entityType: z.preprocess(blankToNull, taskEntityTypeSchema.nullable().optional()),
    entityId: clearableUuid,
  })
  .refine(
    (v) =>
      (v.entityType === undefined && v.entityId === undefined) ||
      (v.entityType === null && v.entityId === null) ||
      (typeof v.entityType === "string" && typeof v.entityId === "string"),
    { path: ["entityId"], message: "entity pair" },
  );
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;

export const taskIdSchema = z.object({ taskId: postgresUuid });

export const setTaskStatusSchema = z.object({
  taskId: postgresUuid,
  status: taskStatusSchema,
});

/**
 * Board / list reorder: drop `taskId` between `beforeId` (the task above) and `afterId`
 * (the task below), optionally into another status column.
 */
export const reorderTaskSchema = z.object({
  taskId: postgresUuid,
  beforeId: optUuid,
  afterId: optUuid,
  status: z.preprocess(blankToUndefined, taskStatusSchema.optional()),
});
export type ReorderTaskInput = z.infer<typeof reorderTaskSchema>;

export const assignTaskSchema = z.object({
  taskId: postgresUuid,
  profileId: postgresUuid,
});

export const addCommentSchema = z.object({
  taskId: postgresUuid,
  body: text(10000),
});

// ---------------------------------------------------------------------------
// Time tracking
// ---------------------------------------------------------------------------

export const startTimerSchema = z.object({
  taskId: postgresUuid,
  note: optText(1000),
});

export const stopTimerSchema = z.object({
  /** Optional: defaults to the caller's running entry. */
  entryId: optUuid,
  note: optText(1000),
});

/** Manual entry: hours + minutes (total 1–1440) on a Riyadh date (default today). */
export const addManualTimeEntrySchema = z
  .object({
    taskId: postgresUuid,
    date: optYmd,
    hours: z.preprocess(blankToUndefined, z.coerce.number().int().min(0).max(24).optional()),
    minutes: z.preprocess(blankToUndefined, z.coerce.number().int().min(0).max(1440).optional()),
    note: optText(1000),
  })
  .refine(
    (v) => {
      const total = (v.hours ?? 0) * 60 + (v.minutes ?? 0);
      return total >= 1 && total <= 1440;
    },
    { path: ["minutes"], message: "duration 1-1440" },
  );
export type AddManualTimeEntryInput = z.infer<typeof addManualTimeEntrySchema>;

export const deleteTimeEntrySchema = z.object({ entryId: postgresUuid });

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export const performanceQuerySchema = z
  .object({
    from: z.string().regex(YMD),
    to: z.string().regex(YMD),
    spaceId: optUuid,
  })
  .refine((v) => v.from <= v.to, { path: ["to"], message: "range" });

type SearchParamValue = string | string[] | undefined;

function firstParam(value: SearchParamValue): string | undefined {
  const v = Array.isArray(value) ? value[0] : value;
  const t = v?.trim();
  return t ? t : undefined;
}

function listParam<T extends string>(value: SearchParamValue, allowed: readonly T[]): T[] | undefined {
  const raw = Array.isArray(value) ? value.join(",") : value;
  if (!raw) return undefined;
  const out = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is T => (allowed as readonly string[]).includes(s));
  return out.length ? [...new Set(out)] : undefined;
}

/**
 * Page search params → TaskFilters (invalid values are dropped, never thrown).
 * Keys: list, space, assignee ("me" → `meProfileId`, "none" → unassigned), status (csv),
 * priority (csv), dueFrom, dueTo, overdue=1, q, closed=1, subtasks=1.
 */
export function parseTaskFilters(
  params: Record<string, SearchParamValue>,
  meProfileId?: string,
): TaskFilters {
  const filters: TaskFilters = {};
  const list = firstParam(params.list);
  if (list && isPostgresUuid(list)) filters.listId = list;
  const space = firstParam(params.space);
  if (space && isPostgresUuid(space)) filters.spaceId = space;
  const assignee = firstParam(params.assignee);
  if (assignee === "me" && meProfileId) filters.assigneeId = meProfileId;
  else if (assignee === "none") filters.unassigned = true;
  else if (assignee && isPostgresUuid(assignee)) filters.assigneeId = assignee;
  const status = listParam<TaskStatus>(params.status, TASK_STATUSES);
  if (status) filters.status = status;
  const priority = listParam<TaskPriority>(params.priority, TASK_PRIORITIES);
  if (priority) filters.priority = priority;
  const dueFrom = firstParam(params.dueFrom);
  if (dueFrom && YMD.test(dueFrom)) filters.dueFrom = dueFrom;
  const dueTo = firstParam(params.dueTo);
  if (dueTo && YMD.test(dueTo)) filters.dueTo = dueTo;
  if (firstParam(params.overdue) === "1") filters.overdueOnly = true;
  const q = firstParam(params.q);
  if (q) filters.search = q.slice(0, 120);
  if (firstParam(params.closed) === "1") filters.includeClosed = true;
  if (firstParam(params.subtasks) === "1") filters.includeSubtasks = true;
  return filters;
}
