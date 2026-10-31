import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { DatabaseError } from "@/lib/errors";
import { taskCapabilities, taskEntityHref, riyadhRangeToUtc } from "@/modules/tasks/logic";
import {
  OPEN_TASK_STATUSES,
  type RunningTimer,
  type Task,
  type TaskAssignee,
  type TaskComment,
  type TaskDetail,
  type TaskFilters,
  type TaskList,
  type TaskListItem,
  type TaskListWithCounts,
  type TaskMemberOption,
  type TaskPerformanceRow,
  type TaskPerson,
  type TaskSpace,
  type TaskSpaceTree,
  type TaskTimeEntry,
} from "@/modules/tasks/types";

/** Column projections (select only what the views use). */
export const TASK_SPACE_COLUMNS =
  "id, organization_id, system_key, name_ar, name_en, color, icon, department_id, sort_order, is_archived, created_by, created_at, updated_at";
export const TASK_LIST_COLUMNS =
  "id, organization_id, space_id, project_id, system_key, name_ar, name_en, sort_order, is_archived, created_by, created_at, updated_at";
export const TASK_COLUMNS =
  "id, organization_id, list_id, parent_task_id, title, title_en, description, status, priority, start_date, due_at, completed_at, estimate_minutes, points, entity_type, entity_id, source, source_key, sort_order, created_by, created_at, updated_at";
/** List/board rows skip the (possibly long) description. */
const TASK_ROW_COLUMNS =
  "id, organization_id, list_id, parent_task_id, title, title_en, status, priority, start_date, due_at, completed_at, estimate_minutes, points, entity_type, entity_id, source, source_key, sort_order, created_by, created_at, updated_at";
const TIME_ENTRY_COLUMNS = "id, task_id, profile_id, started_at, ended_at, minutes, note, created_at";

const DEFAULT_LIMIT = 300;
const MAX_LIMIT = 1000;

function fail(error: { message?: string } | null): never {
  throw new DatabaseError(error);
}

/** Escape % _ and , ( ) for PostgREST ilike / or filters. */
function ilikePattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, (c) => `\\${c}`).replace(/[,()]/g, " ")}%`;
}

type ProfileNameRow = { id: string; full_name_ar: string | null; full_name_en: string | null };

function toPerson(row: ProfileNameRow | undefined, id: string): TaskPerson {
  return {
    profile_id: id,
    full_name_ar: row?.full_name_ar ?? "",
    full_name_en: row?.full_name_en ?? "",
  };
}

export class TaskRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  // -------------------------------------------------------------------------
  // People
  // -------------------------------------------------------------------------

  /** Localized names for a set of profiles (RLS: co-members only). */
  async profileNames(ids: readonly string[]): Promise<Map<string, TaskPerson>> {
    const unique = [...new Set(ids.filter(Boolean))];
    const out = new Map<string, TaskPerson>();
    if (unique.length === 0) return out;
    const { data, error } = await this.supabase
      .from("profiles")
      .select("id, full_name_ar, full_name_en")
      .in("id", unique);
    if (error) fail(error);
    const rows = new Map(((data ?? []) as ProfileNameRow[]).map((r) => [r.id, r]));
    for (const id of unique) out.set(id, toPerson(rows.get(id), id));
    return out;
  }

  /** Active organization members for assignee pickers / filters, sorted by Arabic name. */
  async listMembers(organizationId: string): Promise<TaskMemberOption[]> {
    const { data, error } = await this.supabase
      .from("organization_members")
      .select("profile_id, profiles(id, full_name_ar, full_name_en, is_active)")
      .eq("organization_id", organizationId)
      .eq("status", "active")
      .limit(1000);
    if (error) fail(error);
    type Row = {
      profile_id: string;
      profiles:
        | (ProfileNameRow & { is_active: boolean })
        | Array<ProfileNameRow & { is_active: boolean }>
        | null;
    };
    return ((data ?? []) as Row[])
      .map((row) => {
        const p = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
        return p && p.is_active ? toPerson(p, row.profile_id) : null;
      })
      .filter((p): p is TaskPerson => p !== null)
      .sort((a, b) => a.full_name_ar.localeCompare(b.full_name_ar, "ar"));
  }

  // -------------------------------------------------------------------------
  // Spaces & lists
  // -------------------------------------------------------------------------

  /** Spaces → lists tree with open (todo/in_progress/review) top-level task counts. */
  async listSpacesTree(
    organizationId: string,
    options: { includeArchived?: boolean } = {},
  ): Promise<TaskSpaceTree[]> {
    let spacesQ = this.supabase
      .from("task_spaces")
      .select(TASK_SPACE_COLUMNS)
      .eq("organization_id", organizationId)
      .order("sort_order")
      .order("name_ar");
    let listsQ = this.supabase
      .from("task_lists")
      .select(TASK_LIST_COLUMNS)
      .eq("organization_id", organizationId)
      .order("sort_order")
      .order("name_ar")
      .limit(2000);
    if (!options.includeArchived) {
      spacesQ = spacesQ.eq("is_archived", false);
      listsQ = listsQ.eq("is_archived", false);
    }
    const [spacesRes, listsRes, countsRes] = await Promise.all([
      spacesQ,
      listsQ,
      this.supabase.rpc("task_list_open_counts", { p_org: organizationId }),
    ]);
    if (spacesRes.error) fail(spacesRes.error);
    if (listsRes.error) fail(listsRes.error);
    if (countsRes.error) fail(countsRes.error);

    const counts = new Map<string, number>();
    for (const row of (countsRes.data ?? []) as Array<{ list_id: string; open_count: number }>) {
      counts.set(row.list_id, Number(row.open_count) || 0);
    }
    const listsBySpace = new Map<string, TaskListWithCounts[]>();
    for (const list of (listsRes.data ?? []) as TaskList[]) {
      const arr = listsBySpace.get(list.space_id) ?? [];
      arr.push({ ...list, open_count: counts.get(list.id) ?? 0 });
      listsBySpace.set(list.space_id, arr);
    }
    return ((spacesRes.data ?? []) as TaskSpace[]).map((space) => {
      const lists = listsBySpace.get(space.id) ?? [];
      return { ...space, lists, open_count: lists.reduce((sum, l) => sum + l.open_count, 0) };
    });
  }

  async getSpace(organizationId: string, spaceId: string): Promise<TaskSpace | null> {
    const { data, error } = await this.supabase
      .from("task_spaces")
      .select(TASK_SPACE_COLUMNS)
      .eq("organization_id", organizationId)
      .eq("id", spaceId)
      .maybeSingle();
    if (error) fail(error);
    return (data as TaskSpace | null) ?? null;
  }

  async getList(organizationId: string, listId: string): Promise<TaskList | null> {
    const { data, error } = await this.supabase
      .from("task_lists")
      .select(TASK_LIST_COLUMNS)
      .eq("organization_id", organizationId)
      .eq("id", listId)
      .maybeSingle();
    if (error) fail(error);
    return (data as TaskList | null) ?? null;
  }

  /** The project's auto list id (created on first need via ensure_project_task_list). */
  async ensureProjectList(projectId: string): Promise<string | null> {
    const { data, error } = await this.supabase.rpc("ensure_project_task_list", { p_project_id: projectId });
    if (error) fail(error);
    return (data as string | null) ?? null;
  }

  // -------------------------------------------------------------------------
  // Tasks
  // -------------------------------------------------------------------------

  async getTask(organizationId: string, taskId: string): Promise<Task | null> {
    const { data, error } = await this.supabase
      .from("tasks")
      .select(TASK_COLUMNS)
      .eq("organization_id", organizationId)
      .eq("id", taskId)
      .maybeSingle();
    if (error) fail(error);
    return (data as Task | null) ?? null;
  }

  async listAssigneeIds(taskId: string): Promise<string[]> {
    const { data, error } = await this.supabase.from("task_assignees").select("profile_id").eq("task_id", taskId);
    if (error) fail(error);
    return ((data ?? []) as Array<{ profile_id: string }>).map((r) => r.profile_id);
  }

  /**
   * Tasks matching filters (list / space / assignee / status / priority / due range /
   * search), with assignees, subtask progress and comment counts. Top-level only unless
   * `includeSubtasks`; open only unless `includeClosed` or an explicit `status` filter.
   */
  async listTasks(organizationId: string, filters: TaskFilters = {}): Promise<TaskListItem[]> {
    const limit = Math.min(Math.max(filters.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);

    let restrictIds: string[] | null = null;
    if (filters.assigneeId) {
      const { data, error } = await this.supabase
        .from("task_assignees")
        .select("task_id")
        .eq("organization_id", organizationId)
        .eq("profile_id", filters.assigneeId)
        .limit(5000);
      if (error) fail(error);
      restrictIds = ((data ?? []) as Array<{ task_id: string }>).map((r) => r.task_id);
      if (restrictIds.length === 0) return [];
    }

    let listIds: string[] | null = null;
    if (filters.spaceId && !filters.listId) {
      const { data, error } = await this.supabase
        .from("task_lists")
        .select("id")
        .eq("organization_id", organizationId)
        .eq("space_id", filters.spaceId);
      if (error) fail(error);
      listIds = ((data ?? []) as Array<{ id: string }>).map((r) => r.id);
      if (listIds.length === 0) return [];
    }

    // Builders are mutable: build a fresh query per request (id chunks below).
    const build = () => {
      let q = this.supabase.from("tasks").select(TASK_ROW_COLUMNS).eq("organization_id", organizationId);
      if (filters.listId) q = q.eq("list_id", filters.listId);
      else if (listIds) q = q.in("list_id", listIds);
      if (!filters.includeSubtasks) q = q.is("parent_task_id", null);

      if (filters.status?.length) q = q.in("status", filters.status);
      else if (!filters.includeClosed) q = q.in("status", [...OPEN_TASK_STATUSES]);
      if (filters.priority?.length) q = q.in("priority", filters.priority);

      if (filters.dueFrom || filters.dueTo) {
        const { startIso, endIso } = riyadhRangeToUtc(
          filters.dueFrom ?? "1970-01-01",
          filters.dueTo ?? "2999-12-31",
        );
        if (filters.dueFrom) q = q.gte("due_at", startIso);
        if (filters.dueTo) q = q.lt("due_at", endIso);
      }
      if (filters.overdueOnly) {
        q = q.lt("due_at", new Date().toISOString()).in("status", [...OPEN_TASK_STATUSES]);
      }
      if (filters.search) {
        const pattern = ilikePattern(filters.search);
        q = q.or(`title.ilike.${pattern},title_en.ilike.${pattern}`);
      }
      return q;
    };

    // Chunk the id restriction to keep the URL bounded.
    const rows: Task[] = [];
    if (restrictIds) {
      for (let i = 0; i < restrictIds.length && rows.length < limit; i += 200) {
        const chunk = restrictIds.slice(i, i + 200);
        const { data, error } = await build()
          .in("id", chunk)
          .order("sort_order")
          .order("created_at")
          .limit(limit - rows.length);
        if (error) fail(error);
        rows.push(...((data ?? []) as Task[]));
      }
    } else {
      const { data, error } = await build().order("sort_order").order("created_at").limit(limit);
      if (error) fail(error);
      rows.push(...((data ?? []) as Task[]));
    }

    let items = await this.decorate(rows);
    if (filters.unassigned) items = items.filter((t) => t.assignees.length === 0);
    return items;
  }

  /** Open tasks assigned to `profileId` across all lists (plus closed when asked). */
  async listMyTasks(
    organizationId: string,
    profileId: string,
    filters: Omit<TaskFilters, "assigneeId" | "unassigned"> = {},
  ): Promise<TaskListItem[]> {
    return this.listTasks(organizationId, { ...filters, assigneeId: profileId, includeSubtasks: true });
  }

  /** Tasks with due_at inside the inclusive Riyadh range [fromYmd, toYmd] (calendar view). */
  async listCalendarTasks(
    organizationId: string,
    fromYmd: string,
    toYmd: string,
    filters: Omit<TaskFilters, "dueFrom" | "dueTo"> = {},
  ): Promise<TaskListItem[]> {
    return this.listTasks(organizationId, {
      includeClosed: true,
      includeSubtasks: true,
      ...filters,
      dueFrom: fromYmd,
      dueTo: toYmd,
      limit: filters.limit ?? MAX_LIMIT,
    });
  }

  /** Adds assignees, subtask progress and comment counts to raw task rows (3 queries). */
  private async decorate(rows: Task[]): Promise<TaskListItem[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    const assignees = new Map<string, string[]>();
    const subtasks = new Map<string, { total: number; done: number }>();
    const comments = new Map<string, number>();

    for (let i = 0; i < ids.length; i += 200) {
      const chunk = ids.slice(i, i + 200);
      const [aRes, sRes, cRes] = await Promise.all([
        this.supabase.from("task_assignees").select("task_id, profile_id").in("task_id", chunk),
        this.supabase.from("tasks").select("parent_task_id, status").in("parent_task_id", chunk).limit(5000),
        this.supabase.from("task_comments").select("task_id").in("task_id", chunk).limit(10000),
      ]);
      if (aRes.error) fail(aRes.error);
      if (sRes.error) fail(sRes.error);
      if (cRes.error) fail(cRes.error);
      for (const row of (aRes.data ?? []) as Array<{ task_id: string; profile_id: string }>) {
        const arr = assignees.get(row.task_id) ?? [];
        arr.push(row.profile_id);
        assignees.set(row.task_id, arr);
      }
      for (const row of (sRes.data ?? []) as Array<{ parent_task_id: string; status: string }>) {
        const s = subtasks.get(row.parent_task_id) ?? { total: 0, done: 0 };
        if (row.status !== "cancelled") s.total += 1;
        if (row.status === "done") s.done += 1;
        subtasks.set(row.parent_task_id, s);
      }
      for (const row of (cRes.data ?? []) as Array<{ task_id: string }>) {
        comments.set(row.task_id, (comments.get(row.task_id) ?? 0) + 1);
      }
    }

    const names = await this.profileNames([...assignees.values()].flat());
    return rows.map((row) => ({
      ...row,
      assignees: (assignees.get(row.id) ?? []).map((id) => names.get(id) ?? toPerson(undefined, id)),
      subtask_count: subtasks.get(row.id)?.total ?? 0,
      subtask_done_count: subtasks.get(row.id)?.done ?? 0,
      comment_count: comments.get(row.id) ?? 0,
    }));
  }

  /**
   * Full task page: task, list + space, parent, subtasks, assignees (localized names),
   * comments with authors, time entries (own, or all for task.manage via RLS), the viewer's
   * running entry on this task, linked-record href and the viewer's capabilities.
   */
  async getTaskDetail(
    organizationId: string,
    taskId: string,
    viewer: { profileId: string; canCreate: boolean; canManage: boolean },
  ): Promise<TaskDetail | null> {
    const task = await this.getTask(organizationId, taskId);
    if (!task) return null;

    const [listRes, parentRes, subRes, assigneeRes, commentRes, timeRes] = await Promise.all([
      this.supabase
        .from("task_lists")
        .select("id, space_id, project_id, system_key, name_ar, name_en, is_archived")
        .eq("id", task.list_id)
        .maybeSingle(),
      task.parent_task_id
        ? this.supabase
            .from("tasks")
            .select("id, title, title_en, status")
            .eq("id", task.parent_task_id)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      this.supabase
        .from("tasks")
        .select(TASK_ROW_COLUMNS)
        .eq("parent_task_id", task.id)
        .order("sort_order")
        .order("created_at")
        .limit(200),
      this.supabase
        .from("task_assignees")
        .select("profile_id, assigned_by, assigned_at")
        .eq("task_id", task.id)
        .order("assigned_at"),
      this.supabase
        .from("task_comments")
        .select("id, task_id, author_id, body, created_at, edited_at")
        .eq("task_id", task.id)
        .order("created_at")
        .limit(500),
      this.supabase
        .from("task_time_entries")
        .select(TIME_ENTRY_COLUMNS)
        .eq("task_id", task.id)
        .order("started_at", { ascending: false })
        .limit(500),
    ]);
    for (const res of [listRes, parentRes, subRes, assigneeRes, commentRes, timeRes]) {
      if (res.error) fail(res.error);
    }

    const list = listRes.data as TaskDetail["list"] | null;
    if (!list) return null;
    const { data: spaceData, error: spaceError } = await this.supabase
      .from("task_spaces")
      .select("id, system_key, name_ar, name_en, color, icon")
      .eq("id", list.space_id)
      .maybeSingle();
    if (spaceError) fail(spaceError);
    if (!spaceData) return null;

    const assigneeRows = (assigneeRes.data ?? []) as Array<{
      profile_id: string;
      assigned_by: string | null;
      assigned_at: string;
    }>;
    const commentRows = (commentRes.data ?? []) as Array<Omit<TaskComment, "author">>;
    const timeRows = (timeRes.data ?? []) as Array<Omit<TaskTimeEntry, "person">>;

    const [subtasks, names] = await Promise.all([
      this.decorate((subRes.data ?? []) as Task[]),
      this.profileNames([
        ...assigneeRows.map((a) => a.profile_id),
        ...commentRows.map((c) => c.author_id ?? ""),
        ...timeRows.map((t) => t.profile_id),
        task.created_by ?? "",
      ]),
    ]);

    const assignees: TaskAssignee[] = assigneeRows.map((a) => ({
      ...(names.get(a.profile_id) ?? toPerson(undefined, a.profile_id)),
      assigned_by: a.assigned_by,
      assigned_at: a.assigned_at,
    }));
    const comments: TaskComment[] = commentRows.map((c) => ({
      ...c,
      author: c.author_id ? (names.get(c.author_id) ?? null) : null,
    }));
    const timeEntries: TaskTimeEntry[] = timeRows.map((t) => ({
      ...t,
      person: names.get(t.profile_id) ?? null,
    }));
    const loggedMinutes = timeEntries.reduce((sum, t) => sum + (t.minutes ?? 0), 0);
    const runningEntry =
      timeEntries.find((t) => t.ended_at === null && t.profile_id === viewer.profileId) ?? null;

    return {
      task,
      list,
      space: spaceData as TaskDetail["space"],
      parent: (parentRes.data as TaskDetail["parent"]) ?? null,
      subtasks,
      assignees,
      comments,
      timeEntries,
      loggedMinutes,
      runningEntry,
      createdBy: task.created_by ? (names.get(task.created_by) ?? null) : null,
      entityHref: taskEntityHref(task.entity_type, task.entity_id, { projectId: list.project_id }),
      capabilities: taskCapabilities({
        task,
        assigneeIds: assigneeRows.map((a) => a.profile_id),
        userId: viewer.profileId,
        canCreate: viewer.canCreate,
        canManage: viewer.canManage,
      }),
    };
  }

  // -------------------------------------------------------------------------
  // Time
  // -------------------------------------------------------------------------

  /** The profile's running timer (any task), with the task title. */
  async getRunningTimer(organizationId: string, profileId: string): Promise<RunningTimer | null> {
    const { data, error } = await this.supabase
      .from("task_time_entries")
      .select(`${TIME_ENTRY_COLUMNS}, tasks(title, title_en)`)
      .eq("organization_id", organizationId)
      .eq("profile_id", profileId)
      .is("ended_at", null)
      .maybeSingle();
    if (error) fail(error);
    if (!data) return null;
    const row = data as Omit<TaskTimeEntry, "person"> & {
      tasks: { title: string; title_en: string | null } | Array<{ title: string; title_en: string | null }> | null;
    };
    const t = Array.isArray(row.tasks) ? row.tasks[0] : row.tasks;
    const { tasks: _omit, ...entry } = row;
    void _omit;
    return { ...entry, person: null, task_title: t?.title ?? "", task_title_en: t?.title_en ?? null };
  }

  async getTimeEntry(organizationId: string, entryId: string): Promise<Omit<TaskTimeEntry, "person"> | null> {
    const { data, error } = await this.supabase
      .from("task_time_entries")
      .select(TIME_ENTRY_COLUMNS)
      .eq("organization_id", organizationId)
      .eq("id", entryId)
      .maybeSingle();
    if (error) fail(error);
    return (data as Omit<TaskTimeEntry, "person"> | null) ?? null;
  }

  // -------------------------------------------------------------------------
  // Performance
  // -------------------------------------------------------------------------

  /**
   * task_performance() rows for an inclusive Riyadh date range. Without
   * task.performance.read the database returns only the caller's own row.
   */
  async listPerformance(
    organizationId: string,
    fromYmd: string,
    toYmd: string,
    spaceId?: string | null,
  ): Promise<TaskPerformanceRow[]> {
    const { data, error } = await this.supabase.rpc("task_performance", {
      p_org: organizationId,
      p_from: fromYmd,
      p_to: toYmd,
      p_space: spaceId ?? null,
    });
    if (error) fail(error);
    return ((data ?? []) as TaskPerformanceRow[]).map((r) => ({
      ...r,
      assigned: Number(r.assigned) || 0,
      completed: Number(r.completed) || 0,
      completed_on_time: Number(r.completed_on_time) || 0,
      overdue_open: Number(r.overdue_open) || 0,
      on_time_rate: r.on_time_rate === null ? null : Number(r.on_time_rate),
      avg_cycle_hours: r.avg_cycle_hours === null ? null : Number(r.avg_cycle_hours),
      logged_minutes: Number(r.logged_minutes) || 0,
      estimate_minutes_done: Number(r.estimate_minutes_done) || 0,
      points_earned: Number(r.points_earned) || 0,
    }));
  }

  // -------------------------------------------------------------------------
  // Workspace helpers (appended; read-only)
  // -------------------------------------------------------------------------

  /** The project's auto list id if it already exists (no write; see ensureProjectList). */
  async findProjectListId(organizationId: string, projectId: string): Promise<string | null> {
    const { data, error } = await this.supabase
      .from("task_lists")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("project_id", projectId)
      .maybeSingle();
    if (error) fail(error);
    return (data as { id: string } | null)?.id ?? null;
  }

  /**
   * Status mix of the tasks that fall in an inclusive Riyadh date range, using the same
   * "in period" rule as task_performance() (created, due or completed in the range;
   * cancelled excluded; subtasks included). Scoped to tasks the caller can see (RLS),
   * optionally to one space and/or to tasks assigned to one profile — pass the caller's
   * own id when they lack task.performance.read so the numbers match their own row.
   * `overdue` counts open tasks whose due instant passed before min(now, period end).
   */
  async performanceStatusBreakdown(
    organizationId: string,
    fromYmd: string,
    toYmd: string,
    options: { spaceId?: string | null; profileId?: string | null } = {},
  ): Promise<{ todo: number; in_progress: number; review: number; done: number; overdue: number; total: number }> {
    const out = { todo: 0, in_progress: 0, review: 0, done: 0, overdue: 0, total: 0 };
    const { startIso, endIso } = riyadhRangeToUtc(fromYmd, toYmd);
    const cutoff = Math.min(Date.now(), new Date(endIso).getTime());

    let restrictIds: string[] | null = null;
    if (options.profileId) {
      const { data, error } = await this.supabase
        .from("task_assignees")
        .select("task_id")
        .eq("organization_id", organizationId)
        .eq("profile_id", options.profileId)
        .limit(5000);
      if (error) fail(error);
      restrictIds = ((data ?? []) as Array<{ task_id: string }>).map((r) => r.task_id);
      if (restrictIds.length === 0) return out;
    }

    let listIds: string[] | null = null;
    if (options.spaceId) {
      const { data, error } = await this.supabase
        .from("task_lists")
        .select("id")
        .eq("organization_id", organizationId)
        .eq("space_id", options.spaceId);
      if (error) fail(error);
      listIds = ((data ?? []) as Array<{ id: string }>).map((r) => r.id);
      if (listIds.length === 0) return out;
    }

    const inPeriod = [
      `and(created_at.gte.${startIso},created_at.lt.${endIso})`,
      `and(due_at.gte.${startIso},due_at.lt.${endIso})`,
      `and(status.eq.done,completed_at.gte.${startIso},completed_at.lt.${endIso})`,
    ].join(",");
    const build = () => {
      let q = this.supabase
        .from("tasks")
        .select("id, status, due_at")
        .eq("organization_id", organizationId)
        .neq("status", "cancelled")
        .or(inPeriod);
      if (listIds) q = q.in("list_id", listIds);
      return q;
    };

    type Row = { id: string; status: string; due_at: string | null };
    const rows = new Map<string, Row>();
    if (restrictIds) {
      for (let i = 0; i < restrictIds.length; i += 200) {
        const { data, error } = await build().in("id", restrictIds.slice(i, i + 200)).limit(1000);
        if (error) fail(error);
        for (const r of (data ?? []) as Row[]) rows.set(r.id, r);
      }
    } else {
      const { data, error } = await build().limit(5000);
      if (error) fail(error);
      for (const r of (data ?? []) as Row[]) rows.set(r.id, r);
    }

    for (const r of rows.values()) {
      if (r.status === "todo" || r.status === "in_progress" || r.status === "review" || r.status === "done") {
        out[r.status] += 1;
        out.total += 1;
      }
      if (r.status !== "done" && r.due_at && new Date(r.due_at).getTime() < cutoff) out.overdue += 1;
    }
    return out;
  }
}

export function createTaskRepository(supabase: SupabaseClient): TaskRepository {
  return new TaskRepository(supabase);
}
