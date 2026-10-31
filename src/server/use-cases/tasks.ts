"use server";

import "server-only";

/**
 * Task workspace server actions (091, docs/TASKS.md).
 *
 * Two calling styles:
 *  - `xxxAction(prev, formData)` — for `useActionState` / `<form action>`; returns
 *    TaskActionState ({ ok, message?, id? } | null, FormActionState-compatible).
 *  - plain functions (`setTaskStatus(taskId, status)`, `reorderTask({...})`, `assignTask`,
 *    `unassignTask`, `startTimer`, `stopTimer`, `quickAddTask`) — callable directly from client
 *    components (board drag, optimistic UI); same result shape, never throw.
 *
 * All writes use the caller's Supabase session (RLS from 091 is the authority); permission
 * checks here give friendly bilingual messages first. Every mutation revalidates the /tasks
 * layout (list, board, calendar, detail and performance pages).
 */

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getAuthContext } from "@/server/context";
import { authorize, hasPermission } from "@/server/policies/authorize";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { DatabaseError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { formActionFailure } from "@/server/forms/form-state";
import { getLocale } from "@/lib/i18n/server";
import { AuditService } from "@/server/services/audit.service";
import { createNotificationService } from "@/server/services/notification.service";
import { logger } from "@/lib/logger";
import type { PermissionKey } from "@/lib/permissions/catalog";
import type { AuthContext } from "@/types/models";
import { riyadhDateOf, riyadhLocalInputToIso, RIYADH_UTC_OFFSET, todayInRiyadh } from "@/lib/time/riyadh";
import { tasksAr } from "@/lib/i18n/dictionaries/tasks.ar";
import { tasksEn } from "@/lib/i18n/dictionaries/tasks.en";
import { TaskRepository } from "@/server/repositories/task.repository";
import { riyadhDueDateToIso, sortOrderBetween, taskCapabilities, taskHref } from "@/modules/tasks/logic";
import {
  addCommentSchema,
  addManualTimeEntrySchema,
  archiveListSchema,
  archiveSpaceSchema,
  assignTaskSchema,
  createListSchema,
  createSpaceSchema,
  createTaskSchema,
  deleteTimeEntrySchema,
  reorderTaskSchema,
  setTaskStatusSchema,
  startTimerSchema,
  stopTimerSchema,
  taskIdSchema,
  updateListSchema,
  updateSpaceSchema,
  updateTaskSchema,
  type CreateTaskInput,
  type ReorderTaskInput,
} from "@/modules/tasks/schemas";
import type { Task, TaskActionState, TaskCapabilities, TaskStatus } from "@/modules/tasks/types";

// ---------------------------------------------------------------------------
// Plumbing
// ---------------------------------------------------------------------------

type MessageKey = keyof typeof tasksAr.messages;

function invalid(key: MessageKey): ValidationError {
  return new ValidationError(tasksAr.messages[key], tasksEn.messages[key]);
}

function notFound(key: "taskNotFound" | "listNotFound" | "spaceNotFound" | "timeEntryNotFound"): NotFoundError {
  return new NotFoundError(tasksAr.messages[key], tasksEn.messages[key]);
}

/** Maps 091 trigger / constraint errors to bilingual messages. */
function dbFail(error: { message?: string; code?: string } | null): never {
  const msg = error?.message ?? "";
  if (msg.includes("TASK_AUTO_LOCKED")) throw invalid("autoTaskLocked");
  if (msg.includes("TASK_SUBTASK_DEPTH")) throw invalid("subtaskDepth");
  if (msg.includes("TASK_SYSTEM_LOCKED")) throw invalid("systemLocked");
  if (msg.includes("tasks_start_before_due_check")) throw invalid("startAfterDue");
  if (msg.includes("task_time_entries_running_uidx")) throw invalid("unexpected");
  if (error?.code === "42501") throw new ForbiddenError({ source: "rls" });
  throw new DatabaseError(error);
}

type Session = {
  ctx: AuthContext;
  orgId: string;
  userId: string;
  supabase: SupabaseClient;
  repo: TaskRepository;
  audit: AuditService;
};

async function session(permission: PermissionKey): Promise<Session> {
  const ctx = authorize(await getAuthContext(), permission);
  const supabase = await createServerSupabaseClient();
  return {
    ctx,
    orgId: ctx.organization.id,
    userId: ctx.profile.id,
    supabase,
    repo: new TaskRepository(supabase),
    audit: new AuditService(supabase),
  };
}

async function run(impl: () => Promise<string | void>): Promise<TaskActionState> {
  try {
    const id = await impl();
    return id ? { ok: true, id } : { ok: true };
  } catch (err) {
    return formActionFailure(err, tasksAr.messages.unexpected, await getLocale());
  }
}

function revalidateTasks(taskId?: string | null) {
  revalidatePath("/tasks", "layout");
  if (taskId) revalidatePath(taskHref(taskId));
}

/** FormData → plain object; absent fields stay undefined, repeated fields become arrays. */
function fields(formData: FormData, keys: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    if (!formData.has(key)) continue;
    const all = formData.getAll(key).filter((v): v is string => typeof v === "string");
    out[key] = all.length > 1 ? all : all[0];
  }
  return out;
}

function parse<T>(schema: { safeParse: (v: unknown) => { success: true; data: T } | { success: false } }, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) throw invalid("invalidInput");
  return result.data;
}

async function loadTask(s: Session, taskId: string): Promise<Task> {
  const task = await s.repo.getTask(s.orgId, taskId);
  if (!task) throw notFound("taskNotFound");
  return task;
}

async function capabilitiesFor(s: Session, task: Task): Promise<TaskCapabilities> {
  return taskCapabilities({
    task,
    assigneeIds: await s.repo.listAssigneeIds(task.id),
    userId: s.userId,
    canCreate: hasPermission(s.ctx, "task.create"),
    canManage: hasPermission(s.ctx, "task.manage"),
  });
}

/** Due input → ISO (undefined = unchanged, null = clear). `dueAt` (datetime-local) wins. */
function resolveDue(input: { dueDate?: string | null; dueAt?: string | null }): string | null | undefined {
  try {
    if (typeof input.dueAt === "string") return riyadhLocalInputToIso(input.dueAt);
    if (typeof input.dueDate === "string") return riyadhDueDateToIso(input.dueDate);
  } catch {
    throw invalid("invalidDate");
  }
  if (input.dueAt === null || input.dueDate === null) return null;
  return undefined;
}

function assertStartBeforeDue(startDate: string | null | undefined, dueIso: string | null | undefined) {
  if (startDate && dueIso && startDate > riyadhDateOf(dueIso)) throw invalid("startAfterDue");
}

async function assertActiveMembers(s: Session, profileIds: readonly string[]) {
  if (profileIds.length === 0) return;
  const unique = [...new Set(profileIds)];
  const { data, error } = await s.supabase
    .from("organization_members")
    .select("profile_id")
    .eq("organization_id", s.orgId)
    .eq("status", "active")
    .in("profile_id", unique);
  if (error) dbFail(error);
  const found = new Set(((data ?? []) as Array<{ profile_id: string }>).map((r) => r.profile_id));
  if (unique.some((id) => !found.has(id))) throw invalid("assigneeNotMember");
}

function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => values[k] ?? "");
}

/** Notify a newly assigned person (never the actor). Failures are logged, not thrown. */
async function notifyAssigned(s: Session, task: Pick<Task, "id" | "title" | "title_en">, profileId: string) {
  if (profileId === s.userId) return;
  try {
    const actorAr = s.ctx.profile.full_name_ar || s.ctx.profile.full_name_en;
    const actorEn = s.ctx.profile.full_name_en || s.ctx.profile.full_name_ar;
    await createNotificationService(s.supabase).notify({
      organizationId: s.orgId,
      recipientProfileId: profileId,
      type: "task.assigned",
      title: tasksAr.messages.notifyAssignedTitle,
      titleEn: tasksEn.messages.notifyAssignedTitle,
      message: fill(tasksAr.messages.notifyAssignedMessage, { actor: actorAr, title: task.title }),
      messageEn: fill(tasksEn.messages.notifyAssignedMessage, {
        actor: actorEn,
        title: task.title_en || task.title,
      }),
      entityType: "task",
      entityId: task.id,
      href: taskHref(task.id),
      priority: "normal",
      dedupKey: `task.assigned:${task.id}:${profileId}:${Date.now()}`,
    });
  } catch (error) {
    logger.warn("task assignment notification failed", {
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}

// ---------------------------------------------------------------------------
// Spaces (task.manage)
// ---------------------------------------------------------------------------

const SPACE_FIELDS = ["spaceId", "nameAr", "nameEn", "color", "icon", "departmentId", "sortOrder", "archived"] as const;

/** Form: nameAr, nameEn, color?, icon?, departmentId?, sortOrder?. Returns `id`. */
export async function createSpaceAction(_prev: TaskActionState, formData: FormData): Promise<TaskActionState> {
  return run(async () => {
    const s = await session("task.manage");
    const input = parse(createSpaceSchema, fields(formData, SPACE_FIELDS));
    const { data, error } = await s.supabase
      .from("task_spaces")
      .insert({
        organization_id: s.orgId,
        name_ar: input.nameAr,
        name_en: input.nameEn,
        color: input.color ?? "#6366f1",
        icon: input.icon ?? null,
        department_id: input.departmentId ?? null,
        sort_order: input.sortOrder ?? 100,
        created_by: s.userId,
      })
      .select("id")
      .single<{ id: string }>();
    if (error || !data) dbFail(error);
    await s.audit.log({
      organizationId: s.orgId,
      action: "task_space.created",
      entityType: "task_space",
      entityId: data.id,
      newValues: { name_ar: input.nameAr, name_en: input.nameEn },
    });
    revalidateTasks();
    return data.id;
  });
}

/** Form: spaceId + any of nameAr, nameEn, color, icon ("" clears), departmentId ("" clears), sortOrder. */
export async function updateSpaceAction(_prev: TaskActionState, formData: FormData): Promise<TaskActionState> {
  return run(async () => {
    const s = await session("task.manage");
    const input = parse(updateSpaceSchema, fields(formData, SPACE_FIELDS));
    const space = await s.repo.getSpace(s.orgId, input.spaceId);
    if (!space) throw notFound("spaceNotFound");
    const patch: Record<string, unknown> = {};
    if (input.nameAr !== undefined) patch.name_ar = input.nameAr;
    if (input.nameEn !== undefined) patch.name_en = input.nameEn;
    if (input.color !== undefined) patch.color = input.color;
    if (input.icon !== undefined) patch.icon = input.icon;
    if (input.departmentId !== undefined) patch.department_id = input.departmentId;
    if (input.sortOrder !== undefined) patch.sort_order = input.sortOrder;
    if (Object.keys(patch).length === 0) return;
    const { error } = await s.supabase.from("task_spaces").update(patch).eq("id", space.id).eq("organization_id", s.orgId);
    if (error) dbFail(error);
    await s.audit.log({
      organizationId: s.orgId,
      action: "task_space.updated",
      entityType: "task_space",
      entityId: space.id,
      previousValues: { name_ar: space.name_ar, name_en: space.name_en, color: space.color },
      newValues: patch,
    });
    revalidateTasks();
  });
}

/** Form: spaceId, archived? ("false" restores). System spaces cannot be archived. */
export async function archiveSpaceAction(_prev: TaskActionState, formData: FormData): Promise<TaskActionState> {
  return run(async () => {
    const s = await session("task.manage");
    const input = parse(archiveSpaceSchema, fields(formData, SPACE_FIELDS));
    const space = await s.repo.getSpace(s.orgId, input.spaceId);
    if (!space) throw notFound("spaceNotFound");
    const archived = input.archived ?? true;
    if (space.system_key && archived) throw invalid("systemLocked");
    const { error } = await s.supabase
      .from("task_spaces")
      .update({ is_archived: archived })
      .eq("id", space.id)
      .eq("organization_id", s.orgId);
    if (error) dbFail(error);
    await s.audit.log({
      organizationId: s.orgId,
      action: archived ? "task_space.archived" : "task_space.updated",
      entityType: "task_space",
      entityId: space.id,
      newValues: { is_archived: archived },
    });
    revalidateTasks();
  });
}

// ---------------------------------------------------------------------------
// Lists (task.create; edit = creator or task.manage)
// ---------------------------------------------------------------------------

const LIST_FIELDS = ["listId", "spaceId", "nameAr", "nameEn", "sortOrder", "archived"] as const;

/** Form: spaceId, nameAr, nameEn? (defaults to nameAr), sortOrder?. Returns `id`. */
export async function createListAction(_prev: TaskActionState, formData: FormData): Promise<TaskActionState> {
  return run(async () => {
    const s = await session("task.create");
    const input = parse(createListSchema, fields(formData, LIST_FIELDS));
    const space = await s.repo.getSpace(s.orgId, input.spaceId);
    if (!space) throw notFound("spaceNotFound");
    if (space.is_archived) throw invalid("spaceArchived");
    if (space.system_key === "projects") throw invalid("systemLocked");
    const { data, error } = await s.supabase
      .from("task_lists")
      .insert({
        organization_id: s.orgId,
        space_id: space.id,
        name_ar: input.nameAr,
        name_en: input.nameEn ?? input.nameAr,
        sort_order: input.sortOrder ?? 100,
        created_by: s.userId,
      })
      .select("id")
      .single<{ id: string }>();
    if (error || !data) dbFail(error);
    await s.audit.log({
      organizationId: s.orgId,
      action: "task_list.created",
      entityType: "task_list",
      entityId: data.id,
      newValues: { space_id: space.id, name_ar: input.nameAr },
    });
    revalidateTasks();
    return data.id;
  });
}

async function loadEditableList(s: Session, listId: string) {
  const list = await s.repo.getList(s.orgId, listId);
  if (!list) throw notFound("listNotFound");
  if (list.project_id || list.system_key) throw invalid("systemLocked");
  if (!hasPermission(s.ctx, "task.manage") && list.created_by !== s.userId) throw new ForbiddenError();
  return list;
}

/** Form: listId + any of nameAr, nameEn, spaceId (move), sortOrder. Project / system lists are locked. */
export async function updateListAction(_prev: TaskActionState, formData: FormData): Promise<TaskActionState> {
  return run(async () => {
    const s = await session("task.create");
    const input = parse(updateListSchema, fields(formData, LIST_FIELDS));
    const list = await loadEditableList(s, input.listId);
    const patch: Record<string, unknown> = {};
    if (input.nameAr !== undefined) patch.name_ar = input.nameAr;
    if (input.nameEn !== undefined) patch.name_en = input.nameEn;
    if (input.sortOrder !== undefined) patch.sort_order = input.sortOrder;
    if (input.spaceId !== undefined && input.spaceId !== list.space_id) {
      const target = await s.repo.getSpace(s.orgId, input.spaceId);
      if (!target) throw notFound("spaceNotFound");
      if (target.is_archived) throw invalid("spaceArchived");
      if (target.system_key === "projects") throw invalid("systemLocked");
      patch.space_id = target.id;
    }
    if (Object.keys(patch).length === 0) return;
    const { error } = await s.supabase.from("task_lists").update(patch).eq("id", list.id).eq("organization_id", s.orgId);
    if (error) dbFail(error);
    await s.audit.log({
      organizationId: s.orgId,
      action: "task_list.updated",
      entityType: "task_list",
      entityId: list.id,
      previousValues: { name_ar: list.name_ar, name_en: list.name_en, space_id: list.space_id },
      newValues: patch,
    });
    revalidateTasks();
  });
}

/** Form: listId, archived? ("false" restores). */
export async function archiveListAction(_prev: TaskActionState, formData: FormData): Promise<TaskActionState> {
  return run(async () => {
    const s = await session("task.create");
    const input = parse(archiveListSchema, fields(formData, LIST_FIELDS));
    const list = await loadEditableList(s, input.listId);
    const archived = input.archived ?? true;
    const { error } = await s.supabase
      .from("task_lists")
      .update({ is_archived: archived })
      .eq("id", list.id)
      .eq("organization_id", s.orgId);
    if (error) dbFail(error);
    await s.audit.log({
      organizationId: s.orgId,
      action: archived ? "task_list.archived" : "task_list.updated",
      entityType: "task_list",
      entityId: list.id,
      newValues: { is_archived: archived },
    });
    revalidateTasks();
  });
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

const TASK_FIELDS = [
  "taskId",
  "listId",
  "parentTaskId",
  "title",
  "titleEn",
  "description",
  "status",
  "priority",
  "startDate",
  "dueDate",
  "dueAt",
  "estimateMinutes",
  "points",
  "entityType",
  "entityId",
  "assigneeIds",
] as const;

async function createTaskImpl(s: Session, input: CreateTaskInput): Promise<string> {
  let listId: string;
  if (input.parentTaskId) {
    const parent = await loadTask(s, input.parentTaskId);
    if (parent.parent_task_id) throw invalid("subtaskDepth");
    listId = parent.list_id;
  } else {
    listId = input.listId as string;
  }
  const list = await s.repo.getList(s.orgId, listId);
  if (!list) throw notFound("listNotFound");
  if (list.is_archived) throw invalid("listArchived");

  const dueAt = resolveDue({ dueDate: input.dueDate, dueAt: input.dueAt }) ?? null;
  assertStartBeforeDue(input.startDate, dueAt);
  const assigneeIds = [...new Set(input.assigneeIds ?? [])];
  await assertActiveMembers(s, assigneeIds);

  const row: Record<string, unknown> = {
    organization_id: s.orgId,
    list_id: list.id,
    parent_task_id: input.parentTaskId ?? null,
    title: input.title,
    title_en: input.titleEn ?? null,
    description: input.description ?? null,
    status: input.status ?? "todo",
    priority: input.priority ?? "normal",
    start_date: input.startDate ?? null,
    due_at: dueAt,
    estimate_minutes: input.estimateMinutes ?? null,
    entity_type: input.entityType ?? null,
    entity_id: input.entityId ?? null,
    source: "manual",
    sort_order: Date.now() / 1000,
    created_by: s.userId,
  };
  // points omitted → database default by priority.
  if (input.points !== undefined) row.points = input.points;

  const { data, error } = await s.supabase
    .from("tasks")
    .insert(row)
    .select("id, title, title_en")
    .single<{ id: string; title: string; title_en: string | null }>();
  if (error || !data) dbFail(error);

  if (assigneeIds.length > 0) {
    const { error: aErr } = await s.supabase.from("task_assignees").insert(
      assigneeIds.map((profileId) => ({
        task_id: data.id,
        profile_id: profileId,
        organization_id: s.orgId,
        assigned_by: s.userId,
      })),
    );
    if (aErr) dbFail(aErr);
    for (const profileId of assigneeIds) await notifyAssigned(s, data, profileId);
  }

  await s.audit.log({
    organizationId: s.orgId,
    action: "task.created",
    entityType: "task",
    entityId: data.id,
    newValues: {
      list_id: list.id,
      parent_task_id: input.parentTaskId ?? null,
      title: input.title,
      priority: row.priority,
      status: row.status,
      due_at: dueAt,
      assignee_ids: assigneeIds,
    },
  });
  revalidateTasks(input.parentTaskId ?? null);
  return data.id;
}

/**
 * Form: title + (listId | parentTaskId); optional titleEn, description, status, priority,
 * startDate, dueDate | dueAt, estimateMinutes, points, entityType+entityId, assigneeIds
 * (repeated field or csv). Returns the new task `id`.
 */
export async function createTaskAction(_prev: TaskActionState, formData: FormData): Promise<TaskActionState> {
  return run(async () => {
    const s = await session("task.create");
    return createTaskImpl(s, parse(createTaskSchema, fields(formData, TASK_FIELDS)));
  });
}

/** Inline quick-add (list / board column / subtask row). Returns the new task `id`. */
export async function quickAddTask(input: {
  title: string;
  listId?: string;
  parentTaskId?: string;
  status?: TaskStatus;
  dueDate?: string;
  assigneeIds?: string[];
}): Promise<TaskActionState> {
  return run(async () => {
    const s = await session("task.create");
    return createTaskImpl(s, parse(createTaskSchema, input));
  });
}

/**
 * Form: taskId + any editable field (absent = unchanged, "" = clear). Auto tasks reject
 * changes to title / English title / list / due date / linked record.
 */
export async function updateTaskAction(_prev: TaskActionState, formData: FormData): Promise<TaskActionState> {
  return run(async () => {
    const s = await session("task.create");
    const input = parse(updateTaskSchema, fields(formData, TASK_FIELDS));
    const task = await loadTask(s, input.taskId);
    const caps = await capabilitiesFor(s, task);
    if (!caps.canEdit) throw new ForbiddenError();

    const patch: Record<string, unknown> = {};
    if (input.title !== undefined && input.title !== task.title) patch.title = input.title;
    if (input.titleEn !== undefined && input.titleEn !== task.title_en) patch.title_en = input.titleEn;
    if (input.description !== undefined) patch.description = input.description;
    if (input.priority !== undefined) patch.priority = input.priority;
    if (input.status !== undefined) patch.status = input.status;
    if (input.startDate !== undefined) patch.start_date = input.startDate;
    const due = resolveDue({ dueDate: input.dueDate, dueAt: input.dueAt });
    if (due !== undefined && due !== task.due_at && !(due && task.due_at && Date.parse(due) === Date.parse(task.due_at))) {
      patch.due_at = due;
    }
    if (input.estimateMinutes !== undefined) patch.estimate_minutes = input.estimateMinutes;
    if (input.points !== undefined) patch.points = input.points;
    if (input.entityType !== undefined && (input.entityType !== task.entity_type || input.entityId !== task.entity_id)) {
      patch.entity_type = input.entityType;
      patch.entity_id = input.entityId ?? null;
    }
    if (input.listId !== undefined && input.listId !== task.list_id) {
      if (task.parent_task_id) throw invalid("subtaskMove");
      const target = await s.repo.getList(s.orgId, input.listId);
      if (!target) throw notFound("listNotFound");
      if (target.is_archived) throw invalid("listArchived");
      patch.list_id = target.id;
    }

    if (caps.isAutoTask) {
      const locked = ["title", "title_en", "due_at", "list_id", "entity_type", "entity_id"];
      if (locked.some((k) => k in patch)) throw invalid("autoTaskLocked");
    }
    assertStartBeforeDue(
      "start_date" in patch ? (patch.start_date as string | null) : task.start_date,
      "due_at" in patch ? (patch.due_at as string | null) : task.due_at,
    );
    if (Object.keys(patch).length === 0) return task.id;

    const { error } = await s.supabase.from("tasks").update(patch).eq("id", task.id).eq("organization_id", s.orgId);
    if (error) dbFail(error);

    const previous: Record<string, unknown> = {};
    for (const key of Object.keys(patch)) previous[key] = (task as unknown as Record<string, unknown>)[key];
    await s.audit.log({
      organizationId: s.orgId,
      action: "status" in patch && Object.keys(patch).length === 1 ? "task.status_changed" : "task.updated",
      entityType: "task",
      entityId: task.id,
      previousValues: previous,
      newValues: patch,
    });
    revalidateTasks(task.id);
    return task.id;
  });
}

/** Form: taskId. Manual tasks only; creator or task.manage. Subtasks are deleted with it. */
export async function deleteTaskAction(_prev: TaskActionState, formData: FormData): Promise<TaskActionState> {
  return run(async () => {
    const s = await session("task.create");
    const { taskId } = parse(taskIdSchema, fields(formData, ["taskId"]));
    const task = await loadTask(s, taskId);
    const caps = await capabilitiesFor(s, task);
    if (caps.isAutoTask) throw invalid("autoTaskNoDelete");
    if (!caps.canDelete) throw new ForbiddenError();
    const { error } = await s.supabase.from("tasks").delete().eq("id", task.id).eq("organization_id", s.orgId);
    if (error) dbFail(error);
    await s.audit.log({
      organizationId: s.orgId,
      action: "task.deleted",
      entityType: "task",
      entityId: task.id,
      previousValues: { title: task.title, list_id: task.list_id, status: task.status, parent_task_id: task.parent_task_id },
    });
    revalidateTasks(task.parent_task_id);
  });
}

async function setTaskStatusImpl(s: Session, taskId: string, status: TaskStatus): Promise<string> {
  const task = await loadTask(s, taskId);
  if (task.status === status) return task.id;
  const caps = await capabilitiesFor(s, task);
  if (!caps.canChangeStatus) throw new ForbiddenError();
  const { error } = await s.supabase.from("tasks").update({ status }).eq("id", task.id).eq("organization_id", s.orgId);
  if (error) dbFail(error);
  await s.audit.log({
    organizationId: s.orgId,
    action: "task.status_changed",
    entityType: "task",
    entityId: task.id,
    previousValues: { status: task.status },
    newValues: { status },
  });
  revalidateTasks(task.id);
  return task.id;
}

/** Form: taskId, status. */
export async function setTaskStatusAction(_prev: TaskActionState, formData: FormData): Promise<TaskActionState> {
  return run(async () => {
    const s = await session("task.create");
    const input = parse(setTaskStatusSchema, fields(formData, ["taskId", "status"]));
    return setTaskStatusImpl(s, input.taskId, input.status);
  });
}

/** Plain call for board drag / checkbox: `await setTaskStatus(id, "done")` → { ok, message? }. */
export async function setTaskStatus(taskId: string, status: TaskStatus): Promise<TaskActionState> {
  return run(async () => {
    const s = await session("task.create");
    const input = parse(setTaskStatusSchema, { taskId, status });
    return setTaskStatusImpl(s, input.taskId, input.status);
  });
}

/**
 * Drop `taskId` between `beforeId` (above) and `afterId` (below) in the same list, optionally
 * into another status column. Plain call (board drag) → { ok, message? }.
 */
export async function reorderTask(input: ReorderTaskInput): Promise<TaskActionState> {
  return run(async () => {
    const s = await session("task.create");
    const data = parse(reorderTaskSchema, input);
    const task = await loadTask(s, data.taskId);
    const caps = await capabilitiesFor(s, task);
    if (!caps.canChangeStatus) throw new ForbiddenError();

    const neighbourIds = [data.beforeId, data.afterId].filter((v): v is string => Boolean(v) && v !== task.id);
    const orders = new Map<string, number>();
    if (neighbourIds.length) {
      const { data: rows, error } = await s.supabase
        .from("tasks")
        .select("id, sort_order")
        .eq("organization_id", s.orgId)
        .in("id", neighbourIds);
      if (error) dbFail(error);
      for (const r of (rows ?? []) as Array<{ id: string; sort_order: number }>) orders.set(r.id, Number(r.sort_order));
    }
    const sortOrder = sortOrderBetween(
      data.beforeId ? orders.get(data.beforeId) : null,
      data.afterId ? orders.get(data.afterId) : null,
    );
    const patch: Record<string, unknown> = { sort_order: sortOrder };
    if (data.status && data.status !== task.status) patch.status = data.status;
    const { error } = await s.supabase.from("tasks").update(patch).eq("id", task.id).eq("organization_id", s.orgId);
    if (error) dbFail(error);
    if (patch.status) {
      await s.audit.log({
        organizationId: s.orgId,
        action: "task.status_changed",
        entityType: "task",
        entityId: task.id,
        previousValues: { status: task.status },
        newValues: { status: patch.status },
      });
    }
    revalidateTasks(task.id);
    return task.id;
  });
}

/** Form variant of reorderTask: taskId, beforeId?, afterId?, status?. */
export async function reorderTaskAction(_prev: TaskActionState, formData: FormData): Promise<TaskActionState> {
  return reorderTask(fields(formData, ["taskId", "beforeId", "afterId", "status"]) as ReorderTaskInput);
}

// ---------------------------------------------------------------------------
// Assignees
// ---------------------------------------------------------------------------

async function assignImpl(s: Session, taskId: string, profileId: string): Promise<string> {
  const task = await loadTask(s, taskId);
  const assigneeIds = await s.repo.listAssigneeIds(task.id);
  const caps = taskCapabilities({
    task,
    assigneeIds,
    userId: s.userId,
    canCreate: hasPermission(s.ctx, "task.create"),
    canManage: hasPermission(s.ctx, "task.manage"),
  });
  if (!caps.canAssign) throw new ForbiddenError();
  if (assigneeIds.includes(profileId)) throw invalid("alreadyAssigned");
  await assertActiveMembers(s, [profileId]);
  const { error } = await s.supabase.from("task_assignees").insert({
    task_id: task.id,
    profile_id: profileId,
    organization_id: s.orgId,
    assigned_by: s.userId,
  });
  if (error) {
    if (error.code === "23505") throw invalid("alreadyAssigned");
    dbFail(error);
  }
  await notifyAssigned(s, task, profileId);
  await s.audit.log({
    organizationId: s.orgId,
    action: "task.assigned",
    entityType: "task",
    entityId: task.id,
    newValues: { profile_id: profileId },
  });
  revalidateTasks(task.id);
  return task.id;
}

async function unassignImpl(s: Session, taskId: string, profileId: string): Promise<string> {
  const task = await loadTask(s, taskId);
  const caps = await capabilitiesFor(s, task);
  if (!caps.canAssign) throw new ForbiddenError();
  const { error } = await s.supabase
    .from("task_assignees")
    .delete()
    .eq("task_id", task.id)
    .eq("profile_id", profileId);
  if (error) dbFail(error);
  await s.audit.log({
    organizationId: s.orgId,
    action: "task.unassigned",
    entityType: "task",
    entityId: task.id,
    previousValues: { profile_id: profileId },
  });
  revalidateTasks(task.id);
  return task.id;
}

/** Form: taskId, profileId. Notifies the assignee (not on self-assignment). */
export async function assignTaskAction(_prev: TaskActionState, formData: FormData): Promise<TaskActionState> {
  return run(async () => {
    const s = await session("task.create");
    const input = parse(assignTaskSchema, fields(formData, ["taskId", "profileId"]));
    return assignImpl(s, input.taskId, input.profileId);
  });
}

/** Plain call: `await assignTask(taskId, profileId)`. */
export async function assignTask(taskId: string, profileId: string): Promise<TaskActionState> {
  return run(async () => {
    const s = await session("task.create");
    const input = parse(assignTaskSchema, { taskId, profileId });
    return assignImpl(s, input.taskId, input.profileId);
  });
}

/** Form: taskId, profileId. */
export async function unassignTaskAction(_prev: TaskActionState, formData: FormData): Promise<TaskActionState> {
  return run(async () => {
    const s = await session("task.create");
    const input = parse(assignTaskSchema, fields(formData, ["taskId", "profileId"]));
    return unassignImpl(s, input.taskId, input.profileId);
  });
}

/** Plain call: `await unassignTask(taskId, profileId)`. */
export async function unassignTask(taskId: string, profileId: string): Promise<TaskActionState> {
  return run(async () => {
    const s = await session("task.create");
    const input = parse(assignTaskSchema, { taskId, profileId });
    return unassignImpl(s, input.taskId, input.profileId);
  });
}

// ---------------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------------

/** Form: taskId, body. Returns the comment `id`. */
export async function addCommentAction(_prev: TaskActionState, formData: FormData): Promise<TaskActionState> {
  return run(async () => {
    const s = await session("task.create");
    const input = parse(addCommentSchema, fields(formData, ["taskId", "body"]));
    const task = await loadTask(s, input.taskId);
    const { data, error } = await s.supabase
      .from("task_comments")
      .insert({ task_id: task.id, organization_id: s.orgId, author_id: s.userId, body: input.body })
      .select("id")
      .single<{ id: string }>();
    if (error || !data) dbFail(error);
    revalidateTasks(task.id);
    return data.id;
  });
}

// ---------------------------------------------------------------------------
// Time tracking (own entries only)
// ---------------------------------------------------------------------------

async function stopRunning(s: Session, note?: string): Promise<string | null> {
  const nowIso = new Date().toISOString();
  const patch: Record<string, unknown> = { ended_at: nowIso };
  if (note !== undefined) patch.note = note;
  const { data, error } = await s.supabase
    .from("task_time_entries")
    .update(patch)
    .eq("organization_id", s.orgId)
    .eq("profile_id", s.userId)
    .is("ended_at", null)
    .select("id, task_id");
  if (error) dbFail(error);
  const rows = (data ?? []) as Array<{ id: string; task_id: string }>;
  for (const r of rows) revalidatePath(taskHref(r.task_id));
  return rows[0]?.id ?? null;
}

async function startTimerImpl(s: Session, taskId: string, note?: string): Promise<string> {
  const task = await loadTask(s, taskId);
  await stopRunning(s);
  const { data, error } = await s.supabase
    .from("task_time_entries")
    .insert({
      task_id: task.id,
      organization_id: s.orgId,
      profile_id: s.userId,
      started_at: new Date().toISOString(),
      note: note ?? null,
    })
    .select("id")
    .single<{ id: string }>();
  if (error || !data) dbFail(error);
  revalidateTasks(task.id);
  return data.id;
}

/** Form: taskId, note?. Stops the caller's other running timer first. Returns the entry `id`. */
export async function startTimerAction(_prev: TaskActionState, formData: FormData): Promise<TaskActionState> {
  return run(async () => {
    const s = await session("task.create");
    const input = parse(startTimerSchema, fields(formData, ["taskId", "note"]));
    return startTimerImpl(s, input.taskId, input.note);
  });
}

/** Plain call: `await startTimer(taskId)` → { ok, id? }. */
export async function startTimer(taskId: string): Promise<TaskActionState> {
  return run(async () => {
    const s = await session("task.create");
    const input = parse(startTimerSchema, { taskId });
    return startTimerImpl(s, input.taskId);
  });
}

async function stopTimerImpl(s: Session, entryId?: string, note?: string): Promise<string> {
  if (entryId) {
    const entry = await s.repo.getTimeEntry(s.orgId, entryId);
    if (!entry || entry.profile_id !== s.userId) throw notFound("timeEntryNotFound");
    if (entry.ended_at) throw invalid("timerNotRunning");
  }
  const stopped = await stopRunning(s, note);
  if (!stopped) throw invalid("timerNotRunning");
  revalidateTasks();
  return stopped;
}

/** Form: entryId?, note?. Stops the caller's running timer. */
export async function stopTimerAction(_prev: TaskActionState, formData: FormData): Promise<TaskActionState> {
  return run(async () => {
    const s = await session("task.create");
    const input = parse(stopTimerSchema, fields(formData, ["entryId", "note"]));
    return stopTimerImpl(s, input.entryId, input.note);
  });
}

/** Plain call: `await stopTimer()` (or with the running entry id). */
export async function stopTimer(entryId?: string): Promise<TaskActionState> {
  return run(async () => {
    const s = await session("task.create");
    const input = parse(stopTimerSchema, { entryId });
    return stopTimerImpl(s, input.entryId);
  });
}

/** Form: taskId, hours?, minutes? (total 1–1440), date? (Riyadh YYYY-MM-DD, not future), note?. */
export async function addManualTimeEntryAction(_prev: TaskActionState, formData: FormData): Promise<TaskActionState> {
  return run(async () => {
    const s = await session("task.create");
    const input = parse(addManualTimeEntrySchema, fields(formData, ["taskId", "date", "hours", "minutes", "note"]));
    const task = await loadTask(s, input.taskId);
    const today = todayInRiyadh();
    const day = input.date ?? today;
    if (day > today) throw invalid("invalidDate");
    const minutes = (input.hours ?? 0) * 60 + (input.minutes ?? 0);
    if (minutes < 1 || minutes > 1440) throw invalid("invalidDuration");
    const started = new Date(`${day}T09:00:00${RIYADH_UTC_OFFSET}`);
    if (Number.isNaN(started.getTime())) throw invalid("invalidDate");
    const ended = new Date(started.getTime() + minutes * 60_000);
    const { data, error } = await s.supabase
      .from("task_time_entries")
      .insert({
        task_id: task.id,
        organization_id: s.orgId,
        profile_id: s.userId,
        started_at: started.toISOString(),
        ended_at: ended.toISOString(),
        minutes,
        note: input.note ?? null,
      })
      .select("id")
      .single<{ id: string }>();
    if (error || !data) dbFail(error);
    revalidateTasks(task.id);
    return data.id;
  });
}

/** Form: entryId. Own finished entries only. */
export async function deleteTimeEntryAction(_prev: TaskActionState, formData: FormData): Promise<TaskActionState> {
  return run(async () => {
    const s = await session("task.create");
    const input = parse(deleteTimeEntrySchema, fields(formData, ["entryId"]));
    const entry = await s.repo.getTimeEntry(s.orgId, input.entryId);
    if (!entry || entry.profile_id !== s.userId) throw notFound("timeEntryNotFound");
    if (!entry.ended_at) throw invalid("timerRunningEntry");
    const { error } = await s.supabase
      .from("task_time_entries")
      .delete()
      .eq("id", entry.id)
      .eq("profile_id", s.userId);
    if (error) dbFail(error);
    revalidateTasks(entry.task_id);
  });
}
