-- Master Touch OS — 081
-- Stage 06 mobilization readiness checklist + completion gate.
-- Additive. Does not mutate workflow rows, POs, GRNs, or 073–080 files.

create table if not exists public.project_mobilization_readiness (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  project_id uuid not null unique references public.projects (id) on delete cascade,
  workflow_instance_step_id uuid not null unique references public.workflow_instance_steps (id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  created_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default timezone('utc', now()),
  updated_by uuid references public.profiles (id) on delete set null
);

create trigger project_mobilization_readiness_set_updated_at
  before update on public.project_mobilization_readiness
  for each row execute function public.set_updated_at();

create table if not exists public.project_mobilization_readiness_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  readiness_id uuid not null references public.project_mobilization_readiness (id) on delete cascade,
  item_key text not null,
  is_required boolean not null default true,
  is_confirmed boolean not null default false,
  confirmed_by uuid references public.profiles (id) on delete set null,
  confirmed_at timestamptz,
  note text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (readiness_id, item_key),
  check (item_key in (
    'site_ready',
    'site_access_ready',
    'execution_team_ready',
    'tools_equipment_ready',
    'safety_ppe_ready',
    'procurement_coordination_ready'
  )),
  check (note is null or char_length(note) <= 500)
);

create trigger project_mobilization_readiness_items_set_updated_at
  before update on public.project_mobilization_readiness_items
  for each row execute function public.set_updated_at();

create index if not exists project_mobilization_readiness_items_ready_idx
  on public.project_mobilization_readiness_items (readiness_id, is_confirmed);

alter table public.project_mobilization_readiness enable row level security;
alter table public.project_mobilization_readiness_items enable row level security;

drop policy if exists project_mobilization_readiness_select on public.project_mobilization_readiness;
create policy project_mobilization_readiness_select on public.project_mobilization_readiness
  for select to authenticated
  using (public.can_access_project(project_id));

drop policy if exists project_mobilization_readiness_items_select on public.project_mobilization_readiness_items;
create policy project_mobilization_readiness_items_select on public.project_mobilization_readiness_items
  for select to authenticated
  using (exists (
    select 1 from public.project_mobilization_readiness r
    where r.id = readiness_id and public.can_access_project(r.project_id)
  ));

grant select on public.project_mobilization_readiness to authenticated;
grant select on public.project_mobilization_readiness_items to authenticated;
revoke insert, update, delete on public.project_mobilization_readiness from authenticated, anon, public;
revoke insert, update, delete on public.project_mobilization_readiness_items from authenticated, anon, public;

create or replace function public.ensure_project_mobilization_readiness(p_project_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_org uuid;
  v_step uuid;
  v_id uuid;
begin
  if p_project_id is null then
    raise exception 'VALIDATION';
  end if;
  if v_uid is null then
    raise exception 'FORBIDDEN';
  end if;
  if not public.can_access_project(p_project_id) then
    raise exception 'FORBIDDEN';
  end if;

  select p.organization_id into v_org
  from public.projects p
  where p.id = p_project_id;
  if v_org is null then
    raise exception 'NOT_FOUND';
  end if;

  select s.id into v_step
  from public.workflow_instances i
  join public.workflow_instance_steps s on s.instance_id = i.id
  where i.entity_type = 'project'
    and i.entity_id = p_project_id
    and i.organization_id = v_org
    and i.status = 'in_progress'
    and s.step_key = 'mobilization'
    and s.status in ('ready', 'in_progress')
  order by s.started_at desc nulls last
  limit 1;

  if v_step is null then
    return null;
  end if;

  insert into public.project_mobilization_readiness (
    organization_id, project_id, workflow_instance_step_id, created_by, updated_by
  )
  values (v_org, p_project_id, v_step, v_uid, v_uid)
  on conflict (project_id) do nothing;

  select id into v_id
  from public.project_mobilization_readiness
  where project_id = p_project_id;

  insert into public.project_mobilization_readiness_items (
    organization_id, readiness_id, item_key, is_required
  )
  select v_org, v_id, k.item_key, true
  from (
    values
      ('site_ready'),
      ('site_access_ready'),
      ('execution_team_ready'),
      ('tools_equipment_ready'),
      ('safety_ppe_ready'),
      ('procurement_coordination_ready')
  ) as k(item_key)
  on conflict (readiness_id, item_key) do nothing;

  return v_id;
end;
$$;

revoke all on function public.ensure_project_mobilization_readiness(uuid)
  from public, anon, authenticated, service_role;

create or replace function public.project_has_mobilization_completion_package(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.project_mobilization_readiness r
    join public.workflow_instance_steps s on s.id = r.workflow_instance_step_id
    join public.workflow_instances i on i.id = s.instance_id
    where r.project_id = p_project_id
      and i.entity_type = 'project'
      and i.entity_id = p_project_id
      and i.status = 'in_progress'
      and s.step_key = 'mobilization'
      and s.status in ('ready', 'in_progress')
      and (
        select count(*)::int
        from public.project_mobilization_readiness_items it
        where it.readiness_id = r.id
          and it.is_required
          and it.is_confirmed
          and it.item_key in (
            'site_ready',
            'site_access_ready',
            'execution_team_ready',
            'tools_equipment_ready',
            'safety_ppe_ready',
            'procurement_coordination_ready'
          )
      ) = 6
  );
$$;

revoke all on function public.project_has_mobilization_completion_package(uuid)
  from public, anon, authenticated, service_role;

create or replace function public.get_project_mobilization_readiness(p_project_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_step uuid;
  v_required int := 0;
  v_confirmed int := 0;
  v_items jsonb := '[]'::jsonb;
begin
  if p_project_id is null then
    raise exception 'VALIDATION';
  end if;
  if not public.can_access_project(p_project_id) then
    raise exception 'FORBIDDEN';
  end if;

  v_id := public.ensure_project_mobilization_readiness(p_project_id);
  if v_id is null then
    return jsonb_build_object(
      'ready', false,
      'package_id', null,
      'workflow_instance_step_id', null,
      'required_count', 0,
      'confirmed_required_count', 0,
      'items', '[]'::jsonb
    );
  end if;

  select workflow_instance_step_id into v_step
  from public.project_mobilization_readiness
  where id = v_id;

  select
    count(*) filter (where is_required)::int,
    count(*) filter (where is_required and is_confirmed)::int,
    coalesce(jsonb_agg(
      jsonb_build_object(
        'item_key', it.item_key,
        'is_required', it.is_required,
        'is_confirmed', it.is_confirmed,
        'confirmed_by', it.confirmed_by,
        'confirmed_by_name', coalesce(p.full_name_ar, p.full_name_en),
        'confirmed_at', it.confirmed_at,
        'note', it.note
      )
      order by array_position(
        array[
          'site_ready',
          'site_access_ready',
          'execution_team_ready',
          'tools_equipment_ready',
          'safety_ppe_ready',
          'procurement_coordination_ready'
        ]::text[],
        it.item_key
      )
    ), '[]'::jsonb)
  into v_required, v_confirmed, v_items
  from public.project_mobilization_readiness_items it
  left join public.profiles p on p.id = it.confirmed_by
  where it.readiness_id = v_id;

  return jsonb_build_object(
    'ready', v_required = 6 and v_confirmed = 6,
    'package_id', v_id,
    'workflow_instance_step_id', v_step,
    'required_count', v_required,
    'confirmed_required_count', v_confirmed,
    'items', v_items
  );
end;
$$;

revoke all on function public.get_project_mobilization_readiness(uuid)
  from public, anon, service_role;
grant execute on function public.get_project_mobilization_readiness(uuid) to authenticated;

create or replace function public.set_project_mobilization_readiness_item(
  p_project_id uuid,
  p_item_key text,
  p_is_confirmed boolean,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
  v_step uuid;
  v_note text;
begin
  if p_project_id is null or p_item_key is null or p_is_confirmed is null then
    raise exception 'VALIDATION';
  end if;
  if p_item_key not in (
    'site_ready',
    'site_access_ready',
    'execution_team_ready',
    'tools_equipment_ready',
    'safety_ppe_ready',
    'procurement_coordination_ready'
  ) then
    raise exception 'VALIDATION';
  end if;
  if v_uid is null then
    raise exception 'FORBIDDEN';
  end if;
  if not public.can_access_project(p_project_id) then
    raise exception 'FORBIDDEN';
  end if;

  v_note := nullif(btrim(coalesce(p_note, '')), '');
  if v_note is not null and char_length(v_note) > 500 then
    raise exception 'VALIDATION';
  end if;

  v_id := public.ensure_project_mobilization_readiness(p_project_id);
  if v_id is null then
    raise exception 'NOT_FOUND';
  end if;

  select workflow_instance_step_id into v_step
  from public.project_mobilization_readiness
  where id = v_id;

  if not public.can_execute_workflow_instance_step(v_step) then
    raise exception 'FORBIDDEN';
  end if;

  if not exists (
    select 1
    from public.workflow_instance_steps s
    where s.id = v_step
      and s.step_key = 'mobilization'
      and s.status in ('ready', 'in_progress')
  ) then
    raise exception 'CONFLICT';
  end if;

  update public.project_mobilization_readiness_items
  set
    is_confirmed = p_is_confirmed,
    confirmed_by = case when p_is_confirmed then v_uid else null end,
    confirmed_at = case when p_is_confirmed then timezone('utc', now()) else null end,
    note = case when p_note is null then note else v_note end
  where readiness_id = v_id
    and item_key = p_item_key;

  if not found then
    raise exception 'NOT_FOUND';
  end if;

  update public.project_mobilization_readiness
  set updated_by = v_uid
  where id = v_id;

  perform public.log_audit(
    (select organization_id from public.projects where id = p_project_id),
    'workflow.mobilization.readiness_changed',
    'project_mobilization_readiness',
    v_id,
    null,
    jsonb_build_object(
      'project_id', p_project_id,
      'workflow_instance_step_id', v_step,
      'item_key', p_item_key,
      'confirmed', p_is_confirmed
    )
  );
  perform public.emit_domain_event(
    (select organization_id from public.projects where id = p_project_id),
    'workflow.mobilization.readiness_changed',
    'project_mobilization_readiness',
    v_id,
    jsonb_build_object(
      'project_id', p_project_id,
      'workflow_instance_step_id', v_step,
      'item_key', p_item_key,
      'confirmed', p_is_confirmed
    )
  );

  return public.get_project_mobilization_readiness(p_project_id);
end;
$$;

revoke all on function public.set_project_mobilization_readiness_item(uuid, text, boolean, text)
  from public, anon, service_role;
grant execute on function public.set_project_mobilization_readiness_item(uuid, text, boolean, text) to authenticated;

-- 080 apply_workflow_step_outcome plus mobilization complete predicate.
create or replace function public.apply_workflow_step_outcome(
  p_instance_step_id uuid,
  p_outcome text,
  p_source text
)
returns public.workflow_instance_steps
language plpgsql
security definer
set search_path = public
as $$
declare
  v_step public.workflow_instance_steps;
  v_def public.workflow_steps;
  v_instance public.workflow_instances;
  v_next public.workflow_instance_steps;
  v_target public.workflow_instance_steps;
  v_gate_ok boolean := false;
begin
  if p_outcome not in ('complete', 'reject', 'resubmit') then
    raise exception 'VALIDATION';
  end if;

  if p_source not in ('direct', 'approval_gate') then
    raise exception 'VALIDATION';
  end if;

  select * into v_step
  from public.workflow_instance_steps
  where id = p_instance_step_id
  for update;

  if v_step.id is null then
    raise exception 'NOT_FOUND';
  end if;

  select * into v_def from public.workflow_steps where id = v_step.step_id;

  if p_source = 'direct' then
    if not (
      (
        (
          public.has_permission('workflow.advance', v_step.organization_id)
          or public.has_permission('workflow.manage', v_step.organization_id)
        )
        and (
          public.has_permission('workflow.manage', v_step.organization_id)
          or public.can_act_on_workflow_step(p_instance_step_id)
        )
      )
      or public.can_execute_workflow_instance_step(p_instance_step_id)
    ) then
      raise exception 'FORBIDDEN';
    end if;

    if coalesce(v_def.requires_approval, false) then
      select exists (
        select 1
        from public.approval_requests r
        where r.organization_id = v_step.organization_id
          and r.entity_type = 'workflow_instance_step'
          and r.entity_id = v_step.id
          and r.status = 'completed'
          and r.official_code in ('A', 'B')
      ) into v_gate_ok;

      if not v_gate_ok then
        raise exception 'WORKFLOW_GATE_REQUIRED';
      end if;
    end if;
  end if;

  if v_step.status not in ('ready', 'in_progress') then
    raise exception 'CONFLICT';
  end if;

  select * into v_instance
  from public.workflow_instances
  where id = v_step.instance_id
  for update;

  if v_instance.status in ('completed', 'cancelled') then
    raise exception 'CONFLICT';
  end if;

  if p_source = 'direct'
     and p_outcome = 'complete'
     and v_step.step_key = 'procurement' then
    if v_instance.entity_type is distinct from 'project'
       or not public.project_has_procurement_completion_package(v_instance.entity_id) then
      raise exception 'WORKFLOW_PROCUREMENT_NOT_READY';
    end if;
  end if;

  if p_source = 'direct'
     and p_outcome = 'complete'
     and v_step.step_key = 'mobilization' then
    if v_instance.entity_type is distinct from 'project'
       or not public.project_has_mobilization_completion_package(v_instance.entity_id) then
      raise exception 'WORKFLOW_MOBILIZATION_NOT_READY';
    end if;
  end if;

  if p_outcome = 'reject' then
    update public.workflow_instance_steps
    set status = 'rejected', completed_at = timezone('utc', now()), completed_by = auth.uid()
    where id = v_step.id
    returning * into v_step;

    if v_def.on_reject_step_key is null then
      update public.workflow_instance_steps
      set status = 'cancelled'
      where instance_id = v_instance.id
        and id <> v_step.id
        and status in ('pending', 'ready', 'in_progress');

      update public.workflow_instances
      set status = 'cancelled', completed_at = timezone('utc', now())
      where id = v_instance.id;
    else
      select * into v_target
      from public.workflow_instance_steps
      where instance_id = v_instance.id and step_key = v_def.on_reject_step_key
      for update;

      if v_target.id is null then
        raise exception 'VALIDATION';
      end if;

      update public.workflow_instance_steps
      set status = 'ready', started_at = timezone('utc', now())
      where id = v_target.id;
    end if;
  elsif p_outcome = 'resubmit' then
    if v_def.on_resubmit_step_key is null then
      raise exception 'VALIDATION';
    end if;

    update public.workflow_instance_steps
    set status = 'completed', completed_at = timezone('utc', now()), completed_by = auth.uid()
    where id = v_step.id
    returning * into v_step;

    update public.workflow_instance_steps s
    set status = case when s.step_key = v_def.on_resubmit_step_key then 'ready'::public.workflow_step_status else 'pending'::public.workflow_step_status end,
        completed_at = null,
        completed_by = null
    where s.instance_id = v_instance.id
      and s.sequence >= (
        select sequence from public.workflow_instance_steps
        where instance_id = v_instance.id and step_key = v_def.on_resubmit_step_key
      )
      and s.sequence < v_step.sequence;
  else
    update public.workflow_instance_steps
    set status = 'completed', completed_at = timezone('utc', now()), completed_by = auth.uid()
    where id = v_step.id
      and status in ('ready', 'in_progress')
    returning * into v_step;

    if v_step.id is null then
      raise exception 'CONFLICT';
    end if;

    select * into v_next
    from public.workflow_instance_steps
    where instance_id = v_instance.id
      and status = 'pending'
    order by sequence
    limit 1;

    if v_next.id is null then
      update public.workflow_instances
      set status = 'completed', completed_at = timezone('utc', now())
      where id = v_instance.id;
    else
      update public.workflow_instance_steps
      set status = 'ready', started_at = timezone('utc', now())
      where id = v_next.id;
    end if;
  end if;

  perform public.log_audit(
    v_step.organization_id,
    'workflow.step.completed',
    'workflow_instance_step',
    v_step.id,
    null,
    jsonb_build_object(
      'outcome', p_outcome,
      'source', p_source,
      'automatic', (p_source = 'approval_gate')
    )
  );
  perform public.emit_domain_event(
    v_step.organization_id,
    'workflow.step.completed',
    'workflow_instance_step',
    v_step.id,
    jsonb_build_object(
      'outcome', p_outcome,
      'source', p_source,
      'automatic', (p_source = 'approval_gate')
    )
  );

  return v_step;
end;
$$;

revoke all on function public.apply_workflow_step_outcome(uuid, text, text)
  from public, anon, authenticated, service_role;
