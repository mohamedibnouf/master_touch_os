-- Master Touch OS — 080
-- Stage-key procurement completion predicate for workflow step `procurement`.
-- Additive. Does not mutate workflow rows, PRs, RFQs, POs, or 073–079.

-- Internal boolean used by apply_workflow_step_outcome. Not granted to clients.
create or replace function public.project_has_procurement_completion_package(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.purchase_orders po
    join public.supplier_quotations sq
      on sq.id = po.quotation_id
     and sq.project_id = po.project_id
    join public.quotation_comparisons qc
      on qc.rfq_id = sq.rfq_id
     and qc.project_id = po.project_id
     and qc.recommended_quotation_id = sq.id
     and qc.status = 'awarded'
    join public.rfqs rfq
      on rfq.id = sq.rfq_id
     and rfq.project_id = po.project_id
     and rfq.purchase_request_id is not null
    join public.purchase_requests pr
      on pr.id = rfq.purchase_request_id
     and pr.project_id = po.project_id
     and pr.status not in ('cancelled', 'rejected')
    where po.project_id = p_project_id
      and po.quotation_id is not null
      and po.required_delivery_date is not null
      and po.status in (
        'issued',
        'partially_delivered',
        'delivered',
        'partially_invoiced',
        'invoiced',
        'closed'
      )
      and rfq.status not in ('cancelled')
  );
$$;

revoke all on function public.project_has_procurement_completion_package(uuid)
  from public, anon, authenticated, service_role;

-- Counts only. No supplier names, amounts, or documents. Access: can_access_project.
create or replace function public.get_project_procurement_readiness(p_project_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_pr int := 0;
  v_rfq int := 0;
  v_quote int := 0;
  v_award int := 0;
  v_po int := 0;
  v_po_dated int := 0;
  v_docs int := 0;
  v_ready boolean := false;
begin
  if p_project_id is null then
    raise exception 'VALIDATION';
  end if;
  if not public.can_access_project(p_project_id) then
    raise exception 'FORBIDDEN';
  end if;

  select count(*)::int into v_pr
  from public.purchase_requests
  where project_id = p_project_id
    and status not in ('cancelled', 'rejected');

  select count(*)::int into v_rfq
  from public.rfqs
  where project_id = p_project_id
    and purchase_request_id is not null
    and status not in ('cancelled');

  select count(*)::int into v_quote
  from public.supplier_quotations
  where project_id = p_project_id;

  select count(*)::int into v_award
  from public.quotation_comparisons
  where project_id = p_project_id
    and status = 'awarded'
    and recommended_quotation_id is not null;

  select count(*)::int into v_po
  from public.purchase_orders
  where project_id = p_project_id
    and status in (
      'issued',
      'partially_delivered',
      'delivered',
      'partially_invoiced',
      'invoiced',
      'closed'
    );

  select count(*)::int into v_po_dated
  from public.purchase_orders po
  where po.project_id = p_project_id
    and po.required_delivery_date is not null
    and po.status in (
      'issued',
      'partially_delivered',
      'delivered',
      'partially_invoiced',
      'invoiced',
      'closed'
    );

  select count(*)::int into v_docs
  from public.entity_documents ed
  where ed.entity_type in ('purchase_request', 'rfq', 'supplier_quotation', 'purchase_order')
    and (
      (ed.entity_type = 'purchase_request' and exists (
        select 1 from public.purchase_requests pr
        where pr.id = ed.entity_id and pr.project_id = p_project_id
      ))
      or (ed.entity_type = 'rfq' and exists (
        select 1 from public.rfqs r
        where r.id = ed.entity_id and r.project_id = p_project_id
      ))
      or (ed.entity_type = 'supplier_quotation' and exists (
        select 1 from public.supplier_quotations q
        where q.id = ed.entity_id and q.project_id = p_project_id
      ))
      or (ed.entity_type = 'purchase_order' and exists (
        select 1 from public.purchase_orders p
        where p.id = ed.entity_id and p.project_id = p_project_id
      ))
    );

  v_ready := public.project_has_procurement_completion_package(p_project_id);

  return jsonb_build_object(
    'ready', v_ready,
    'purchase_request_count', v_pr,
    'rfq_count', v_rfq,
    'quotation_count', v_quote,
    'awarded_count', v_award,
    'issued_po_count', v_po,
    'issued_po_with_delivery_date_count', v_po_dated,
    'supporting_document_count', v_docs,
    'document_enforced', false,
    'document_policy', 'ui_advisory'
  );
end;
$$;

revoke all on function public.get_project_procurement_readiness(uuid)
  from public, anon, service_role;
grant execute on function public.get_project_procurement_readiness(uuid) to authenticated;

comment on function public.get_project_procurement_readiness(uuid) is
  'Project-scoped procurement readiness counts. Requires can_access_project. No supplier or amount fields.';

-- 077 apply_workflow_step_outcome plus procurement complete predicate on direct complete.
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
