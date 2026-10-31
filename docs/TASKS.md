# Task workspace (ClickUp-style) — design contract

Status: being built (2026-10-31). Migration **091**. Bilingual (AR default / EN), RTL/LTR, dark mode,
same design system as the rest of the app.

## Concepts

```
organization
 └─ task_spaces            (e.g. "المشاريع", "الموارد البشرية", "المالية" — one per team/department)
     └─ task_lists         (manual lists; every project gets exactly one auto list in the Projects space)
         └─ tasks          (status, priority, assignees, dates, estimate, points, linked record)
             ├─ subtasks   (tasks.parent_task_id, one level deep)
             ├─ task_assignees (many-to-many profiles)
             ├─ task_comments
             └─ task_time_entries (timer start/stop + manual entries)
```

## Database (migration `091_task_workspace.sql`)

| Table | Key columns |
|---|---|
| `task_spaces` | `id, organization_id, name_ar, name_en, color text (hex), icon text, department_id null, sort_order, is_archived, created_by, created_at, updated_at` |
| `task_lists` | `id, organization_id, space_id, project_id null UNIQUE (one auto list per project), name_ar, name_en, sort_order, is_archived, created_by, ...` |
| `tasks` | `id, organization_id, list_id, parent_task_id null, title, description, status, priority, start_date date null, due_at timestamptz null, completed_at, estimate_minutes int null, points int not null default by priority, entity_type text null, entity_id uuid null, source text ('manual','workflow_step','approval_step'), source_key text null UNIQUE, sort_order numeric, created_by, created_at, updated_at` |
| `task_assignees` | `task_id, profile_id, organization_id, assigned_by, assigned_at` PK(task_id, profile_id) |
| `task_comments` | `id, task_id, organization_id, author_id, body, created_at, edited_at` |
| `task_time_entries` | `id, task_id, organization_id, profile_id, started_at, ended_at null (running), minutes int null (computed on stop / manual), note, created_at` — at most one running entry per profile (partial unique index) |

- `status`: `todo`, `in_progress`, `review`, `done`, `cancelled`.
- `priority`: `urgent`, `high`, `normal`, `low`. Default points: urgent 5, high 3, normal 2, low 1.
- `completed_at` set by trigger when status becomes `done`, cleared otherwise.
- Linked record: `entity_type` ∈ `project`, `workflow_instance_step`, `approval_request`, `purchase_request`,
  `purchase_order`, `supplier_invoice`, `client_valuation`, `client_invoice`, `variation`, `document`,
  `rfi`, `ncr`, `employee`, `leave_request` (free list; the UI maps each to a link).

### Permissions (added to the catalog + seeded to roles)
- `task.read` — see spaces/lists/tasks of the organization (all internal roles).
- `task.create` — create tasks/lists, comment, log own time, edit tasks they created or are assigned to (all internal roles).
- `task.manage` — create/edit spaces, edit/delete any task, reassign (managers: general_manager, operations_manager, project_manager, hr_manager, finance_manager).
- `task.performance.read` — see other people's performance (managers + hr_manager). Everyone can see their own.

### RLS
- Select: organization member AND `task.read`.
- Insert/update: through RLS for simple edits by creator/assignee/`task.manage`; status/assignee changes allowed the same way.
- Auto-generated tasks (`source <> 'manual'`): users may change status/comments/time, not title/source/entity (trigger guard).
- Time entries: a user writes only their own; `task.manage` can read all.

### Automatic tasks (SECURITY DEFINER triggers)
- **Project list:** when a project is created (or on first need), ensure a list `project_id = projects.id` in the org's
  system space `projects` (created on demand, `name_ar 'المشاريع' / name_en 'Projects'`).
- **Workflow steps:** when a `workflow_instance_steps` row becomes the current/ready step of a project workflow,
  upsert a task (`source 'workflow_step'`, `source_key 'wfs:<step_id>'`) in the project's list, assigned to the step's
  responsible profile (`project_workflow_step_assignments`), `due_at` = step deadline, title = stage name (AR) with
  description in EN, `entity_type 'workflow_instance_step'`. When the step completes → task `done`; cancelled/skipped → `cancelled`.
- **Approvals:** when an `approval_steps` row is `pending/in_progress` with an assigned approver profile, upsert a task
  (`source 'approval_step'`, `source_key 'aps:<approval_step_id>'`) assigned to that approver, title = the request title
  (`title` / `title_en`), `due_at` = request due date, linked to the approval request; closes when the step is decided.
- Backfill in the migration for currently open steps/approvals.

### Performance (SQL function `task_performance(p_org uuid, p_from date, p_to date, p_space uuid default null)`)
Returns one row per assignee profile: `assigned, completed, completed_on_time, overdue_open, on_time_rate,
avg_cycle_hours (created→completed), logged_minutes, estimate_minutes_done, points_earned`.
Points earned = task points when done (×1.0 on time, ×0.5 late). Callers without `task.performance.read`
only get their own row.

## Server (TypeScript)
- `src/modules/tasks/` — types, zod schemas, pure helpers (status/priority labels via dictionary, points, overdue, cycle time) + tests.
- `src/server/repositories/task.repository.ts` — reads (spaces tree, list tasks with filters, my tasks, task detail with
  subtasks/assignees/comments/time, calendar range, performance rows).
- `src/server/use-cases/tasks.ts` (`"use server"`) — actions: create/update/archive space & list, create/update/delete task,
  set status (board drag), reorder, assign/unassign, add comment, start/stop timer, add manual time entry.
  All return `FormActionState` via `runFormAction`, check permissions, scope by org, revalidate `/tasks`.

## UI
- Sidebar: "المهام / Tasks" (`/tasks`) and "الأداء / Performance" (`/tasks/performance`) under "عملي".
- `/tasks` — left panel: My tasks, spaces → lists tree; main: header with view switch **List | Board | Calendar**,
  filters (assignee, status, priority, due), quick-add.
- Board: columns by status, native HTML5 drag-and-drop (no new dependencies), optimistic update.
- Calendar: month grid by `due_at` (Asia/Riyadh).
- `/tasks/[id]` — detail: title, status, priority, assignees, dates, estimate/points, linked record link, description,
  subtasks, comments, time tracker (start/stop, entries, total vs estimate).
- `/tasks/performance` — period + space filters, KPI cards, per-person table, simple bar charts (existing chart components).
- Project page gets a "المهام / Tasks" link to its list.
- Dictionary namespace `t.tasks` (`tasks.ar.ts` / `tasks.en.ts`).
