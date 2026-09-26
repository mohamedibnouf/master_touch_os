-- Master Touch OS — 063
-- Phase 5.7: Attendance geofencing (workplace locations + server-side distance).
-- Additive. Does not modify migrations 001–062.
-- Browser GPS is evidence, not anti-spoofing. Distance is decided in this schema only.
--
-- Privacy: exact employee lat/lng live on attendance_location_attempts (nullable; never fabricated 0,0).
-- attendance_records store workplace/distance/accuracy/verified only.
-- Zero-arg attendance_check_in/out remain FAIL-CLOSED (GEOFENCE_LOCATION_REQUIRED). They never punch.
-- HQ coordinates are not on workplace_locations_directory (employee-facing).

-- ---------------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------------
insert into public.permissions (key, resource, action, description_ar, description_en)
values
  ('attendance.manage_locations', 'attendance', 'manage_locations', 'إدارة مواقع العمل', 'Manage workplace locations'),
  ('attendance.view_location_evidence', 'attendance', 'view_location_evidence', 'عرض أدلة الموقع', 'View exact attendance location evidence')
on conflict (key) do nothing;

insert into public.role_permissions (role_id, permission_key)
select r.id, p.key
from public.roles r
cross join public.permissions p
where r.code in ('super_admin', 'general_manager')
  and p.key in ('attendance.manage_locations', 'attendance.view_location_evidence')
on conflict do nothing;

insert into public.role_permissions (role_id, permission_key)
select r.id, x.permission_key
from public.roles r
join (values
  ('hr_manager', 'attendance.manage_locations'),
  ('hr_manager', 'attendance.view_location_evidence'),
  ('hr_officer', 'attendance.view_location_evidence'),
  ('operations_manager', 'attendance.manage_locations')
) as x(code, permission_key) on r.code = x.code
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Distance (deterministic Haversine, meters). No PostGIS required.
-- Exclusion constraint on assignments needs btree_gist (already in 057).
create extension if not exists btree_gist;

-- ---------------------------------------------------------------------------
create or replace function public.haversine_meters(
  p_lat1 numeric,
  p_lng1 numeric,
  p_lat2 numeric,
  p_lng2 numeric
)
returns numeric
language sql
immutable
strict
set search_path = public
as $$
  select (
    6371000::numeric * 2 * asin(sqrt(
      least(1::numeric, greatest(0::numeric,
        power(sin(radians(p_lat2 - p_lat1) / 2), 2)
        + cos(radians(p_lat1)) * cos(radians(p_lat2))
          * power(sin(radians(p_lng2 - p_lng1) / 2), 2)
      ))
    ))
  )::numeric(12, 2);
$$;

revoke all on function public.haversine_meters(numeric, numeric, numeric, numeric) from public;
revoke all on function public.haversine_meters(numeric, numeric, numeric, numeric) from anon;
revoke all on function public.haversine_meters(numeric, numeric, numeric, numeric) from authenticated;

-- ---------------------------------------------------------------------------
-- Workplace model
-- ---------------------------------------------------------------------------
create table public.workplace_locations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (length(trim(name)) >= 2 and length(name) <= 160),
  code text check (code is null or (length(trim(code)) >= 1 and length(code) <= 32)),
  address text,
  latitude numeric not null check (latitude >= -90 and latitude <= 90),
  longitude numeric not null check (longitude >= -180 and longitude <= 180),
  allowed_radius_meters integer not null default 150 check (allowed_radius_meters >= 10 and allowed_radius_meters <= 2000),
  -- Maximum allowed GPS error radius (meters). Accept when reported_accuracy <= this value.
  max_accuracy_meters integer check (max_accuracy_meters is null or (max_accuracy_meters >= 10 and max_accuracy_meters <= 1000)),
  timezone text not null default 'Asia/Riyadh',
  is_active boolean not null default true,
  is_primary boolean not null default false,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create unique index workplace_locations_org_code_uidx
  on public.workplace_locations (organization_id, code)
  where code is not null;

create unique index workplace_locations_one_primary_uidx
  on public.workplace_locations (organization_id)
  where is_primary;

create index workplace_locations_org_active_idx
  on public.workplace_locations (organization_id, is_active);

drop trigger if exists workplace_locations_set_updated_at on public.workplace_locations;
create trigger workplace_locations_set_updated_at
  before update on public.workplace_locations
  for each row execute function public.set_updated_at();

create or replace function public.workplace_locations_clear_other_primary()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.is_primary then
    update public.workplace_locations
    set is_primary = false
    where organization_id = new.organization_id
      and id is distinct from new.id
      and is_primary;
  end if;
  return new;
end;
$$;

drop trigger if exists workplace_locations_one_primary on public.workplace_locations;
create trigger workplace_locations_one_primary
  before insert or update on public.workplace_locations
  for each row execute function public.workplace_locations_clear_other_primary();

create table public.employee_workplace_assignments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  employee_id uuid not null references public.employees (id) on delete cascade,
  workplace_location_id uuid not null references public.workplace_locations (id) on delete restrict,
  effective_from date not null,
  effective_to date,
  is_primary boolean not null default true,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  constraint employee_workplace_assignments_range_valid check (
    effective_to is null or effective_to >= effective_from
  )
);

create index employee_workplace_assignments_emp_idx
  on public.employee_workplace_assignments (employee_id, effective_from desc);
create index employee_workplace_assignments_org_idx
  on public.employee_workplace_assignments (organization_id, effective_from);

create or replace function public.employee_workplace_assignments_same_org()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_org uuid;
  v_emp_org uuid;
begin
  select organization_id into v_org from public.workplace_locations where id = new.workplace_location_id;
  select organization_id into v_emp_org from public.employees where id = new.employee_id;
  if v_org is distinct from new.organization_id or v_emp_org is distinct from new.organization_id then
    raise exception 'WORKPLACE_ORG_MISMATCH' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists employee_workplace_assignments_same_org on public.employee_workplace_assignments;
create trigger employee_workplace_assignments_same_org
  before insert or update on public.employee_workplace_assignments
  for each row execute function public.employee_workplace_assignments_same_org();

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'employee_workplace_assignments_no_overlap'
  ) then
    alter table public.employee_workplace_assignments
      add constraint employee_workplace_assignments_no_overlap
      exclude using gist (
        employee_id with =,
        daterange(effective_from, coalesce(effective_to, 'infinity'::date), '[]') with &&
      );
  end if;
end
$$;

create table public.attendance_location_attempts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  employee_id uuid not null references public.employees (id) on delete cascade,
  workplace_location_id uuid references public.workplace_locations (id) on delete set null,
  action text not null check (action in ('CHECK_IN', 'CHECK_OUT')),
  result text not null check (result in (
    'ACCEPTED',
    'OUTSIDE_GEOFENCE',
    'POOR_ACCURACY',
    'NO_WORKPLACE',
    'INVALID_LOCATION',
    'INACTIVE_WORKPLACE'
  )),
  latitude numeric,
  longitude numeric,
  accuracy_meters numeric,
  distance_meters numeric,
  reason_code text not null,
  created_at timestamptz not null default timezone('utc', now()),
  constraint attendance_location_attempts_coords_pair check (
    (latitude is null and longitude is null)
    or (
      latitude is not null and longitude is not null
      and latitude >= -90 and latitude <= 90
      and longitude >= -180 and longitude <= 180
    )
  ),
  constraint attendance_location_attempts_accepted_has_coords check (
    result <> 'ACCEPTED'
    or (latitude is not null and longitude is not null)
  )
);

create index attendance_location_attempts_org_time_idx
  on public.attendance_location_attempts (organization_id, created_at desc);
create index attendance_location_attempts_emp_time_idx
  on public.attendance_location_attempts (employee_id, created_at desc);

alter table public.attendance_records
  add column if not exists check_in_workplace_id uuid references public.workplace_locations (id) on delete set null,
  add column if not exists check_in_accuracy_meters numeric,
  add column if not exists check_in_distance_meters numeric,
  add column if not exists check_in_location_verified boolean,
  add column if not exists check_out_workplace_id uuid references public.workplace_locations (id) on delete set null,
  add column if not exists check_out_accuracy_meters numeric,
  add column if not exists check_out_distance_meters numeric,
  add column if not exists check_out_location_verified boolean;

-- ---------------------------------------------------------------------------
-- Resolve workplace: assignment covering Riyadh today, else org primary.
-- ---------------------------------------------------------------------------
create or replace function public.resolve_employee_workplace(p_employee_id uuid)
returns public.workplace_locations
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_emp public.employees;
  v_today date := (timezone('Asia/Riyadh', now()))::date;
  v_wp public.workplace_locations;
begin
  select * into v_emp from public.employees where id = p_employee_id;
  if v_emp.id is null then
    return null;
  end if;

  select w.* into v_wp
  from public.employee_workplace_assignments a
  join public.workplace_locations w on w.id = a.workplace_location_id
  where a.employee_id = p_employee_id
    and a.organization_id = v_emp.organization_id
    and a.effective_from <= v_today
    and (a.effective_to is null or a.effective_to >= v_today)
  order by a.effective_from desc
  limit 1;

  if v_wp.id is not null then
    return v_wp;
  end if;

  select w.* into v_wp
  from public.workplace_locations w
  where w.organization_id = v_emp.organization_id
    and w.is_primary
  order by w.created_at
  limit 1;

  return v_wp;
end;
$$;

revoke all on function public.resolve_employee_workplace(uuid) from public;
revoke all on function public.resolve_employee_workplace(uuid) from anon;
revoke all on function public.resolve_employee_workplace(uuid) from authenticated;

create or replace function public.enforce_attendance_geofence(
  p_emp public.employees,
  p_action text,
  p_latitude numeric,
  p_longitude numeric,
  p_accuracy_meters numeric
)
returns table (
  workplace_id uuid,
  distance_meters numeric,
  accuracy_meters numeric,
  result text,
  reason_code text,
  attempt_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_wp public.workplace_locations;
  v_dist numeric;
  v_result text;
  v_reason text;
  v_coords_valid boolean;
  v_store_lat numeric;
  v_store_lng numeric;
  v_store_acc numeric;
  v_attempt_id uuid;
begin
  v_wp := public.resolve_employee_workplace(p_emp.id);

  v_coords_valid :=
    p_latitude is not null
    and p_longitude is not null
    and p_latitude = p_latitude
    and p_longitude = p_longitude
    and p_latitude >= -90 and p_latitude <= 90
    and p_longitude >= -180 and p_longitude <= 180;

  if not v_coords_valid then
    v_result := 'INVALID_LOCATION';
    v_reason := 'GEOFENCE_INVALID_LOCATION';
  elsif v_wp.id is null then
    v_result := 'NO_WORKPLACE';
    v_reason := 'GEOFENCE_NO_WORKPLACE';
  elsif not v_wp.is_active then
    v_result := 'INACTIVE_WORKPLACE';
    v_reason := 'GEOFENCE_INACTIVE_WORKPLACE';
  elsif v_wp.max_accuracy_meters is not null
     and (
       p_accuracy_meters is null
       or p_accuracy_meters <> p_accuracy_meters
       or p_accuracy_meters < 0
       or p_accuracy_meters > v_wp.max_accuracy_meters
     ) then
    v_result := 'POOR_ACCURACY';
    v_reason := 'GEOFENCE_POOR_ACCURACY';
  else
    v_dist := public.haversine_meters(p_latitude, p_longitude, v_wp.latitude, v_wp.longitude);
    if v_dist > v_wp.allowed_radius_meters then
      v_result := 'OUTSIDE_GEOFENCE';
      v_reason := 'GEOFENCE_OUTSIDE';
    else
      v_result := 'ACCEPTED';
      v_reason := 'ACCEPTED';
    end if;
  end if;

  if v_result = 'INVALID_LOCATION' then
    v_store_lat := null;
    v_store_lng := null;
    v_store_acc := null;
    v_dist := null;
  else
    v_store_lat := p_latitude;
    v_store_lng := p_longitude;
    v_store_acc := p_accuracy_meters;
  end if;

  insert into public.attendance_location_attempts (
    organization_id,
    employee_id,
    workplace_location_id,
    action,
    result,
    latitude,
    longitude,
    accuracy_meters,
    distance_meters,
    reason_code
  ) values (
    p_emp.organization_id,
    p_emp.id,
    v_wp.id,
    p_action,
    v_result,
    v_store_lat,
    v_store_lng,
    v_store_acc,
    v_dist,
    v_reason
  )
  returning id into v_attempt_id;

  -- Do NOT RAISE on geofence rejection: the attempt row must COMMIT.
  workplace_id := v_wp.id;
  distance_meters := v_dist;
  accuracy_meters := p_accuracy_meters;
  result := v_result;
  reason_code := v_reason;
  attempt_id := v_attempt_id;
  return next;
end;
$$;

revoke all on function public.enforce_attendance_geofence(public.employees, text, numeric, numeric, numeric) from public;
revoke all on function public.enforce_attendance_geofence(public.employees, text, numeric, numeric, numeric) from anon;
revoke all on function public.enforce_attendance_geofence(public.employees, text, numeric, numeric, numeric) from authenticated;

-- ---------------------------------------------------------------------------
-- Geo punch RPCs return jsonb so geofence rejections COMMIT (attempt evidence survives).
-- Zero-arg overloads remain FAIL-CLOSED (no geofence bypass).
-- ---------------------------------------------------------------------------
drop function if exists public.attendance_check_in(numeric, numeric, numeric);
drop function if exists public.attendance_check_out(numeric, numeric, numeric);

create or replace function public.attendance_check_in(
  p_latitude numeric,
  p_longitude numeric,
  p_accuracy_meters numeric
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_emp public.employees;
  v_now timestamptz := timezone('utc', now());
  v_ctx record;
  v_shift public.attendance_shifts;
  v_policy public.attendance_policies;
  v_attendance_date date;
  v_scheduled_start timestamptz;
  v_scheduled_end timestamptz;
  v_rec public.attendance_records;
  v_late integer := 0;
  v_status public.attendance_status;
  v_on_leave boolean;
  v_is_working boolean;
  v_dow smallint;
  v_wp_id uuid;
  v_dist numeric;
  v_acc numeric;
  v_geo_result text;
  v_geo_reason text;
  v_attempt_id uuid;
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

  select f.workplace_id, f.distance_meters, f.accuracy_meters, f.result, f.reason_code, f.attempt_id
    into v_wp_id, v_dist, v_acc, v_geo_result, v_geo_reason, v_attempt_id
  from public.enforce_attendance_geofence(v_emp, 'CHECK_IN', p_latitude, p_longitude, p_accuracy_meters) f;

  if v_geo_result is distinct from 'ACCEPTED' then
    return jsonb_build_object(
      'accepted', false,
      'reason_code', v_geo_reason,
      'attempt_id', v_attempt_id,
      'attendance_record', null
    );
  end if;

  select * into v_ctx
  from public.resolve_attendance_context_for_now(v_emp.id, v_now);

  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;

  v_attendance_date := v_ctx.attendance_date;
  v_shift := v_ctx.shift;
  v_policy := v_ctx.policy;
  v_scheduled_start := v_ctx.scheduled_start;
  v_scheduled_end := v_ctx.scheduled_end;

  if v_shift.id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;

  if not coalesce(v_policy.allow_manual_check_in, true) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  v_dow := extract(dow from v_attendance_date)::smallint;
  v_is_working := v_dow = any (v_shift.working_days);
  v_on_leave := public.employee_has_approved_leave_on(v_emp.id, v_attendance_date);

  insert into public.attendance_records (
    organization_id, employee_id, shift_id, attendance_date,
    scheduled_start, scheduled_end, attendance_status, source
  ) values (
    v_emp.organization_id, v_emp.id, v_shift.id, v_attendance_date,
    v_scheduled_start, v_scheduled_end, 'absent', 'self_service'
  )
  on conflict (employee_id, attendance_date) do nothing;

  select * into v_rec
  from public.attendance_records
  where employee_id = v_emp.id
    and attendance_date = v_attendance_date
  for update;

  if v_rec.check_in_at is not null then
    return jsonb_build_object(
      'accepted', true,
      'reason_code', 'ACCEPTED',
      'attempt_id', v_attempt_id,
      'attendance_record', to_jsonb(v_rec)
    );
  end if;

  if v_scheduled_start is not null
     and v_now > (v_scheduled_start + make_interval(mins => greatest(coalesce(v_policy.late_grace_minutes, 0), 0))) then
    v_late := greatest(
      0,
      floor(extract(epoch from (v_now - v_scheduled_start)) / 60.0)::integer
        - greatest(coalesce(v_policy.late_grace_minutes, 0), 0)
    );
  end if;

  v_status := public.classify_attendance_status(
    v_now,
    null,
    v_scheduled_start,
    v_scheduled_end,
    v_policy.late_grace_minutes,
    v_policy.early_leave_grace_minutes,
    v_policy.minimum_work_minutes,
    v_on_leave,
    v_is_working,
    false
  );

  update public.attendance_records set
    shift_id = v_shift.id,
    scheduled_start = v_scheduled_start,
    scheduled_end = v_scheduled_end,
    check_in_at = v_now,
    late_minutes = case when v_on_leave then 0 else v_late end,
    attendance_status = v_status,
    source = case when source = 'hr_adjustment' then source else 'self_service' end,
    check_in_workplace_id = v_wp_id,
    check_in_accuracy_meters = v_acc,
    check_in_distance_meters = v_dist,
    check_in_location_verified = true,
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
      'attendance_date', v_attendance_date,
      'check_in_at', v_now,
      'late_minutes', v_rec.late_minutes,
      'attendance_status', v_rec.attendance_status::text,
      'workplace_id', v_wp_id,
      'distance_meters', v_dist,
      'location_verified', true
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
      'attendance_date', v_attendance_date,
      'attendance_status', v_rec.attendance_status::text
    ),
    null
  );

  return jsonb_build_object(
    'accepted', true,
    'reason_code', 'ACCEPTED',
    'attempt_id', v_attempt_id,
    'attendance_record', to_jsonb(v_rec)
  );
end;
$$;

grant execute on function public.attendance_check_in(numeric, numeric, numeric) to authenticated;

create or replace function public.attendance_check_out(
  p_latitude numeric,
  p_longitude numeric,
  p_accuracy_meters numeric
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_emp public.employees;
  v_now timestamptz := timezone('utc', now());
  v_ctx record;
  v_shift public.attendance_shifts;
  v_policy public.attendance_policies;
  v_attendance_date date;
  v_scheduled_start timestamptz;
  v_scheduled_end timestamptz;
  v_rec public.attendance_records;
  v_early integer := 0;
  v_worked integer := 0;
  v_status public.attendance_status;
  v_on_leave boolean;
  v_is_working boolean;
  v_dow smallint;
  v_prev jsonb;
  v_wp_id uuid;
  v_dist numeric;
  v_acc numeric;
  v_geo_result text;
  v_geo_reason text;
  v_attempt_id uuid;
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

  select f.workplace_id, f.distance_meters, f.accuracy_meters, f.result, f.reason_code, f.attempt_id
    into v_wp_id, v_dist, v_acc, v_geo_result, v_geo_reason, v_attempt_id
  from public.enforce_attendance_geofence(v_emp, 'CHECK_OUT', p_latitude, p_longitude, p_accuracy_meters) f;

  if v_geo_result is distinct from 'ACCEPTED' then
    return jsonb_build_object(
      'accepted', false,
      'reason_code', v_geo_reason,
      'attempt_id', v_attempt_id,
      'attendance_record', null
    );
  end if;

  select * into v_ctx
  from public.resolve_attendance_context_for_now(v_emp.id, v_now);

  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;

  v_attendance_date := v_ctx.attendance_date;
  v_shift := v_ctx.shift;
  v_policy := v_ctx.policy;
  v_scheduled_start := v_ctx.scheduled_start;
  v_scheduled_end := v_ctx.scheduled_end;

  if not coalesce(v_policy.allow_manual_check_out, true) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  select * into v_rec
  from public.attendance_records
  where employee_id = v_emp.id
    and attendance_date = v_attendance_date
  for update;

  if v_rec.id is null or v_rec.check_in_at is null then
    raise exception 'CONFLICT' using errcode = 'P0001';
  end if;

  if v_rec.check_out_at is not null then
    return jsonb_build_object(
      'accepted', true,
      'reason_code', 'ACCEPTED',
      'attempt_id', v_attempt_id,
      'attendance_record', to_jsonb(v_rec)
    );
  end if;

  if v_now < v_rec.check_in_at then
    raise exception 'VALIDATION' using errcode = 'P0001';
  end if;

  v_dow := extract(dow from v_attendance_date)::smallint;
  v_is_working := v_dow = any (v_shift.working_days);
  v_on_leave := public.employee_has_approved_leave_on(v_emp.id, v_attendance_date);

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
    coalesce(v_rec.scheduled_start, v_scheduled_start),
    coalesce(v_rec.scheduled_end, v_scheduled_end),
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
    check_out_workplace_id = v_wp_id,
    check_out_accuracy_meters = v_acc,
    check_out_distance_meters = v_dist,
    check_out_location_verified = true,
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
      'attendance_status', v_rec.attendance_status::text,
      'workplace_id', v_wp_id,
      'distance_meters', v_dist,
      'location_verified', true
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

  return jsonb_build_object(
    'accepted', true,
    'reason_code', 'ACCEPTED',
    'attempt_id', v_attempt_id,
    'attendance_record', to_jsonb(v_rec)
  );
end;
$$;

grant execute on function public.attendance_check_out(numeric, numeric, numeric) to authenticated;

create or replace function public.attendance_check_in()
returns public.attendance_records
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'UNAUTHORIZED' using errcode = 'P0001';
  end if;
  raise exception 'GEOFENCE_LOCATION_REQUIRED' using errcode = 'P0001';
end;
$$;

create or replace function public.attendance_check_out()
returns public.attendance_records
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'UNAUTHORIZED' using errcode = 'P0001';
  end if;
  raise exception 'GEOFENCE_LOCATION_REQUIRED' using errcode = 'P0001';
end;
$$;

grant execute on function public.attendance_check_in() to authenticated;
grant execute on function public.attendance_check_out() to authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.workplace_locations enable row level security;
alter table public.employee_workplace_assignments enable row level security;
alter table public.attendance_location_attempts enable row level security;

create policy workplace_locations_select on public.workplace_locations
  for select to authenticated
  using (
    public.is_organization_member(organization_id)
    and (
      public.is_platform_admin()
      or public.has_permission('attendance.manage_locations', organization_id, 'organization', null)
    )
  );

create policy workplace_locations_write on public.workplace_locations
  for all to authenticated
  using (
    public.has_permission('attendance.manage_locations', organization_id, 'organization', null)
    or public.is_platform_admin()
  )
  with check (
    public.has_permission('attendance.manage_locations', organization_id, 'organization', null)
    or public.is_platform_admin()
  );

create policy employee_workplace_assignments_select on public.employee_workplace_assignments
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
      or public.has_permission('attendance.manage_locations', organization_id, 'organization', null)
    )
  );

create policy employee_workplace_assignments_write on public.employee_workplace_assignments
  for all to authenticated
  using (
    public.has_permission('attendance.manage_locations', organization_id, 'organization', null)
    or public.is_platform_admin()
  )
  with check (
    public.has_permission('attendance.manage_locations', organization_id, 'organization', null)
    or public.is_platform_admin()
  );

create policy attendance_location_attempts_select on public.attendance_location_attempts
  for select to authenticated
  using (
    public.is_organization_member(organization_id)
    and (
      public.is_platform_admin()
      or public.has_permission('attendance.view_location_evidence', organization_id, 'organization', null)
      or exists (
        select 1 from public.employees e
        where e.id = employee_id and e.profile_id = auth.uid()
      )
    )
  );

create policy attendance_location_attempts_write on public.attendance_location_attempts
  for all to authenticated
  using (false)
  with check (false);

grant select, insert, update, delete on public.workplace_locations to authenticated;
grant select, insert, update, delete on public.employee_workplace_assignments to authenticated;
grant select on public.attendance_location_attempts to authenticated;

create or replace view public.workplace_locations_directory as
select
  w.id,
  w.organization_id,
  w.name,
  w.code,
  w.address,
  w.allowed_radius_meters,
  w.max_accuracy_meters,
  w.timezone,
  w.is_active,
  w.is_primary,
  w.created_at,
  w.updated_at
from public.workplace_locations w
where public.is_organization_member(w.organization_id)
  and (
    public.is_platform_admin()
    or public.has_permission('attendance.view_self', w.organization_id, 'organization', null)
    or public.has_permission('attendance.check_in', w.organization_id, 'organization', null)
    or public.has_permission('attendance.view_all', w.organization_id, 'organization', null)
    or public.has_permission('attendance.manage', w.organization_id, 'organization', null)
    or public.has_permission('attendance.manage_locations', w.organization_id, 'organization', null)
  );

grant select on public.workplace_locations_directory to authenticated;

comment on view public.workplace_locations_directory is
  'Employee/HR directory of workplaces without raw HQ coordinates. Server geofence uses workplace_locations.';

comment on column public.workplace_locations.max_accuracy_meters is
  'Maximum allowed reported GPS accuracy (error radius) in meters. Punch accepted only if reported_accuracy_meters <= max_accuracy_meters.';

comment on function public.workplace_locations_clear_other_primary() is
  'Transactional demote of other primary rows in the same organization. Unique partial index remains the concurrency backstop.';

comment on table public.attendance_location_attempts is
  'Sensitive GPS evidence for attendance attempts. Retention should be configurable in a later phase. Browser geolocation is not anti-spoofing.';
