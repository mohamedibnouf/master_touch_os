-- Master Touch OS — 056
-- Phase 4.3: Leave Management
-- Additive only. Does not modify migrations 001–055.

-- =============================================================================
-- A. Organization leave day basis (calendar | working)
-- =============================================================================

alter table public.organizations
  add column if not exists leave_day_basis text not null default 'calendar'
    check (leave_day_basis in ('calendar', 'working'));

-- =============================================================================
-- B. Leave types
-- =============================================================================

create table if not exists public.leave_types (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  code text not null,
  name_ar text not null,
  name_en text not null,
  description_ar text,
  description_en text,
  is_paid boolean not null default true,
  annual_entitlement_days numeric(8,2) not null default 0 check (annual_entitlement_days >= 0),
  requires_attachment boolean not null default false,
  minimum_notice_days integer not null default 0 check (minimum_notice_days >= 0),
  maximum_consecutive_days integer check (maximum_consecutive_days is null or maximum_consecutive_days > 0),
  allow_carry_forward boolean not null default false,
  maximum_carry_forward_days numeric(8,2) check (maximum_carry_forward_days is null or maximum_carry_forward_days >= 0),
  allow_negative_balance boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (organization_id, code)
);

drop trigger if exists leave_types_set_updated_at on public.leave_types;
create trigger leave_types_set_updated_at
  before update on public.leave_types
  for each row execute function public.set_updated_at();

create index if not exists leave_types_org_active_idx
  on public.leave_types (organization_id, is_active);

-- =============================================================================
-- C. Employee leave balances (per type per year)
-- =============================================================================

create table if not exists public.employee_leave_balances (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  employee_id uuid not null references public.employees (id) on delete cascade,
  leave_type_id uuid not null references public.leave_types (id) on delete restrict,
  year integer not null check (year >= 2000 and year <= 2100),
  opening_balance numeric(8,2) not null default 0,
  entitled_days numeric(8,2) not null default 0,
  carried_forward_days numeric(8,2) not null default 0,
  used_days numeric(8,2) not null default 0,
  pending_days numeric(8,2) not null default 0,
  adjustment_days numeric(8,2) not null default 0,
  available_days numeric(8,2) generated always as (
    opening_balance + entitled_days + carried_forward_days + adjustment_days - used_days - pending_days
  ) stored,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (employee_id, leave_type_id, year)
);

drop trigger if exists employee_leave_balances_set_updated_at on public.employee_leave_balances;
create trigger employee_leave_balances_set_updated_at
  before update on public.employee_leave_balances
  for each row execute function public.set_updated_at();

create index if not exists employee_leave_balances_org_year_idx
  on public.employee_leave_balances (organization_id, year);

create index if not exists employee_leave_balances_employee_idx
  on public.employee_leave_balances (employee_id, year);

-- =============================================================================
-- D. Leave balance adjustments (immutable ledger rows)
-- =============================================================================

create table if not exists public.leave_balance_adjustments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  balance_id uuid not null references public.employee_leave_balances (id) on delete cascade,
  employee_id uuid not null references public.employees (id) on delete cascade,
  leave_type_id uuid not null references public.leave_types (id) on delete restrict,
  year integer not null,
  adjustment_days numeric(8,2) not null,
  reason text not null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists leave_balance_adjustments_balance_idx
  on public.leave_balance_adjustments (balance_id, created_at desc);

-- =============================================================================
-- E. Leave requests
-- =============================================================================

do $$ begin
  create type public.leave_request_status as enum (
    'draft', 'submitted', 'approved', 'rejected', 'cancelled'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.leave_approval_stage as enum (
    'none', 'manager', 'hr', 'complete'
  );
exception when duplicate_object then null;
end $$;

create table if not exists public.leave_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  employee_id uuid not null references public.employees (id) on delete restrict,
  leave_type_id uuid not null references public.leave_types (id) on delete restrict,
  start_date date not null,
  end_date date not null,
  total_days numeric(8,2) not null check (total_days > 0),
  reason text,
  attachment_document_id uuid references public.documents (id) on delete set null,
  status public.leave_request_status not null default 'draft',
  approval_stage public.leave_approval_stage not null default 'none',
  manager_profile_id uuid references public.profiles (id) on delete set null,
  manager_decided_at timestamptz,
  manager_decision text check (manager_decision is null or manager_decision in ('approved', 'rejected')),
  manager_comment text,
  hr_profile_id uuid references public.profiles (id) on delete set null,
  hr_decided_at timestamptz,
  hr_decision text check (hr_decision is null or hr_decision in ('approved', 'rejected')),
  hr_comment text,
  submitted_at timestamptz,
  approved_at timestamptz,
  rejected_at timestamptz,
  cancelled_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  check (start_date <= end_date)
);

drop trigger if exists leave_requests_set_updated_at on public.leave_requests;
create trigger leave_requests_set_updated_at
  before update on public.leave_requests
  for each row execute function public.set_updated_at();

create index if not exists leave_requests_org_status_idx
  on public.leave_requests (organization_id, status, start_date);

create index if not exists leave_requests_employee_idx
  on public.leave_requests (employee_id, start_date desc);

create index if not exists leave_requests_type_idx
  on public.leave_requests (leave_type_id, status);

-- Prevent overlapping active requests for same employee (submitted or approved)
create extension if not exists btree_gist;

do $$ begin
  alter table public.leave_requests
    add constraint leave_requests_no_overlap
    exclude using gist (
      employee_id with =,
      daterange(start_date, end_date, '[]') with &&
    )
    where (status in ('submitted', 'approved'));
exception
  when duplicate_object then null;
end $$;

-- =============================================================================
-- F. Permissions
-- =============================================================================

insert into public.permissions (key, resource, action, description_ar, description_en) values
  ('leave.view_self', 'leave', 'view_self', 'عرض إجازاتي', 'View own leave'),
  ('leave.request', 'leave', 'request', 'طلب إجازة', 'Request leave'),
  ('leave.cancel_self', 'leave', 'cancel_self', 'إلغاء طلب إجازتي', 'Cancel own leave request'),
  ('leave.view_team', 'leave', 'view_team', 'عرض إجازات الفريق', 'View team leave'),
  ('leave.approve_manager', 'leave', 'approve_manager', 'اعتماد إجازات المرؤوسين', 'Approve direct reports leave'),
  ('leave.view_all', 'leave', 'view_all', 'عرض كل الإجازات', 'View all organization leave'),
  ('leave.manage', 'leave', 'manage', 'إدارة الإجازات', 'Manage leave'),
  ('leave.adjust_balance', 'leave', 'adjust_balance', 'تعديل أرصدة الإجازات', 'Adjust leave balances')
on conflict (key) do nothing;

-- Super admin: all via catalog sync pattern — grant every leave.* to super_admin
insert into public.role_permissions (role_id, permission_key)
select r.id, p.key
from public.roles r
cross join public.permissions p
where r.code = 'super_admin' and r.organization_id is null
  and p.key like 'leave.%'
on conflict do nothing;

insert into public.role_permissions (role_id, permission_key)
select r.id, p.key
from public.roles r
cross join public.permissions p
where r.code = 'general_manager' and r.organization_id is null
  and p.key like 'leave.%'
on conflict do nothing;

insert into public.role_permissions (role_id, permission_key)
select r.id, x.permission_key
from public.roles r
join (values
  ('hr_manager', 'leave.view_self'),
  ('hr_manager', 'leave.request'),
  ('hr_manager', 'leave.cancel_self'),
  ('hr_manager', 'leave.view_team'),
  ('hr_manager', 'leave.approve_manager'),
  ('hr_manager', 'leave.view_all'),
  ('hr_manager', 'leave.manage'),
  ('hr_manager', 'leave.adjust_balance'),
  ('hr_officer', 'leave.view_self'),
  ('hr_officer', 'leave.request'),
  ('hr_officer', 'leave.cancel_self'),
  ('hr_officer', 'leave.view_all'),
  ('hr_officer', 'leave.manage'),
  ('department_manager', 'leave.view_self'),
  ('department_manager', 'leave.request'),
  ('department_manager', 'leave.cancel_self'),
  ('department_manager', 'leave.view_team'),
  ('department_manager', 'leave.approve_manager'),
  ('operations_manager', 'leave.view_self'),
  ('operations_manager', 'leave.request'),
  ('operations_manager', 'leave.cancel_self'),
  ('operations_manager', 'leave.view_team'),
  ('operations_manager', 'leave.approve_manager'),
  ('project_manager', 'leave.view_self'),
  ('project_manager', 'leave.request'),
  ('project_manager', 'leave.cancel_self'),
  ('project_manager', 'leave.view_team'),
  ('project_manager', 'leave.approve_manager'),
  ('project_engineer', 'leave.view_self'),
  ('project_engineer', 'leave.request'),
  ('project_engineer', 'leave.cancel_self'),
  ('engineer', 'leave.view_self'),
  ('engineer', 'leave.request'),
  ('engineer', 'leave.cancel_self'),
  ('document_controller', 'leave.view_self'),
  ('document_controller', 'leave.request'),
  ('document_controller', 'leave.cancel_self'),
  ('finance_manager', 'leave.view_self'),
  ('finance_manager', 'leave.request'),
  ('finance_manager', 'leave.cancel_self'),
  ('finance_officer', 'leave.view_self'),
  ('finance_officer', 'leave.request'),
  ('finance_officer', 'leave.cancel_self'),
  ('procurement_manager', 'leave.view_self'),
  ('procurement_manager', 'leave.request'),
  ('procurement_manager', 'leave.cancel_self'),
  ('procurement_officer', 'leave.view_self'),
  ('procurement_officer', 'leave.request'),
  ('procurement_officer', 'leave.cancel_self')
) as x(role_code, permission_key) on r.code = x.role_code and r.organization_id is null
on conflict do nothing;

-- Seed default leave types for Master Touch org
insert into public.leave_types (
  organization_id, code, name_ar, name_en, is_paid, annual_entitlement_days,
  requires_attachment, minimum_notice_days, allow_carry_forward, maximum_carry_forward_days,
  allow_negative_balance, is_active
)
select
  '11111111-1111-1111-1111-111111111111',
  v.code, v.name_ar, v.name_en, v.is_paid, v.entitlement,
  v.attachment, v.notice, v.carry, v.max_carry, v.neg, true
from (values
  ('ANNUAL', 'إجازة سنوية', 'Annual Leave', true, 21::numeric, false, 7, true, 5::numeric, false),
  ('SICK', 'إجازة مرضية', 'Sick Leave', true, 30::numeric, true, 0, false, null::numeric, false),
  ('EMERGENCY', 'إجازة طارئة', 'Emergency Leave', true, 5::numeric, false, 0, false, null::numeric, false),
  ('UNPAID', 'إجازة بدون راتب', 'Unpaid Leave', false, 0::numeric, false, 3, false, null::numeric, true)
) as v(code, name_ar, name_en, is_paid, entitlement, attachment, notice, carry, max_carry, neg)
where exists (select 1 from public.organizations where id = '11111111-1111-1111-1111-111111111111')
on conflict (organization_id, code) do nothing;

-- =============================================================================
-- G. Helpers
-- =============================================================================

create or replace function public.is_leave_direct_manager_of(p_employee_id uuid)
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

grant execute on function public.is_leave_direct_manager_of(uuid) to authenticated;

create or replace function public.can_read_leave_request_row(p_request_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.leave_requests lr
    join public.employees e on e.id = lr.employee_id
    where lr.id = p_request_id
      and public.is_organization_member(lr.organization_id)
      and (
        public.is_platform_admin()
        or e.profile_id = auth.uid()
        or public.has_permission('leave.view_all', lr.organization_id, 'organization', null)
        or public.has_permission('leave.manage', lr.organization_id, 'organization', null)
        or (
          public.has_permission('leave.view_team', lr.organization_id, 'organization', null)
          and public.is_leave_direct_manager_of(lr.employee_id)
        )
        or (
          public.has_permission('leave.approve_manager', lr.organization_id, 'organization', null)
          and public.is_leave_direct_manager_of(lr.employee_id)
        )
      )
  );
$$;

grant execute on function public.can_read_leave_request_row(uuid) to authenticated;

create or replace function public.calculate_leave_days(
  p_organization_id uuid,
  p_start_date date,
  p_end_date date
)
returns numeric
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_basis text;
  v_days numeric := 0;
  v_d date;
begin
  if p_start_date is null or p_end_date is null or p_start_date > p_end_date then
    raise exception 'VALIDATION' using errcode = 'P0001';
  end if;

  select leave_day_basis into v_basis
  from public.organizations
  where id = p_organization_id;

  v_basis := coalesce(v_basis, 'calendar');
  v_d := p_start_date;
  while v_d <= p_end_date loop
    if v_basis = 'working' then
      -- Fri=5, Sat=6 in extract(dow) with Sunday=0 — Saudi weekend Fri/Sat
      if extract(dow from v_d) not in (5, 6) then
        v_days := v_days + 1;
      end if;
    else
      v_days := v_days + 1;
    end if;
    v_d := v_d + 1;
  end loop;

  if v_days <= 0 then
    raise exception 'VALIDATION' using errcode = 'P0001';
  end if;
  return v_days;
end;
$$;

grant execute on function public.calculate_leave_days(uuid, date, date) to authenticated;

create or replace function public.ensure_leave_balance(
  p_organization_id uuid,
  p_employee_id uuid,
  p_leave_type_id uuid,
  p_year integer
)
returns public.employee_leave_balances
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.employee_leave_balances;
  v_type public.leave_types;
begin
  select * into v_type from public.leave_types where id = p_leave_type_id;
  if v_type.id is null or v_type.organization_id <> p_organization_id then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;

  select * into v_row
  from public.employee_leave_balances
  where employee_id = p_employee_id
    and leave_type_id = p_leave_type_id
    and year = p_year
  for update;

  if v_row.id is null then
    insert into public.employee_leave_balances (
      organization_id, employee_id, leave_type_id, year,
      opening_balance, entitled_days, carried_forward_days,
      used_days, pending_days, adjustment_days
    ) values (
      p_organization_id, p_employee_id, p_leave_type_id, p_year,
      0, v_type.annual_entitlement_days, 0, 0, 0, 0
    )
    returning * into v_row;
  end if;

  return v_row;
end;
$$;

revoke all on function public.ensure_leave_balance(uuid, uuid, uuid, integer) from public, anon, authenticated;

-- =============================================================================
-- H. RPCs
-- =============================================================================

create or replace function public.submit_leave_request(
  p_leave_type_id uuid,
  p_start_date date,
  p_end_date date,
  p_reason text default null,
  p_attachment_document_id uuid default null,
  p_request_id uuid default null
)
returns public.leave_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_emp public.employees;
  v_type public.leave_types;
  v_days numeric;
  v_year integer;
  v_balance public.employee_leave_balances;
  v_mgr_profile uuid;
  v_stage public.leave_approval_stage;
  v_req public.leave_requests;
  v_notice integer;
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
    public.has_permission('leave.request', v_emp.organization_id, 'organization', null)
    or public.is_platform_admin()
  ) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  select * into v_type from public.leave_types where id = p_leave_type_id for share;
  if v_type.id is null or not v_type.is_active or v_type.organization_id <> v_emp.organization_id then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;

  if p_start_date > p_end_date then
    raise exception 'VALIDATION' using errcode = 'P0001';
  end if;

  if extract(year from p_start_date)::integer <> extract(year from p_end_date)::integer then
    raise exception 'VALIDATION' using errcode = 'P0001';
  end if;

  v_notice := coalesce(v_type.minimum_notice_days, 0);
  if p_start_date < (current_date + v_notice) then
    raise exception 'VALIDATION' using errcode = 'P0001';
  end if;

  v_days := public.calculate_leave_days(v_emp.organization_id, p_start_date, p_end_date);

  if v_type.maximum_consecutive_days is not null and v_days > v_type.maximum_consecutive_days then
    raise exception 'VALIDATION' using errcode = 'P0001';
  end if;

  if v_type.requires_attachment and p_attachment_document_id is null then
    raise exception 'VALIDATION' using errcode = 'P0001';
  end if;

  -- Overlap with active requests
  if exists (
    select 1 from public.leave_requests lr
    where lr.employee_id = v_emp.id
      and lr.status in ('submitted', 'approved')
      and daterange(lr.start_date, lr.end_date, '[]') && daterange(p_start_date, p_end_date, '[]')
      and (p_request_id is null or lr.id <> p_request_id)
  ) then
    raise exception 'CONFLICT' using errcode = 'P0001';
  end if;

  v_year := extract(year from p_start_date)::integer;
  v_balance := public.ensure_leave_balance(v_emp.organization_id, v_emp.id, p_leave_type_id, v_year);

  -- Lock balance row
  select * into v_balance
  from public.employee_leave_balances
  where id = v_balance.id
  for update;

  if not v_type.allow_negative_balance and (v_balance.available_days < v_days) then
    raise exception 'CONFLICT' using errcode = 'P0001';
  end if;

  -- Resolve manager
  select mgr.profile_id into v_mgr_profile
  from public.employees mgr
  where mgr.id = v_emp.direct_manager_employee_id
    and mgr.is_active = true;

  if v_mgr_profile is not null then
    v_stage := 'manager';
  else
    v_stage := 'hr';
  end if;

  if p_request_id is not null then
    select * into v_req from public.leave_requests where id = p_request_id for update;
    if v_req.id is null or v_req.employee_id <> v_emp.id or v_req.status <> 'draft' then
      raise exception 'FORBIDDEN' using errcode = 'P0001';
    end if;
    update public.leave_requests set
      leave_type_id = p_leave_type_id,
      start_date = p_start_date,
      end_date = p_end_date,
      total_days = v_days,
      reason = p_reason,
      attachment_document_id = p_attachment_document_id,
      status = 'submitted',
      approval_stage = v_stage,
      manager_profile_id = v_mgr_profile,
      submitted_at = timezone('utc', now()),
      updated_at = timezone('utc', now())
    where id = p_request_id
    returning * into v_req;
  else
    insert into public.leave_requests (
      organization_id, employee_id, leave_type_id, start_date, end_date, total_days,
      reason, attachment_document_id, status, approval_stage, manager_profile_id,
      submitted_at, created_by
    ) values (
      v_emp.organization_id, v_emp.id, p_leave_type_id, p_start_date, p_end_date, v_days,
      p_reason, p_attachment_document_id, 'submitted', v_stage, v_mgr_profile,
      timezone('utc', now()), auth.uid()
    )
    returning * into v_req;
  end if;

  update public.employee_leave_balances
  set pending_days = pending_days + v_days,
      updated_at = timezone('utc', now())
  where id = v_balance.id;

  perform public.log_audit(
    v_emp.organization_id,
    'leave_request.submitted',
    'leave_request',
    v_req.id,
    null,
    jsonb_build_object(
      'leave_type_id', p_leave_type_id,
      'start_date', p_start_date,
      'end_date', p_end_date,
      'total_days', v_days,
      'approval_stage', v_stage::text
    ),
    null, null, null
  );

  perform public.emit_domain_event(
    v_emp.organization_id,
    'leave_request.submitted',
    'leave_request',
    v_req.id,
    jsonb_build_object('employee_id', v_emp.id, 'total_days', v_days),
    null
  );

  return v_req;
end;
$$;

grant execute on function public.submit_leave_request(uuid, date, date, text, uuid, uuid) to authenticated;

create or replace function public.decide_leave_request(
  p_request_id uuid,
  p_decision text,
  p_comment text default null
)
returns public.leave_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req public.leave_requests;
  v_emp public.employees;
  v_type public.leave_types;
  v_balance public.employee_leave_balances;
  v_is_manager boolean;
  v_is_hr boolean;
begin
  if auth.uid() is null then
    raise exception 'UNAUTHORIZED' using errcode = 'P0001';
  end if;
  if p_decision not in ('approved', 'rejected') then
    raise exception 'VALIDATION' using errcode = 'P0001';
  end if;

  select * into v_req from public.leave_requests where id = p_request_id for update;
  if v_req.id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_req.status <> 'submitted' then
    raise exception 'CONFLICT' using errcode = 'P0001';
  end if;

  select * into v_emp from public.employees where id = v_req.employee_id;
  select * into v_type from public.leave_types where id = v_req.leave_type_id;

  v_is_manager := (
    v_req.approval_stage = 'manager'
    and public.is_leave_direct_manager_of(v_req.employee_id)
    and (
      public.has_permission('leave.approve_manager', v_req.organization_id, 'organization', null)
      or public.is_platform_admin()
    )
  );

  v_is_hr := (
    v_req.approval_stage = 'hr'
    and (
      public.has_permission('leave.manage', v_req.organization_id, 'organization', null)
      or public.is_platform_admin()
    )
  );

  if not (v_is_manager or v_is_hr) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  select * into v_balance
  from public.employee_leave_balances
  where employee_id = v_req.employee_id
    and leave_type_id = v_req.leave_type_id
    and year = extract(year from v_req.start_date)::integer
  for update;

  if v_is_manager then
    if p_decision = 'rejected' then
      update public.employee_leave_balances
      set pending_days = greatest(0, pending_days - v_req.total_days),
          updated_at = timezone('utc', now())
      where id = v_balance.id;

      update public.leave_requests set
        status = 'rejected',
        approval_stage = 'complete',
        manager_decision = 'rejected',
        manager_comment = p_comment,
        manager_decided_at = timezone('utc', now()),
        rejected_at = timezone('utc', now()),
        updated_at = timezone('utc', now())
      where id = v_req.id
      returning * into v_req;
    else
      update public.leave_requests set
        approval_stage = 'hr',
        manager_decision = 'approved',
        manager_comment = p_comment,
        manager_decided_at = timezone('utc', now()),
        updated_at = timezone('utc', now())
      where id = v_req.id
      returning * into v_req;
    end if;
  else
    -- HR stage
    if p_decision = 'rejected' then
      update public.employee_leave_balances
      set pending_days = greatest(0, pending_days - v_req.total_days),
          updated_at = timezone('utc', now())
      where id = v_balance.id;

      update public.leave_requests set
        status = 'rejected',
        approval_stage = 'complete',
        hr_profile_id = auth.uid(),
        hr_decision = 'rejected',
        hr_comment = p_comment,
        hr_decided_at = timezone('utc', now()),
        rejected_at = timezone('utc', now()),
        updated_at = timezone('utc', now())
      where id = v_req.id
      returning * into v_req;
    else
      update public.employee_leave_balances
      set pending_days = greatest(0, pending_days - v_req.total_days),
          used_days = used_days + v_req.total_days,
          updated_at = timezone('utc', now())
      where id = v_balance.id;

      update public.leave_requests set
        status = 'approved',
        approval_stage = 'complete',
        hr_profile_id = auth.uid(),
        hr_decision = 'approved',
        hr_comment = p_comment,
        hr_decided_at = timezone('utc', now()),
        approved_at = timezone('utc', now()),
        updated_at = timezone('utc', now())
      where id = v_req.id
      returning * into v_req;
    end if;
  end if;

  perform public.log_audit(
    v_req.organization_id,
    case
      when p_decision = 'rejected' then 'leave_request.rejected'
      when v_req.status = 'approved' then 'leave_request.approved'
      else 'leave_request.manager_approved'
    end,
    'leave_request',
    v_req.id,
    null,
    jsonb_build_object('decision', p_decision, 'stage', case when v_is_manager then 'manager' else 'hr' end),
    null, null, null
  );

  perform public.emit_domain_event(
    v_req.organization_id,
    case when p_decision = 'approved' and v_req.status = 'approved' then 'leave_request.approved'
         when p_decision = 'rejected' then 'leave_request.rejected'
         else 'leave_request.manager_approved' end,
    'leave_request',
    v_req.id,
    jsonb_build_object('employee_id', v_req.employee_id, 'status', v_req.status::text),
    null
  );

  return v_req;
end;
$$;

grant execute on function public.decide_leave_request(uuid, text, text) to authenticated;

create or replace function public.cancel_leave_request(p_request_id uuid)
returns public.leave_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req public.leave_requests;
  v_emp public.employees;
  v_balance public.employee_leave_balances;
  v_can_hr boolean;
begin
  if auth.uid() is null then
    raise exception 'UNAUTHORIZED' using errcode = 'P0001';
  end if;

  select * into v_req from public.leave_requests where id = p_request_id for update;
  if v_req.id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;

  select * into v_emp from public.employees where id = v_req.employee_id;
  v_can_hr := public.has_permission('leave.manage', v_req.organization_id, 'organization', null)
           or public.is_platform_admin();

  if not (
    (v_emp.profile_id = auth.uid() and public.has_permission('leave.cancel_self', v_req.organization_id, 'organization', null))
    or v_can_hr
  ) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  if v_req.status not in ('draft', 'submitted', 'approved') then
    raise exception 'CONFLICT' using errcode = 'P0001';
  end if;

  -- Self can cancel draft/submitted only; HR can cancel approved before start
  if v_emp.profile_id = auth.uid() and not v_can_hr then
    if v_req.status = 'approved' then
      raise exception 'FORBIDDEN' using errcode = 'P0001';
    end if;
  end if;

  if v_req.status = 'approved' and v_req.start_date <= current_date and not v_can_hr then
    raise exception 'CONFLICT' using errcode = 'P0001';
  end if;

  select * into v_balance
  from public.employee_leave_balances
  where employee_id = v_req.employee_id
    and leave_type_id = v_req.leave_type_id
    and year = extract(year from v_req.start_date)::integer
  for update;

  if v_req.status = 'submitted' and v_balance.id is not null then
    update public.employee_leave_balances
    set pending_days = greatest(0, pending_days - v_req.total_days),
        updated_at = timezone('utc', now())
    where id = v_balance.id;
  elsif v_req.status = 'approved' and v_balance.id is not null then
    update public.employee_leave_balances
    set used_days = greatest(0, used_days - v_req.total_days),
        updated_at = timezone('utc', now())
    where id = v_balance.id;
  end if;

  update public.leave_requests set
    status = 'cancelled',
    approval_stage = 'complete',
    cancelled_at = timezone('utc', now()),
    updated_at = timezone('utc', now())
  where id = v_req.id
  returning * into v_req;

  perform public.log_audit(
    v_req.organization_id,
    'leave_request.cancelled',
    'leave_request',
    v_req.id,
    null,
    jsonb_build_object('previous_consumed', true),
    null, null, null
  );

  perform public.emit_domain_event(
    v_req.organization_id,
    'leave_request.cancelled',
    'leave_request',
    v_req.id,
    jsonb_build_object('employee_id', v_req.employee_id),
    null
  );

  return v_req;
end;
$$;

grant execute on function public.cancel_leave_request(uuid) to authenticated;

create or replace function public.adjust_leave_balance(
  p_employee_id uuid,
  p_leave_type_id uuid,
  p_year integer,
  p_adjustment_days numeric,
  p_reason text
)
returns public.employee_leave_balances
language plpgsql
security definer
set search_path = public
as $$
declare
  v_emp public.employees;
  v_balance public.employee_leave_balances;
begin
  if auth.uid() is null then
    raise exception 'UNAUTHORIZED' using errcode = 'P0001';
  end if;
  if p_reason is null or length(trim(p_reason)) < 3 then
    raise exception 'VALIDATION' using errcode = 'P0001';
  end if;
  if p_adjustment_days = 0 then
    raise exception 'VALIDATION' using errcode = 'P0001';
  end if;

  select * into v_emp from public.employees where id = p_employee_id;
  if v_emp.id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;

  if not (
    public.has_permission('leave.adjust_balance', v_emp.organization_id, 'organization', null)
    or public.is_platform_admin()
  ) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  v_balance := public.ensure_leave_balance(v_emp.organization_id, p_employee_id, p_leave_type_id, p_year);

  select * into v_balance from public.employee_leave_balances where id = v_balance.id for update;

  update public.employee_leave_balances
  set adjustment_days = adjustment_days + p_adjustment_days,
      updated_at = timezone('utc', now())
  where id = v_balance.id
  returning * into v_balance;

  insert into public.leave_balance_adjustments (
    organization_id, balance_id, employee_id, leave_type_id, year,
    adjustment_days, reason, created_by
  ) values (
    v_emp.organization_id, v_balance.id, p_employee_id, p_leave_type_id, p_year,
    p_adjustment_days, trim(p_reason), auth.uid()
  );

  perform public.log_audit(
    v_emp.organization_id,
    'leave_balance.adjusted',
    'employee_leave_balance',
    v_balance.id,
    null,
    jsonb_build_object(
      'employee_id', p_employee_id,
      'leave_type_id', p_leave_type_id,
      'year', p_year,
      'adjustment_days', p_adjustment_days
      -- reason intentionally omitted from metadata if sensitive; keep short reason ok
    ),
    null, null, null
  );

  return v_balance;
end;
$$;

grant execute on function public.adjust_leave_balance(uuid, uuid, integer, numeric, text) to authenticated;

-- =============================================================================
-- I. RLS
-- =============================================================================

alter table public.leave_types enable row level security;
alter table public.employee_leave_balances enable row level security;
alter table public.leave_balance_adjustments enable row level security;
alter table public.leave_requests enable row level security;

drop policy if exists leave_types_select on public.leave_types;
create policy leave_types_select on public.leave_types
  for select to authenticated
  using (
    public.is_organization_member(organization_id)
    and (
      public.is_platform_admin()
      or public.has_permission('leave.view_self', organization_id, 'organization', null)
      or public.has_permission('leave.view_all', organization_id, 'organization', null)
      or public.has_permission('leave.manage', organization_id, 'organization', null)
    )
  );

drop policy if exists leave_types_write on public.leave_types;
create policy leave_types_write on public.leave_types
  for all to authenticated
  using (
    public.has_permission('leave.manage', organization_id, 'organization', null)
    or public.is_platform_admin()
  )
  with check (
    public.has_permission('leave.manage', organization_id, 'organization', null)
    or public.is_platform_admin()
  );

drop policy if exists leave_balances_select on public.employee_leave_balances;
create policy leave_balances_select on public.employee_leave_balances
  for select to authenticated
  using (
    public.is_organization_member(organization_id)
    and (
      public.is_platform_admin()
      or exists (
        select 1 from public.employees e
        where e.id = employee_id and e.profile_id = auth.uid()
      )
      or public.has_permission('leave.view_all', organization_id, 'organization', null)
      or public.has_permission('leave.manage', organization_id, 'organization', null)
      or public.has_permission('leave.adjust_balance', organization_id, 'organization', null)
      or (
        public.has_permission('leave.view_team', organization_id, 'organization', null)
        and public.is_leave_direct_manager_of(employee_id)
      )
    )
  );

drop policy if exists leave_balances_write on public.employee_leave_balances;
create policy leave_balances_write on public.employee_leave_balances
  for all to authenticated
  using (false)
  with check (false);

drop policy if exists leave_balance_adjustments_select on public.leave_balance_adjustments;
create policy leave_balance_adjustments_select on public.leave_balance_adjustments
  for select to authenticated
  using (
    public.has_permission('leave.view_all', organization_id, 'organization', null)
    or public.has_permission('leave.manage', organization_id, 'organization', null)
    or public.has_permission('leave.adjust_balance', organization_id, 'organization', null)
    or public.is_platform_admin()
  );

drop policy if exists leave_balance_adjustments_write on public.leave_balance_adjustments;
create policy leave_balance_adjustments_write on public.leave_balance_adjustments
  for all to authenticated
  using (false)
  with check (false);

drop policy if exists leave_requests_select on public.leave_requests;
create policy leave_requests_select on public.leave_requests
  for select to authenticated
  using (public.can_read_leave_request_row(id));

drop policy if exists leave_requests_insert on public.leave_requests;
create policy leave_requests_insert on public.leave_requests
  for insert to authenticated
  with check (
    exists (
      select 1 from public.employees e
      where e.id = employee_id
        and e.profile_id = auth.uid()
        and e.organization_id = organization_id
    )
    and (
      public.has_permission('leave.request', organization_id, 'organization', null)
      or public.is_platform_admin()
    )
  );

drop policy if exists leave_requests_update on public.leave_requests;
create policy leave_requests_update on public.leave_requests
  for update to authenticated
  using (false)
  with check (false);

drop policy if exists leave_requests_delete on public.leave_requests;
create policy leave_requests_delete on public.leave_requests
  for delete to authenticated
  using (false);
