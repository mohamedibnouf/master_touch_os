-- Master Touch OS — 091
-- Task workspace (ClickUp-style): spaces → lists → tasks (+ subtasks, assignees, comments,
-- time entries), automatic tasks from project workflow steps and approval steps, and the
-- task_performance() report. Design contract: docs/TASKS.md.
-- Additive and idempotent (create … if not exists, create or replace, drop trigger/policy
-- if exists). Run in one go as postgres in the Supabase SQL Editor. Apply BEFORE the app
-- deploy that ships /tasks (the app reads these tables and RPCs).
--
-- Sections:
--   A. Permissions (task.read, task.create, task.manage, task.performance.read) + system role seeds
--   B. Tables, constraints, indexes
--   C. Row triggers (defaults, completed_at, subtask depth, auto-task guard, timer minutes)
--   D. RLS helpers, policies and grants
--   E. Automatic tasks: project lists, workflow steps, approval steps (SECURITY DEFINER)
--   F. Backfill (project lists, open workflow steps, open approval steps)
--   G. task_performance()
--
-- Safety:
--  * No existing rows of any pre-091 table are updated or deleted. Triggers added on
--    projects / workflow_instance_steps / approval_steps / approval_requests are AFTER
--    triggers that only WRITE to the new task tables, run as SECURITY DEFINER with
--    search_path = public, and swallow their own errors (raise warning) so a task problem
--    can never fail a workflow / approval / project transaction.
--  * 088's write lock on workflow / approval tables is untouched: nothing here grants
--    UPDATE/DELETE on them. The guard uses 088's workflow_write_is_untrusted() predicate.
--  * Auto tasks (source <> 'manual') are locked for direct client writes: users can move
--    status / priority / description, comment and log time, but not change title, source,
--    linked record, list or due date, and cannot delete them.
--  * Organization custom roles are NOT given task.* keys automatically; grant them in the
--    roles UI if needed. System roles are seeded in section A.
--  * anon has no privileges on any task table or RPC.

-- =============================================================================
-- A. Permissions
-- =============================================================================

insert into public.permissions (key, resource, action, description_ar, description_en) values
  ('task.read', 'task', 'read', 'عرض المهام', 'View tasks'),
  ('task.create', 'task', 'create', 'إنشاء المهام والتعليق وتسجيل الوقت', 'Create tasks, comment and log time'),
  ('task.manage', 'task', 'manage', 'إدارة مساحات المهام وكل المهام', 'Manage task spaces and all tasks'),
  ('task.performance.read', 'task', 'performance.read', 'عرض أداء الفريق في المهام', 'View team task performance')
on conflict (key) do nothing;

-- All internal system roles: read + create (viewer: read only).
insert into public.role_permissions (role_id, permission_key)
select r.id, x.permission_key
from public.roles r
join (values ('task.read'), ('task.create')) as x(permission_key) on true
where r.organization_id is null
  and r.is_system = true
  and r.is_external = false
  and r.code <> 'viewer'
on conflict do nothing;

insert into public.role_permissions (role_id, permission_key)
select r.id, 'task.read'
from public.roles r
where r.organization_id is null
  and r.is_system = true
  and r.code = 'viewer'
on conflict do nothing;

-- Managers: manage + team performance.
insert into public.role_permissions (role_id, permission_key)
select r.id, x.permission_key
from public.roles r
join (values ('task.manage'), ('task.performance.read')) as x(permission_key) on true
where r.organization_id is null
  and r.is_system = true
  and r.code in ('super_admin', 'general_manager', 'operations_manager', 'project_manager', 'hr_manager', 'finance_manager')
on conflict do nothing;

-- =============================================================================
-- B. Tables
-- =============================================================================

create table if not exists public.task_spaces (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  -- System spaces created by the auto-task engine: 'projects', 'approvals'. Null for user spaces.
  system_key text check (system_key is null or system_key in ('projects', 'approvals')),
  name_ar text not null check (char_length(btrim(name_ar)) between 1 and 120),
  name_en text not null check (char_length(btrim(name_en)) between 1 and 120),
  color text not null default '#6366f1' check (color ~ '^#[0-9a-fA-F]{6}$'),
  icon text check (icon is null or char_length(icon) between 1 and 40),
  department_id uuid references public.departments (id) on delete set null,
  sort_order integer not null default 0,
  is_archived boolean not null default false,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint task_spaces_id_org_key unique (id, organization_id)
);

create unique index if not exists task_spaces_system_key_uidx
  on public.task_spaces (organization_id, system_key)
  where system_key is not null;
create index if not exists task_spaces_org_idx
  on public.task_spaces (organization_id, is_archived, sort_order);

create table if not exists public.task_lists (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  space_id uuid not null,
  -- Exactly one auto list per project (in the 'projects' system space).
  project_id uuid references public.projects (id) on delete cascade,
  -- System list key ('approvals' = fallback list for approval tasks without a project).
  system_key text check (system_key is null or system_key in ('approvals')),
  name_ar text not null check (char_length(btrim(name_ar)) between 1 and 160),
  name_en text not null check (char_length(btrim(name_en)) between 1 and 160),
  sort_order integer not null default 0,
  is_archived boolean not null default false,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint task_lists_project_id_key unique (project_id),
  constraint task_lists_id_org_key unique (id, organization_id),
  constraint task_lists_space_fk foreign key (space_id, organization_id)
    references public.task_spaces (id, organization_id) on delete cascade
);

create unique index if not exists task_lists_system_key_uidx
  on public.task_lists (organization_id, system_key)
  where system_key is not null;
create index if not exists task_lists_space_idx
  on public.task_lists (space_id, is_archived, sort_order);
create index if not exists task_lists_org_idx
  on public.task_lists (organization_id);

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  list_id uuid not null,
  parent_task_id uuid,
  title text not null check (char_length(btrim(title)) between 1 and 500),
  -- Optional English title (auto tasks carry the stage / request English name here).
  title_en text check (title_en is null or char_length(title_en) <= 500),
  description text check (description is null or char_length(description) <= 20000),
  status text not null default 'todo'
    check (status in ('todo', 'in_progress', 'review', 'done', 'cancelled')),
  priority text not null default 'normal'
    check (priority in ('urgent', 'high', 'normal', 'low')),
  start_date date,
  due_at timestamptz,
  completed_at timestamptz,
  estimate_minutes integer check (estimate_minutes is null or estimate_minutes between 0 and 100000),
  -- No column default: tasks_before_write fills it from priority (urgent 5, high 3, normal 2, low 1).
  points integer not null check (points between 0 and 100),
  entity_type text check (
    entity_type is null or entity_type in (
      'project', 'workflow_instance_step', 'approval_request', 'purchase_request',
      'purchase_order', 'supplier_invoice', 'client_valuation', 'client_invoice', 'variation',
      'document', 'rfi', 'ncr', 'employee', 'leave_request'
    )
  ),
  entity_id uuid,
  source text not null default 'manual'
    check (source in ('manual', 'workflow_step', 'approval_step')),
  source_key text,
  sort_order numeric not null default 0,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint tasks_source_key_key unique (source_key),
  constraint tasks_id_org_key unique (id, organization_id),
  constraint tasks_list_fk foreign key (list_id, organization_id)
    references public.task_lists (id, organization_id) on delete cascade,
  constraint tasks_parent_fk foreign key (parent_task_id, organization_id)
    references public.tasks (id, organization_id) on delete cascade,
  constraint tasks_entity_pair_check check ((entity_type is null) = (entity_id is null)),
  constraint tasks_source_key_check check ((source = 'manual') = (source_key is null)),
  constraint tasks_parent_not_self_check check (parent_task_id is null or parent_task_id <> id),
  constraint tasks_start_before_due_check check (
    start_date is null or due_at is null
    or start_date <= (due_at at time zone 'Asia/Riyadh')::date
  )
);

create index if not exists tasks_list_status_idx
  on public.tasks (list_id, status, sort_order);
create index if not exists tasks_org_status_due_idx
  on public.tasks (organization_id, status, due_at);
create index if not exists tasks_org_due_idx
  on public.tasks (organization_id, due_at)
  where due_at is not null;
create index if not exists tasks_org_completed_idx
  on public.tasks (organization_id, completed_at)
  where completed_at is not null;
create index if not exists tasks_parent_idx
  on public.tasks (parent_task_id, sort_order)
  where parent_task_id is not null;
create index if not exists tasks_entity_idx
  on public.tasks (entity_type, entity_id)
  where entity_id is not null;
create index if not exists tasks_created_by_idx
  on public.tasks (created_by);

create table if not exists public.task_assignees (
  task_id uuid not null,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  -- Null = assigned by the auto-task engine (replaced when the step's responsible changes).
  assigned_by uuid references public.profiles (id) on delete set null,
  assigned_at timestamptz not null default timezone('utc', now()),
  primary key (task_id, profile_id),
  constraint task_assignees_task_fk foreign key (task_id, organization_id)
    references public.tasks (id, organization_id) on delete cascade
);

create index if not exists task_assignees_profile_idx
  on public.task_assignees (profile_id, task_id);
create index if not exists task_assignees_org_profile_idx
  on public.task_assignees (organization_id, profile_id);

create table if not exists public.task_comments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  author_id uuid references public.profiles (id) on delete set null,
  body text not null check (char_length(btrim(body)) between 1 and 10000),
  created_at timestamptz not null default timezone('utc', now()),
  edited_at timestamptz,
  constraint task_comments_task_fk foreign key (task_id, organization_id)
    references public.tasks (id, organization_id) on delete cascade
);

create index if not exists task_comments_task_idx
  on public.task_comments (task_id, created_at);

create table if not exists public.task_time_entries (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  started_at timestamptz not null default timezone('utc', now()),
  ended_at timestamptz,
  minutes integer check (minutes is null or minutes between 0 and 100000),
  note text check (note is null or char_length(note) <= 1000),
  created_at timestamptz not null default timezone('utc', now()),
  constraint task_time_entries_task_fk foreign key (task_id, organization_id)
    references public.tasks (id, organization_id) on delete cascade,
  constraint task_time_entries_range_check check (ended_at is null or ended_at >= started_at),
  constraint task_time_entries_running_check check (ended_at is not null or minutes is null)
);

-- At most one running timer per person.
create unique index if not exists task_time_entries_running_uidx
  on public.task_time_entries (profile_id)
  where ended_at is null;
create index if not exists task_time_entries_task_idx
  on public.task_time_entries (task_id, started_at);
create index if not exists task_time_entries_profile_idx
  on public.task_time_entries (organization_id, profile_id, started_at);

-- =============================================================================
-- C. Row triggers
-- =============================================================================

drop trigger if exists task_spaces_set_updated_at on public.task_spaces;
create trigger task_spaces_set_updated_at
  before update on public.task_spaces
  for each row execute function public.set_updated_at();

drop trigger if exists task_lists_set_updated_at on public.task_lists;
create trigger task_lists_set_updated_at
  before update on public.task_lists
  for each row execute function public.set_updated_at();

drop trigger if exists tasks_set_updated_at on public.tasks;
create trigger tasks_set_updated_at
  before update on public.tasks
  for each row execute function public.set_updated_at();

-- Space / list guard: system spaces and project lists belong to the auto-task engine.
-- SECURITY INVOKER on purpose (workflow_write_is_untrusted reads current_user).
create or replace function public.task_container_guard()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if not public.workflow_write_is_untrusted() then
    return new;
  end if;

  if tg_table_name = 'task_spaces' then
    if tg_op = 'INSERT' then
      if new.system_key is not null then
        raise exception 'TASK_SYSTEM_LOCKED' using errcode = '42501';
      end if;
    elsif new.system_key is distinct from old.system_key
       or new.organization_id is distinct from old.organization_id
       or (old.system_key is not null and new.is_archived) then
      raise exception 'TASK_SYSTEM_LOCKED' using errcode = '42501';
    end if;
  else
    if tg_op = 'INSERT' then
      if new.project_id is not null or new.system_key is not null then
        raise exception 'TASK_SYSTEM_LOCKED' using errcode = '42501';
      end if;
    elsif new.project_id is distinct from old.project_id
       or new.system_key is distinct from old.system_key
       or new.organization_id is distinct from old.organization_id
       or ((old.project_id is not null or old.system_key is not null)
           and (new.space_id is distinct from old.space_id or new.is_archived is distinct from old.is_archived)) then
      raise exception 'TASK_SYSTEM_LOCKED' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.task_container_guard() from public, anon, authenticated;

drop trigger if exists task_spaces_00_guard on public.task_spaces;
create trigger task_spaces_00_guard
  before insert or update on public.task_spaces
  for each row execute function public.task_container_guard();

drop trigger if exists task_lists_00_guard on public.task_lists;
create trigger task_lists_00_guard
  before insert or update on public.task_lists
  for each row execute function public.task_container_guard();

-- Task defaults + integrity (SECURITY INVOKER: the guard part depends on current_user).
--  * points default from priority
--  * completed_at: set when status becomes done, cleared otherwise; clients cannot forge it
--  * subtasks: one level deep, always in the parent's list
--  * auto tasks: clients cannot change title / source / linked record / list / due date or delete
create or replace function public.tasks_before_write()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_untrusted boolean := public.workflow_write_is_untrusted();
  v_now timestamptz := timezone('utc', now());
  v_parent_list uuid;
  v_parent_parent uuid;
  v_found boolean;
  -- OLD values copied only on UPDATE (OLD is never read on INSERT).
  v_is_update boolean := tg_op = 'UPDATE';
  v_old_parent uuid;
  v_old_list uuid;
  v_old_status text;
  v_old_completed timestamptz;
begin
  if tg_op = 'DELETE' then
    if v_untrusted and old.source <> 'manual' then
      raise exception 'TASK_AUTO_LOCKED' using errcode = '42501';
    end if;
    return old;
  end if;

  if tg_op = 'INSERT' then
    if v_untrusted then
      if new.source is distinct from 'manual' or new.source_key is not null then
        raise exception 'TASK_AUTO_LOCKED' using errcode = '42501';
      end if;
      new.created_at := v_now;
    end if;
  elsif v_untrusted then
    if new.organization_id is distinct from old.organization_id
       or new.source is distinct from old.source
       or new.source_key is distinct from old.source_key
       or new.created_at is distinct from old.created_at
       or new.created_by is distinct from old.created_by then
      raise exception 'TASK_AUTO_LOCKED' using errcode = '42501';
    end if;
    if old.source <> 'manual' and (
         new.title is distinct from old.title
      or new.title_en is distinct from old.title_en
      or new.entity_type is distinct from old.entity_type
      or new.entity_id is distinct from old.entity_id
      or new.list_id is distinct from old.list_id
      or new.parent_task_id is distinct from old.parent_task_id
      or new.due_at is distinct from old.due_at
    ) then
      raise exception 'TASK_AUTO_LOCKED' using errcode = '42501';
    end if;
  end if;

  if v_is_update then
    v_old_parent := old.parent_task_id;
    v_old_list := old.list_id;
    v_old_status := old.status;
    v_old_completed := old.completed_at;
  end if;

  if new.points is null then
    new.points := case new.priority
      when 'urgent' then 5
      when 'high' then 3
      when 'low' then 1
      else 2
    end;
  end if;

  if new.parent_task_id is not null and (
       not v_is_update
    or new.parent_task_id is distinct from v_old_parent
    or new.list_id is distinct from v_old_list
  ) then
    select t.list_id, t.parent_task_id, true
    into v_parent_list, v_parent_parent, v_found
    from public.tasks t
    where t.id = new.parent_task_id;

    if v_found is not true or v_parent_parent is not null then
      raise exception 'TASK_SUBTASK_DEPTH' using errcode = '23514';
    end if;
    new.list_id := v_parent_list;
  end if;

  if v_is_update
     and new.parent_task_id is not null
     and v_old_parent is null
     and exists (select 1 from public.tasks c where c.parent_task_id = new.id) then
    raise exception 'TASK_SUBTASK_DEPTH' using errcode = '23514';
  end if;

  if new.status <> 'done' then
    new.completed_at := null;
  elsif v_is_update and v_old_status = 'done' then
    new.completed_at := coalesce(v_old_completed, v_now);
  elsif v_untrusted then
    new.completed_at := v_now;
  else
    new.completed_at := coalesce(new.completed_at, v_now);
  end if;

  return new;
end;
$$;

revoke all on function public.tasks_before_write() from public, anon, authenticated;

drop trigger if exists tasks_00_before_write on public.tasks;
create trigger tasks_00_before_write
  before insert or update or delete on public.tasks
  for each row execute function public.tasks_before_write();

-- Subtasks follow their parent when it moves to another list.
create or replace function public.tasks_after_move()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.tasks
  set list_id = new.list_id
  where parent_task_id = new.id
    and list_id is distinct from new.list_id;
  return null;
end;
$$;

revoke all on function public.tasks_after_move() from public, anon, authenticated;

drop trigger if exists tasks_after_move on public.tasks;
create trigger tasks_after_move
  after update of list_id on public.tasks
  for each row
  when (old.list_id is distinct from new.list_id and new.parent_task_id is null)
  execute function public.tasks_after_move();

-- Timer: minutes computed on stop when not given.
create or replace function public.task_time_entries_before_write()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.ended_at is not null and new.minutes is null then
    new.minutes := greatest(0, round(extract(epoch from (new.ended_at - new.started_at)) / 60.0))::integer;
  end if;
  if new.ended_at is null then
    new.minutes := null;
  end if;
  return new;
end;
$$;

revoke all on function public.task_time_entries_before_write() from public, anon, authenticated;

drop trigger if exists task_time_entries_00_before_write on public.task_time_entries;
create trigger task_time_entries_00_before_write
  before insert or update on public.task_time_entries
  for each row execute function public.task_time_entries_before_write();

-- =============================================================================
-- D. RLS helpers, policies, grants
-- =============================================================================

-- Edit right on one task: task.manage, or task.create + (creator or assignee).
create or replace function public.can_edit_task(p_task_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.tasks t
    where t.id = p_task_id
      and (
        public.has_permission('task.manage', t.organization_id)
        or (
          public.has_permission('task.create', t.organization_id)
          and (
            t.created_by = auth.uid()
            or exists (
              select 1 from public.task_assignees a
              where a.task_id = t.id and a.profile_id = auth.uid()
            )
          )
        )
      )
  );
$$;

revoke all on function public.can_edit_task(uuid) from public, anon;
grant execute on function public.can_edit_task(uuid) to authenticated, service_role;

-- Is p_profile_id an active member of p_org (assignee validation).
create or replace function public.task_profile_is_member(p_profile_id uuid, p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_members m
    join public.profiles p on p.id = m.profile_id
    where m.profile_id = p_profile_id
      and m.organization_id = p_org
      and m.status = 'active'
      and p.is_active = true
  );
$$;

revoke all on function public.task_profile_is_member(uuid, uuid) from public, anon;
grant execute on function public.task_profile_is_member(uuid, uuid) to authenticated, service_role;

alter table public.task_spaces enable row level security;
alter table public.task_lists enable row level security;
alter table public.tasks enable row level security;
alter table public.task_assignees enable row level security;
alter table public.task_comments enable row level security;
alter table public.task_time_entries enable row level security;

-- task_spaces
drop policy if exists task_spaces_select on public.task_spaces;
create policy task_spaces_select on public.task_spaces
  for select to authenticated
  using (public.is_organization_member(organization_id) and public.has_permission('task.read', organization_id));

drop policy if exists task_spaces_insert on public.task_spaces;
create policy task_spaces_insert on public.task_spaces
  for insert to authenticated
  with check (public.has_permission('task.manage', organization_id) and created_by = auth.uid());

drop policy if exists task_spaces_update on public.task_spaces;
create policy task_spaces_update on public.task_spaces
  for update to authenticated
  using (public.has_permission('task.manage', organization_id))
  with check (public.has_permission('task.manage', organization_id));

-- task_lists
drop policy if exists task_lists_select on public.task_lists;
create policy task_lists_select on public.task_lists
  for select to authenticated
  using (public.is_organization_member(organization_id) and public.has_permission('task.read', organization_id));

drop policy if exists task_lists_insert on public.task_lists;
create policy task_lists_insert on public.task_lists
  for insert to authenticated
  with check (public.has_permission('task.create', organization_id) and created_by = auth.uid());

drop policy if exists task_lists_update on public.task_lists;
create policy task_lists_update on public.task_lists
  for update to authenticated
  using (
    public.has_permission('task.manage', organization_id)
    or (public.has_permission('task.create', organization_id) and created_by = auth.uid())
  )
  with check (
    public.has_permission('task.manage', organization_id)
    or (public.has_permission('task.create', organization_id) and created_by = auth.uid())
  );

-- tasks
drop policy if exists tasks_select on public.tasks;
create policy tasks_select on public.tasks
  for select to authenticated
  using (public.is_organization_member(organization_id) and public.has_permission('task.read', organization_id));

drop policy if exists tasks_insert on public.tasks;
create policy tasks_insert on public.tasks
  for insert to authenticated
  with check (public.has_permission('task.create', organization_id) and created_by = auth.uid());

drop policy if exists tasks_update on public.tasks;
create policy tasks_update on public.tasks
  for update to authenticated
  using (public.can_edit_task(id))
  with check (
    public.has_permission('task.create', organization_id)
    or public.has_permission('task.manage', organization_id)
  );

drop policy if exists tasks_delete on public.tasks;
create policy tasks_delete on public.tasks
  for delete to authenticated
  using (
    public.has_permission('task.manage', organization_id)
    or (public.has_permission('task.create', organization_id) and created_by = auth.uid())
  );

-- task_assignees
drop policy if exists task_assignees_select on public.task_assignees;
create policy task_assignees_select on public.task_assignees
  for select to authenticated
  using (public.is_organization_member(organization_id) and public.has_permission('task.read', organization_id));

drop policy if exists task_assignees_insert on public.task_assignees;
create policy task_assignees_insert on public.task_assignees
  for insert to authenticated
  with check (
    public.can_edit_task(task_id)
    and assigned_by = auth.uid()
    and public.task_profile_is_member(profile_id, organization_id)
  );

drop policy if exists task_assignees_delete on public.task_assignees;
create policy task_assignees_delete on public.task_assignees
  for delete to authenticated
  using (public.can_edit_task(task_id));

-- task_comments
drop policy if exists task_comments_select on public.task_comments;
create policy task_comments_select on public.task_comments
  for select to authenticated
  using (public.is_organization_member(organization_id) and public.has_permission('task.read', organization_id));

drop policy if exists task_comments_insert on public.task_comments;
create policy task_comments_insert on public.task_comments
  for insert to authenticated
  with check (
    public.has_permission('task.create', organization_id)
    and author_id = auth.uid()
  );

drop policy if exists task_comments_update on public.task_comments;
create policy task_comments_update on public.task_comments
  for update to authenticated
  using (author_id = auth.uid() and public.has_permission('task.create', organization_id))
  with check (author_id = auth.uid());

drop policy if exists task_comments_delete on public.task_comments;
create policy task_comments_delete on public.task_comments
  for delete to authenticated
  using (author_id = auth.uid() or public.has_permission('task.manage', organization_id));

-- task_time_entries: own rows; task.manage reads all.
drop policy if exists task_time_entries_select on public.task_time_entries;
create policy task_time_entries_select on public.task_time_entries
  for select to authenticated
  using (
    public.is_organization_member(organization_id)
    and (profile_id = auth.uid() or public.has_permission('task.manage', organization_id))
  );

drop policy if exists task_time_entries_insert on public.task_time_entries;
create policy task_time_entries_insert on public.task_time_entries
  for insert to authenticated
  with check (profile_id = auth.uid() and public.has_permission('task.create', organization_id));

drop policy if exists task_time_entries_update on public.task_time_entries;
create policy task_time_entries_update on public.task_time_entries
  for update to authenticated
  using (profile_id = auth.uid() and public.has_permission('task.create', organization_id))
  with check (profile_id = auth.uid());

drop policy if exists task_time_entries_delete on public.task_time_entries;
create policy task_time_entries_delete on public.task_time_entries
  for delete to authenticated
  using (profile_id = auth.uid());

revoke all on table public.task_spaces from anon;
revoke all on table public.task_lists from anon;
revoke all on table public.tasks from anon;
revoke all on table public.task_assignees from anon;
revoke all on table public.task_comments from anon;
revoke all on table public.task_time_entries from anon;

grant select, insert, update on table public.task_spaces to authenticated;
grant select, insert, update on table public.task_lists to authenticated;
grant select, insert, update, delete on table public.tasks to authenticated;
grant select, insert, delete on table public.task_assignees to authenticated;
grant select, insert, update, delete on table public.task_comments to authenticated;
grant select, insert, update, delete on table public.task_time_entries to authenticated;

grant all on table public.task_spaces to service_role;
grant all on table public.task_lists to service_role;
grant all on table public.tasks to service_role;
grant all on table public.task_assignees to service_role;
grant all on table public.task_comments to service_role;
grant all on table public.task_time_entries to service_role;

-- Open (todo / in_progress / review) top-level task count per list, for the sidebar tree.
-- SECURITY INVOKER: RLS on tasks applies, so it never reveals more than a select would.
create or replace function public.task_list_open_counts(p_org uuid)
returns table (list_id uuid, open_count integer)
language sql
stable
security invoker
set search_path = public
as $$
  select t.list_id, count(*)::integer
  from public.tasks t
  where t.organization_id = p_org
    and t.parent_task_id is null
    and t.status in ('todo', 'in_progress', 'review')
  group by t.list_id;
$$;

revoke all on function public.task_list_open_counts(uuid) from public, anon;
grant execute on function public.task_list_open_counts(uuid) to authenticated, service_role;

-- =============================================================================
-- E. Automatic tasks (SECURITY DEFINER; internal helpers are not callable by clients)
-- =============================================================================

-- System space by key ('projects' | 'approvals'), created on demand.
create or replace function public.task_ensure_system_space(p_org uuid, p_key text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  select id into v_id
  from public.task_spaces
  where organization_id = p_org and system_key = p_key;
  if v_id is not null then
    return v_id;
  end if;

  insert into public.task_spaces (organization_id, system_key, name_ar, name_en, color, icon, sort_order)
  values (
    p_org,
    p_key,
    case p_key when 'projects' then 'المشاريع' else 'الاعتمادات' end,
    case p_key when 'projects' then 'Projects' else 'Approvals' end,
    case p_key when 'projects' then '#2563eb' else '#d97706' end,
    case p_key when 'projects' then 'folder-kanban' else 'stamp' end,
    case p_key when 'projects' then 0 else 1 end
  )
  on conflict (organization_id, system_key) where system_key is not null do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id
    from public.task_spaces
    where organization_id = p_org and system_key = p_key;
  end if;
  return v_id;
end;
$$;

revoke all on function public.task_ensure_system_space(uuid, text) from public, anon, authenticated;

-- The project's auto list (one per project) in the 'projects' system space.
create or replace function public.task_ensure_project_list(p_project_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_project record;
  v_space uuid;
begin
  select id into v_id from public.task_lists where project_id = p_project_id;
  if v_id is not null then
    return v_id;
  end if;

  select p.id, p.organization_id, p.project_code, p.name_ar, p.name_en, p.archived_at
  into v_project
  from public.projects p
  where p.id = p_project_id;
  if not found then
    return null;
  end if;

  v_space := public.task_ensure_system_space(v_project.organization_id, 'projects');

  insert into public.task_lists (organization_id, space_id, project_id, name_ar, name_en, is_archived, sort_order)
  values (
    v_project.organization_id,
    v_space,
    v_project.id,
    left(v_project.project_code || ' — ' || v_project.name_ar, 160),
    left(v_project.project_code || ' — ' || v_project.name_en, 160),
    v_project.archived_at is not null,
    0
  )
  on conflict (project_id) do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id from public.task_lists where project_id = p_project_id;
  end if;
  return v_id;
end;
$$;

revoke all on function public.task_ensure_project_list(uuid) from public, anon, authenticated;

-- The org's fallback 'approvals' list (approval tasks not tied to a project).
create or replace function public.task_ensure_approvals_list(p_org uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_space uuid;
begin
  select id into v_id
  from public.task_lists
  where organization_id = p_org and system_key = 'approvals';
  if v_id is not null then
    return v_id;
  end if;

  v_space := public.task_ensure_system_space(p_org, 'approvals');

  insert into public.task_lists (organization_id, space_id, system_key, name_ar, name_en, sort_order)
  values (p_org, v_space, 'approvals', 'طلبات الاعتماد', 'Approval requests', 0)
  on conflict (organization_id, system_key) where system_key is not null do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id
    from public.task_lists
    where organization_id = p_org and system_key = 'approvals';
  end if;
  return v_id;
end;
$$;

revoke all on function public.task_ensure_approvals_list(uuid) from public, anon, authenticated;

-- App RPC: "on first need" — returns the project's list id (creates it if missing).
create or replace function public.ensure_project_task_list(p_project_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
begin
  select organization_id into v_org from public.projects where id = p_project_id;
  if v_org is null then
    raise exception 'NOT_FOUND';
  end if;
  if not (public.is_organization_member(v_org) and public.has_permission('task.read', v_org)) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  return public.task_ensure_project_list(p_project_id);
end;
$$;

revoke all on function public.ensure_project_task_list(uuid) from public, anon;
grant execute on function public.ensure_project_task_list(uuid) to authenticated, service_role;

-- Project owning a linked record (null when unknown / not project-scoped).
create or replace function public.task_project_for_entity(p_entity_type text, p_entity_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_project uuid;
begin
  case p_entity_type
    when 'project' then
      select id into v_project from public.projects where id = p_entity_id;
    when 'workflow_instance_step' then
      select i.entity_id into v_project
      from public.workflow_instance_steps s
      join public.workflow_instances i on i.id = s.instance_id
      where s.id = p_entity_id and i.entity_type = 'project';
    when 'purchase_request' then
      select project_id into v_project from public.purchase_requests where id = p_entity_id;
    when 'purchase_order' then
      select project_id into v_project from public.purchase_orders where id = p_entity_id;
    when 'supplier_invoice' then
      select project_id into v_project from public.supplier_invoices where id = p_entity_id;
    when 'client_valuation' then
      select project_id into v_project from public.client_valuations where id = p_entity_id;
    when 'client_invoice' then
      select project_id into v_project from public.client_invoices where id = p_entity_id;
    when 'variation' then
      select project_id into v_project from public.variations where id = p_entity_id;
    when 'document' then
      select project_id into v_project from public.documents where id = p_entity_id;
    else
      v_project := null;
  end case;
  return v_project;
exception when others then
  return null;
end;
$$;

revoke all on function public.task_project_for_entity(text, uuid) from public, anon, authenticated;

-- Replace the engine-assigned assignee (assigned_by is null); manual assignees are kept.
create or replace function public.task_set_auto_assignee(p_task_id uuid, p_org uuid, p_profile_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.task_assignees
  where task_id = p_task_id
    and assigned_by is null
    and profile_id is distinct from p_profile_id;

  if p_profile_id is not null then
    insert into public.task_assignees (task_id, profile_id, organization_id, assigned_by)
    values (p_task_id, p_profile_id, p_org, null)
    on conflict (task_id, profile_id) do nothing;
  end if;
end;
$$;

revoke all on function public.task_set_auto_assignee(uuid, uuid, uuid) from public, anon, authenticated;

-- Workflow step → task. Status mapping:
--   step ready        → task todo (re-opened if it was done/cancelled)
--   step in_progress  → task in_progress (unless the user already moved it to review)
--   step completed    → task done (completed_at = step.completed_at)
--   step skipped / cancelled / rejected → task cancelled (unless done)
--   step pending (reset by a return/resubmit) → open task cancelled; re-opened when ready again
create or replace function public.task_sync_workflow_step(p_step_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_step public.workflow_instance_steps;
  v_instance public.workflow_instances;
  v_tpl public.workflow_steps;
  v_task public.tasks;
  v_key text;
  v_list uuid;
  v_assignee uuid;
  v_target text;
begin
  select * into v_step from public.workflow_instance_steps where id = p_step_id;
  if v_step.id is null then
    return;
  end if;

  v_key := 'wfs:' || v_step.id::text;
  select * into v_task from public.tasks where source_key = v_key;

  if v_step.status in ('ready', 'in_progress') then
    select * into v_instance from public.workflow_instances where id = v_step.instance_id;
    if v_instance.id is null
       or v_instance.entity_type is distinct from 'project'
       or v_instance.status not in ('pending', 'in_progress') then
      return;
    end if;

    select * into v_tpl from public.workflow_steps where id = v_step.step_id;

    v_assignee := coalesce(
      v_step.responsible_user_id,
      (select a.responsible_user_id
         from public.project_workflow_step_assignments a
        where a.project_id = v_instance.entity_id
          and a.workflow_step_id = v_step.step_id
        limit 1),
      v_step.assigned_user_id
    );
    v_target := case when v_step.status = 'in_progress' then 'in_progress' else 'todo' end;

    if v_task.id is null then
      v_list := public.task_ensure_project_list(v_instance.entity_id);
      if v_list is null then
        return;
      end if;

      insert into public.tasks (
        organization_id, list_id, title, title_en, status, priority, due_at,
        entity_type, entity_id, source, source_key, sort_order
      ) values (
        v_step.organization_id,
        v_list,
        left(coalesce(nullif(btrim(v_tpl.name_ar), ''), v_step.step_key), 500),
        left(nullif(btrim(v_tpl.name_en), ''), 500),
        v_target,
        'high',
        v_step.due_at,
        'workflow_instance_step',
        v_step.id,
        'workflow_step',
        v_key,
        v_step.sequence
      )
      on conflict (source_key) do nothing
      returning * into v_task;

      if v_task.id is null then
        select * into v_task from public.tasks where source_key = v_key;
      end if;
    else
      update public.tasks
      set due_at = v_step.due_at,
          status = case
            when status in ('done', 'cancelled') then v_target
            when v_target = 'in_progress' and status = 'todo' then 'in_progress'
            else status
          end
      where id = v_task.id
      returning * into v_task;
    end if;

    if v_task.id is not null then
      perform public.task_set_auto_assignee(v_task.id, v_step.organization_id, v_assignee);
    end if;
  elsif v_task.id is not null then
    if v_step.status = 'completed' then
      update public.tasks
      set status = 'done',
          completed_at = coalesce(v_step.completed_at, timezone('utc', now()))
      where id = v_task.id and status <> 'done';
    else
      -- skipped / cancelled / rejected / pending
      update public.tasks
      set status = 'cancelled'
      where id = v_task.id and status not in ('done', 'cancelled');
    end if;
  end if;
end;
$$;

revoke all on function public.task_sync_workflow_step(uuid) from public, anon, authenticated;

-- Approval step → task. Open = step pending/in_progress, request open, it is the current
-- step (parallel mode, or no earlier open step in sequential mode) and it names a person
-- (delegated_to, else user_id). Step completed → done; skipped/cancelled or request closed
-- → cancelled. Title / English title / due date follow the request.
create or replace function public.task_sync_approval_step(p_step_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_step public.approval_steps;
  v_request public.approval_requests;
  v_task public.tasks;
  v_key text;
  v_list uuid;
  v_project uuid;
  v_assignee uuid;
  v_open boolean;
begin
  select * into v_step from public.approval_steps where id = p_step_id;
  if v_step.id is null then
    return;
  end if;
  select * into v_request from public.approval_requests where id = v_step.request_id;
  if v_request.id is null then
    return;
  end if;

  v_key := 'aps:' || v_step.id::text;
  select * into v_task from public.tasks where source_key = v_key;
  v_assignee := coalesce(v_step.delegated_to, v_step.user_id);

  v_open := v_step.status in ('pending', 'in_progress')
    and v_request.status in ('pending', 'in_progress')
    and (
      v_request.mode = 'parallel'
      or not exists (
        select 1
        from public.approval_steps o
        where o.request_id = v_step.request_id
          and o.sequence < v_step.sequence
          and o.status in ('pending', 'in_progress')
      )
    );

  if v_open then
    if v_task.id is null then
      if v_assignee is null then
        return;
      end if;
      v_project := public.task_project_for_entity(v_request.entity_type, v_request.entity_id);
      if v_project is not null then
        v_list := public.task_ensure_project_list(v_project);
      end if;
      if v_list is null then
        v_list := public.task_ensure_approvals_list(v_request.organization_id);
      end if;
      if v_list is null then
        return;
      end if;

      insert into public.tasks (
        organization_id, list_id, title, title_en, status, priority, due_at,
        entity_type, entity_id, source, source_key, sort_order
      ) values (
        v_request.organization_id,
        v_list,
        left(v_request.title, 500),
        left(nullif(btrim(v_request.title_en), ''), 500),
        case when v_step.status = 'in_progress' then 'in_progress' else 'todo' end,
        'normal',
        coalesce(v_request.due_at, v_step.due_at),
        'approval_request',
        v_request.id,
        'approval_step',
        v_key,
        v_step.sequence
      )
      on conflict (source_key) do nothing
      returning * into v_task;

      if v_task.id is null then
        select * into v_task from public.tasks where source_key = v_key;
      end if;
    else
      update public.tasks
      set title = left(v_request.title, 500),
          title_en = left(nullif(btrim(v_request.title_en), ''), 500),
          due_at = coalesce(v_request.due_at, v_step.due_at),
          status = case when status in ('done', 'cancelled') then 'todo' else status end
      where id = v_task.id
      returning * into v_task;
    end if;

    if v_task.id is not null then
      perform public.task_set_auto_assignee(v_task.id, v_request.organization_id, v_assignee);
    end if;
  elsif v_task.id is not null then
    if v_step.status = 'completed' then
      update public.tasks
      set status = 'done'
      where id = v_task.id and status <> 'done';
    elsif v_step.status in ('skipped', 'cancelled') or v_request.status in ('completed', 'cancelled') then
      update public.tasks
      set status = 'cancelled'
      where id = v_task.id and status not in ('done', 'cancelled');
    end if;
  end if;
end;
$$;

revoke all on function public.task_sync_approval_step(uuid) from public, anon, authenticated;

-- ---- Trigger wrappers: never fail the parent transaction ----

create or replace function public.task_on_project_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    if tg_op = 'INSERT' then
      perform public.task_ensure_project_list(new.id);
    else
      update public.task_lists
      set name_ar = left(new.project_code || ' — ' || new.name_ar, 160),
          name_en = left(new.project_code || ' — ' || new.name_en, 160),
          is_archived = new.archived_at is not null
      where project_id = new.id;
    end if;
  exception when others then
    raise warning '091 task workspace: project % list sync skipped: %', new.id, sqlerrm;
  end;
  return null;
end;
$$;

revoke all on function public.task_on_project_change() from public, anon, authenticated;

drop trigger if exists projects_zz_task_list on public.projects;
create trigger projects_zz_task_list
  after insert or update of project_code, name_ar, name_en, archived_at on public.projects
  for each row execute function public.task_on_project_change();

create or replace function public.task_on_workflow_step_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    perform public.task_sync_workflow_step(new.id);
  exception when others then
    raise warning '091 task workspace: workflow step % task sync skipped: %', new.id, sqlerrm;
  end;
  return null;
end;
$$;

revoke all on function public.task_on_workflow_step_change() from public, anon, authenticated;

drop trigger if exists workflow_instance_steps_zz_task_sync on public.workflow_instance_steps;
create trigger workflow_instance_steps_zz_task_sync
  after insert or update of status, responsible_user_id, assigned_user_id, due_at
  on public.workflow_instance_steps
  for each row execute function public.task_on_workflow_step_change();

create or replace function public.task_on_approval_step_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    perform public.task_sync_approval_step(new.id);
  exception when others then
    raise warning '091 task workspace: approval step % task sync skipped: %', new.id, sqlerrm;
  end;
  return null;
end;
$$;

revoke all on function public.task_on_approval_step_change() from public, anon, authenticated;

drop trigger if exists approval_steps_zz_task_sync on public.approval_steps;
create trigger approval_steps_zz_task_sync
  after insert or update of status, user_id, delegated_to, due_at
  on public.approval_steps
  for each row execute function public.task_on_approval_step_change();

create or replace function public.task_on_approval_request_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_step_id uuid;
begin
  begin
    for v_step_id in
      select s.id from public.approval_steps s where s.request_id = new.id order by s.sequence
    loop
      perform public.task_sync_approval_step(v_step_id);
    end loop;
  exception when others then
    raise warning '091 task workspace: approval request % task sync skipped: %', new.id, sqlerrm;
  end;
  return null;
end;
$$;

revoke all on function public.task_on_approval_request_change() from public, anon, authenticated;

drop trigger if exists approval_requests_zz_task_sync on public.approval_requests;
create trigger approval_requests_zz_task_sync
  after update of status, title, title_en, due_at
  on public.approval_requests
  for each row execute function public.task_on_approval_request_change();

-- =============================================================================
-- F. Backfill (idempotent: ensure_* and sync_* upsert by key)
-- =============================================================================

do $$
declare
  v_id uuid;
  v_projects integer := 0;
  v_steps integer := 0;
  v_approvals integer := 0;
begin
  for v_id in select p.id from public.projects p loop
    begin
      perform public.task_ensure_project_list(v_id);
      v_projects := v_projects + 1;
    exception when others then
      raise warning '091 backfill: project % skipped: %', v_id, sqlerrm;
    end;
  end loop;

  for v_id in
    select s.id
    from public.workflow_instance_steps s
    join public.workflow_instances i on i.id = s.instance_id
    where s.status in ('ready', 'in_progress')
      and i.status in ('pending', 'in_progress')
      and i.entity_type = 'project'
  loop
    begin
      perform public.task_sync_workflow_step(v_id);
      v_steps := v_steps + 1;
    exception when others then
      raise warning '091 backfill: workflow step % skipped: %', v_id, sqlerrm;
    end;
  end loop;

  for v_id in
    select s.id
    from public.approval_steps s
    join public.approval_requests r on r.id = s.request_id
    where s.status in ('pending', 'in_progress')
      and r.status in ('pending', 'in_progress')
  loop
    begin
      perform public.task_sync_approval_step(v_id);
      v_approvals := v_approvals + 1;
    exception when others then
      raise warning '091 backfill: approval step % skipped: %', v_id, sqlerrm;
    end;
  end loop;

  raise notice '091 backfill: % project lists, % workflow steps, % approval steps processed',
    v_projects, v_steps, v_approvals;
end;
$$;

-- =============================================================================
-- G. task_performance(p_org, p_from, p_to, p_space)
-- =============================================================================
-- One row per assignee profile for the Riyadh calendar period [p_from, p_to]:
--   assigned              tasks (not cancelled) created, due or completed in the period
--   completed             done with completed_at in the period
--   completed_on_time     … and completed_at <= due_at (or no due date)
--   overdue_open          still open with due_at before min(now, period end)
--   on_time_rate          completed_on_time / completed × 100 (null when nothing completed)
--   avg_cycle_hours       avg(completed_at − created_at) in hours over completed
--   logged_minutes        finished time entries by that person started in the period
--   estimate_minutes_done sum(estimate_minutes) over completed
--   points_earned         sum(points × 1.0 on time / × 0.5 late) over completed
-- Callers without task.performance.read only get their own row.

create or replace function public.task_performance(
  p_org uuid,
  p_from date,
  p_to date,
  p_space uuid default null
)
returns table (
  profile_id uuid,
  full_name_ar text,
  full_name_en text,
  assigned integer,
  completed integer,
  completed_on_time integer,
  overdue_open integer,
  on_time_rate numeric,
  avg_cycle_hours numeric,
  logged_minutes bigint,
  estimate_minutes_done bigint,
  points_earned numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_all boolean;
  v_start timestamptz;
  v_end timestamptz;
  v_now timestamptz := timezone('utc', now());
begin
  if v_uid is null or not public.is_organization_member(p_org) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_from > p_to or p_to - p_from > 1100 then
    raise exception 'VALIDATION';
  end if;

  v_all := public.has_permission('task.performance.read', p_org);
  v_start := p_from::timestamp at time zone 'Asia/Riyadh';
  v_end := (p_to + 1)::timestamp at time zone 'Asia/Riyadh';

  return query
  with scoped as (
    select t.id, t.status, t.created_at, t.due_at, t.completed_at, t.estimate_minutes, t.points
    from public.tasks t
    join public.task_lists l on l.id = t.list_id
    where t.organization_id = p_org
      and t.status <> 'cancelled'
      and (p_space is null or l.space_id = p_space)
  ),
  mine as (
    select a.profile_id as pid, s.*,
      (s.status = 'done' and s.completed_at >= v_start and s.completed_at < v_end) as done_in_period,
      (s.due_at is null or s.completed_at <= s.due_at) as on_time
    from scoped s
    join public.task_assignees a on a.task_id = s.id
    where v_all or a.profile_id = v_uid
  ),
  per_person as (
    select m.pid,
      count(*) filter (where
           (m.created_at >= v_start and m.created_at < v_end)
        or (m.due_at >= v_start and m.due_at < v_end)
        or m.done_in_period) as n_assigned,
      count(*) filter (where m.done_in_period) as n_completed,
      count(*) filter (where m.done_in_period and m.on_time) as n_on_time,
      count(*) filter (where m.status <> 'done' and m.due_at < least(v_now, v_end)) as n_overdue,
      avg(extract(epoch from (m.completed_at - m.created_at)) / 3600.0)
        filter (where m.done_in_period) as cycle_hours,
      coalesce(sum(m.estimate_minutes) filter (where m.done_in_period), 0) as est_done,
      coalesce(sum(m.points * case when m.on_time then 1.0 else 0.5 end)
        filter (where m.done_in_period), 0) as pts
    from mine m
    group by m.pid
  ),
  logged as (
    select e.profile_id as pid, sum(e.minutes) as mins
    from public.task_time_entries e
    join scoped s on s.id = e.task_id
    where e.organization_id = p_org
      and e.minutes is not null
      and e.started_at >= v_start
      and e.started_at < v_end
      and (v_all or e.profile_id = v_uid)
    group by e.profile_id
  ),
  people as (
    select pp.pid from per_person pp
    union
    select lg.pid from logged lg
  )
  select
    pe.pid,
    pr.full_name_ar,
    pr.full_name_en,
    coalesce(pp.n_assigned, 0)::integer,
    coalesce(pp.n_completed, 0)::integer,
    coalesce(pp.n_on_time, 0)::integer,
    coalesce(pp.n_overdue, 0)::integer,
    case when coalesce(pp.n_completed, 0) > 0
      then round(pp.n_on_time::numeric * 100 / pp.n_completed, 1) end,
    round(pp.cycle_hours::numeric, 1),
    coalesce(lg.mins, 0)::bigint,
    coalesce(pp.est_done, 0)::bigint,
    round(coalesce(pp.pts, 0)::numeric, 1)
  from people pe
  left join per_person pp on pp.pid = pe.pid
  left join logged lg on lg.pid = pe.pid
  left join public.profiles pr on pr.id = pe.pid
  order by round(coalesce(pp.pts, 0)::numeric, 1) desc, coalesce(pp.n_completed, 0) desc, pr.full_name_ar;
end;
$$;

revoke all on function public.task_performance(uuid, date, date, uuid) from public, anon;
grant execute on function public.task_performance(uuid, date, date, uuid) to authenticated, service_role;

comment on function public.task_performance(uuid, date, date, uuid) is
  '091: per-assignee task KPIs for a Riyadh date range; own row only without task.performance.read.';
