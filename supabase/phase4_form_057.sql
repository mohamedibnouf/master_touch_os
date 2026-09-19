-- Master Touch OS — 057
-- Phase 4.4: Attendance Management
-- Additive only. Does not modify migrations 001–056.

create extension if not exists btree_gist;

-- =============================================================================
-- A. Enums
-- =============================================================================

do $$
begin
  if not exists (select 1 from pg_type where typname = 'attendance_status') then
    create type public.attendance_status as enum (
      'present', 'late', 'absent', 'partial', 'on_leave', 'holiday', 'off_day', 'missing_checkout'
    );
  end if;
  if not exists (select 1 from pg_type where typname = 'attendance_source') then
    create type public.attendance_source as enum (
      'self_service', 'hr_adjustment', 'system_reconcile', 'import'
    );
  end if;
end
$$;

-- =============================================================================
-- B. Attendance policies
-- =============================================================================

create table if not exists public.attendance_policies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  code text not null,
  name_ar text not null,
  name_en text not null,
  description_ar text,
  description_en text,
  late_grace_minutes integer not null default 15 check (late_grace_minutes >= 0),
  early_leave_grace_minutes integer not null default 15 check (early_leave_grace_minutes >= 0),
  minimum_work_minutes integer not null default 240 check (minimum_work_minutes >= 0),
  allow_manual_check_in boolean not null default true,
  allow_manual_check_out boolean not null default true,
  require_hr_approval_for_adjustment boolean not null default false,
  reconciliation_delay_hours integer not null default 8 check (reconciliation_delay_hours >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (organization_id, code)
);

drop trigger if exists attendance_policies_set_updated_at on public.attendance_policies;
create trigger attendance_policies_set_updated_at
  before update on public.attendance_policies
  for each row execute function public.set_updated_at();

create index if not exists attendance_policies_org_active_idx
  on public.attendance_policies (organization_id, is_active);

-- =============================================================================
-- C. Shifts
-- =============================================================================

create table if not exists public.attendance_shifts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  policy_id uuid not null references public.attendance_policies (id) on delete restrict,
  code text not null,
  name_ar text not null,
  name_en text not null,
  start_time time not null,
  end_time time not null,
  break_minutes integer not null default 60 check (break_minutes >= 0),
  crosses_midnight boolean not null default false,
  working_days smallint[] not null default '{0,1,2,3,4}',
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (organization_id, code),
  constraint attendance_shifts_working_days_valid check (
    cardinality(working_days) > 0
    and working_days <@ array[0,1,2,3,4,5,6]::smallint[]
  )
);

drop trigger if exists attendance_shifts_set_updated_at on public.attendance_shifts;
create trigger attendance_shifts_set_updated_at
  before update on public.attendance_shifts
  for each row execute function public.set_updated_at();

create index if not exists attendance_shifts_org_active_idx
  on public.attendance_shifts (organization_id, is_active);
create index if not exists attendance_shifts_policy_idx
  on public.attendance_shifts (policy_id);

-- =============================================================================
-- D. Employee shift assignments (effective-dated)
-- =============================================================================

create table if not exists public.employee_shift_assignments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  employee_id uuid not null references public.employees (id) on delete cascade,
  shift_id uuid not null references public.attendance_shifts (id) on delete restrict,
  effective_from date not null,
  effective_to date,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  constraint employee_shift_assignments_range_valid check (
    effective_to is null or effective_to >= effective_from
  )
);

create index if not exists employee_shift_assignments_emp_idx
  on public.employee_shift_assignments (employee_id, effective_from desc);
create index if not exists employee_shift_assignments_org_idx
  on public.employee_shift_assignments (organization_id, effective_from);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'employee_shift_assignments_no_overlap'
  ) then
    alter table public.employee_shift_assignments
      add constraint employee_shift_assignments_no_overlap
      exclude using gist (
        employee_id with =,
        daterange(effective_from, coalesce(effective_to, 'infinity'::date), '[]') with &&
      );
  end if;
end
$$;

-- =============================================================================
-- E. Daily attendance records
-- =============================================================================

create table if not exists public.attendance_records (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  employee_id uuid not null references public.employees (id) on delete cascade,
  shift_id uuid references public.attendance_shifts (id) on delete set null,
  attendance_date date not null,
  scheduled_start timestamptz,
  scheduled_end timestamptz,
  check_in_at timestamptz,
  check_out_at timestamptz,
  worked_minutes integer not null default 0 check (worked_minutes >= 0),
  late_minutes integer not null default 0 check (late_minutes >= 0),
  early_leave_minutes integer not null default 0 check (early_leave_minutes >= 0),
  attendance_status public.attendance_status not null default 'absent',
  source public.attendance_source not null default 'self_service',
  notes text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (employee_id, attendance_date),
  constraint attendance_records_checkout_after_checkin check (
    check_out_at is null or check_in_at is null or check_out_at >= check_in_at
  )
);

drop trigger if exists attendance_records_set_updated_at on public.attendance_records;
create trigger attendance_records_set_updated_at
  before update on public.attendance_records
  for each row execute function public.set_updated_at();

create index if not exists attendance_records_org_date_idx
  on public.attendance_records (organization_id, attendance_date);
create index if not exists attendance_records_emp_date_idx
  on public.attendance_records (employee_id, attendance_date desc);
create index if not exists attendance_records_status_date_idx
  on public.attendance_records (organization_id, attendance_status, attendance_date);

-- =============================================================================
-- F. Immutable adjustment history
-- =============================================================================

create table if not exists public.attendance_adjustments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  attendance_record_id uuid not null references public.attendance_records (id) on delete cascade,
  employee_id uuid not null references public.employees (id) on delete cascade,
  previous_values jsonb not null,
  new_values jsonb not null,
  reason text not null,
  adjusted_by uuid not null references public.profiles (id) on delete restrict,
  adjusted_at timestamptz not null default timezone('utc', now())
);

create index if not exists attendance_adjustments_record_idx
  on public.attendance_adjustments (attendance_record_id, adjusted_at desc);
create index if not exists attendance_adjustments_org_idx
  on public.attendance_adjustments (organization_id, adjusted_at desc);

-- Prevent silent history mutation
create or replace function public.prevent_attendance_adjustment_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'IMMUTABLE_ATTENDANCE_ADJUSTMENT' using errcode = 'P0001';
end;
$$;

drop trigger if exists attendance_adjustments_immutable_upd on public.attendance_adjustments;
create trigger attendance_adjustments_immutable_upd
  before update on public.attendance_adjustments
  for each row execute function public.prevent_attendance_adjustment_mutation();

drop trigger if exists attendance_adjustments_immutable_del on public.attendance_adjustments;
create trigger attendance_adjustments_immutable_del
  before delete on public.attendance_adjustments
  for each row execute function public.prevent_attendance_adjustment_mutation();


-- =============================================================================
-- G. Permissions
-- =============================================================================

insert into public.permissions (key, resource, action, description_ar, description_en) values
  ('attendance.view_self', 'attendance', 'view_self', 'Ø¹Ø±Ø¶ Ø­Ø¶ÙˆØ±ÙŠ', 'View own attendance'),
  ('attendance.check_in', 'attendance', 'check_in', 'ØªØ³Ø¬ÙŠÙ„ Ø§Ù„Ø­Ø¶ÙˆØ±', 'Check in'),
  ('attendance.check_out', 'attendance', 'check_out', 'ØªØ³Ø¬ÙŠÙ„ Ø§Ù„Ø§Ù†ØµØ±Ø§Ù', 'Check out'),
  ('attendance.view_team', 'attendance', 'view_team', 'Ø¹Ø±Ø¶ Ø­Ø¶ÙˆØ± Ø§Ù„ÙØ±ÙŠÙ‚', 'View team attendance'),
  ('attendance.view_all', 'attendance', 'view_all', 'Ø¹Ø±Ø¶ ÙƒÙ„ Ø§Ù„Ø­Ø¶ÙˆØ±', 'View all organization attendance'),
  ('attendance.manage', 'attendance', 'manage', 'Ø¥Ø¯Ø§Ø±Ø© Ø§Ù„Ø­Ø¶ÙˆØ±', 'Manage attendance'),
  ('attendance.adjust', 'attendance', 'adjust', 'ØªØ¹Ø¯ÙŠÙ„ Ø³Ø¬Ù„Ø§Øª Ø§Ù„Ø­Ø¶ÙˆØ±', 'Adjust attendance records'),
  ('attendance.manage_policies', 'attendance', 'manage_policies', 'Ø¥Ø¯Ø§Ø±Ø© Ø³ÙŠØ§Ø³Ø§Øª Ø§Ù„Ø­Ø¶ÙˆØ±', 'Manage attendance policies'),
  ('attendance.manage_shifts', 'attendance', 'manage_shifts', 'Ø¥Ø¯Ø§Ø±Ø© Ø§Ù„ÙˆØ±Ø¯ÙŠØ§Øª', 'Manage shifts and assignments')
on conflict (key) do nothing;

insert into public.role_permissions (role_id, permission_key)
select r.id, p.key
from public.roles r
cross join public.permissions p
where r.code = 'super_admin' and r.organization_id is null
  and p.key like 'attendance.%'
on conflict do nothing;

insert into public.role_permissions (role_id, permission_key)
select r.id, p.key
from public.roles r
cross join public.permissions p
where r.code = 'general_manager' and r.organization_id is null
  and p.key like 'attendance.%'
on conflict do nothing;

insert into public.role_permissions (role_id, permission_key)
select r.id, x.permission_key
from public.roles r
join (values
  ('hr_manager', 'attendance.view_self'),
  ('hr_manager', 'attendance.check_in'),
  ('hr_manager', 'attendance.check_out'),
  ('hr_manager', 'attendance.view_team'),
  ('hr_manager', 'attendance.view_all'),
  ('hr_manager', 'attendance.manage'),
  ('hr_manager', 'attendance.adjust'),
  ('hr_manager', 'attendance.manage_policies'),
  ('hr_manager', 'attendance.manage_shifts'),
  ('hr_officer', 'attendance.view_self'),
  ('hr_officer', 'attendance.check_in'),
  ('hr_officer', 'attendance.check_out'),
  ('hr_officer', 'attendance.view_all'),
  ('hr_officer', 'attendance.manage'),
  ('hr_officer', 'attendance.adjust'),
  ('department_manager', 'attendance.view_self'),
  ('department_manager', 'attendance.check_in'),
  ('department_manager', 'attendance.check_out'),
  ('department_manager', 'attendance.view_team'),
  ('operations_manager', 'attendance.view_self'),
  ('operations_manager', 'attendance.check_in'),
  ('operations_manager', 'attendance.check_out'),
  ('operations_manager', 'attendance.view_team'),
  ('project_manager', 'attendance.view_self'),
  ('project_manager', 'attendance.check_in'),
  ('project_manager', 'attendance.check_out'),
  ('project_manager', 'attendance.view_team'),
  ('project_engineer', 'attendance.view_self'),
  ('project_engineer', 'attendance.check_in'),
  ('project_engineer', 'attendance.check_out'),
  ('engineer', 'attendance.view_self'),
  ('engineer', 'attendance.check_in'),
  ('engineer', 'attendance.check_out'),
  ('document_controller', 'attendance.view_self'),
  ('document_controller', 'attendance.check_in'),
  ('document_controller', 'attendance.check_out'),
  ('finance_manager', 'attendance.view_self'),
  ('finance_manager', 'attendance.check_in'),
  ('finance_manager', 'attendance.check_out'),
  ('finance_officer', 'attendance.view_self'),
  ('finance_officer', 'attendance.check_in'),
  ('finance_officer', 'attendance.check_out'),
  ('procurement_manager', 'attendance.view_self'),
  ('procurement_manager', 'attendance.check_in'),
  ('procurement_manager', 'attendance.check_out'),
  ('procurement_officer', 'attendance.view_self'),
  ('procurement_officer', 'attendance.check_in'),
  ('procurement_officer', 'attendance.check_out')
) as x(role_code, permission_key) on r.code = x.role_code and r.organization_id is null
on conflict do nothing;

-- Seed DEFAULT policy + STD_DAY shift for Master Touch org
insert into public.attendance_policies (
  organization_id, code, name_ar, name_en, description_ar, description_en,
  late_grace_minutes, early_leave_grace_minutes, minimum_work_minutes,
  allow_manual_check_in, allow_manual_check_out, require_hr_approval_for_adjustment,
  reconciliation_delay_hours, is_active
)
select
  '11111111-1111-1111-1111-111111111111',
  'DEFAULT',
  'Ø³ÙŠØ§Ø³Ø© Ø§Ù„Ø­Ø¶ÙˆØ± Ø§Ù„Ø§ÙØªØ±Ø§Ø¶ÙŠØ©',
  'Default Attendance Policy',
  'Ø³ÙŠØ§Ø³Ø© Ø§Ù„Ø­Ø¶ÙˆØ± Ø§Ù„Ù‚ÙŠØ§Ø³ÙŠØ© Ù„Ù„Ù…Ù†Ø¸Ù…Ø©',
  'Standard organization attendance policy',
  15, 15, 240, true, true, false, 8, true
where exists (select 1 from public.organizations where id = '11111111-1111-1111-1111-111111111111')
on conflict (organization_id, code) do nothing;

insert into public.attendance_shifts (
  organization_id, policy_id, code, name_ar, name_en,
  start_time, end_time, break_minutes, crosses_midnight, working_days, is_active
)
select
  '11111111-1111-1111-1111-111111111111',
  p.id,
  'STD_DAY',
  'ÙˆØ±Ø¯ÙŠØ© Ù†Ù‡Ø§Ø±ÙŠØ© Ù‚ÙŠØ§Ø³ÙŠØ©',
  'Standard Day Shift',
  time '08:00',
  time '17:00',
  60,
  false,
  '{0,1,2,3,4}'::smallint[],
  true
from public.attendance_policies p
where p.organization_id = '11111111-1111-1111-1111-111111111111'
  and p.code = 'DEFAULT'
  and exists (select 1 from public.organizations where id = '11111111-1111-1111-1111-111111111111')
on conflict (organization_id, code) do nothing;

-- =============================================================================
-- H. Helpers
-- =============================================================================

create or replace function public.is_attendance_direct_manager_of(p_employee_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.employees report
    join public.employees mgr on mgr.id = report.direct_manager_employee_id
    where report.id = p_employee_id
      and mgr.profile_id = auth.uid()
      and mgr.is_active = true
  );
$$;

grant execute on function public.is_attendance_direct_manager_of(uuid) to authenticated;

create or replace function public.can_read_attendance_row(p_record_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.attendance_records ar
    join public.employees e on e.id = ar.employee_id
    where ar.id = p_record_id
      and public.is_organization_member(ar.organization_id)
      and (
        public.is_platform_admin()
        or e.profile_id = auth.uid()
        or public.has_permission('attendance.view_all', ar.organization_id, 'organization', null)
        or public.has_permission('attendance.manage', ar.organization_id, 'organization', null)
        or public.has_permission('attendance.adjust', ar.organization_id, 'organization', null)
        or (
          public.has_permission('attendance.view_team', ar.organization_id, 'organization', null)
          and public.is_attendance_direct_manager_of(ar.employee_id)
        )
      )
  );
$$;

grant execute on function public.can_read_attendance_row(uuid) to authenticated;

create or replace function public.employee_has_approved_leave_on(
  p_employee_id uuid,
  p_date date
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.leave_requests lr
    where lr.employee_id = p_employee_id
      and lr.status = 'approved'
      and lr.start_date <= p_date
      and lr.end_date >= p_date
  );
$$;

grant execute on function public.employee_has_approved_leave_on(uuid, date) to authenticated;

create or replace function public.resolve_employee_shift_for_date(
  p_employee_id uuid,
  p_date date
)
returns public.attendance_shifts
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_shift public.attendance_shifts;
begin
  select s.* into v_shift
  from public.employee_shift_assignments a
  join public.attendance_shifts s on s.id = a.shift_id
  where a.employee_id = p_employee_id
    and a.effective_from <= p_date
    and (a.effective_to is null or a.effective_to >= p_date)
    and s.is_active = true
  order by a.effective_from desc
  limit 1;

  return v_shift;
end;
$$;

grant execute on function public.resolve_employee_shift_for_date(uuid, date) to authenticated;

create or replace function public.compute_scheduled_window(
  p_attendance_date date,
  p_shift public.attendance_shifts
)
returns table(scheduled_start timestamptz, scheduled_end timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_attendance_date is null or p_shift.id is null then
    return;
  end if;

  scheduled_start := ((p_attendance_date + p_shift.start_time) at time zone 'Asia/Riyadh');

  if p_shift.crosses_midnight then
    scheduled_end := (((p_attendance_date + 1) + p_shift.end_time) at time zone 'Asia/Riyadh');
  else
    scheduled_end := ((p_attendance_date + p_shift.end_time) at time zone 'Asia/Riyadh');
  end if;

  return next;
end;
$$;

grant execute on function public.compute_scheduled_window(date, public.attendance_shifts) to authenticated;

create or replace function public.classify_attendance_status(
  p_check_in_at timestamptz,
  p_check_out_at timestamptz,
  p_scheduled_start timestamptz,
  p_scheduled_end timestamptz,
  p_late_grace_minutes integer,
  p_early_leave_grace_minutes integer,
  p_minimum_work_minutes integer,
  p_is_on_leave boolean,
  p_is_working_day boolean,
  p_is_day_closed boolean
)
returns public.attendance_status
language plpgsql
immutable
as $$
declare
  v_late_grace interval;
  v_worked integer;
begin
  if coalesce(p_is_on_leave, false) then
    return 'on_leave'::public.attendance_status;
  end if;

  if not coalesce(p_is_working_day, true) then
    return 'off_day'::public.attendance_status;
  end if;

  if p_check_in_at is null then
    return 'absent'::public.attendance_status;
  end if;

  if p_check_out_at is null then
    if coalesce(p_is_day_closed, false) then
      return 'missing_checkout'::public.attendance_status;
    end if;
    v_late_grace := make_interval(mins => greatest(coalesce(p_late_grace_minutes, 0), 0));
    if p_scheduled_start is not null and p_check_in_at > (p_scheduled_start + v_late_grace) then
      return 'late'::public.attendance_status;
    end if;
    return 'present'::public.attendance_status;
  end if;

  v_worked := greatest(0, floor(extract(epoch from (p_check_out_at - p_check_in_at)) / 60.0)::integer);
  v_late_grace := make_interval(mins => greatest(coalesce(p_late_grace_minutes, 0), 0));

  if p_scheduled_start is not null and p_check_in_at > (p_scheduled_start + v_late_grace) then
    return 'late'::public.attendance_status;
  end if;

  if v_worked < greatest(coalesce(p_minimum_work_minutes, 0), 0) then
    return 'partial'::public.attendance_status;
  end if;

  return 'present'::public.attendance_status;
end;
$$;

grant execute on function public.classify_attendance_status(
  timestamptz, timestamptz, timestamptz, timestamptz,
  integer, integer, integer, boolean, boolean, boolean
) to authenticated;

-- Internal: resolve attendance date + shift for "now" (cross-midnight aware)
create or replace function public.resolve_attendance_context_for_now(
  p_employee_id uuid,
  p_now timestamptz
)
returns table (
  attendance_date date,
  shift public.attendance_shifts,
  scheduled_start timestamptz,
  scheduled_end timestamptz,
  policy public.attendance_policies
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_local timestamp;
  v_local_date date;
  v_y_date date;
  v_shift public.attendance_shifts;
  v_pol public.attendance_policies;
  v_start timestamptz;
  v_end timestamptz;
begin
  v_local := p_now at time zone 'Asia/Riyadh';
  v_local_date := v_local::date;
  v_y_date := v_local_date - 1;

  -- Prefer yesterday when still inside a cross-midnight window
  v_shift := public.resolve_employee_shift_for_date(p_employee_id, v_y_date);
  if v_shift.id is not null and v_shift.crosses_midnight then
    select cw.scheduled_start, cw.scheduled_end into v_start, v_end
    from public.compute_scheduled_window(v_y_date, v_shift) cw;
    if p_now >= v_start and p_now <= v_end then
      select * into v_pol from public.attendance_policies where id = v_shift.policy_id;
      attendance_date := v_y_date;
      shift := v_shift;
      scheduled_start := v_start;
      scheduled_end := v_end;
      policy := v_pol;
      return next;
      return;
    end if;
  end if;

  v_shift := public.resolve_employee_shift_for_date(p_employee_id, v_local_date);
  if v_shift.id is null then
    return;
  end if;

  select cw.scheduled_start, cw.scheduled_end into v_start, v_end
  from public.compute_scheduled_window(v_local_date, v_shift) cw;

  select * into v_pol from public.attendance_policies where id = v_shift.policy_id;

  attendance_date := v_local_date;
  shift := v_shift;
  scheduled_start := v_start;
  scheduled_end := v_end;
  policy := v_pol;
  return next;
end;
$$;

revoke all on function public.resolve_attendance_context_for_now(uuid, timestamptz) from public, anon, authenticated;


-- =============================================================================
-- I. RPCs
-- =============================================================================

create or replace function public.attendance_check_in()
returns public.attendance_records
language plpgsql
security definer
set search_path = public
as $$
declare
  v_emp public.employees;
  v_now timestamptz := timezone('utc', now());
  v_ctx record;
  v_rec public.attendance_records;
  v_late integer := 0;
  v_status public.attendance_status;
  v_on_leave boolean;
  v_is_working boolean;
  v_dow smallint;
begin
  if auth.uid() is null then
    raise exception 'UNAUTHORIZED' using errcode = 'P0001';
  end if;

  select * into v_emp
  from public.employees
  where profile_id = auth.uid() and is_active = true
  order by created_at
  limit 1;

  if v_emp.id is null then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  if not (
    public.has_permission('attendance.check_in', v_emp.organization_id, 'organization', null)
    or public.is_platform_admin()
  ) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  select * into v_ctx
  from public.resolve_attendance_context_for_now(v_emp.id, v_now);

  if not found or v_ctx.shift.id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;

  if not coalesce(v_ctx.policy.allow_manual_check_in, true) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  v_dow := extract(dow from v_ctx.attendance_date)::smallint;
  v_is_working := v_dow = any (v_ctx.shift.working_days);
  v_on_leave := public.employee_has_approved_leave_on(v_emp.id, v_ctx.attendance_date);

  insert into public.attendance_records (
    organization_id, employee_id, shift_id, attendance_date,
    scheduled_start, scheduled_end, attendance_status, source
  ) values (
    v_emp.organization_id, v_emp.id, v_ctx.shift.id, v_ctx.attendance_date,
    v_ctx.scheduled_start, v_ctx.scheduled_end, 'absent', 'self_service'
  )
  on conflict (employee_id, attendance_date) do nothing;

  select * into v_rec
  from public.attendance_records
  where employee_id = v_emp.id
    and attendance_date = v_ctx.attendance_date
  for update;

  if v_rec.check_in_at is not null then
    return v_rec;
  end if;

  if v_ctx.scheduled_start is not null
     and v_now > (v_ctx.scheduled_start + make_interval(mins => greatest(coalesce(v_ctx.policy.late_grace_minutes, 0), 0))) then
    v_late := greatest(
      0,
      floor(extract(epoch from (v_now - v_ctx.scheduled_start)) / 60.0)::integer
        - greatest(coalesce(v_ctx.policy.late_grace_minutes, 0), 0)
    );
  end if;

  v_status := public.classify_attendance_status(
    v_now,
    null,
    v_ctx.scheduled_start,
    v_ctx.scheduled_end,
    v_ctx.policy.late_grace_minutes,
    v_ctx.policy.early_leave_grace_minutes,
    v_ctx.policy.minimum_work_minutes,
    v_on_leave,
    v_is_working,
    false
  );

  update public.attendance_records set
    shift_id = v_ctx.shift.id,
    scheduled_start = v_ctx.scheduled_start,
    scheduled_end = v_ctx.scheduled_end,
    check_in_at = v_now,
    late_minutes = case when v_on_leave then 0 else v_late end,
    attendance_status = v_status,
    source = case when source = 'hr_adjustment' then source else 'self_service' end,
    updated_at = timezone('utc', now())
  where id = v_rec.id
  returning * into v_rec;

  perform public.log_audit(
    v_emp.organization_id,
    'attendance.checked_in',
    'attendance_record',
    v_rec.id,
    null,
    jsonb_build_object(
      'employee_id', v_emp.id,
      'attendance_date', v_ctx.attendance_date,
      'check_in_at', v_now,
      'late_minutes', v_rec.late_minutes,
      'attendance_status', v_rec.attendance_status::text
    ),
    null, null, null
  );

  perform public.emit_domain_event(
    v_emp.organization_id,
    'attendance.checked_in',
    'attendance_record',
    v_rec.id,
    jsonb_build_object(
      'employee_id', v_emp.id,
      'attendance_date', v_ctx.attendance_date,
      'attendance_status', v_rec.attendance_status::text
    ),
    null
  );

  return v_rec;
end;
$$;

grant execute on function public.attendance_check_in() to authenticated;

create or replace function public.attendance_check_out()
returns public.attendance_records
language plpgsql
security definer
set search_path = public
as $$
declare
  v_emp public.employees;
  v_now timestamptz := timezone('utc', now());
  v_ctx record;
  v_rec public.attendance_records;
  v_early integer := 0;
  v_worked integer := 0;
  v_status public.attendance_status;
  v_on_leave boolean;
  v_is_working boolean;
  v_dow smallint;
  v_policy public.attendance_policies;
  v_prev jsonb;
begin
  if auth.uid() is null then
    raise exception 'UNAUTHORIZED' using errcode = 'P0001';
  end if;

  select * into v_emp
  from public.employees
  where profile_id = auth.uid() and is_active = true
  order by created_at
  limit 1;

  if v_emp.id is null then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  if not (
    public.has_permission('attendance.check_out', v_emp.organization_id, 'organization', null)
    or public.is_platform_admin()
  ) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  select * into v_ctx
  from public.resolve_attendance_context_for_now(v_emp.id, v_now);

  if not found or v_ctx.shift.id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;

  if not coalesce(v_ctx.policy.allow_manual_check_out, true) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  select * into v_rec
  from public.attendance_records
  where employee_id = v_emp.id
    and attendance_date = v_ctx.attendance_date
  for update;

  if v_rec.id is null or v_rec.check_in_at is null then
    raise exception 'CONFLICT' using errcode = 'P0001';
  end if;

  if v_rec.check_out_at is not null then
    return v_rec;
  end if;

  if v_now < v_rec.check_in_at then
    raise exception 'VALIDATION' using errcode = 'P0001';
  end if;

  v_policy := v_ctx.policy;
  v_dow := extract(dow from v_ctx.attendance_date)::smallint;
  v_is_working := v_dow = any (v_ctx.shift.working_days);
  v_on_leave := public.employee_has_approved_leave_on(v_emp.id, v_ctx.attendance_date);

  v_worked := greatest(0, floor(extract(epoch from (v_now - v_rec.check_in_at)) / 60.0)::integer);

  if v_rec.scheduled_end is not null
     and v_now < (v_rec.scheduled_end - make_interval(mins => greatest(coalesce(v_policy.early_leave_grace_minutes, 0), 0))) then
    v_early := greatest(
      0,
      floor(extract(epoch from (v_rec.scheduled_end - v_now)) / 60.0)::integer
        - greatest(coalesce(v_policy.early_leave_grace_minutes, 0), 0)
    );
  end if;

  v_status := public.classify_attendance_status(
    v_rec.check_in_at,
    v_now,
    coalesce(v_rec.scheduled_start, v_ctx.scheduled_start),
    coalesce(v_rec.scheduled_end, v_ctx.scheduled_end),
    v_policy.late_grace_minutes,
    v_policy.early_leave_grace_minutes,
    v_policy.minimum_work_minutes,
    v_on_leave,
    v_is_working,
    false
  );

  v_prev := to_jsonb(v_rec);

  update public.attendance_records set
    check_out_at = v_now,
    worked_minutes = v_worked,
    early_leave_minutes = case when v_on_leave then 0 else v_early end,
    attendance_status = v_status,
    source = case when source = 'hr_adjustment' then source else 'self_service' end,
    updated_at = timezone('utc', now())
  where id = v_rec.id
  returning * into v_rec;

  perform public.log_audit(
    v_emp.organization_id,
    'attendance.checked_out',
    'attendance_record',
    v_rec.id,
    v_prev,
    jsonb_build_object(
      'check_out_at', v_now,
      'worked_minutes', v_rec.worked_minutes,
      'early_leave_minutes', v_rec.early_leave_minutes,
      'attendance_status', v_rec.attendance_status::text
    ),
    null, null, null
  );

  perform public.emit_domain_event(
    v_emp.organization_id,
    'attendance.checked_out',
    'attendance_record',
    v_rec.id,
    jsonb_build_object(
      'employee_id', v_emp.id,
      'attendance_date', v_rec.attendance_date,
      'worked_minutes', v_rec.worked_minutes,
      'attendance_status', v_rec.attendance_status::text
    ),
    null
  );

  return v_rec;
end;
$$;

grant execute on function public.attendance_check_out() to authenticated;

create or replace function public.adjust_attendance_record(
  p_record_id uuid,
  p_check_in timestamptz default null,
  p_check_out timestamptz default null,
  p_status public.attendance_status default null,
  p_notes text default null,
  p_reason text default null
)
returns public.attendance_records
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rec public.attendance_records;
  v_prev jsonb;
  v_shift public.attendance_shifts;
  v_policy public.attendance_policies;
  v_check_in timestamptz;
  v_check_out timestamptz;
  v_late integer := 0;
  v_early integer := 0;
  v_worked integer := 0;
  v_status public.attendance_status;
  v_on_leave boolean;
  v_is_working boolean := true;
  v_dow smallint;
begin
  if auth.uid() is null then
    raise exception 'UNAUTHORIZED' using errcode = 'P0001';
  end if;

  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'VALIDATION' using errcode = 'P0001';
  end if;

  select * into v_rec from public.attendance_records where id = p_record_id for update;
  if v_rec.id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;

  if not (
    public.has_permission('attendance.adjust', v_rec.organization_id, 'organization', null)
    or public.is_platform_admin()
  ) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  v_prev := to_jsonb(v_rec);
  v_check_in := coalesce(p_check_in, v_rec.check_in_at);
  v_check_out := coalesce(p_check_out, v_rec.check_out_at);

  if v_check_in is not null and v_check_out is not null and v_check_out < v_check_in then
    raise exception 'VALIDATION' using errcode = 'P0001';
  end if;

  if v_rec.shift_id is not null then
    select * into v_shift from public.attendance_shifts where id = v_rec.shift_id;
    if v_shift.id is not null then
      select * into v_policy from public.attendance_policies where id = v_shift.policy_id;
      v_dow := extract(dow from v_rec.attendance_date)::smallint;
      v_is_working := v_dow = any (v_shift.working_days);
    end if;
  end if;

  if v_policy.id is null then
    v_policy.late_grace_minutes := 15;
    v_policy.early_leave_grace_minutes := 15;
    v_policy.minimum_work_minutes := 240;
  end if;

  v_on_leave := public.employee_has_approved_leave_on(v_rec.employee_id, v_rec.attendance_date);

  if v_check_in is not null and v_rec.scheduled_start is not null
     and v_check_in > (v_rec.scheduled_start + make_interval(mins => greatest(coalesce(v_policy.late_grace_minutes, 0), 0))) then
    v_late := greatest(
      0,
      floor(extract(epoch from (v_check_in - v_rec.scheduled_start)) / 60.0)::integer
        - greatest(coalesce(v_policy.late_grace_minutes, 0), 0)
    );
  end if;

  if v_check_in is not null and v_check_out is not null then
    v_worked := greatest(0, floor(extract(epoch from (v_check_out - v_check_in)) / 60.0)::integer);
  end if;

  if v_check_out is not null and v_rec.scheduled_end is not null
     and v_check_out < (v_rec.scheduled_end - make_interval(mins => greatest(coalesce(v_policy.early_leave_grace_minutes, 0), 0))) then
    v_early := greatest(
      0,
      floor(extract(epoch from (v_rec.scheduled_end - v_check_out)) / 60.0)::integer
        - greatest(coalesce(v_policy.early_leave_grace_minutes, 0), 0)
    );
  end if;

  if p_status is not null then
    v_status := p_status;
  else
    v_status := public.classify_attendance_status(
      v_check_in,
      v_check_out,
      v_rec.scheduled_start,
      v_rec.scheduled_end,
      v_policy.late_grace_minutes,
      v_policy.early_leave_grace_minutes,
      v_policy.minimum_work_minutes,
      v_on_leave,
      v_is_working,
      true
    );
  end if;

  update public.attendance_records set
    check_in_at = v_check_in,
    check_out_at = v_check_out,
    worked_minutes = v_worked,
    late_minutes = v_late,
    early_leave_minutes = v_early,
    attendance_status = v_status,
    notes = coalesce(p_notes, notes),
    source = 'hr_adjustment',
    updated_at = timezone('utc', now())
  where id = v_rec.id
  returning * into v_rec;

  insert into public.attendance_adjustments (
    organization_id, attendance_record_id, employee_id,
    previous_values, new_values, reason, adjusted_by
  ) values (
    v_rec.organization_id,
    v_rec.id,
    v_rec.employee_id,
    v_prev,
    to_jsonb(v_rec),
    trim(p_reason),
    auth.uid()
  );

  perform public.log_audit(
    v_rec.organization_id,
    'attendance.adjusted',
    'attendance_record',
    v_rec.id,
    v_prev,
    to_jsonb(v_rec) || jsonb_build_object('reason', trim(p_reason)),
    null, null, null
  );

  perform public.emit_domain_event(
    v_rec.organization_id,
    'attendance.adjusted',
    'attendance_record',
    v_rec.id,
    jsonb_build_object(
      'employee_id', v_rec.employee_id,
      'attendance_date', v_rec.attendance_date,
      'attendance_status', v_rec.attendance_status::text
    ),
    null
  );

  return v_rec;
end;
$$;

grant execute on function public.adjust_attendance_record(
  uuid, timestamptz, timestamptz, public.attendance_status, text, text
) to authenticated;

create or replace function public.assign_employee_shift(
  p_employee_id uuid,
  p_shift_id uuid,
  p_effective_from date,
  p_effective_to date default null
)
returns public.employee_shift_assignments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_emp public.employees;
  v_shift public.attendance_shifts;
  v_row public.employee_shift_assignments;
begin
  if auth.uid() is null then
    raise exception 'UNAUTHORIZED' using errcode = 'P0001';
  end if;

  if p_effective_from is null then
    raise exception 'VALIDATION' using errcode = 'P0001';
  end if;

  if p_effective_to is not null and p_effective_to < p_effective_from then
    raise exception 'VALIDATION' using errcode = 'P0001';
  end if;

  select * into v_emp from public.employees where id = p_employee_id;
  if v_emp.id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;

  if not (
    public.has_permission('attendance.manage_shifts', v_emp.organization_id, 'organization', null)
    or public.is_platform_admin()
  ) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  select * into v_shift from public.attendance_shifts where id = p_shift_id;
  if v_shift.id is null or v_shift.organization_id <> v_emp.organization_id then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;

  insert into public.employee_shift_assignments (
    organization_id, employee_id, shift_id, effective_from, effective_to, created_by
  ) values (
    v_emp.organization_id, v_emp.id, v_shift.id, p_effective_from, p_effective_to, auth.uid()
  )
  returning * into v_row;

  perform public.log_audit(
    v_emp.organization_id,
    'attendance.shift_assigned',
    'employee_shift_assignment',
    v_row.id,
    null,
    jsonb_build_object(
      'employee_id', v_emp.id,
      'shift_id', v_shift.id,
      'effective_from', p_effective_from,
      'effective_to', p_effective_to
    ),
    null, null, null
  );

  perform public.emit_domain_event(
    v_emp.organization_id,
    'attendance.shift_assigned',
    'employee_shift_assignment',
    v_row.id,
    jsonb_build_object('employee_id', v_emp.id, 'shift_id', v_shift.id),
    null
  );

  return v_row;
end;
$$;

grant execute on function public.assign_employee_shift(uuid, uuid, date, date) to authenticated;


create or replace function public.reconcile_attendance_for_date(
  p_organization_id uuid,
  p_date date
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer := 0;
  v_now timestamptz := timezone('utc', now());
  v_emp_id uuid;
  v_shift public.attendance_shifts;
  v_policy public.attendance_policies;
  v_start timestamptz;
  v_end timestamptz;
  v_rec public.attendance_records;
  v_on_leave boolean;
  v_is_working boolean;
  v_day_closed boolean;
  v_dow smallint;
  v_delay integer;
begin
  if auth.uid() is null then
    raise exception 'UNAUTHORIZED' using errcode = 'P0001';
  end if;

  if p_organization_id is null or p_date is null then
    raise exception 'VALIDATION' using errcode = 'P0001';
  end if;

  if not (
    public.has_permission('attendance.manage', p_organization_id, 'organization', null)
    or public.is_platform_admin()
  ) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  for v_emp_id in
    select distinct a.employee_id
    from public.employee_shift_assignments a
    join public.employees e on e.id = a.employee_id
    where a.organization_id = p_organization_id
      and e.organization_id = p_organization_id
      and e.is_active = true
      and a.effective_from <= p_date
      and (a.effective_to is null or a.effective_to >= p_date)
  loop
    v_shift := public.resolve_employee_shift_for_date(v_emp_id, p_date);
    if v_shift.id is null then
      continue;
    end if;

    select * into v_policy from public.attendance_policies where id = v_shift.policy_id;
    select cw.scheduled_start, cw.scheduled_end into v_start, v_end
    from public.compute_scheduled_window(p_date, v_shift) cw;

    v_dow := extract(dow from p_date)::smallint;
    v_is_working := v_dow = any (v_shift.working_days);
    v_on_leave := public.employee_has_approved_leave_on(v_emp_id, p_date);
    v_delay := greatest(coalesce(v_policy.reconciliation_delay_hours, 8), 0);
    v_day_closed := v_end is not null and v_now > (v_end + make_interval(hours => v_delay));

    select * into v_rec
    from public.attendance_records
    where employee_id = v_emp_id
      and attendance_date = p_date
    for update;

    -- Leave is authoritative
    if v_on_leave then
      if v_rec.id is null then
        insert into public.attendance_records (
          organization_id, employee_id, shift_id, attendance_date,
          scheduled_start, scheduled_end, attendance_status, source
        ) values (
          p_organization_id, v_emp_id, v_shift.id, p_date,
          v_start, v_end, 'on_leave', 'system_reconcile'
        );
        v_count := v_count + 1;
      elsif v_rec.attendance_status is distinct from 'on_leave'
            and v_rec.source is distinct from 'hr_adjustment' then
        update public.attendance_records set
          shift_id = coalesce(shift_id, v_shift.id),
          scheduled_start = coalesce(scheduled_start, v_start),
          scheduled_end = coalesce(scheduled_end, v_end),
          attendance_status = 'on_leave',
          late_minutes = 0,
          early_leave_minutes = 0,
          source = 'system_reconcile',
          updated_at = timezone('utc', now())
        where id = v_rec.id;
        v_count := v_count + 1;
      end if;
      continue;
    end if;

    -- Off day
    if not v_is_working then
      if v_rec.id is null then
        insert into public.attendance_records (
          organization_id, employee_id, shift_id, attendance_date,
          scheduled_start, scheduled_end, attendance_status, source
        ) values (
          p_organization_id, v_emp_id, v_shift.id, p_date,
          v_start, v_end, 'off_day', 'system_reconcile'
        );
        v_count := v_count + 1;
      elsif v_rec.check_in_at is null
            and v_rec.attendance_status is distinct from 'off_day'
            and v_rec.source is distinct from 'hr_adjustment' then
        update public.attendance_records set
          attendance_status = 'off_day',
          source = 'system_reconcile',
          updated_at = timezone('utc', now())
        where id = v_rec.id;
        v_count := v_count + 1;
      end if;
      continue;
    end if;

    -- Working day: absent / missing checkout only after day close
    if not v_day_closed then
      continue;
    end if;

    if v_rec.id is null then
      insert into public.attendance_records (
        organization_id, employee_id, shift_id, attendance_date,
        scheduled_start, scheduled_end, attendance_status, source
      ) values (
        p_organization_id, v_emp_id, v_shift.id, p_date,
        v_start, v_end, 'absent', 'system_reconcile'
      );
      v_count := v_count + 1;
      continue;
    end if;

    if v_rec.source = 'hr_adjustment' then
      continue;
    end if;

    if v_rec.check_in_at is null then
      if v_rec.attendance_status is distinct from 'absent' then
        update public.attendance_records set
          shift_id = coalesce(shift_id, v_shift.id),
          scheduled_start = coalesce(scheduled_start, v_start),
          scheduled_end = coalesce(scheduled_end, v_end),
          attendance_status = 'absent',
          source = 'system_reconcile',
          updated_at = timezone('utc', now())
        where id = v_rec.id;
        v_count := v_count + 1;
      end if;
    elsif v_rec.check_out_at is null then
      if v_rec.attendance_status is distinct from 'missing_checkout' then
        update public.attendance_records set
          attendance_status = 'missing_checkout',
          source = 'system_reconcile',
          updated_at = timezone('utc', now())
        where id = v_rec.id;
        v_count := v_count + 1;
      end if;
    end if;
  end loop;

  perform public.log_audit(
    p_organization_id,
    'attendance.reconciled',
    'organization',
    p_organization_id,
    null,
    jsonb_build_object('attendance_date', p_date, 'updated_count', v_count),
    null, null, null
  );

  perform public.emit_domain_event(
    p_organization_id,
    'attendance.reconciled',
    'organization',
    p_organization_id,
    jsonb_build_object('attendance_date', p_date, 'updated_count', v_count),
    null
  );

  return v_count;
end;
$$;

grant execute on function public.reconcile_attendance_for_date(uuid, date) to authenticated;

create or replace function public.attendance_monthly_summary(
  p_organization_id uuid,
  p_year integer,
  p_month integer
)
returns table (
  employee_id uuid,
  working_days integer,
  present_days integer,
  absent_days integer,
  leave_days integer,
  late_count integer,
  total_late_minutes integer,
  early_leave_count integer,
  total_worked_minutes integer,
  missing_checkout_count integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_from date;
  v_to date;
begin
  if auth.uid() is null then
    raise exception 'UNAUTHORIZED' using errcode = 'P0001';
  end if;

  if p_organization_id is null or p_year is null or p_month is null
     or p_month < 1 or p_month > 12 then
    raise exception 'VALIDATION' using errcode = 'P0001';
  end if;

  if not (
    public.has_permission('attendance.view_all', p_organization_id, 'organization', null)
    or public.has_permission('attendance.manage', p_organization_id, 'organization', null)
    or public.has_permission('attendance.view_team', p_organization_id, 'organization', null)
    or public.is_platform_admin()
  ) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  v_from := make_date(p_year, p_month, 1);
  v_to := (v_from + interval '1 month' - interval '1 day')::date;

  return query
  select
    ar.employee_id,
    count(*) filter (
      where ar.attendance_status not in ('off_day', 'holiday')
    )::integer as working_days,
    count(*) filter (
      where ar.attendance_status in ('present', 'late', 'partial')
    )::integer as present_days,
    count(*) filter (
      where ar.attendance_status = 'absent'
    )::integer as absent_days,
    count(*) filter (
      where ar.attendance_status = 'on_leave'
    )::integer as leave_days,
    count(*) filter (
      where ar.attendance_status = 'late'
    )::integer as late_count,
    coalesce(sum(ar.late_minutes), 0)::integer as total_late_minutes,
    count(*) filter (
      where ar.early_leave_minutes > 0
    )::integer as early_leave_count,
    coalesce(sum(ar.worked_minutes), 0)::integer as total_worked_minutes,
    count(*) filter (
      where ar.attendance_status = 'missing_checkout'
    )::integer as missing_checkout_count
  from public.attendance_records ar
  where ar.organization_id = p_organization_id
    and ar.attendance_date >= v_from
    and ar.attendance_date <= v_to
    and (
      public.is_platform_admin()
      or public.has_permission('attendance.view_all', p_organization_id, 'organization', null)
      or public.has_permission('attendance.manage', p_organization_id, 'organization', null)
      or (
        public.has_permission('attendance.view_team', p_organization_id, 'organization', null)
        and public.is_attendance_direct_manager_of(ar.employee_id)
      )
    )
  group by ar.employee_id
  order by ar.employee_id;
end;
$$;

grant execute on function public.attendance_monthly_summary(uuid, integer, integer) to authenticated;

-- =============================================================================
-- J. RLS
-- =============================================================================

alter table public.attendance_policies enable row level security;
alter table public.attendance_shifts enable row level security;
alter table public.employee_shift_assignments enable row level security;
alter table public.attendance_records enable row level security;
alter table public.attendance_adjustments enable row level security;

drop policy if exists attendance_policies_select on public.attendance_policies;
create policy attendance_policies_select on public.attendance_policies
  for select to authenticated
  using (
    public.is_organization_member(organization_id)
    and (
      public.is_platform_admin()
      or public.has_permission('attendance.view_self', organization_id, 'organization', null)
      or public.has_permission('attendance.check_in', organization_id, 'organization', null)
      or public.has_permission('attendance.view_team', organization_id, 'organization', null)
      or public.has_permission('attendance.view_all', organization_id, 'organization', null)
      or public.has_permission('attendance.manage', organization_id, 'organization', null)
      or public.has_permission('attendance.manage_policies', organization_id, 'organization', null)
    )
  );

drop policy if exists attendance_policies_write on public.attendance_policies;
create policy attendance_policies_write on public.attendance_policies
  for all to authenticated
  using (
    public.has_permission('attendance.manage_policies', organization_id, 'organization', null)
    or public.is_platform_admin()
  )
  with check (
    public.has_permission('attendance.manage_policies', organization_id, 'organization', null)
    or public.is_platform_admin()
  );

drop policy if exists attendance_shifts_select on public.attendance_shifts;
create policy attendance_shifts_select on public.attendance_shifts
  for select to authenticated
  using (
    public.is_organization_member(organization_id)
    and (
      public.is_platform_admin()
      or public.has_permission('attendance.view_self', organization_id, 'organization', null)
      or public.has_permission('attendance.check_in', organization_id, 'organization', null)
      or public.has_permission('attendance.view_team', organization_id, 'organization', null)
      or public.has_permission('attendance.view_all', organization_id, 'organization', null)
      or public.has_permission('attendance.manage', organization_id, 'organization', null)
      or public.has_permission('attendance.manage_shifts', organization_id, 'organization', null)
    )
  );

drop policy if exists attendance_shifts_write on public.attendance_shifts;
create policy attendance_shifts_write on public.attendance_shifts
  for all to authenticated
  using (
    public.has_permission('attendance.manage_shifts', organization_id, 'organization', null)
    or public.is_platform_admin()
  )
  with check (
    public.has_permission('attendance.manage_shifts', organization_id, 'organization', null)
    or public.is_platform_admin()
  );

drop policy if exists employee_shift_assignments_select on public.employee_shift_assignments;
create policy employee_shift_assignments_select on public.employee_shift_assignments
  for select to authenticated
  using (
    public.is_organization_member(organization_id)
    and (
      public.is_platform_admin()
      or exists (
        select 1 from public.employees e
        where e.id = employee_id and e.profile_id = auth.uid()
      )
      or public.has_permission('attendance.view_all', organization_id, 'organization', null)
      or public.has_permission('attendance.manage', organization_id, 'organization', null)
      or public.has_permission('attendance.manage_shifts', organization_id, 'organization', null)
      or (
        public.has_permission('attendance.view_team', organization_id, 'organization', null)
        and public.is_attendance_direct_manager_of(employee_id)
      )
    )
  );

drop policy if exists employee_shift_assignments_write on public.employee_shift_assignments;
create policy employee_shift_assignments_write on public.employee_shift_assignments
  for all to authenticated
  using (false)
  with check (false);

drop policy if exists attendance_records_select on public.attendance_records;
create policy attendance_records_select on public.attendance_records
  for select to authenticated
  using (public.can_read_attendance_row(id));

drop policy if exists attendance_records_insert on public.attendance_records;
create policy attendance_records_insert on public.attendance_records
  for insert to authenticated
  with check (false);

drop policy if exists attendance_records_update on public.attendance_records;
create policy attendance_records_update on public.attendance_records
  for update to authenticated
  using (false)
  with check (false);

drop policy if exists attendance_records_delete on public.attendance_records;
create policy attendance_records_delete on public.attendance_records
  for delete to authenticated
  using (false);

drop policy if exists attendance_adjustments_select on public.attendance_adjustments;
create policy attendance_adjustments_select on public.attendance_adjustments
  for select to authenticated
  using (
    public.has_permission('attendance.view_all', organization_id, 'organization', null)
    or public.has_permission('attendance.manage', organization_id, 'organization', null)
    or public.has_permission('attendance.adjust', organization_id, 'organization', null)
    or public.is_platform_admin()
  );

drop policy if exists attendance_adjustments_write on public.attendance_adjustments;
create policy attendance_adjustments_write on public.attendance_adjustments
  for all to authenticated
  using (false)
  with check (false);
