-- Master Touch OS — 064
-- Phase 5.7.1: Multi-workplace attendance (explicit assignments, nearest valid site).
-- Additive. Does NOT modify migration 063. Do NOT apply until reviewed.
--
-- Authorization is explicit via employee_workplace_assignments only.
-- Org primary is NOT implicit punch authorization.
-- There is NO "all active workplaces" flag.
-- Client supplies lat/lng/accuracy only. Server matches nearest valid authorized site.
-- Check-out may be from any currently authorized workplace (not necessarily check-in site).
-- Deactivate workplaces; do not hard-delete history. Rejected attempts still COMMIT (jsonb, no RAISE).
-- Zero-arg attendance_check_in/out remain FAIL-CLOSED (GEOFENCE_LOCATION_REQUIRED).

-- ---------------------------------------------------------------------------
-- Preflight: existing rows must satisfy the new per-site exclusion.
-- ---------------------------------------------------------------------------
do $$
declare
  n int;
begin
  select count(*)::int into n
  from public.employee_workplace_assignments a
  join public.employee_workplace_assignments b
    on a.employee_id = b.employee_id
   and a.workplace_location_id = b.workplace_location_id
   and a.id < b.id
   and daterange(a.effective_from, coalesce(a.effective_to, 'infinity'::date), '[]')
    && daterange(b.effective_from, coalesce(b.effective_to, 'infinity'::date), '[]');
  if n > 0 then
    raise exception '064_PREFLIGHT_OVERLAP: % overlapping employee+workplace assignment pair(s). Resolve before applying 064.', n
      using errcode = 'P0001';
  end if;
end
$$;

alter table public.employee_workplace_assignments
  drop constraint if exists employee_workplace_assignments_no_overlap;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'employee_workplace_assignments_no_overlap_per_site'
  ) then
    alter table public.employee_workplace_assignments
      add constraint employee_workplace_assignments_no_overlap_per_site
      exclude using gist (
        employee_id with =,
        workplace_location_id with =,
        daterange(effective_from, coalesce(effective_to, 'infinity'::date), '[]') with &&
      );
  end if;
end
$$;

-- Historical workplace identity: do not SET NULL when a referenced workplace is deleted.
do $$
declare
  r record;
begin
  for r in
    select c.conname, c.conrelid::regclass as rel
    from pg_constraint c
    where c.contype = 'f'
      and c.confrelid = 'public.workplace_locations'::regclass
      and c.conrelid in ('public.attendance_location_attempts'::regclass, 'public.attendance_records'::regclass)
  loop
    execute format('alter table %s drop constraint if exists %I', r.rel, r.conname);
  end loop;

  alter table public.attendance_location_attempts
    add constraint attendance_location_attempts_workplace_fk
    foreign key (workplace_location_id)
    references public.workplace_locations (id)
    on delete restrict;

  alter table public.attendance_records
    add constraint attendance_records_check_in_workplace_fk
    foreign key (check_in_workplace_id)
    references public.workplace_locations (id)
    on delete restrict;

  alter table public.attendance_records
    add constraint attendance_records_check_out_workplace_fk
    foreign key (check_out_workplace_id)
    references public.workplace_locations (id)
    on delete restrict;
end
$$;

-- ---------------------------------------------------------------------------
-- Eligible workplaces: covering explicit assignments of ACTIVE sites. No primary fallback.
-- ---------------------------------------------------------------------------
create or replace function public.resolve_employee_workplaces(p_employee_id uuid)
returns setof public.workplace_locations
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_emp public.employees;
  v_today date := (timezone('Asia/Riyadh', now()))::date;
begin
  select * into v_emp from public.employees where id = p_employee_id;
  if v_emp.id is null then
    return;
  end if;

  return query
  select w.*
  from public.employee_workplace_assignments a
  join public.workplace_locations w on w.id = a.workplace_location_id
  where a.employee_id = p_employee_id
    and a.organization_id = v_emp.organization_id
    and w.organization_id = v_emp.organization_id
    and a.effective_from <= v_today
    and (a.effective_to is null or a.effective_to >= v_today)
    and w.is_active
  order by w.id;
end;
$$;

revoke all on function public.resolve_employee_workplaces(uuid) from public;
revoke all on function public.resolve_employee_workplaces(uuid) from anon;
revoke all on function public.resolve_employee_workplaces(uuid) from authenticated;

-- Legacy single-row helper: first eligible active assignment. NO org-primary fallback.
create or replace function public.resolve_employee_workplace(p_employee_id uuid)
returns public.workplace_locations
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_wp public.workplace_locations;
begin
  select * into v_wp
  from public.resolve_employee_workplaces(p_employee_id)
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
  v_today date := (timezone('Asia/Riyadh', now()))::date;
  v_wp public.workplace_locations;
  v_dist numeric;
  v_result text;
  v_reason text;
  v_coords_valid boolean;
  v_store_lat numeric;
  v_store_lng numeric;
  v_store_acc numeric;
  v_attempt_id uuid;
  v_assign_count int := 0;
  v_active_count int := 0;
  v_acc_ok boolean;
  v_in_range boolean;
  v_best_valid_id uuid;
  v_best_valid_dist numeric;
  v_best_inrange_id uuid;
  v_best_inrange_dist numeric;
  v_best_active_id uuid;
  v_best_active_dist numeric;
  v_chosen_id uuid;
begin
  v_coords_valid :=
    p_latitude is not null
    and p_longitude is not null
    and p_latitude = p_latitude
    and p_longitude = p_longitude
    and p_latitude >= -90 and p_latitude <= 90
    and p_longitude >= -180 and p_longitude <= 180;

  select count(*)::int into v_assign_count
  from public.employee_workplace_assignments a
  where a.employee_id = p_emp.id
    and a.organization_id = p_emp.organization_id
    and a.effective_from <= v_today
    and (a.effective_to is null or a.effective_to >= v_today);

  if not v_coords_valid then
    v_result := 'INVALID_LOCATION';
    v_reason := 'GEOFENCE_INVALID_LOCATION';
    v_store_lat := null;
    v_store_lng := null;
    v_store_acc := null;
    v_dist := null;
    v_chosen_id := null;
  elsif v_assign_count = 0 then
    v_result := 'NO_WORKPLACE';
    v_reason := 'GEOFENCE_NO_WORKPLACE';
    v_store_lat := p_latitude;
    v_store_lng := p_longitude;
    v_store_acc := p_accuracy_meters;
    v_dist := null;
    v_chosen_id := null;
  else
    for v_wp in
      select w.*
      from public.employee_workplace_assignments a
      join public.workplace_locations w on w.id = a.workplace_location_id
      where a.employee_id = p_emp.id
        and a.organization_id = p_emp.organization_id
        and w.organization_id = p_emp.organization_id
        and a.effective_from <= v_today
        and (a.effective_to is null or a.effective_to >= v_today)
        and w.is_active
    loop
      v_active_count := v_active_count + 1;
      v_dist := public.haversine_meters(p_latitude, p_longitude, v_wp.latitude, v_wp.longitude);
      v_in_range := v_dist <= v_wp.allowed_radius_meters;
      v_acc_ok :=
        v_wp.max_accuracy_meters is null
        or (
          p_accuracy_meters is not null
          and p_accuracy_meters = p_accuracy_meters
          and p_accuracy_meters >= 0
          and p_accuracy_meters <= v_wp.max_accuracy_meters
        );

      if v_best_active_dist is null
         or v_dist < v_best_active_dist
         or (v_dist = v_best_active_dist and v_wp.id < v_best_active_id) then
        v_best_active_dist := v_dist;
        v_best_active_id := v_wp.id;
      end if;

      if v_in_range then
        if v_best_inrange_dist is null
           or v_dist < v_best_inrange_dist
           or (v_dist = v_best_inrange_dist and v_wp.id < v_best_inrange_id) then
          v_best_inrange_dist := v_dist;
          v_best_inrange_id := v_wp.id;
        end if;
        if v_acc_ok then
          if v_best_valid_dist is null
             or v_dist < v_best_valid_dist
             or (v_dist = v_best_valid_dist and v_wp.id < v_best_valid_id) then
            v_best_valid_dist := v_dist;
            v_best_valid_id := v_wp.id;
          end if;
        end if;
      end if;
    end loop;

    if v_active_count = 0 then
      v_result := 'INACTIVE_WORKPLACE';
      v_reason := 'GEOFENCE_INACTIVE_WORKPLACE';
      v_chosen_id := null;
      v_dist := null;
    elsif v_best_valid_id is not null then
      v_result := 'ACCEPTED';
      v_reason := 'ACCEPTED';
      v_chosen_id := v_best_valid_id;
      v_dist := v_best_valid_dist;
    elsif v_best_inrange_id is not null then
      v_result := 'POOR_ACCURACY';
      v_reason := 'GEOFENCE_POOR_ACCURACY';
      v_chosen_id := v_best_inrange_id;
      v_dist := v_best_inrange_dist;
    else
      v_result := 'OUTSIDE_GEOFENCE';
      v_reason := 'GEOFENCE_OUTSIDE';
      v_chosen_id := v_best_active_id;
      v_dist := v_best_active_dist;
    end if;

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
    v_chosen_id,
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
  workplace_id := v_chosen_id;
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

comment on function public.resolve_employee_workplaces(uuid) is
  'Active workplaces covered by explicit employee_workplace_assignments for Riyadh today. No org-primary fallback.';

comment on function public.enforce_attendance_geofence(public.employees, text, numeric, numeric, numeric) is
  'Nearest authorized active workplace that passes per-site radius and accuracy. Rejects return jsonb via punch RPCs; attempt is inserted before return (no RAISE).';

comment on constraint employee_workplace_assignments_no_overlap_per_site on public.employee_workplace_assignments is
  'Overlapping date ranges are forbidden only for the same employee + same workplace. Different workplaces may overlap.';
