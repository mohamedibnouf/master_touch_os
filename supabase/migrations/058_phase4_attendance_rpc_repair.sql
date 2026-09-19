-- Master Touch OS — 058
-- Phase 4.4 repair: nested composite field access in attendance check-in/out
-- Additive CREATE OR REPLACE only. Does not modify migration 057.
--
-- Root cause (42P01): PostgreSQL parses expressions like v_ctx.shift.id as
-- table "shift" + column "id" (missing FROM-clause), instead of nested
-- composite field access. Correct form is (v_ctx.shift).id, or unpack into
-- typed locals (preferred below).

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

  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;

  -- Unpack nested composites to avoid 42P01 on v_ctx.shift.* / v_ctx.policy.*
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
    return v_rec;
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
      'attendance_date', v_attendance_date,
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
    return v_rec;
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
