-- Master Touch OS — 076
-- Project-specific workflow step operational responsibility.
-- Does not change template workflow_steps, 073 approval gates, 074 deadlines, or can_act_on_workflow_step.
-- DO NOT APPLY TO PRODUCTION in the pre-UAT implementation phase.

alter table public.workflow_instance_steps
  add column if not exists responsible_user_id uuid references public.profiles (id) on delete set null;

create index if not exists workflow_instance_steps_responsible_idx
  on public.workflow_instance_steps (responsible_user_id, status);

create table if not exists public.project_workflow_step_assignments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  workflow_definition_id uuid not null references public.workflow_definitions (id) on delete cascade,
  workflow_version_id uuid not null references public.workflow_versions (id) on delete cascade,
  workflow_step_id uuid not null references public.workflow_steps (id) on delete cascade,
  responsible_user_id uuid not null references public.profiles (id) on delete restrict,
  created_by uuid not null references public.profiles (id),
  updated_by uuid not null references public.profiles (id),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (project_id, workflow_step_id)
);

create trigger project_workflow_step_assignments_set_updated_at
  before update on public.project_workflow_step_assignments
  for each row execute function public.set_updated_at();

create index if not exists project_workflow_step_assignments_project_idx
  on public.project_workflow_step_assignments (organization_id, project_id);

alter table public.project_workflow_step_assignments enable row level security;

create policy project_workflow_step_assignments_select on public.project_workflow_step_assignments
  for select to authenticated
  using (public.is_organization_member(organization_id));

create policy project_workflow_step_assignments_write on public.project_workflow_step_assignments
  for all to authenticated
  using (public.has_permission('workflow.manage', organization_id))
  with check (public.has_permission('workflow.manage', organization_id));

-- Carry pre-start project assignments onto instance steps. Keep template role/user/department.
create or replace function public.start_workflow(
  p_organization_id uuid,
  p_definition_id uuid,
  p_entity_type text,
  p_entity_id uuid
)
returns public.workflow_instances
language plpgsql
security definer
set search_path = public
as $$
declare
  v_version public.workflow_versions;
  v_instance public.workflow_instances;
  v_step record;
  v_first boolean := true;
  v_def_entity text;
  v_responsible uuid;
begin
  if not public.has_permission('workflow.start', p_organization_id) then
    raise exception 'FORBIDDEN';
  end if;

  select entity_type into v_def_entity
  from public.workflow_definitions
  where id = p_definition_id;

  if v_def_entity is null then
    raise exception 'NOT_FOUND';
  end if;

  if v_def_entity is distinct from p_entity_type then
    raise exception 'VALIDATION';
  end if;

  if exists (
    select 1
    from public.workflow_instances i
    where i.organization_id = p_organization_id
      and i.definition_id = p_definition_id
      and i.entity_type = p_entity_type
      and i.entity_id = p_entity_id
      and i.status in ('pending', 'in_progress')
  ) then
    raise exception 'CONFLICT';
  end if;

  select *
  into v_version
  from public.workflow_versions
  where definition_id = p_definition_id
    and status = 'published'
  order by version_number desc
  limit 1;

  if v_version.id is null then
    raise exception 'NOT_FOUND';
  end if;

  insert into public.workflow_instances (
    organization_id, definition_id, version_id, entity_type, entity_id, status, started_by
  ) values (
    p_organization_id, p_definition_id, v_version.id, p_entity_type, p_entity_id, 'in_progress', auth.uid()
  ) returning * into v_instance;

  for v_step in
    select *
    from public.workflow_steps
    where version_id = v_version.id
    order by sequence
  loop
    v_responsible := null;
    if p_entity_type = 'project' then
      select a.responsible_user_id
      into v_responsible
      from public.project_workflow_step_assignments a
      where a.organization_id = p_organization_id
        and a.project_id = p_entity_id
        and a.workflow_step_id = v_step.id;
    end if;

    insert into public.workflow_instance_steps (
      organization_id, instance_id, step_id, step_key, sequence, status,
      assigned_user_id, assigned_role_id, assigned_department_id, responsible_user_id,
      due_at, warning_at
    ) values (
      p_organization_id,
      v_instance.id,
      v_step.id,
      v_step.key,
      v_step.sequence,
      case when v_first then 'ready'::public.workflow_step_status else 'pending'::public.workflow_step_status end,
      v_step.assigned_user_id,
      v_step.assigned_role_id,
      v_step.assigned_department_id,
      v_responsible,
      case when v_first and v_step.sla_hours is not null
        then timezone('utc', now()) + make_interval(hours => v_step.sla_hours)
      end,
      case when v_first and v_step.warning_hours is not null
        then timezone('utc', now()) + make_interval(hours => v_step.warning_hours)
      end
    );
    v_first := false;
  end loop;

  perform public.log_audit(p_organization_id, 'workflow.started', 'workflow_instance', v_instance.id, null, to_jsonb(v_instance));
  perform public.emit_domain_event(p_organization_id, 'workflow.started', 'workflow_instance', v_instance.id, '{}'::jsonb);
  return v_instance;
end;
$$;

revoke all on function public.start_workflow(uuid, uuid, text, uuid)
  from public, anon, service_role;
grant execute on function public.start_workflow(uuid, uuid, text, uuid) to authenticated;

create or replace function public.assign_workflow_step_responsible(
  p_project_id uuid,
  p_workflow_step_id uuid,
  p_responsible_user_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project public.projects;
  v_step public.workflow_steps;
  v_version public.workflow_versions;
  v_instance_step public.workflow_instance_steps;
  v_previous uuid;
  v_assignment_id uuid;
  v_has_employee boolean;
  v_has_active_employee boolean;
begin
  select * into v_project
  from public.projects
  where id = p_project_id;

  if v_project.id is null then
    raise exception 'NOT_FOUND';
  end if;

  if not public.has_permission('workflow.manage', v_project.organization_id) then
    raise exception 'FORBIDDEN';
  end if;

  if not public.can_access_project(v_project.id) then
    raise exception 'FORBIDDEN';
  end if;

  select * into v_step
  from public.workflow_steps
  where id = p_workflow_step_id;

  if v_step.id is null then
    raise exception 'NOT_FOUND';
  end if;

  select * into v_version
  from public.workflow_versions
  where id = v_step.version_id;

  if v_version.id is null then
    raise exception 'NOT_FOUND';
  end if;

  if not exists (
    select 1
    from public.organization_members om
    join public.profiles pr on pr.id = om.profile_id
    where om.organization_id = v_project.organization_id
      and om.profile_id = p_responsible_user_id
      and om.status = 'active'
      and pr.is_active = true
  ) then
    raise exception 'VALIDATION';
  end if;

  select
    exists (
      select 1 from public.employees e
      where e.organization_id = v_project.organization_id
        and e.profile_id = p_responsible_user_id
    ),
    exists (
      select 1 from public.employees e
      where e.organization_id = v_project.organization_id
        and e.profile_id = p_responsible_user_id
        and e.is_active = true
    )
  into v_has_employee, v_has_active_employee;

  if v_has_employee and not v_has_active_employee then
    raise exception 'VALIDATION';
  end if;

  if v_project.project_manager_id is distinct from p_responsible_user_id
     and not exists (
       select 1
       from public.project_members m
       where m.project_id = v_project.id
         and m.organization_id = v_project.organization_id
         and m.profile_id = p_responsible_user_id
         and m.is_active = true
     )
  then
    raise exception 'VALIDATION';
  end if;

  select s.*
  into v_instance_step
  from public.workflow_instance_steps s
  join public.workflow_instances i on i.id = s.instance_id
  where i.organization_id = v_project.organization_id
    and i.entity_type = 'project'
    and i.entity_id = v_project.id
    and i.status in ('pending', 'in_progress')
    and s.step_id = v_step.id
  order by i.started_at desc
  limit 1;

  if v_instance_step.id is not null
     and v_instance_step.status in ('completed', 'skipped', 'rejected', 'cancelled') then
    raise exception 'CONFLICT';
  end if;

  v_previous := coalesce(v_instance_step.responsible_user_id, (
    select a.responsible_user_id
    from public.project_workflow_step_assignments a
    where a.project_id = v_project.id
      and a.workflow_step_id = v_step.id
  ));

  insert into public.project_workflow_step_assignments (
    organization_id, project_id, workflow_definition_id, workflow_version_id, workflow_step_id,
    responsible_user_id, created_by, updated_by
  ) values (
    v_project.organization_id, v_project.id, v_version.definition_id, v_version.id, v_step.id,
    p_responsible_user_id, auth.uid(), auth.uid()
  )
  on conflict (project_id, workflow_step_id)
  do update set
    responsible_user_id = excluded.responsible_user_id,
    updated_by = excluded.updated_by
  returning id into v_assignment_id;

  if v_instance_step.id is not null then
    update public.workflow_instance_steps
    set responsible_user_id = p_responsible_user_id
    where id = v_instance_step.id
      and status is not distinct from v_instance_step.status
      and assigned_role_id is not distinct from v_instance_step.assigned_role_id;
  end if;

  perform public.log_audit(
    v_project.organization_id,
    'workflow.step.assignee_changed',
    'workflow_step',
    v_step.id,
    jsonb_build_object(
      'project_id', v_project.id,
      'previous_responsible_user_id', v_previous
    ),
    jsonb_build_object(
      'project_id', v_project.id,
      'workflow_step_id', v_step.id,
      'instance_step_id', v_instance_step.id,
      'new_responsible_user_id', p_responsible_user_id,
      'previous_responsible_user_id', v_previous
    )
  );
  perform public.emit_domain_event(
    v_project.organization_id,
    'workflow.step.assignee_changed',
    'workflow_step',
    v_step.id,
    jsonb_build_object(
      'project_id', v_project.id,
      'previous_responsible_user_id', v_previous,
      'new_responsible_user_id', p_responsible_user_id
    )
  );

  return v_assignment_id;
end;
$$;

revoke all on function public.assign_workflow_step_responsible(uuid, uuid, uuid)
  from public, anon, service_role;
grant execute on function public.assign_workflow_step_responsible(uuid, uuid, uuid) to authenticated;
