/**
 * Task workspace (migration 091, docs/TASKS.md) — shared types.
 * Row types mirror the SQL columns exactly (snake_case); view models add joined data.
 */

export const TASK_STATUSES = ["todo", "in_progress", "review", "done", "cancelled"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

/** Statuses counted as "open" (shown on boards, counted in the tree, can be overdue). */
export const OPEN_TASK_STATUSES = ["todo", "in_progress", "review"] as const satisfies readonly TaskStatus[];

/** Board column order. */
export const BOARD_STATUSES: readonly TaskStatus[] = ["todo", "in_progress", "review", "done", "cancelled"];

export const TASK_PRIORITIES = ["urgent", "high", "normal", "low"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const TASK_SOURCES = ["manual", "workflow_step", "approval_step"] as const;
export type TaskSource = (typeof TASK_SOURCES)[number];

/** Linked-record types accepted by tasks.entity_type (SQL check constraint). */
export const TASK_ENTITY_TYPES = [
  "project",
  "workflow_instance_step",
  "approval_request",
  "purchase_request",
  "purchase_order",
  "supplier_invoice",
  "client_valuation",
  "client_invoice",
  "variation",
  "document",
  "rfi",
  "ncr",
  "employee",
  "leave_request",
] as const;
export type TaskEntityType = (typeof TASK_ENTITY_TYPES)[number];

export type TaskSpaceSystemKey = "projects" | "approvals";

export type TaskSpace = {
  id: string;
  organization_id: string;
  /** 'projects' / 'approvals' for engine-owned spaces (cannot be archived), null for user spaces. */
  system_key: TaskSpaceSystemKey | null;
  name_ar: string;
  name_en: string;
  /** #rrggbb */
  color: string;
  /** lucide icon name, free text (≤ 40 chars). */
  icon: string | null;
  department_id: string | null;
  sort_order: number;
  is_archived: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type TaskList = {
  id: string;
  organization_id: string;
  space_id: string;
  /** Set for the auto list of a project (one per project). */
  project_id: string | null;
  /** 'approvals' for the fallback approvals list, else null. */
  system_key: "approvals" | null;
  name_ar: string;
  name_en: string;
  sort_order: number;
  is_archived: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type Task = {
  id: string;
  organization_id: string;
  list_id: string;
  parent_task_id: string | null;
  title: string;
  /** English title (auto tasks: stage / request English name). Prefer it in the EN UI when set. */
  title_en: string | null;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  /** YYYY-MM-DD */
  start_date: string | null;
  /** ISO timestamp (store in UTC, display in Asia/Riyadh). */
  due_at: string | null;
  completed_at: string | null;
  estimate_minutes: number | null;
  points: number;
  entity_type: TaskEntityType | null;
  entity_id: string | null;
  source: TaskSource;
  /** 'wfs:<workflow_instance_step id>' / 'aps:<approval_step id>' for auto tasks. */
  source_key: string | null;
  sort_order: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

/** Minimal person reference with both localized names. */
export type TaskPerson = {
  profile_id: string;
  full_name_ar: string;
  full_name_en: string;
};

export type TaskAssignee = TaskPerson & {
  /** null = assigned automatically by the workflow / approval engine. */
  assigned_by: string | null;
  assigned_at: string;
};

/** Row shown in list / board / calendar / my-tasks views. */
export type TaskListItem = Task & {
  assignees: TaskPerson[];
  subtask_count: number;
  subtask_done_count: number;
  comment_count: number;
};

export type TaskListWithCounts = TaskList & {
  /** Open top-level tasks (todo / in_progress / review) visible to the viewer. */
  open_count: number;
};

export type TaskSpaceTree = TaskSpace & {
  lists: TaskListWithCounts[];
  open_count: number;
};

export type TaskComment = {
  id: string;
  task_id: string;
  author_id: string | null;
  body: string;
  created_at: string;
  edited_at: string | null;
  author: TaskPerson | null;
};

export type TaskTimeEntry = {
  id: string;
  task_id: string;
  profile_id: string;
  started_at: string;
  /** null = timer running */
  ended_at: string | null;
  minutes: number | null;
  note: string | null;
  created_at: string;
  person: TaskPerson | null;
};

/** The current user's running timer, with its task title for a global indicator. */
export type RunningTimer = TaskTimeEntry & {
  task_title: string;
  task_title_en: string | null;
};

export type TaskCapabilities = {
  /** Edit title/description/dates/priority (manual tasks) — creator, assignee or task.manage. */
  canEdit: boolean;
  /** Change status (board drag) — same as canEdit, also for auto tasks. */
  canChangeStatus: boolean;
  /** Add / remove assignees. */
  canAssign: boolean;
  /** Delete — manual tasks only; creator or task.manage. */
  canDelete: boolean;
  /** Comment / log own time — task.create. */
  canComment: boolean;
  canTrackTime: boolean;
  /** Auto task (workflow / approval): title, link, list and due date are locked. */
  isAutoTask: boolean;
};

export type TaskDetail = {
  task: Task;
  list: Pick<TaskList, "id" | "space_id" | "project_id" | "system_key" | "name_ar" | "name_en" | "is_archived">;
  space: Pick<TaskSpace, "id" | "system_key" | "name_ar" | "name_en" | "color" | "icon">;
  parent: Pick<Task, "id" | "title" | "title_en" | "status"> | null;
  subtasks: TaskListItem[];
  assignees: TaskAssignee[];
  comments: TaskComment[];
  /** Own entries for regular users; all entries for task.manage (RLS). */
  timeEntries: TaskTimeEntry[];
  /** Sum of finished entries visible to the viewer. */
  loggedMinutes: number;
  /** The viewer's running entry on THIS task, if any. */
  runningEntry: TaskTimeEntry | null;
  createdBy: TaskPerson | null;
  /** Linked-record route, or null when the type has no page. */
  entityHref: string | null;
  capabilities: TaskCapabilities;
};

export type TaskFilters = {
  listId?: string;
  spaceId?: string;
  /** Tasks assigned to this profile. */
  assigneeId?: string;
  /** Only unassigned tasks. */
  unassigned?: boolean;
  status?: TaskStatus[];
  priority?: TaskPriority[];
  /** Riyadh calendar dates (YYYY-MM-DD), inclusive. */
  dueFrom?: string;
  dueTo?: string;
  /** Only open tasks with due_at in the past. */
  overdueOnly?: boolean;
  /** Case-insensitive title search. */
  search?: string;
  /** Include done / cancelled (default: true when `status` is given, else false). */
  includeClosed?: boolean;
  /** Include subtasks as separate rows (default false: top-level only). */
  includeSubtasks?: boolean;
  /** Max rows (default 300, max 1000). */
  limit?: number;
};

/** One row of task_performance() (091). */
export type TaskPerformanceRow = {
  profile_id: string;
  full_name_ar: string | null;
  full_name_en: string | null;
  assigned: number;
  completed: number;
  completed_on_time: number;
  overdue_open: number;
  /** 0–100, one decimal; null when nothing was completed in the period. */
  on_time_rate: number | null;
  avg_cycle_hours: number | null;
  logged_minutes: number;
  estimate_minutes_done: number;
  points_earned: number;
};

/** Org member usable in assignee pickers / filters. */
export type TaskMemberOption = TaskPerson;

/**
 * Result of task server actions. Compatible with FormActionState ({ ok, message? } | null)
 * so it works with useActionState; `id` carries the created row id where relevant.
 */
export type TaskActionState = { ok: boolean; message?: string; id?: string } | null;
