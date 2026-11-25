-- Master Touch OS — 092
-- Split shifts: one employee can hold several shifts at the same time (for example
-- 08:00–12:00 and 16:00–20:00 on the same days) and checks in / out once per shift.
-- HR can also take an employee off a shift (end it from a date) or delete a wrong
-- assignment.
-- Additive and idempotent. Does NOT modify 001–091 files; redefines objects created there,
-- each copied from its latest definition and patched (look for "092:").
-- Run in one go as postgres in the Supabase SQL Editor, BEFORE the app deploy that ships
-- the split-shift screens (the app calls end/delete_employee_shift_assignment).
--
-- Sections:
--   A. employee_shift_assignments: different shifts may overlap in dates; the same shift
--      still cannot be assigned twice for overlapping dates.
--   B. attendance_records: one row per employee + day + shift (was employee + day).
--   C. Helpers: attendance_shifts_overlap(), resolve_employee_shifts_for_date(),
--      resolve_employee_shift_for_date() (compat), resolve_attendance_context_for_now().
--   D. attendance_check_in / attendance_check_out (geofenced, 063) pick the right shift.
--   E. assign_employee_shift rejects shifts whose hours collide; new
--      end_employee_shift_assignment / delete_employee_shift_assignment.
--   F. reconcile_attendance_for_date works per shift.
--   G. attendance_monthly_summary and calculate_payroll_period count DAYS, weighting each
--      shift of a split day (1 of 2 shifts absent = 0.5 absent day). For employees with a
--      single shift every number is identical to before.
--
-- Safety:
--  * No rows are updated or deleted. Existing attendance rows already satisfy the new,
--    looser unique key.
--  * attendance_monthly_summary changes the type of its day columns from integer to
--    numeric (it is dropped and re-created; only reports call it).
--  * Existing payroll periods are NOT recalculated; draft periods change only when someone
--    runs "Calculate" again.

-- =============================================================================
-- A. Concurrent shift assignments
-- =============================================================================

alter table public.employee_shift_assignments
  drop constraint if exists employee_shift_assignments_no_overlap;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'employee_shift_assignments_same_shift_no_overlap'
  ) then
    alter table public.employee_shift_assignments
      add constraint employee_shift_assignments_same_shift_no_overlap
      exclude using gist (
        employee_id with =,
        shift_id with =,
        daterange(effective_from, coalesce(effective_to, 'infinity'::date), '[]') with &&
      );
  end if;
end
$$;

-- =============================================================================
-- B. One attendance row per employee + day + shift
-- =============================================================================

do $$
declare
  r record;
begin
  for r in
    select c.conname
    from pg_constraint c
    where c.conrelid = 'public.attendance_records'::regclass
      and c.contype = 'u'
      and pg_get_constraintdef(c.oid) = 'UNIQUE (employee_id, attendance_date)'
  loop
    execute format('alter table public.attendance_records drop constraint %I', r.conname);
  end loop;

  if not exists (
    select 1 from pg_constraint where conname = 'attendance_records_employee_date_shift_key'
  ) then
    alter table public.attendance_records
      add constraint attendance_records_employee_date_shift_key
      unique (employee_id, attendance_date, shift_id);
  end if;
end
$$;

-- =============================================================================
-- C. Helpers
-- =============================================================================

-- True when two shifts would have the employee in two places at once on some day.
-- Compares the same day and, for shifts crossing midnight, the next / previous day.
create or replace function public.attendance_shifts_overlap(
  p_a public.attendance_shifts,
  p_b public.attendance_shifts
)
returns boolean
language plpgsql
immutable
set search_path = public
as $$
declare
  a_s integer;
  a_e integer;
  b_s integer;
  b_e integer;
  a_next smallint[];
  b_next smallint[];
begin
  if p_a.id is null or p_b.id is null then
    return false;
  end if;

  a_s := (extract(epoch from p_a.start_time) / 60)::integer;
  a_e := (extract(epoch from p_a.end_time) / 60)::integer + case when p_a.crosses_midnight then 1440 else 0 end;
  b_s := (extract(epoch from p_b.start_time) / 60)::integer;
  b_e := (extract(epoch from p_b.end_time) / 60)::integer + case when p_b.crosses_midnight then 1440 else 0 end;

  select coalesce(array_agg(((d + 1) % 7)::smallint), '{}') into a_next from unnest(p_a.working_days) d;
  select coalesce(array_agg(((d + 1) % 7)::smallint), '{}') into b_next from unnest(p_b.working_days) d;

  -- same calendar day
  if p_a.working_days && p_b.working_days and a_s < b_e and b_s < a_e then
    return true;
  end if;
  -- A starts the day before B (A crosses midnight into B's day)
  if a_next && p_b.working_days and a_s < b_e + 1440 and b_s + 1440 < a_e then
    return true;
  end if;
  -- B starts the day before A
  if b_next && p_a.working_days and b_s < a_e + 1440 and a_s + 1440 < b_e then
    return true;
  end if;
  return false;
end;
$$;

grant execute on function public.attendance_shifts_overlap(public.attendance_shifts, public.attendance_shifts) to authenticated;

-- All active shifts assigned to the employee on a date, earliest start first.
create or replace function public.resolve_employee_shifts_for_date(
  p_employee_id uuid,
  p_date date
)
returns setof public.attendance_shifts
language sql
stable
security definer
set search_path = public
as $$
  select s.*
  from public.attendance_shifts s
  where s.is_active = true
    and exists (
      select 1
      from public.employee_shift_assignments a
      where a.employee_id = p_employee_id
        and a.shift_id = s.id
        and a.effective_from <= p_date
        and (a.effective_to is null or a.effective_to >= p_date)
    )
  order by s.start_time, s.code;
$$;

grant execute on function public.resolve_employee_shifts_for_date(uuid, date) to authenticated;

-- 092: compat — first shift of the day (was: the latest assignment, which was unique).
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
  select * into v_shift
  from public.resolve_employee_shifts_for_date(p_employee_id, p_date)
  limit 1;
  return v_shift;
end;
$$;

grant execute on function public.resolve_employee_shift_for_date(uuid, date) to authenticated;

-- 092: the shift to check IN to now. Skips shifts already checked in today. Preference:
--   1. a shift scheduled on this weekday (non-working-day shifts only as a fallback);
--   2. a shift whose window contains now (incl. yesterday's cross-midnight shift);
--   3. otherwise the next shift to start today (early arrival for the evening part);
--   4. otherwise the shift that ended most recently (late punch, same as before 092).
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
  v_local_date date;
  v_y_date date;
begin
  v_local_date := (p_now at time zone 'Asia/Riyadh')::date;
  v_y_date := v_local_date - 1;

  return query
  with cand as (
    select
      d.dt,
      d.is_yesterday,
      s as sh,
      cw.scheduled_start as w_start,
      cw.scheduled_end as w_end,
      (extract(dow from d.dt)::smallint = any (s.working_days)) as is_working
    from (values (v_y_date, true), (v_local_date, false)) as d(dt, is_yesterday)
    cross join lateral public.resolve_employee_shifts_for_date(p_employee_id, d.dt) s
    cross join lateral public.compute_scheduled_window(d.dt, s) cw
  ),
  open_cand as (
    select c.*
    from cand c
    where (not c.is_yesterday or ((c.sh).crosses_midnight and p_now <= c.w_end))
      and not exists (
        select 1
        from public.attendance_records ar
        where ar.employee_id = p_employee_id
          and ar.attendance_date = c.dt
          and ar.shift_id = (c.sh).id
          and ar.check_in_at is not null
      )
  )
  select
    oc.dt,
    oc.sh,
    oc.w_start,
    oc.w_end,
    p
  from open_cand oc
  join public.attendance_policies p on p.id = (oc.sh).policy_id
  order by
    oc.is_working desc,
    case
      when p_now >= oc.w_start and p_now <= oc.w_end then 0
      when oc.w_start > p_now then 1
      else 2
    end,
    case
      when oc.w_end < p_now then -extract(epoch from oc.w_end)
      else extract(epoch from oc.w_start)
    end
  limit 1;
end;
$$;

revoke all on function public.resolve_attendance_context_for_now(uuid, timestamptz) from public, anon, authenticated;

-- =============================================================================
-- D. Geofenced punches pick the right shift (latest body: 063)
-- =============================================================================

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
  v_local_date date;
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

  v_local_date := (v_now at time zone 'Asia/Riyadh')::date;

  -- 092: still inside a shift that is checked in and not out -> idempotent repeat press.
  -- (A shift whose hours are over does not block checking in to the next shift.)
  select * into v_rec
  from public.attendance_records ar
  where ar.employee_id = v_emp.id
    and ar.attendance_date between v_local_date - 1 and v_local_date
    and ar.check_in_at is not null
    and ar.check_out_at is null
    and (ar.scheduled_end is null or v_now <= ar.scheduled_end)
  order by ar.check_in_at desc
  limit 1;

  if v_rec.id is not null then
    return jsonb_build_object(
      'accepted', true,
      'reason_code', 'ACCEPTED',
      'attempt_id', v_attempt_id,
      'attendance_record', to_jsonb(v_rec)
    );
  end if;

  select * into v_ctx
  from public.resolve_attendance_context_for_now(v_emp.id, v_now);

  if not found then
    -- 092: every shift of today is already checked in -> return the latest row (as before).
    select * into v_rec
    from public.attendance_records ar
    where ar.employee_id = v_emp.id
      and ar.attendance_date between v_local_date - 1 and v_local_date
      and ar.check_in_at is not null
    order by ar.check_in_at desc
    limit 1;
    if v_rec.id is not null then
      return jsonb_build_object(
        'accepted', true,
        'reason_code', 'ACCEPTED',
        'attempt_id', v_attempt_id,
        'attendance_record', to_jsonb(v_rec)
      );
    end if;
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
  on conflict (employee_id, attendance_date, shift_id) do nothing;  -- 092: per shift

  select * into v_rec
  from public.attendance_records
  where employee_id = v_emp.id
    and attendance_date = v_attendance_date
    and shift_id = v_shift.id  -- 092
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
      'shift_id', v_shift.id,
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
      'shift_id', v_shift.id,
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
  v_shift public.attendance_shifts;
  v_policy public.attendance_policies;
  v_rec public.attendance_records;
  v_early integer := 0;
  v_worked integer := 0;
  v_status public.attendance_status;
  v_on_leave boolean;
  v_is_working boolean := true;
  v_dow smallint;
  v_prev jsonb;
  v_wp_id uuid;
  v_dist numeric;
  v_acc numeric;
  v_geo_result text;
  v_geo_reason text;
  v_attempt_id uuid;
  v_local_date date;
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

  v_local_date := (v_now at time zone 'Asia/Riyadh')::date;

  -- 092: check out of the most recent open shift (today or yesterday's night shift).
  select * into v_rec
  from public.attendance_records ar
  where ar.employee_id = v_emp.id
    and ar.attendance_date between v_local_date - 1 and v_local_date
    and ar.check_in_at is not null
    and ar.check_out_at is null
  order by ar.check_in_at desc
  limit 1
  for update;

  if v_rec.id is null then
    -- Already checked out -> idempotent repeat press returns the latest row (as before).
    select * into v_rec
    from public.attendance_records ar
    where ar.employee_id = v_emp.id
      and ar.attendance_date between v_local_date - 1 and v_local_date
      and ar.check_out_at is not null
    order by ar.check_out_at desc
    limit 1;
    if v_rec.id is not null then
      return jsonb_build_object(
        'accepted', true,
        'reason_code', 'ACCEPTED',
        'attempt_id', v_attempt_id,
        'attendance_record', to_jsonb(v_rec)
      );
    end if;
    raise exception 'CONFLICT' using errcode = 'P0001';
  end if;

  if v_rec.shift_id is not null then
    select * into v_shift from public.attendance_shifts where id = v_rec.shift_id;
  end if;
  if v_shift.id is not null then
    select * into v_policy from public.attendance_policies where id = v_shift.policy_id;
    v_dow := extract(dow from v_rec.attendance_date)::smallint;
    v_is_working := v_dow = any (v_shift.working_days);
  end if;
  if v_policy.id is null then
    v_policy.late_grace_minutes := 15;
    v_policy.early_leave_grace_minutes := 15;
    v_policy.minimum_work_minutes := 240;
    v_policy.allow_manual_check_out := true;
  end if;

  if not coalesce(v_policy.allow_manual_check_out, true) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  if v_now < v_rec.check_in_at then
    raise exception 'VALIDATION' using errcode = 'P0001';
  end if;

  v_on_leave := public.employee_has_approved_leave_on(v_emp.id, v_rec.attendance_date);

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
    v_rec.scheduled_start,
    v_rec.scheduled_end,
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
      'shift_id', v_rec.shift_id,
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
      'shift_id', v_rec.shift_id,
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

-- =============================================================================
-- E. Assign / end / delete shift assignments (latest assign body: 057)
-- =============================================================================

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
  v_range daterange;
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

  -- 092: lock the employee so two concurrent assignments cannot both pass the checks.
  select * into v_emp from public.employees where id = p_employee_id for update;
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

  v_range := daterange(p_effective_from, coalesce(p_effective_to, 'infinity'::date), '[]');

  -- 092: same shift already assigned for (part of) these dates
  if exists (
    select 1 from public.employee_shift_assignments a
    where a.employee_id = v_emp.id
      and a.shift_id = v_shift.id
      and daterange(a.effective_from, coalesce(a.effective_to, 'infinity'::date), '[]') && v_range
  ) then
    raise exception 'SHIFT_ALREADY_ASSIGNED' using errcode = 'P0001';
  end if;

  -- 092: another shift of the employee whose hours collide with this one
  if exists (
    select 1
    from public.employee_shift_assignments a
    join public.attendance_shifts s on s.id = a.shift_id
    where a.employee_id = v_emp.id
      and a.shift_id <> v_shift.id
      and s.is_active = true
      and daterange(a.effective_from, coalesce(a.effective_to, 'infinity'::date), '[]') && v_range
      and public.attendance_shifts_overlap(s, v_shift)
  ) then
    raise exception 'SHIFT_TIME_OVERLAP' using errcode = 'P0001';
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

-- 092: take an employee off a shift from a date (inclusive last day). History is kept.
-- Only shortens an assignment; it never extends one.
create or replace function public.end_employee_shift_assignment(
  p_assignment_id uuid,
  p_effective_to date
)
returns public.employee_shift_assignments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.employee_shift_assignments;
  v_prev jsonb;
begin
  if auth.uid() is null then
    raise exception 'UNAUTHORIZED' using errcode = 'P0001';
  end if;

  if p_assignment_id is null or p_effective_to is null then
    raise exception 'VALIDATION' using errcode = 'P0001';
  end if;

  select * into v_row from public.employee_shift_assignments where id = p_assignment_id for update;
  if v_row.id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;

  if not (
    public.has_permission('attendance.manage_shifts', v_row.organization_id, 'organization', null)
    or public.is_platform_admin()
  ) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  if p_effective_to < v_row.effective_from then
    raise exception 'SHIFT_END_BEFORE_START' using errcode = 'P0001';
  end if;

  if v_row.effective_to is not null and p_effective_to > v_row.effective_to then
    raise exception 'SHIFT_END_EXTENDS' using errcode = 'P0001';
  end if;

  v_prev := to_jsonb(v_row);

  update public.employee_shift_assignments
  set effective_to = p_effective_to
  where id = v_row.id
  returning * into v_row;

  perform public.log_audit(
    v_row.organization_id,
    'attendance.shift_assignment_ended',
    'employee_shift_assignment',
    v_row.id,
    v_prev,
    jsonb_build_object(
      'employee_id', v_row.employee_id,
      'shift_id', v_row.shift_id,
      'effective_to', p_effective_to
    ),
    null, null, null
  );

  perform public.emit_domain_event(
    v_row.organization_id,
    'attendance.shift_assignment_ended',
    'employee_shift_assignment',
    v_row.id,
    jsonb_build_object('employee_id', v_row.employee_id, 'shift_id', v_row.shift_id, 'effective_to', p_effective_to),
    null
  );

  return v_row;
end;
$$;

grant execute on function public.end_employee_shift_assignment(uuid, date) to authenticated;

-- 092: delete an assignment made by mistake. Refused once the employee has any
-- attendance row on that shift inside the assignment's dates (end it instead).
create or replace function public.delete_employee_shift_assignment(
  p_assignment_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.employee_shift_assignments;
begin
  if auth.uid() is null then
    raise exception 'UNAUTHORIZED' using errcode = 'P0001';
  end if;

  select * into v_row from public.employee_shift_assignments where id = p_assignment_id for update;
  if v_row.id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;

  if not (
    public.has_permission('attendance.manage_shifts', v_row.organization_id, 'organization', null)
    or public.is_platform_admin()
  ) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from public.attendance_records ar
    where ar.employee_id = v_row.employee_id
      and ar.shift_id = v_row.shift_id
      and ar.attendance_date >= v_row.effective_from
      and (v_row.effective_to is null or ar.attendance_date <= v_row.effective_to)
  ) then
    raise exception 'SHIFT_ASSIGNMENT_HAS_ATTENDANCE' using errcode = 'P0001';
  end if;

  delete from public.employee_shift_assignments where id = v_row.id;

  perform public.log_audit(
    v_row.organization_id,
    'attendance.shift_assignment_deleted',
    'employee_shift_assignment',
    v_row.id,
    to_jsonb(v_row),
    null,
    null, null, null
  );

  perform public.emit_domain_event(
    v_row.organization_id,
    'attendance.shift_assignment_deleted',
    'employee_shift_assignment',
    v_row.id,
    jsonb_build_object('employee_id', v_row.employee_id, 'shift_id', v_row.shift_id),
    null
  );

  return v_row.id;
end;
$$;

grant execute on function public.delete_employee_shift_assignment(uuid) to authenticated;

-- =============================================================================
-- F. Reconcile per shift (latest body: 057)
-- =============================================================================

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
  v_pair record;
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

  -- 092: one pass per (employee, shift) instead of per employee
  for v_pair in
    select e.id as emp_id, s as sh
    from public.employees e
    cross join lateral public.resolve_employee_shifts_for_date(e.id, p_date) s
    where e.organization_id = p_organization_id
      and e.is_active = true
      and s.organization_id = p_organization_id
  loop
    v_emp_id := v_pair.emp_id;
    v_shift := v_pair.sh;
    select * into v_policy from public.attendance_policies where id = v_shift.policy_id;
    select cw.scheduled_start, cw.scheduled_end into v_start, v_end
    from public.compute_scheduled_window(p_date, v_shift) cw;

    v_dow := extract(dow from p_date)::smallint;
    v_is_working := v_dow = any (v_shift.working_days);
    v_on_leave := public.employee_has_approved_leave_on(v_emp_id, p_date);
    v_delay := greatest(coalesce(v_policy.reconciliation_delay_hours, 8), 0);
    v_day_closed := v_end is not null and v_now > (v_end + make_interval(hours => v_delay));

    v_rec := null;
    select * into v_rec
    from public.attendance_records
    where employee_id = v_emp_id
      and attendance_date = p_date
      and shift_id = v_shift.id  -- 092
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

    -- Working day: absent / missing checkout only after the shift closes
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

-- =============================================================================
-- G. Day-weighted summaries
-- =============================================================================

-- 092: each attendance row of a working day weighs 1 / (working shifts that day), so a
-- split day contributes at most 1 day in total. Off-day / holiday rows weigh nothing.

drop function if exists public.attendance_monthly_summary(uuid, integer, integer);

create or replace function public.attendance_monthly_summary(
  p_organization_id uuid,
  p_year integer,
  p_month integer
)
returns table (
  employee_id uuid,
  working_days integer,
  present_days numeric,
  absent_days numeric,
  leave_days numeric,
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
    -- 092: distinct days, weighted day fractions
    (count(distinct ar.attendance_date) filter (
      where ar.attendance_status not in ('off_day', 'holiday')
    ))::integer as working_days,
    round(coalesce(sum(ar.day_weight) filter (
      where ar.attendance_status in ('present', 'late', 'partial')
    ), 0), 2) as present_days,
    round(coalesce(sum(ar.day_weight) filter (
      where ar.attendance_status = 'absent'
    ), 0), 2) as absent_days,
    round(coalesce(sum(ar.day_weight) filter (
      where ar.attendance_status = 'on_leave'
    ), 0), 2) as leave_days,
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
  from (
    select
      r.*,
      case
        when r.attendance_status in ('off_day', 'holiday') then 0::numeric
        else 1::numeric / nullif(
          count(*) filter (where r.attendance_status not in ('off_day', 'holiday'))
            over (partition by r.employee_id, r.attendance_date),
          0
        )
      end as day_weight
    from public.attendance_records r
    where r.organization_id = p_organization_id
      and r.attendance_date >= v_from
      and r.attendance_date <= v_to
  ) ar
  where (
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

-- 092: calculate_payroll_period, copied from 089 (latest body); only the attendance
-- aggregate is patched (look for "092:").

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
  v_period_calendar numeric(8, 2);
  v_full_period boolean;
  v_seg_calendar numeric(8, 2);
  v_unpaid_payable numeric;
  v_available numeric(14, 2);
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
  v_period_calendar := (v_period.period_end - v_period.period_start + 1)::numeric;

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

    v_full_period := (
      v_eligible_start = v_period.period_start
      and v_eligible_end = v_period.period_end
    );

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

      v_seg_calendar := (v_seg_end - v_seg_start + 1)::numeric;
      if v_full_period and v_period_calendar > 0 then
        -- Normalize full-period months onto standard_days (avoids ×31/30 and ×28/30).
        v_payable := v_std * v_seg_calendar / v_period_calendar;
      else
        v_payable := v_seg_calendar;
      end if;

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
    -- 092: count days, not rows. Each working-day row weighs 1 / (working shifts that
    -- day), so one absent half of a split day bills 0.5 day. Single-shift: unchanged.
    select
      coalesce(round(sum(ar.day_weight) filter (where ar.attendance_status in ('present', 'late', 'partial')), 2), 0),
      coalesce(round(sum(ar.day_weight) filter (where ar.attendance_status = 'absent'), 2), 0),
      coalesce(round(sum(ar.day_weight) filter (where ar.attendance_status = 'on_leave'), 2), 0),
      coalesce(sum(ar.late_minutes), 0),
      coalesce(sum(ar.early_leave_minutes), 0),
      coalesce(sum(ar.worked_minutes), 0),
      coalesce(count(*) filter (where ar.attendance_status = 'missing_checkout'), 0)
    into v_present, v_absent, v_leave_att, v_late, v_early, v_worked, v_missing
    from (
      select
        r.*,
        case
          when r.attendance_status in ('off_day', 'holiday') then 0::numeric
          else 1::numeric / nullif(
            count(*) filter (where r.attendance_status not in ('off_day', 'holiday'))
              over (partition by r.attendance_date),
            0
          )
        end as day_weight
      from public.attendance_records r
      where r.employee_id = v_emp.id
        and r.attendance_date between v_period.period_start and v_period.period_end
    ) ar;

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
    -- 089: reconcile_attendance_for_date (057) already marks approved-leave days
    -- on_leave, so absent days never overlap unpaid leave. Bill every absent day
    -- (was: absent - unpaid_leave, which let unpaid leave cancel real absences).
    v_absence_billable := greatest(0, coalesce(v_absent, 0));

    -- 089: express unpaid calendar days on the same basis as payable days. Full-period
    -- employees are paid on standard_payable_days (e.g. 30), so a whole unpaid month
    -- must equal exactly those days in 28/29/31-day months; never exceed payable days.
    if v_full_period and v_period_calendar > 0 then
      v_unpaid_payable := v_unpaid_leave * v_std / v_period_calendar;
    else
      v_unpaid_payable := v_unpaid_leave;
    end if;
    v_unpaid_payable := least(v_unpaid_payable, v_sum_payable);
    -- Unpaid leave covering every eligible day removes the whole period, even when the
    -- per-segment payable days (numeric(8,2)) do not sum to exactly standard days.
    if v_unpaid_leave >= (v_eligible_end - v_eligible_start + 1) then
      v_unpaid_payable := v_sum_payable;
    end if;

    -- 089: calculated deductions may only consume what is still available: recurring
    -- gross + kept manual earnings - kept manual deductions (calculated lines were
    -- deleted above, so every line still on the entry is manual).
    select v_gross_recurring
      + coalesce((select sum(e.amount) from public.payroll_earnings e where e.payroll_entry_id = v_entry.id), 0)
      - coalesce((select sum(d.amount) from public.payroll_deductions d where d.payroll_entry_id = v_entry.id), 0)
    into v_available;
    v_available := greatest(coalesce(v_available, 0), 0);

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

    if coalesce(v_settings.deduct_unpaid_leave, true) and v_unpaid_payable > 0 and v_sum_payable > 0 then
      -- 089: proportional to the recurring gross on the payable-days basis.
      if v_unpaid_payable >= v_sum_payable then
        v_deduct_amt := v_gross_recurring;
      else
        v_deduct_amt := round(v_gross_recurring * v_unpaid_payable / v_sum_payable, v_prec);
      end if;
      v_deduct_amt := least(v_deduct_amt, v_available);
      v_available := v_available - v_deduct_amt;
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
      v_deduct_amt := least(v_deduct_amt, v_available);
      v_available := v_available - v_deduct_amt;
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
      v_deduct_amt := least(v_deduct_amt, v_available);
      v_available := v_available - v_deduct_amt;
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
      'unpaid_leave_payable_days', round(v_unpaid_payable, 4),
      'deduction_rules', '089',
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
