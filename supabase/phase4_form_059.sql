-- Master Touch OS — 059
-- Phase 4.5: Payroll Management
-- Additive only. Does not modify migrations 001–058.
-- Equivalent to migrations/059_phase4_payroll_management.sql — run in Supabase SQL Editor after 058

-- =============================================================================
-- A. Enums
-- =============================================================================

do $$
begin
  if not exists (select 1 from pg_type where typname = 'payroll_period_status') then
    create type public.payroll_period_status as enum (
      'draft', 'calculated', 'under_review', 'approved', 'locked', 'paid', 'cancelled'
    );
  end if;
  if not exists (select 1 from pg_type where typname = 'payroll_earning_kind') then
    create type public.payroll_earning_kind as enum (
      'recurring', 'one_time'
    );
  end if;
  if not exists (select 1 from pg_type where typname = 'payroll_line_source') then
    create type public.payroll_line_source as enum (
      'calculated', 'manual', 'leave', 'attendance', 'system'
    );
  end if;
  if not exists (select 1 from pg_type where typname = 'payroll_payment_method') then
    create type public.payroll_payment_method as enum (
      'bank_transfer', 'cash', 'cheque', 'other'
    );
  end if;
end
$$;

-- =============================================================================
-- B. Tables
-- =============================================================================

create table if not exists public.payroll_settings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  currency text not null default 'SAR',
  standard_payable_days numeric(5, 2) not null default 30 check (standard_payable_days > 0),
  deduct_unpaid_leave boolean not null default true,
  deduct_absence boolean not null default false,
  deduct_late_minutes boolean not null default false,
  rounding_precision integer not null default 2 check (rounding_precision >= 0 and rounding_precision <= 6),
  default_payment_method public.payroll_payment_method not null default 'bank_transfer',
  calculation_basis text not null default 'calendar_proration'
    check (calculation_basis in ('calendar_proration')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (organization_id)
);

drop trigger if exists payroll_settings_set_updated_at on public.payroll_settings;
create trigger payroll_settings_set_updated_at
  before update on public.payroll_settings
  for each row execute function public.set_updated_at();

create table if not exists public.payroll_periods (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  year integer not null check (year >= 2000 and year <= 2100),
  month integer not null check (month between 1 and 12),
  period_start date not null,
  period_end date not null,
  status public.payroll_period_status not null default 'draft',
  employee_count integer not null default 0 check (employee_count >= 0),
  total_gross numeric(14, 2) not null default 0,
  total_deductions numeric(14, 2) not null default 0,
  total_net numeric(14, 2) not null default 0,
  engine_version integer not null default 1,
  created_by uuid references public.profiles (id) on delete set null,
  calculated_at timestamptz,
  calculated_by uuid references public.profiles (id) on delete set null,
  submitted_at timestamptz,
  submitted_by uuid references public.profiles (id) on delete set null,
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles (id) on delete set null,
  approved_at timestamptz,
  approved_by uuid references public.profiles (id) on delete set null,
  locked_at timestamptz,
  locked_by uuid references public.profiles (id) on delete set null,
  paid_at timestamptz,
  cancelled_at timestamptz,
  cancelled_by uuid references public.profiles (id) on delete set null,
  notes text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  check (period_end >= period_start)
);

drop trigger if exists payroll_periods_set_updated_at on public.payroll_periods;
create trigger payroll_periods_set_updated_at
  before update on public.payroll_periods
  for each row execute function public.set_updated_at();

create unique index if not exists payroll_periods_org_year_month_active_uidx
  on public.payroll_periods (organization_id, year, month)
  where (status <> 'cancelled');

create index if not exists payroll_periods_org_year_month_idx
  on public.payroll_periods (organization_id, year desc, month desc);

create index if not exists payroll_periods_org_status_idx
  on public.payroll_periods (organization_id, status);

create table if not exists public.payroll_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  payroll_period_id uuid not null references public.payroll_periods (id) on delete cascade,
  employee_id uuid not null references public.employees (id) on delete restrict,
  employee_number text,
  employee_name text,
  department_name text,
  contract_id uuid references public.employee_contracts (id) on delete set null,
  compensation_version_ids uuid[],
  primary_compensation_version_id uuid references public.employee_compensation_versions (id) on delete set null,
  base_salary numeric(14, 2) not null default 0,
  housing_allowance numeric(14, 2) not null default 0,
  transport_allowance numeric(14, 2) not null default 0,
  other_allowances numeric(14, 2) not null default 0,
  gross_recurring numeric(14, 2) not null default 0,
  bank_account_id uuid references public.employee_bank_accounts (id) on delete set null,
  masked_iban text,
  eligible_start date,
  eligible_end date,
  payable_days numeric(8, 2) not null default 0,
  present_days numeric(8, 2) not null default 0,
  absent_days numeric(8, 2) not null default 0,
  leave_days numeric(8, 2) not null default 0,
  unpaid_leave_days numeric(8, 2) not null default 0,
  late_minutes integer not null default 0,
  early_leave_minutes integer not null default 0,
  worked_minutes integer not null default 0,
  missing_checkout_count integer not null default 0,
  gross_pay numeric(14, 2) not null default 0,
  total_earnings numeric(14, 2) not null default 0,
  total_deductions numeric(14, 2) not null default 0,
  net_pay numeric(14, 2) not null default 0,
  payment_status text not null default 'unpaid'
    check (payment_status in ('unpaid', 'partial', 'paid')),
  calculation_details jsonb not null default '{}'::jsonb,
  engine_version integer not null default 1,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (payroll_period_id, employee_id)
);

drop trigger if exists payroll_entries_set_updated_at on public.payroll_entries;
create trigger payroll_entries_set_updated_at
  before update on public.payroll_entries
  for each row execute function public.set_updated_at();

create index if not exists payroll_entries_period_idx
  on public.payroll_entries (payroll_period_id);

create index if not exists payroll_entries_employee_period_idx
  on public.payroll_entries (employee_id, payroll_period_id);

create index if not exists payroll_entries_org_employee_idx
  on public.payroll_entries (organization_id, employee_id);

create table if not exists public.payroll_entry_segments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  payroll_entry_id uuid not null references public.payroll_entries (id) on delete cascade,
  compensation_version_id uuid not null references public.employee_compensation_versions (id) on delete restrict,
  segment_start date not null,
  segment_end date not null,
  payable_days numeric(8, 2) not null default 0,
  basic_salary numeric(14, 2) not null default 0,
  housing_allowance numeric(14, 2) not null default 0,
  transport_allowance numeric(14, 2) not null default 0,
  other_allowances numeric(14, 2) not null default 0,
  monthly_gross numeric(14, 2) not null default 0,
  segment_gross numeric(14, 2) not null default 0,
  daily_rate numeric(14, 2) not null default 0,
  created_at timestamptz not null default timezone('utc', now()),
  check (segment_end >= segment_start)
);

create index if not exists payroll_entry_segments_entry_idx
  on public.payroll_entry_segments (payroll_entry_id);

create table if not exists public.payroll_earnings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  payroll_entry_id uuid not null references public.payroll_entries (id) on delete cascade,
  payroll_period_id uuid not null references public.payroll_periods (id) on delete cascade,
  code text not null,
  description_ar text,
  description_en text,
  kind public.payroll_earning_kind not null default 'recurring',
  source public.payroll_line_source not null default 'calculated',
  amount numeric(14, 2) not null check (amount >= 0),
  is_manual boolean not null default false,
  created_by uuid references public.profiles (id) on delete set null,
  reason text,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists payroll_earnings_entry_idx
  on public.payroll_earnings (payroll_entry_id);

create index if not exists payroll_earnings_period_idx
  on public.payroll_earnings (payroll_period_id);

create table if not exists public.payroll_deductions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  payroll_entry_id uuid not null references public.payroll_entries (id) on delete cascade,
  payroll_period_id uuid not null references public.payroll_periods (id) on delete cascade,
  code text not null,
  description_ar text,
  description_en text,
  source public.payroll_line_source not null default 'calculated',
  amount numeric(14, 2) not null check (amount >= 0),
  is_manual boolean not null default false,
  created_by uuid references public.profiles (id) on delete set null,
  reason text,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists payroll_deductions_entry_idx
  on public.payroll_deductions (payroll_entry_id);

create index if not exists payroll_deductions_period_idx
  on public.payroll_deductions (payroll_period_id);

create table if not exists public.payroll_payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  payroll_period_id uuid not null references public.payroll_periods (id) on delete cascade,
  payroll_entry_id uuid not null references public.payroll_entries (id) on delete cascade,
  payment_date date not null,
  payment_method public.payroll_payment_method not null default 'bank_transfer',
  payment_reference text,
  amount numeric(14, 2) not null check (amount >= 0),
  recorded_by uuid references public.profiles (id) on delete set null,
  notes text,
  created_at timestamptz not null default timezone('utc', now()),
  unique (payroll_entry_id)
);

create index if not exists payroll_payments_period_idx
  on public.payroll_payments (payroll_period_id);

create index if not exists payroll_payments_entry_idx
  on public.payroll_payments (payroll_entry_id);

-- =============================================================================
-- C. Permissions
-- =============================================================================

insert into public.permissions (key, resource, action, description_ar, description_en) values
  ('payroll.view_self', 'payroll', 'view_self', 'عرض قسيمة راتبي', 'View own payslip'),
  ('payroll.view_all', 'payroll', 'view_all', 'عرض كل مسيرات الرواتب', 'View all payroll'),
  ('payroll.prepare', 'payroll', 'prepare', 'إعداد فترات الرواتب', 'Prepare payroll periods'),
  ('payroll.calculate', 'payroll', 'calculate', 'احتساب مسير الرواتب', 'Calculate payroll'),
  ('payroll.review', 'payroll', 'review', 'مراجعة مسير الرواتب', 'Review payroll'),
  ('payroll.approve', 'payroll', 'approve', 'اعتماد مسير الرواتب', 'Approve payroll'),
  ('payroll.lock', 'payroll', 'lock', 'قفل مسير الرواتب', 'Lock payroll'),
  ('payroll.adjust', 'payroll', 'adjust', 'تعديل يدوي على المسير', 'Adjust payroll lines'),
  ('payroll.record_payment', 'payroll', 'record_payment', 'تسجيل صرف الرواتب', 'Record payroll payment'),
  ('payroll.manage_settings', 'payroll', 'manage_settings', 'إدارة إعدادات الرواتب', 'Manage payroll settings')
on conflict (key) do nothing;

insert into public.role_permissions (role_id, permission_key)
select r.id, p.key
from public.roles r
cross join public.permissions p
where r.code = 'super_admin' and r.organization_id is null
  and p.key like 'payroll.%'
on conflict do nothing;

insert into public.role_permissions (role_id, permission_key)
select r.id, p.key
from public.roles r
cross join public.permissions p
where r.code = 'general_manager' and r.organization_id is null
  and p.key like 'payroll.%'
on conflict do nothing;

-- view_self for all internal roles that have leave.view_self
insert into public.role_permissions (role_id, permission_key)
select r.id, 'payroll.view_self'
from public.roles r
where r.organization_id is null
  and r.code in (
    'hr_manager', 'hr_officer', 'finance_manager', 'finance_officer',
    'department_manager', 'operations_manager', 'project_manager', 'project_engineer',
    'engineer', 'document_controller', 'procurement_manager', 'procurement_officer'
  )
on conflict do nothing;

insert into public.role_permissions (role_id, permission_key)
select r.id, x.permission_key
from public.roles r
join (values
  ('hr_manager', 'payroll.view_all'),
  ('hr_manager', 'payroll.prepare'),
  ('hr_manager', 'payroll.calculate'),
  ('hr_manager', 'payroll.adjust'),
  ('hr_manager', 'payroll.lock'),
  ('hr_manager', 'payroll.manage_settings'),
  ('hr_officer', 'payroll.view_all'),
  ('hr_officer', 'payroll.prepare'),
  ('hr_officer', 'payroll.calculate'),
  ('hr_officer', 'payroll.adjust'),
  ('finance_manager', 'payroll.view_all'),
  ('finance_manager', 'payroll.review'),
  ('finance_manager', 'payroll.approve'),
  ('finance_manager', 'payroll.lock'),
  ('finance_manager', 'payroll.adjust'),
  ('finance_manager', 'payroll.record_payment'),
  ('finance_manager', 'payroll.manage_settings'),
  ('finance_officer', 'payroll.view_all'),
  ('finance_officer', 'payroll.review'),
  ('finance_officer', 'payroll.record_payment')
) as x(role_code, permission_key) on r.code = x.role_code and r.organization_id is null
on conflict do nothing;

-- =============================================================================
-- D. Immutability triggers
-- =============================================================================

create or replace function public.prevent_payroll_mutation_when_locked()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_period_id uuid;
  v_status public.payroll_period_status;
begin
  if TG_TABLE_NAME = 'payroll_entries' then
    v_period_id := coalesce(NEW.payroll_period_id, OLD.payroll_period_id);
  elsif TG_TABLE_NAME = 'payroll_entry_segments' then
    select pe.payroll_period_id into v_period_id
    from public.payroll_entries pe
    where pe.id = coalesce(NEW.payroll_entry_id, OLD.payroll_entry_id);
  else
    v_period_id := coalesce(NEW.payroll_period_id, OLD.payroll_period_id);
  end if;

  if v_period_id is null then
    return coalesce(NEW, OLD);
  end if;

  select status into v_status
  from public.payroll_periods
  where id = v_period_id;

  if v_status is null or v_status not in ('locked', 'paid') then
    return coalesce(NEW, OLD);
  end if;

  -- Allow payment_status updates on locked entries (record_payroll_payment)
  if TG_TABLE_NAME = 'payroll_entries' and TG_OP = 'UPDATE' then
    if (
      NEW.organization_id is not distinct from OLD.organization_id
      and NEW.payroll_period_id is not distinct from OLD.payroll_period_id
      and NEW.employee_id is not distinct from OLD.employee_id
      and NEW.employee_number is not distinct from OLD.employee_number
      and NEW.employee_name is not distinct from OLD.employee_name
      and NEW.department_name is not distinct from OLD.department_name
      and NEW.contract_id is not distinct from OLD.contract_id
      and NEW.compensation_version_ids is not distinct from OLD.compensation_version_ids
      and NEW.primary_compensation_version_id is not distinct from OLD.primary_compensation_version_id
      and NEW.base_salary is not distinct from OLD.base_salary
      and NEW.housing_allowance is not distinct from OLD.housing_allowance
      and NEW.transport_allowance is not distinct from OLD.transport_allowance
      and NEW.other_allowances is not distinct from OLD.other_allowances
      and NEW.gross_recurring is not distinct from OLD.gross_recurring
      and NEW.bank_account_id is not distinct from OLD.bank_account_id
      and NEW.masked_iban is not distinct from OLD.masked_iban
      and NEW.eligible_start is not distinct from OLD.eligible_start
      and NEW.eligible_end is not distinct from OLD.eligible_end
      and NEW.payable_days is not distinct from OLD.payable_days
      and NEW.present_days is not distinct from OLD.present_days
      and NEW.absent_days is not distinct from OLD.absent_days
      and NEW.leave_days is not distinct from OLD.leave_days
      and NEW.unpaid_leave_days is not distinct from OLD.unpaid_leave_days
      and NEW.late_minutes is not distinct from OLD.late_minutes
      and NEW.early_leave_minutes is not distinct from OLD.early_leave_minutes
      and NEW.worked_minutes is not distinct from OLD.worked_minutes
      and NEW.missing_checkout_count is not distinct from OLD.missing_checkout_count
      and NEW.gross_pay is not distinct from OLD.gross_pay
      and NEW.total_earnings is not distinct from OLD.total_earnings
      and NEW.total_deductions is not distinct from OLD.total_deductions
      and NEW.net_pay is not distinct from OLD.net_pay
      and NEW.calculation_details is not distinct from OLD.calculation_details
      and NEW.engine_version is not distinct from OLD.engine_version
    ) then
      return NEW;
    end if;
  end if;

  raise exception 'IMMUTABLE_PAYROLL' using errcode = 'P0001';
end;
$$;

drop trigger if exists trg_payroll_entries_immutable on public.payroll_entries;
create trigger trg_payroll_entries_immutable
  before update or delete on public.payroll_entries
  for each row execute function public.prevent_payroll_mutation_when_locked();

drop trigger if exists trg_payroll_entry_segments_immutable on public.payroll_entry_segments;
create trigger trg_payroll_entry_segments_immutable
  before update or delete on public.payroll_entry_segments
  for each row execute function public.prevent_payroll_mutation_when_locked();

drop trigger if exists trg_payroll_earnings_immutable on public.payroll_earnings;
create trigger trg_payroll_earnings_immutable
  before update or delete on public.payroll_earnings
  for each row execute function public.prevent_payroll_mutation_when_locked();

drop trigger if exists trg_payroll_deductions_immutable on public.payroll_deductions;
create trigger trg_payroll_deductions_immutable
  before update or delete on public.payroll_deductions
  for each row execute function public.prevent_payroll_mutation_when_locked();

create or replace function public.prevent_payroll_period_unlock()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if OLD.status in ('locked', 'paid') then
    if OLD.status = 'locked' and NEW.status = 'paid' then
      return NEW;
    end if;
    if NEW.status is distinct from OLD.status then
      raise exception 'IMMUTABLE_PAYROLL' using errcode = 'P0001';
    end if;
    if (
      NEW.total_gross is distinct from OLD.total_gross
      or NEW.total_deductions is distinct from OLD.total_deductions
      or NEW.total_net is distinct from OLD.total_net
      or NEW.employee_count is distinct from OLD.employee_count
      or NEW.period_start is distinct from OLD.period_start
      or NEW.period_end is distinct from OLD.period_end
      or NEW.year is distinct from OLD.year
      or NEW.month is distinct from OLD.month
      or NEW.engine_version is distinct from OLD.engine_version
    ) then
      raise exception 'IMMUTABLE_PAYROLL' using errcode = 'P0001';
    end if;
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_payroll_periods_immutable on public.payroll_periods;
create trigger trg_payroll_periods_immutable
  before update on public.payroll_periods
  for each row execute function public.prevent_payroll_period_unlock();

-- =============================================================================
-- E. Helpers
-- =============================================================================

create or replace function public.ensure_payroll_settings(p_organization_id uuid)
returns public.payroll_settings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.payroll_settings;
begin
  if p_organization_id is null then
    raise exception 'VALIDATION' using errcode = 'P0001';
  end if;

  select * into v_row
  from public.payroll_settings
  where organization_id = p_organization_id
  for update;

  if v_row.id is null then
    insert into public.payroll_settings (organization_id)
    values (p_organization_id)
    on conflict (organization_id) do update
      set updated_at = public.payroll_settings.updated_at
    returning * into v_row;

    if v_row.id is null then
      select * into v_row
      from public.payroll_settings
      where organization_id = p_organization_id;
    end if;
  end if;

  return v_row;
end;
$$;

revoke all on function public.ensure_payroll_settings(uuid) from public, anon, authenticated;

create or replace function public.mask_payroll_iban(p_iban text)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when p_iban is null or length(p_iban) = 0 then null
    when length(p_iban) >= 8 then
      substr(p_iban, 1, 4) || ' **** **** **** ' || substr(p_iban, length(p_iban) - 3, 4)
    else '****'
  end;
$$;

revoke all on function public.mask_payroll_iban(text) from public, anon;

create or replace function public.recompute_payroll_entry_totals(p_entry_id uuid)
returns public.payroll_entries
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entry public.payroll_entries;
  v_earnings numeric(14, 2);
  v_deductions numeric(14, 2);
begin
  select * into v_entry from public.payroll_entries where id = p_entry_id for update;
  if v_entry.id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;

  select coalesce(sum(amount), 0) into v_earnings
  from public.payroll_earnings
  where payroll_entry_id = p_entry_id;

  select coalesce(sum(amount), 0) into v_deductions
  from public.payroll_deductions
  where payroll_entry_id = p_entry_id;

  update public.payroll_entries set
    total_earnings = v_earnings,
    total_deductions = v_deductions,
    gross_pay = greatest(v_entry.gross_recurring, 0),
    net_pay = v_earnings - v_deductions,
    updated_at = timezone('utc', now())
  where id = p_entry_id
  returning * into v_entry;

  return v_entry;
end;
$$;

revoke all on function public.recompute_payroll_entry_totals(uuid) from public, anon, authenticated;

create or replace function public.recompute_payroll_period_totals(p_period_id uuid)
returns public.payroll_periods
language plpgsql
security definer
set search_path = public
as $$
declare
  v_period public.payroll_periods;
begin
  select * into v_period from public.payroll_periods where id = p_period_id for update;
  if v_period.id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;

  update public.payroll_periods pp set
    employee_count = coalesce((
      select count(*)::integer from public.payroll_entries pe where pe.payroll_period_id = pp.id
    ), 0),
    total_gross = coalesce((
      select sum(pe.total_earnings) from public.payroll_entries pe where pe.payroll_period_id = pp.id
    ), 0),
    total_deductions = coalesce((
      select sum(pe.total_deductions) from public.payroll_entries pe where pe.payroll_period_id = pp.id
    ), 0),
    total_net = coalesce((
      select sum(pe.net_pay) from public.payroll_entries pe where pe.payroll_period_id = pp.id
    ), 0),
    updated_at = timezone('utc', now())
  where pp.id = p_period_id
  returning * into v_period;

  return v_period;
end;
$$;

revoke all on function public.recompute_payroll_period_totals(uuid) from public, anon, authenticated;

-- =============================================================================
-- F. RPCs
-- =============================================================================

create or replace function public.create_payroll_period(
  p_organization_id uuid,
  p_year integer,
  p_month integer
)
returns public.payroll_periods
language plpgsql
security definer
set search_path = public
as $$
declare
  v_period public.payroll_periods;
  v_start date;
  v_end date;
begin
  if auth.uid() is null then
    raise exception 'UNAUTHORIZED' using errcode = 'P0001';
  end if;

  if p_organization_id is null or p_year is null or p_month is null
     or p_month < 1 or p_month > 12 then
    raise exception 'VALIDATION' using errcode = 'P0001';
  end if;

  if not (
    public.has_permission('payroll.prepare', p_organization_id, 'organization', null)
    or public.is_platform_admin()
  ) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  perform public.ensure_payroll_settings(p_organization_id);

  v_start := make_date(p_year, p_month, 1);
  v_end := (v_start + interval '1 month' - interval '1 day')::date;

  begin
    insert into public.payroll_periods (
      organization_id, year, month, period_start, period_end,
      status, created_by, engine_version
    ) values (
      p_organization_id, p_year, p_month, v_start, v_end,
      'draft', auth.uid(), 1
    )
    returning * into v_period;
  exception
    when unique_violation then
      raise exception 'CONFLICT' using errcode = 'P0001';
  end;

  perform public.log_audit(
    p_organization_id,
    'payroll.period_created',
    'payroll_period',
    v_period.id,
    null,
    jsonb_build_object(
      'year', p_year,
      'month', p_month,
      'period_start', v_start,
      'period_end', v_end
    ),
    null, null, null
  );

  perform public.emit_domain_event(
    p_organization_id,
    'payroll.period_created',
    'payroll_period',
    v_period.id,
    jsonb_build_object(
      'year', p_year,
      'month', p_month,
      'status', v_period.status::text
    ),
    null
  );

  return v_period;
end;
$$;

grant execute on function public.create_payroll_period(uuid, integer, integer) to authenticated;

/*
  calculate_payroll_period — engine v1 proration formula
  -------------------------------------------------------
  calculation_basis = calendar_proration

  For each compensation segment overlapping the employee eligible window:
    payable_days   = (segment_end - segment_start + 1)   -- inclusive calendar days
    monthly_gross  = basic_salary + housing + transport + other
    daily_rate     = round(monthly_gross / standard_payable_days, rounding_precision)
    segment_gross  = round(monthly_gross * payable_days / standard_payable_days, rounding_precision)
    component_x    = round(component_monthly * payable_days / standard_payable_days, rounding_precision)

  Entry recurring totals = sum of segment component amounts.
  Unpaid leave deduction (if enabled):
    daily_avg = gross_recurring / payable_days   (equals monthly/standard when fully covered)
    amount    = round(daily_avg * unpaid_leave_days, rounding_precision)
  Absence deduction (if enabled):
    billable  = max(0, absent_days - unpaid_leave_days)  -- avoid double-count with unpaid leave
    amount    = round(daily_avg * billable, rounding_precision)
  Late minutes deduction (if enabled):
    amount    = round(daily_avg * late_minutes / (8 * 60), rounding_precision)
*/
create or replace function public.calculate_payroll_period(p_period_id uuid)
returns public.payroll_periods
language plpgsql
security definer
set search_path = public
as $$
declare
  v_period public.payroll_periods;
  v_settings public.payroll_settings;
  v_emp record;
  v_entry public.payroll_entries;
  v_contract public.employee_contracts;
  v_bank public.employee_bank_accounts;
  v_comp record;
  v_eligible_start date;
  v_eligible_end date;
  v_join date;
  v_term date;
  v_seg_start date;
  v_seg_end date;
  v_payable numeric(8, 2);
  v_monthly numeric(14, 2);
  v_daily numeric(14, 2);
  v_seg_gross numeric(14, 2);
  v_basic_amt numeric(14, 2);
  v_housing_amt numeric(14, 2);
  v_transport_amt numeric(14, 2);
  v_other_amt numeric(14, 2);
  v_sum_basic numeric(14, 2);
  v_sum_housing numeric(14, 2);
  v_sum_transport numeric(14, 2);
  v_sum_other numeric(14, 2);
  v_sum_payable numeric(8, 2);
  v_gross_recurring numeric(14, 2);
  v_version_ids uuid[];
  v_primary_version uuid;
  v_dept_name text;
  v_emp_name text;
  v_present numeric(8, 2);
  v_absent numeric(8, 2);
  v_leave_att numeric(8, 2);
  v_late integer;
  v_early integer;
  v_worked integer;
  v_missing integer;
  v_unpaid_leave numeric(8, 2);
  v_paid_leave numeric(8, 2);
  v_absence_billable numeric(8, 2);
  v_deduct_amt numeric(14, 2);
  v_daily_avg numeric(14, 2);
  v_prec integer;
  v_std numeric(5, 2);
  v_has_comp boolean;
  v_details jsonb;
begin
  if auth.uid() is null then
    raise exception 'UNAUTHORIZED' using errcode = 'P0001';
  end if;

  if p_period_id is null then
    raise exception 'VALIDATION' using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_period_id::text));

  select * into v_period
  from public.payroll_periods
  where id = p_period_id
  for update;

  if v_period.id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;

  if not (
    public.has_permission('payroll.calculate', v_period.organization_id, 'organization', null)
    or public.is_platform_admin()
  ) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  if v_period.status not in ('draft', 'calculated') then
    raise exception 'INVALID_STATUS' using errcode = 'P0001';
  end if;

  v_settings := public.ensure_payroll_settings(v_period.organization_id);
  v_prec := coalesce(v_settings.rounding_precision, 2);
  v_std := coalesce(v_settings.standard_payable_days, 30);

  -- Clear calculated lines and segments; keep manual lines
  delete from public.payroll_earnings
  where payroll_period_id = p_period_id and is_manual = false;

  delete from public.payroll_deductions
  where payroll_period_id = p_period_id and is_manual = false;

  delete from public.payroll_entry_segments
  where payroll_entry_id in (
    select id from public.payroll_entries where payroll_period_id = p_period_id
  );

  delete from public.payroll_entries pe
  where pe.payroll_period_id = p_period_id
    and not exists (
      select 1 from public.payroll_earnings e where e.payroll_entry_id = pe.id
    )
    and not exists (
      select 1 from public.payroll_deductions d where d.payroll_entry_id = pe.id
    );

  for v_emp in
    select e.*,
      p.full_name_ar,
      p.full_name_en
    from public.employees e
    join public.profiles p on p.id = e.profile_id
    where e.organization_id = v_period.organization_id
  loop
    v_join := coalesce(v_emp.joining_date, v_emp.contract_start, v_emp.created_at::date);
    v_term := coalesce(v_emp.terminated_at::date, v_emp.contract_end, '9999-12-31'::date);

    if v_join is null then
      continue;
    end if;

    v_eligible_start := greatest(v_join, v_period.period_start);
    v_eligible_end := least(v_term, v_period.period_end);

    if v_eligible_start > v_eligible_end then
      continue;
    end if;

    -- Include active/probation/on_leave; include terminated/resigned only if they worked in period
    if v_emp.employment_status not in ('active', 'probation', 'on_leave') then
      if v_emp.employment_status not in ('terminated', 'resigned') then
        continue;
      end if;
      if coalesce(v_emp.terminated_at::date, v_emp.contract_end, v_term) < v_period.period_start then
        continue;
      end if;
    end if;

    select exists (
      select 1
      from public.employee_compensation_versions cv
      where cv.employee_id = v_emp.id
        and cv.organization_id = v_period.organization_id
        and cv.status in ('active', 'superseded')
        and cv.effective_from <= v_eligible_end
        and (cv.effective_to is null or cv.effective_to >= v_eligible_start)
    ) into v_has_comp;

    if not coalesce(v_has_comp, false) then
      continue;
    end if;

    v_emp_name := coalesce(
      nullif(trim(v_emp.full_name_ar), ''),
      nullif(trim(v_emp.full_name_en), ''),
      v_emp.employee_number,
      v_emp.id::text
    );

    select coalesce(d.name_ar, d.name_en) into v_dept_name
    from public.employee_departments ed
    join public.departments d on d.id = ed.department_id
    where ed.employee_id = v_emp.id
      and ed.is_primary = true
    order by ed.created_at
    limit 1;

    select * into v_contract
    from public.employee_contracts
    where employee_id = v_emp.id
      and is_current = true
    order by created_at desc
    limit 1;

    select * into v_bank
    from public.employee_bank_accounts
    where employee_id = v_emp.id
      and is_active = true
    order by is_primary desc, created_at desc
    limit 1;

    select * into v_entry
    from public.payroll_entries
    where payroll_period_id = p_period_id
      and employee_id = v_emp.id
    for update;

    if v_entry.id is null then
      insert into public.payroll_entries (
        organization_id, payroll_period_id, employee_id,
        employee_number, employee_name, department_name,
        contract_id, bank_account_id, masked_iban,
        eligible_start, eligible_end, engine_version, payment_status
      ) values (
        v_period.organization_id, p_period_id, v_emp.id,
        v_emp.employee_number, v_emp_name, v_dept_name,
        v_contract.id, v_bank.id, public.mask_payroll_iban(v_bank.iban),
        v_eligible_start, v_eligible_end, 1, 'unpaid'
      )
      returning * into v_entry;
    else
      update public.payroll_entries set
        employee_number = v_emp.employee_number,
        employee_name = v_emp_name,
        department_name = v_dept_name,
        contract_id = v_contract.id,
        bank_account_id = v_bank.id,
        masked_iban = public.mask_payroll_iban(v_bank.iban),
        eligible_start = v_eligible_start,
        eligible_end = v_eligible_end,
        engine_version = 1,
        updated_at = timezone('utc', now())
      where id = v_entry.id
      returning * into v_entry;
    end if;

    v_sum_basic := 0;
    v_sum_housing := 0;
    v_sum_transport := 0;
    v_sum_other := 0;
    v_sum_payable := 0;
    v_version_ids := array[]::uuid[];
    v_primary_version := null;

    for v_comp in
      select *
      from public.employee_compensation_versions cv
      where cv.employee_id = v_emp.id
        and cv.organization_id = v_period.organization_id
        and cv.status in ('active', 'superseded')
        and cv.effective_from <= v_eligible_end
        and (cv.effective_to is null or cv.effective_to >= v_eligible_start)
      order by cv.effective_from
    loop
      v_seg_start := greatest(v_comp.effective_from, v_eligible_start);
      v_seg_end := least(coalesce(v_comp.effective_to, v_eligible_end), v_eligible_end);
      if v_seg_start > v_seg_end then
        continue;
      end if;

      v_payable := (v_seg_end - v_seg_start + 1)::numeric;
      v_monthly := coalesce(v_comp.basic_salary, 0)
        + coalesce(v_comp.housing_allowance, 0)
        + coalesce(v_comp.transport_allowance, 0)
        + coalesce(v_comp.other_allowances, 0);
      v_daily := round(v_monthly / v_std, v_prec);
      v_seg_gross := round(v_monthly * v_payable / v_std, v_prec);
      v_basic_amt := round(coalesce(v_comp.basic_salary, 0) * v_payable / v_std, v_prec);
      v_housing_amt := round(coalesce(v_comp.housing_allowance, 0) * v_payable / v_std, v_prec);
      v_transport_amt := round(coalesce(v_comp.transport_allowance, 0) * v_payable / v_std, v_prec);
      v_other_amt := round(coalesce(v_comp.other_allowances, 0) * v_payable / v_std, v_prec);

      insert into public.payroll_entry_segments (
        organization_id, payroll_entry_id, compensation_version_id,
        segment_start, segment_end, payable_days,
        basic_salary, housing_allowance, transport_allowance, other_allowances,
        monthly_gross, segment_gross, daily_rate
      ) values (
        v_period.organization_id, v_entry.id, v_comp.id,
        v_seg_start, v_seg_end, v_payable,
        coalesce(v_comp.basic_salary, 0), coalesce(v_comp.housing_allowance, 0),
        coalesce(v_comp.transport_allowance, 0), coalesce(v_comp.other_allowances, 0),
        v_monthly, v_seg_gross, v_daily
      );

      v_sum_basic := v_sum_basic + v_basic_amt;
      v_sum_housing := v_sum_housing + v_housing_amt;
      v_sum_transport := v_sum_transport + v_transport_amt;
      v_sum_other := v_sum_other + v_other_amt;
      v_sum_payable := v_sum_payable + v_payable;
      v_version_ids := array_append(v_version_ids, v_comp.id);
      v_primary_version := v_comp.id;
    end loop;

    if coalesce(array_length(v_version_ids, 1), 0) = 0 then
      -- No usable segments (should be rare); remove empty non-manual entry
      if not exists (select 1 from public.payroll_earnings where payroll_entry_id = v_entry.id)
         and not exists (select 1 from public.payroll_deductions where payroll_entry_id = v_entry.id) then
        delete from public.payroll_entries where id = v_entry.id;
      end if;
      continue;
    end if;

    v_gross_recurring := v_sum_basic + v_sum_housing + v_sum_transport + v_sum_other;

    -- Attendance aggregates within period
    select
      coalesce(count(*) filter (where ar.attendance_status in ('present', 'late', 'partial')), 0),
      coalesce(count(*) filter (where ar.attendance_status = 'absent'), 0),
      coalesce(count(*) filter (where ar.attendance_status = 'on_leave'), 0),
      coalesce(sum(ar.late_minutes), 0),
      coalesce(sum(ar.early_leave_minutes), 0),
      coalesce(sum(ar.worked_minutes), 0),
      coalesce(count(*) filter (where ar.attendance_status = 'missing_checkout'), 0)
    into v_present, v_absent, v_leave_att, v_late, v_early, v_worked, v_missing
    from public.attendance_records ar
    where ar.employee_id = v_emp.id
      and ar.attendance_date between v_period.period_start and v_period.period_end;

    -- Approved leave overlap days (inclusive) within eligible window
    select
      coalesce(sum(
        greatest(0, (
          least(lr.end_date, v_eligible_end) - greatest(lr.start_date, v_eligible_start) + 1
        ))
      ) filter (where not coalesce(lt.is_paid, true)), 0),
      coalesce(sum(
        greatest(0, (
          least(lr.end_date, v_eligible_end) - greatest(lr.start_date, v_eligible_start) + 1
        ))
      ) filter (where coalesce(lt.is_paid, true)), 0)
    into v_unpaid_leave, v_paid_leave
    from public.leave_requests lr
    join public.leave_types lt on lt.id = lr.leave_type_id
    where lr.employee_id = v_emp.id
      and lr.status = 'approved'
      and lr.start_date <= v_eligible_end
      and lr.end_date >= v_eligible_start;

    v_unpaid_leave := coalesce(v_unpaid_leave, 0);
    v_paid_leave := coalesce(v_paid_leave, 0);
    v_absence_billable := greatest(0, coalesce(v_absent, 0) - v_unpaid_leave);

    if v_sum_payable > 0 then
      v_daily_avg := round(v_gross_recurring / v_sum_payable, v_prec);
    else
      v_daily_avg := 0;
    end if;

    -- Recurring earning lines per component
    if v_sum_basic > 0 then
      insert into public.payroll_earnings (
        organization_id, payroll_entry_id, payroll_period_id,
        code, description_ar, description_en, kind, source, amount, is_manual
      ) values (
        v_period.organization_id, v_entry.id, p_period_id,
        'BASE_SALARY', 'الراتب الأساسي', 'Base Salary',
        'recurring', 'calculated', v_sum_basic, false
      );
    end if;

    if v_sum_housing > 0 then
      insert into public.payroll_earnings (
        organization_id, payroll_entry_id, payroll_period_id,
        code, description_ar, description_en, kind, source, amount, is_manual
      ) values (
        v_period.organization_id, v_entry.id, p_period_id,
        'HOUSING', 'بدل سكن', 'Housing Allowance',
        'recurring', 'calculated', v_sum_housing, false
      );
    end if;

    if v_sum_transport > 0 then
      insert into public.payroll_earnings (
        organization_id, payroll_entry_id, payroll_period_id,
        code, description_ar, description_en, kind, source, amount, is_manual
      ) values (
        v_period.organization_id, v_entry.id, p_period_id,
        'TRANSPORT', 'بدل مواصلات', 'Transport Allowance',
        'recurring', 'calculated', v_sum_transport, false
      );
    end if;

    if v_sum_other > 0 then
      insert into public.payroll_earnings (
        organization_id, payroll_entry_id, payroll_period_id,
        code, description_ar, description_en, kind, source, amount, is_manual
      ) values (
        v_period.organization_id, v_entry.id, p_period_id,
        'OTHER', 'بدلات أخرى', 'Other Allowances',
        'recurring', 'calculated', v_sum_other, false
      );
    end if;

    if coalesce(v_settings.deduct_unpaid_leave, true) and v_unpaid_leave > 0 and v_daily_avg > 0 then
      v_deduct_amt := round(v_daily_avg * v_unpaid_leave, v_prec);
      if v_deduct_amt > 0 then
        insert into public.payroll_deductions (
          organization_id, payroll_entry_id, payroll_period_id,
          code, description_ar, description_en, source, amount, is_manual
        ) values (
          v_period.organization_id, v_entry.id, p_period_id,
          'UNPAID_LEAVE', 'خصم إجازة غير مدفوعة', 'Unpaid Leave Deduction',
          'leave', v_deduct_amt, false
        );
      end if;
    end if;

    if coalesce(v_settings.deduct_absence, false) and v_absence_billable > 0 and v_daily_avg > 0 then
      v_deduct_amt := round(v_daily_avg * v_absence_billable, v_prec);
      if v_deduct_amt > 0 then
        insert into public.payroll_deductions (
          organization_id, payroll_entry_id, payroll_period_id,
          code, description_ar, description_en, source, amount, is_manual
        ) values (
          v_period.organization_id, v_entry.id, p_period_id,
          'ABSENCE', 'خصم غياب', 'Absence Deduction',
          'attendance', v_deduct_amt, false
        );
      end if;
    end if;

    if coalesce(v_settings.deduct_late_minutes, false) and coalesce(v_late, 0) > 0 and v_daily_avg > 0 then
      v_deduct_amt := round(v_daily_avg * v_late / (8 * 60), v_prec);
      if v_deduct_amt > 0 then
        insert into public.payroll_deductions (
          organization_id, payroll_entry_id, payroll_period_id,
          code, description_ar, description_en, source, amount, is_manual
        ) values (
          v_period.organization_id, v_entry.id, p_period_id,
          'LATE', 'خصم تأخير', 'Late Minutes Deduction',
          'attendance', v_deduct_amt, false
        );
      end if;
    end if;

    v_details := jsonb_build_object(
      'engine_version', 1,
      'calculation_basis', v_settings.calculation_basis,
      'standard_payable_days', v_std,
      'rounding_precision', v_prec,
      'eligible_start', v_eligible_start,
      'eligible_end', v_eligible_end,
      'payable_days', v_sum_payable,
      'daily_avg', v_daily_avg,
      'unpaid_leave_days', v_unpaid_leave,
      'paid_leave_days', v_paid_leave,
      'absence_billable_days', v_absence_billable,
      'deduct_unpaid_leave', v_settings.deduct_unpaid_leave,
      'deduct_absence', v_settings.deduct_absence,
      'deduct_late_minutes', v_settings.deduct_late_minutes,
      'compensation_version_ids', to_jsonb(v_version_ids)
    );

    update public.payroll_entries set
      compensation_version_ids = v_version_ids,
      primary_compensation_version_id = v_primary_version,
      base_salary = v_sum_basic,
      housing_allowance = v_sum_housing,
      transport_allowance = v_sum_transport,
      other_allowances = v_sum_other,
      gross_recurring = v_gross_recurring,
      payable_days = v_sum_payable,
      present_days = coalesce(v_present, 0),
      absent_days = coalesce(v_absent, 0),
      leave_days = v_paid_leave + v_unpaid_leave,
      unpaid_leave_days = v_unpaid_leave,
      late_minutes = coalesce(v_late, 0),
      early_leave_minutes = coalesce(v_early, 0),
      worked_minutes = coalesce(v_worked, 0),
      missing_checkout_count = coalesce(v_missing, 0),
      calculation_details = v_details,
      engine_version = 1,
      updated_at = timezone('utc', now())
    where id = v_entry.id;

    perform public.recompute_payroll_entry_totals(v_entry.id);
  end loop;

  update public.payroll_periods set
    status = 'calculated',
    calculated_at = timezone('utc', now()),
    calculated_by = auth.uid(),
    engine_version = 1,
    updated_at = timezone('utc', now())
  where id = p_period_id;

  v_period := public.recompute_payroll_period_totals(p_period_id);

  perform public.log_audit(
    v_period.organization_id,
    'payroll.calculated',
    'payroll_period',
    v_period.id,
    null,
    jsonb_build_object(
      'employee_count', v_period.employee_count,
      'total_gross', v_period.total_gross,
      'total_deductions', v_period.total_deductions,
      'total_net', v_period.total_net,
      'engine_version', 1
    ),
    null, null, null
  );

  perform public.emit_domain_event(
    v_period.organization_id,
    'payroll.calculated',
    'payroll_period',
    v_period.id,
    jsonb_build_object(
      'employee_count', v_period.employee_count,
      'total_net', v_period.total_net,
      'status', v_period.status::text
    ),
    null
  );

  return v_period;
end;
$$;

grant execute on function public.calculate_payroll_period(uuid) to authenticated;

create or replace function public.submit_payroll_for_review(p_period_id uuid)
returns public.payroll_periods
language plpgsql
security definer
set search_path = public
as $$
declare
  v_period public.payroll_periods;
begin
  if auth.uid() is null then
    raise exception 'UNAUTHORIZED' using errcode = 'P0001';
  end if;

  select * into v_period from public.payroll_periods where id = p_period_id for update;
  if v_period.id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;

  if not (
    public.has_permission('payroll.prepare', v_period.organization_id, 'organization', null)
    or public.is_platform_admin()
  ) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  if v_period.status <> 'calculated' then
    raise exception 'INVALID_STATUS' using errcode = 'P0001';
  end if;

  update public.payroll_periods set
    status = 'under_review',
    submitted_at = timezone('utc', now()),
    submitted_by = auth.uid(),
    updated_at = timezone('utc', now())
  where id = p_period_id
  returning * into v_period;

  perform public.log_audit(
    v_period.organization_id, 'payroll.submitted', 'payroll_period', v_period.id,
    null, jsonb_build_object('status', v_period.status::text), null, null, null
  );
  perform public.emit_domain_event(
    v_period.organization_id, 'payroll.submitted', 'payroll_period', v_period.id,
    jsonb_build_object('status', v_period.status::text), null
  );

  return v_period;
end;
$$;

grant execute on function public.submit_payroll_for_review(uuid) to authenticated;

create or replace function public.mark_payroll_reviewed(p_period_id uuid)
returns public.payroll_periods
language plpgsql
security definer
set search_path = public
as $$
declare
  v_period public.payroll_periods;
begin
  if auth.uid() is null then
    raise exception 'UNAUTHORIZED' using errcode = 'P0001';
  end if;

  select * into v_period from public.payroll_periods where id = p_period_id for update;
  if v_period.id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;

  if not (
    public.has_permission('payroll.review', v_period.organization_id, 'organization', null)
    or public.is_platform_admin()
  ) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  if v_period.status <> 'under_review' then
    raise exception 'INVALID_STATUS' using errcode = 'P0001';
  end if;

  update public.payroll_periods set
    reviewed_at = timezone('utc', now()),
    reviewed_by = auth.uid(),
    updated_at = timezone('utc', now())
  where id = p_period_id
  returning * into v_period;

  perform public.log_audit(
    v_period.organization_id, 'payroll.reviewed', 'payroll_period', v_period.id,
    null, jsonb_build_object('reviewed_by', auth.uid()), null, null, null
  );
  perform public.emit_domain_event(
    v_period.organization_id, 'payroll.reviewed', 'payroll_period', v_period.id,
    jsonb_build_object('status', v_period.status::text), null
  );

  return v_period;
end;
$$;

grant execute on function public.mark_payroll_reviewed(uuid) to authenticated;

create or replace function public.approve_payroll_period(p_period_id uuid)
returns public.payroll_periods
language plpgsql
security definer
set search_path = public
as $$
declare
  v_period public.payroll_periods;
begin
  if auth.uid() is null then
    raise exception 'UNAUTHORIZED' using errcode = 'P0001';
  end if;

  select * into v_period from public.payroll_periods where id = p_period_id for update;
  if v_period.id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;

  if not (
    public.has_permission('payroll.approve', v_period.organization_id, 'organization', null)
    or public.is_platform_admin()
  ) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  if v_period.status <> 'under_review' then
    raise exception 'INVALID_STATUS' using errcode = 'P0001';
  end if;

  update public.payroll_periods set
    status = 'approved',
    approved_at = timezone('utc', now()),
    approved_by = auth.uid(),
    updated_at = timezone('utc', now())
  where id = p_period_id
  returning * into v_period;

  perform public.log_audit(
    v_period.organization_id, 'payroll.approved', 'payroll_period', v_period.id,
    null, jsonb_build_object('status', v_period.status::text), null, null, null
  );
  perform public.emit_domain_event(
    v_period.organization_id, 'payroll.approved', 'payroll_period', v_period.id,
    jsonb_build_object('status', v_period.status::text), null
  );

  return v_period;
end;
$$;

grant execute on function public.approve_payroll_period(uuid) to authenticated;

create or replace function public.lock_payroll_period(p_period_id uuid)
returns public.payroll_periods
language plpgsql
security definer
set search_path = public
as $$
declare
  v_period public.payroll_periods;
begin
  if auth.uid() is null then
    raise exception 'UNAUTHORIZED' using errcode = 'P0001';
  end if;

  select * into v_period from public.payroll_periods where id = p_period_id for update;
  if v_period.id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;

  if not (
    public.has_permission('payroll.lock', v_period.organization_id, 'organization', null)
    or public.is_platform_admin()
  ) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  if v_period.status <> 'approved' then
    raise exception 'INVALID_STATUS' using errcode = 'P0001';
  end if;

  update public.payroll_periods set
    status = 'locked',
    locked_at = timezone('utc', now()),
    locked_by = auth.uid(),
    updated_at = timezone('utc', now())
  where id = p_period_id
  returning * into v_period;

  perform public.log_audit(
    v_period.organization_id, 'payroll.locked', 'payroll_period', v_period.id,
    null, jsonb_build_object('status', v_period.status::text), null, null, null
  );
  perform public.emit_domain_event(
    v_period.organization_id, 'payroll.locked', 'payroll_period', v_period.id,
    jsonb_build_object('status', v_period.status::text), null
  );

  return v_period;
end;
$$;

grant execute on function public.lock_payroll_period(uuid) to authenticated;

create or replace function public.add_payroll_manual_earning(
  p_entry_id uuid,
  p_code text,
  p_description_ar text,
  p_description_en text,
  p_amount numeric,
  p_reason text default null
)
returns public.payroll_earnings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entry public.payroll_entries;
  v_period public.payroll_periods;
  v_row public.payroll_earnings;
begin
  if auth.uid() is null then
    raise exception 'UNAUTHORIZED' using errcode = 'P0001';
  end if;

  if p_entry_id is null or nullif(trim(p_code), '') is null or p_amount is null or p_amount < 0 then
    raise exception 'VALIDATION' using errcode = 'P0001';
  end if;

  select * into v_entry from public.payroll_entries where id = p_entry_id for update;
  if v_entry.id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;

  select * into v_period from public.payroll_periods where id = v_entry.payroll_period_id for update;
  if v_period.id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;

  if not (
    public.has_permission('payroll.adjust', v_period.organization_id, 'organization', null)
    or public.is_platform_admin()
  ) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  if v_period.status not in ('draft', 'calculated', 'under_review') then
    raise exception 'INVALID_STATUS' using errcode = 'P0001';
  end if;

  insert into public.payroll_earnings (
    organization_id, payroll_entry_id, payroll_period_id,
    code, description_ar, description_en, kind, source, amount,
    is_manual, created_by, reason
  ) values (
    v_entry.organization_id, v_entry.id, v_period.id,
    upper(trim(p_code)), p_description_ar, p_description_en,
    'one_time', 'manual', round(p_amount, 2),
    true, auth.uid(), p_reason
  )
  returning * into v_row;

  perform public.recompute_payroll_entry_totals(v_entry.id);
  perform public.recompute_payroll_period_totals(v_period.id);

  perform public.log_audit(
    v_entry.organization_id, 'payroll.adjusted', 'payroll_earning', v_row.id,
    null,
    jsonb_build_object('entry_id', v_entry.id, 'code', v_row.code, 'amount', v_row.amount, 'kind', 'earning'),
    null, null, null
  );
  perform public.emit_domain_event(
    v_entry.organization_id, 'payroll.adjusted', 'payroll_earning', v_row.id,
    jsonb_build_object('entry_id', v_entry.id, 'amount', v_row.amount, 'type', 'earning'),
    null
  );

  return v_row;
end;
$$;

grant execute on function public.add_payroll_manual_earning(uuid, text, text, text, numeric, text) to authenticated;

create or replace function public.add_payroll_manual_deduction(
  p_entry_id uuid,
  p_code text,
  p_description_ar text,
  p_description_en text,
  p_amount numeric,
  p_reason text default null
)
returns public.payroll_deductions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entry public.payroll_entries;
  v_period public.payroll_periods;
  v_row public.payroll_deductions;
begin
  if auth.uid() is null then
    raise exception 'UNAUTHORIZED' using errcode = 'P0001';
  end if;

  if p_entry_id is null or nullif(trim(p_code), '') is null or p_amount is null or p_amount < 0 then
    raise exception 'VALIDATION' using errcode = 'P0001';
  end if;

  select * into v_entry from public.payroll_entries where id = p_entry_id for update;
  if v_entry.id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;

  select * into v_period from public.payroll_periods where id = v_entry.payroll_period_id for update;
  if v_period.id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;

  if not (
    public.has_permission('payroll.adjust', v_period.organization_id, 'organization', null)
    or public.is_platform_admin()
  ) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  if v_period.status not in ('draft', 'calculated', 'under_review') then
    raise exception 'INVALID_STATUS' using errcode = 'P0001';
  end if;

  insert into public.payroll_deductions (
    organization_id, payroll_entry_id, payroll_period_id,
    code, description_ar, description_en, source, amount,
    is_manual, created_by, reason
  ) values (
    v_entry.organization_id, v_entry.id, v_period.id,
    upper(trim(p_code)), p_description_ar, p_description_en,
    'manual', round(p_amount, 2),
    true, auth.uid(), p_reason
  )
  returning * into v_row;

  perform public.recompute_payroll_entry_totals(v_entry.id);
  perform public.recompute_payroll_period_totals(v_period.id);

  perform public.log_audit(
    v_entry.organization_id, 'payroll.adjusted', 'payroll_deduction', v_row.id,
    null,
    jsonb_build_object('entry_id', v_entry.id, 'code', v_row.code, 'amount', v_row.amount, 'kind', 'deduction'),
    null, null, null
  );
  perform public.emit_domain_event(
    v_entry.organization_id, 'payroll.adjusted', 'payroll_deduction', v_row.id,
    jsonb_build_object('entry_id', v_entry.id, 'amount', v_row.amount, 'type', 'deduction'),
    null
  );

  return v_row;
end;
$$;

grant execute on function public.add_payroll_manual_deduction(uuid, text, text, text, numeric, text) to authenticated;

create or replace function public.record_payroll_payment(
  p_entry_id uuid,
  p_payment_date date,
  p_method public.payroll_payment_method,
  p_reference text,
  p_amount numeric,
  p_notes text default null
)
returns public.payroll_payments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entry public.payroll_entries;
  v_period public.payroll_periods;
  v_pay public.payroll_payments;
  v_unpaid integer;
begin
  if auth.uid() is null then
    raise exception 'UNAUTHORIZED' using errcode = 'P0001';
  end if;

  if p_entry_id is null or p_payment_date is null or p_method is null
     or p_amount is null or p_amount < 0 then
    raise exception 'VALIDATION' using errcode = 'P0001';
  end if;

  select * into v_entry from public.payroll_entries where id = p_entry_id for update;
  if v_entry.id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;

  select * into v_period from public.payroll_periods where id = v_entry.payroll_period_id for update;
  if v_period.id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;

  if not (
    public.has_permission('payroll.record_payment', v_period.organization_id, 'organization', null)
    or public.is_platform_admin()
  ) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  if v_period.status <> 'locked' then
    raise exception 'INVALID_STATUS' using errcode = 'P0001';
  end if;

  if exists (select 1 from public.payroll_payments where payroll_entry_id = p_entry_id) then
    raise exception 'CONFLICT' using errcode = 'P0001';
  end if;

  begin
    insert into public.payroll_payments (
      organization_id, payroll_period_id, payroll_entry_id,
      payment_date, payment_method, payment_reference, amount,
      recorded_by, notes
    ) values (
      v_entry.organization_id, v_period.id, v_entry.id,
      p_payment_date, p_method, p_reference, round(p_amount, 2),
      auth.uid(), p_notes
    )
    returning * into v_pay;
  exception
    when unique_violation then
      raise exception 'CONFLICT' using errcode = 'P0001';
  end;

  update public.payroll_entries set
    payment_status = 'paid',
    updated_at = timezone('utc', now())
  where id = v_entry.id;

  select count(*) into v_unpaid
  from public.payroll_entries
  where payroll_period_id = v_period.id
    and payment_status <> 'paid';

  if coalesce(v_unpaid, 0) = 0 then
    update public.payroll_periods set
      status = 'paid',
      paid_at = timezone('utc', now()),
      updated_at = timezone('utc', now())
    where id = v_period.id;
  end if;

  perform public.log_audit(
    v_entry.organization_id, 'payroll.payment_recorded', 'payroll_payment', v_pay.id,
    null,
    jsonb_build_object(
      'entry_id', v_entry.id,
      'amount', v_pay.amount,
      'payment_date', v_pay.payment_date,
      'method', v_pay.payment_method::text
    ),
    null, null, null
  );
  perform public.emit_domain_event(
    v_entry.organization_id, 'payroll.payment_recorded', 'payroll_payment', v_pay.id,
    jsonb_build_object('entry_id', v_entry.id, 'amount', v_pay.amount),
    null
  );

  return v_pay;
end;
$$;

grant execute on function public.record_payroll_payment(
  uuid, date, public.payroll_payment_method, text, numeric, text
) to authenticated;

create or replace function public.cancel_payroll_period(
  p_period_id uuid,
  p_reason text default null
)
returns public.payroll_periods
language plpgsql
security definer
set search_path = public
as $$
declare
  v_period public.payroll_periods;
begin
  if auth.uid() is null then
    raise exception 'UNAUTHORIZED' using errcode = 'P0001';
  end if;

  select * into v_period from public.payroll_periods where id = p_period_id for update;
  if v_period.id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;

  if not (
    public.has_permission('payroll.prepare', v_period.organization_id, 'organization', null)
    or public.is_platform_admin()
  ) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  if v_period.status not in ('draft', 'calculated') then
    raise exception 'INVALID_STATUS' using errcode = 'P0001';
  end if;

  update public.payroll_periods set
    status = 'cancelled',
    cancelled_at = timezone('utc', now()),
    cancelled_by = auth.uid(),
    notes = case
      when p_reason is null or trim(p_reason) = '' then notes
      when notes is null or notes = '' then p_reason
      else notes || E'\n' || p_reason
    end,
    updated_at = timezone('utc', now())
  where id = p_period_id
  returning * into v_period;

  perform public.log_audit(
    v_period.organization_id, 'payroll.cancelled', 'payroll_period', v_period.id,
    null, jsonb_build_object('reason', p_reason, 'status', v_period.status::text),
    null, null, null
  );
  perform public.emit_domain_event(
    v_period.organization_id, 'payroll.cancelled', 'payroll_period', v_period.id,
    jsonb_build_object('reason', p_reason), null
  );

  return v_period;
end;
$$;

grant execute on function public.cancel_payroll_period(uuid, text) to authenticated;

create or replace function public.update_payroll_settings(
  p_organization_id uuid,
  p_currency text default null,
  p_standard_payable_days numeric default null,
  p_deduct_unpaid_leave boolean default null,
  p_deduct_absence boolean default null,
  p_deduct_late_minutes boolean default null,
  p_rounding_precision integer default null,
  p_default_payment_method public.payroll_payment_method default null
)
returns public.payroll_settings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.payroll_settings;
begin
  if auth.uid() is null then
    raise exception 'UNAUTHORIZED' using errcode = 'P0001';
  end if;

  if p_organization_id is null then
    raise exception 'VALIDATION' using errcode = 'P0001';
  end if;

  if not (
    public.has_permission('payroll.manage_settings', p_organization_id, 'organization', null)
    or public.is_platform_admin()
  ) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  v_row := public.ensure_payroll_settings(p_organization_id);

  if p_standard_payable_days is not null and p_standard_payable_days <= 0 then
    raise exception 'VALIDATION' using errcode = 'P0001';
  end if;

  if p_rounding_precision is not null
     and (p_rounding_precision < 0 or p_rounding_precision > 6) then
    raise exception 'VALIDATION' using errcode = 'P0001';
  end if;

  update public.payroll_settings set
    currency = coalesce(nullif(trim(p_currency), ''), currency),
    standard_payable_days = coalesce(p_standard_payable_days, standard_payable_days),
    deduct_unpaid_leave = coalesce(p_deduct_unpaid_leave, deduct_unpaid_leave),
    deduct_absence = coalesce(p_deduct_absence, deduct_absence),
    deduct_late_minutes = coalesce(p_deduct_late_minutes, deduct_late_minutes),
    rounding_precision = coalesce(p_rounding_precision, rounding_precision),
    default_payment_method = coalesce(p_default_payment_method, default_payment_method),
    updated_at = timezone('utc', now())
  where organization_id = p_organization_id
  returning * into v_row;

  perform public.log_audit(
    p_organization_id, 'payroll.settings_updated', 'payroll_settings', v_row.id,
    null,
    jsonb_build_object(
      'currency', v_row.currency,
      'standard_payable_days', v_row.standard_payable_days,
      'deduct_unpaid_leave', v_row.deduct_unpaid_leave,
      'deduct_absence', v_row.deduct_absence,
      'deduct_late_minutes', v_row.deduct_late_minutes
    ),
    null, null, null
  );

  return v_row;
end;
$$;

grant execute on function public.update_payroll_settings(
  uuid, text, numeric, boolean, boolean, boolean, integer, public.payroll_payment_method
) to authenticated;

-- =============================================================================
-- G. RLS
-- =============================================================================

alter table public.payroll_settings enable row level security;
alter table public.payroll_periods enable row level security;
alter table public.payroll_entries enable row level security;
alter table public.payroll_entry_segments enable row level security;
alter table public.payroll_earnings enable row level security;
alter table public.payroll_deductions enable row level security;
alter table public.payroll_payments enable row level security;

drop policy if exists payroll_settings_select on public.payroll_settings;
create policy payroll_settings_select on public.payroll_settings
  for select to authenticated
  using (
    public.is_organization_member(organization_id)
    and (
      public.is_platform_admin()
      or public.has_permission('payroll.view_all', organization_id, 'organization', null)
      or public.has_permission('payroll.prepare', organization_id, 'organization', null)
      or public.has_permission('payroll.manage_settings', organization_id, 'organization', null)
    )
  );

drop policy if exists payroll_settings_write on public.payroll_settings;
create policy payroll_settings_write on public.payroll_settings
  for all to authenticated
  using (false)
  with check (false);

drop policy if exists payroll_periods_select on public.payroll_periods;
create policy payroll_periods_select on public.payroll_periods
  for select to authenticated
  using (
    public.is_organization_member(organization_id)
    and (
      public.is_platform_admin()
      or public.has_permission('payroll.view_all', organization_id, 'organization', null)
      or public.has_permission('payroll.prepare', organization_id, 'organization', null)
      or public.has_permission('payroll.calculate', organization_id, 'organization', null)
      or public.has_permission('payroll.review', organization_id, 'organization', null)
      or public.has_permission('payroll.approve', organization_id, 'organization', null)
      or public.has_permission('payroll.lock', organization_id, 'organization', null)
      or public.has_permission('payroll.adjust', organization_id, 'organization', null)
      or public.has_permission('payroll.record_payment', organization_id, 'organization', null)
      or (
        public.has_permission('payroll.view_self', organization_id, 'organization', null)
        and exists (
          select 1
          from public.payroll_entries pe
          join public.employees e on e.id = pe.employee_id
          where pe.payroll_period_id = payroll_periods.id
            and e.profile_id = auth.uid()
        )
      )
    )
  );

drop policy if exists payroll_periods_write on public.payroll_periods;
create policy payroll_periods_write on public.payroll_periods
  for all to authenticated
  using (false)
  with check (false);

drop policy if exists payroll_entries_select on public.payroll_entries;
create policy payroll_entries_select on public.payroll_entries
  for select to authenticated
  using (
    public.is_organization_member(organization_id)
    and (
      public.is_platform_admin()
      or public.has_permission('payroll.view_all', organization_id, 'organization', null)
      or public.has_permission('payroll.prepare', organization_id, 'organization', null)
      or public.has_permission('payroll.calculate', organization_id, 'organization', null)
      or public.has_permission('payroll.review', organization_id, 'organization', null)
      or public.has_permission('payroll.approve', organization_id, 'organization', null)
      or public.has_permission('payroll.lock', organization_id, 'organization', null)
      or public.has_permission('payroll.adjust', organization_id, 'organization', null)
      or public.has_permission('payroll.record_payment', organization_id, 'organization', null)
      or (
        public.has_permission('payroll.view_self', organization_id, 'organization', null)
        and exists (
          select 1 from public.employees e
          where e.id = payroll_entries.employee_id
            and e.profile_id = auth.uid()
        )
      )
    )
  );

drop policy if exists payroll_entries_write on public.payroll_entries;
create policy payroll_entries_write on public.payroll_entries
  for all to authenticated
  using (false)
  with check (false);

drop policy if exists payroll_entry_segments_select on public.payroll_entry_segments;
create policy payroll_entry_segments_select on public.payroll_entry_segments
  for select to authenticated
  using (
    exists (
      select 1 from public.payroll_entries pe
      where pe.id = payroll_entry_segments.payroll_entry_id
    )
  );

drop policy if exists payroll_entry_segments_write on public.payroll_entry_segments;
create policy payroll_entry_segments_write on public.payroll_entry_segments
  for all to authenticated
  using (false)
  with check (false);

drop policy if exists payroll_earnings_select on public.payroll_earnings;
create policy payroll_earnings_select on public.payroll_earnings
  for select to authenticated
  using (
    exists (
      select 1 from public.payroll_entries pe
      where pe.id = payroll_earnings.payroll_entry_id
    )
  );

drop policy if exists payroll_earnings_write on public.payroll_earnings;
create policy payroll_earnings_write on public.payroll_earnings
  for all to authenticated
  using (false)
  with check (false);

drop policy if exists payroll_deductions_select on public.payroll_deductions;
create policy payroll_deductions_select on public.payroll_deductions
  for select to authenticated
  using (
    exists (
      select 1 from public.payroll_entries pe
      where pe.id = payroll_deductions.payroll_entry_id
    )
  );

drop policy if exists payroll_deductions_write on public.payroll_deductions;
create policy payroll_deductions_write on public.payroll_deductions
  for all to authenticated
  using (false)
  with check (false);

drop policy if exists payroll_payments_select on public.payroll_payments;
create policy payroll_payments_select on public.payroll_payments
  for select to authenticated
  using (
    public.is_organization_member(organization_id)
    and (
      public.is_platform_admin()
      or public.has_permission('payroll.view_all', organization_id, 'organization', null)
      or public.has_permission('payroll.record_payment', organization_id, 'organization', null)
      or public.has_permission('payroll.review', organization_id, 'organization', null)
      or public.has_permission('payroll.approve', organization_id, 'organization', null)
    )
  );

drop policy if exists payroll_payments_write on public.payroll_payments;
create policy payroll_payments_write on public.payroll_payments
  for all to authenticated
  using (false)
  with check (false);

-- =============================================================================
-- H. Seed settings for Master Touch org (if exists)
-- =============================================================================

do $$
begin
  if exists (
    select 1 from public.organizations
    where id = '11111111-1111-1111-1111-111111111111'
  ) then
    perform public.ensure_payroll_settings('11111111-1111-1111-1111-111111111111');
  end if;
end
$$;
