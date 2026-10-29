-- Master Touch OS — 090
-- Commercial integrity: status guards on procurement / finance RPCs, cumulative
-- three-way match, one active PO per awarded quotation.
-- Additive and idempotent (create or replace + guarded index). Apply BEFORE or
-- together with the matching app deploy; the app-side checks are a second line.
--
-- Each function below is the LATEST prior definition copied verbatim and patched
-- minimally (source noted per section):
--   approve_variation               050 F  → status gate + closes open approval requests
--   record_supplier_payment         046    → payable-status gate
--   evaluate_supplier_invoice_match 044    → org/permission check, past-review refusal,
--                                            cumulative per-PO invoice vs PO total and received value
--   issue_purchase_order            044    → only 'approved' (no draft bypass); permission checked first
--   post_goods_receipt              044    → draft-only (no double posting) + PO must be issued/partial
--   decide_entity_approval          049 F  → valuation branch guarded on internal_review;
--                                            variation reject/resubmit guarded on approvable status;
--                                            supplier invoice approve refuses rejected/cancelled/paid
--
-- Safety:
--  * No existing rows are updated or deleted by this migration.
--  * Function signatures, return types and grants are unchanged (create or replace keeps ACLs).
--  * The unique index on purchase_orders.quotation_id is created ONLY when no duplicate
--    active POs exist; otherwise a NOTICE lists the count and the index is skipped
--    (re-run 090 after resolving duplicates — see section D).
--  * New helper can_review_supplier_invoice() is read-only (stable, security definer).

-- =============================================================================
-- A. approve_variation (from 050 F) — approvable-status gate, close open requests
-- =============================================================================

create or replace function public.approve_variation(
  p_variation_id uuid,
  p_approved_amount numeric
)
returns public.variations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_vo public.variations;
  v_submitted numeric(18, 2);
  v_new_status public.variation_status;
begin
  select * into v_vo from public.variations where id = p_variation_id for update;
  if v_vo.id is null then raise exception 'NOT_FOUND'; end if;

  if not public.can_approve_variation(v_vo.project_id, v_vo.organization_id) then
    raise exception 'FORBIDDEN';
  end if;

  -- 090: a variation is decided once. Re-approving (direct form + approval request,
  -- or a resubmission) would add p_approved_amount to the budget a second time.
  if v_vo.status not in ('under_review', 'submitted', 'negotiation') then
    raise exception 'CONFLICT: variation is not awaiting approval'
      using errcode = 'P0001';
  end if;

  if p_approved_amount is null or p_approved_amount < 0 then raise exception 'VALIDATION'; end if;

  v_submitted := coalesce(nullif(v_vo.submitted_amount, 0), v_vo.cost_impact, 0);

  if p_approved_amount <= 0.001 then
    v_new_status := 'rejected';
  elsif p_approved_amount < v_submitted - 0.001 then
    v_new_status := 'partially_approved';
  else
    v_new_status := 'approved';
  end if;

  update public.variations
  set status = v_new_status,
      approved_amount = p_approved_amount,
      approval_date = (timezone('utc', now()))::date
  where id = p_variation_id
  returning * into v_vo;

  if v_new_status in ('approved', 'partially_approved') then
    update public.project_budgets
    set approved_variation_amount = approved_variation_amount + p_approved_amount,
        status = 'revised'
    where project_id = v_vo.project_id;
  end if;

  -- 090: the variation is now decided — close any still-open approval request for it
  -- (when called from decide_entity_approval that request is already completed).
  update public.approval_steps
  set status = 'cancelled'
  where status in ('pending', 'in_progress')
    and request_id in (
      select r.id
      from public.approval_requests r
      where r.organization_id = v_vo.organization_id
        and r.entity_type = 'variation'
        and r.entity_id = v_vo.id
        and r.status in ('pending', 'in_progress')
    );

  update public.approval_requests
  set status = 'cancelled',
      completed_at = timezone('utc', now())
  where organization_id = v_vo.organization_id
    and entity_type = 'variation'
    and entity_id = v_vo.id
    and status in ('pending', 'in_progress');

  perform public.log_audit(
    v_vo.organization_id,
    case v_new_status
      when 'partially_approved' then 'variation.partially_approved'
      when 'rejected' then 'variation.rejected'
      else 'variation.approved'
    end,
    'variation',
    v_vo.id,
    null,
    to_jsonb(v_vo)
  );
  perform public.emit_domain_event(
    v_vo.organization_id,
    case v_new_status
      when 'partially_approved' then 'variation.partially_approved'
      when 'rejected' then 'variation.rejected'
      else 'variation.approved'
    end,
    'variation',
    v_vo.id,
    jsonb_build_object(
      'approved_amount', p_approved_amount,
      'submitted_amount', v_submitted,
      'vo_number', v_vo.vo_number
    )
  );

  return v_vo;
end;
$$;

-- =============================================================================
-- B. record_supplier_payment (from 046) — only approved / partially paid invoices
-- =============================================================================

create or replace function public.record_supplier_payment(
  p_invoice_id uuid,
  p_amount numeric,
  p_payment_date date,
  p_payment_reference text,
  p_payment_method public.payment_method default 'bank_transfer',
  p_bank_reference text default null,
  p_notes text default null
)
returns public.supplier_payments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inv public.supplier_invoices;
  v_paid numeric(18, 2);
  v_outstanding numeric(18, 2);
  v_pay public.supplier_payments;
begin
  select * into v_inv
  from public.supplier_invoices
  where id = p_invoice_id
  for update;

  if v_inv.id is null then
    raise exception 'NOT_FOUND';
  end if;

  if not public.can_record_supplier_payment(v_inv.project_id, v_inv.organization_id) then
    raise exception 'FORBIDDEN';
  end if;

  -- 090: received / discrepancy / rejected / cancelled / paid invoices are not payable.
  if v_inv.status not in ('approved_for_payment', 'partially_paid') then
    raise exception 'SUPPLIER_INVOICE_NOT_PAYABLE: invoice must be approved for payment'
      using errcode = 'P0001';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'VALIDATION';
  end if;

  if p_payment_reference is null or length(trim(p_payment_reference)) = 0 then
    raise exception 'VALIDATION';
  end if;

  select coalesce(sum(amount), 0) into v_paid
  from public.supplier_payments
  where supplier_invoice_id = v_inv.id;

  v_outstanding := v_inv.total - v_paid;

  if p_amount > v_outstanding + 0.001 then
    raise exception 'SUPPLIER_PAYMENT_EXCEEDS_INVOICE: payment exceeds invoice outstanding amount'
      using errcode = 'P0001';
  end if;

  insert into public.supplier_payments (
    organization_id, project_id, supplier_id, supplier_invoice_id,
    payment_reference, amount, payment_date, payment_method,
    bank_reference, notes, recorded_by
  ) values (
    v_inv.organization_id, v_inv.project_id, v_inv.supplier_id, v_inv.id,
    p_payment_reference, p_amount, p_payment_date, p_payment_method,
    p_bank_reference, p_notes, auth.uid()
  ) returning * into v_pay;

  v_paid := v_paid + p_amount;

  update public.supplier_invoices
  set status = case
        when v_paid >= v_inv.total - 0.001 then 'paid'::public.supplier_invoice_status
        else 'partially_paid'::public.supplier_invoice_status
      end
  where id = v_inv.id;

  perform public.log_audit(
    v_inv.organization_id, 'supplier_payment.recorded', 'supplier_payment', v_pay.id,
    null, to_jsonb(v_pay)
  );
  perform public.emit_domain_event(
    v_inv.organization_id, 'supplier_payment.recorded', 'supplier_payment', v_pay.id,
    jsonb_build_object('amount', p_amount, 'invoice_id', v_inv.id)
  );

  return v_pay;
end;
$$;

-- =============================================================================
-- C. evaluate_supplier_invoice_match (from 044) — authz, past-review refusal,
--    cumulative per-PO comparison
-- =============================================================================

create or replace function public.can_review_supplier_invoice(p_project_id uuid, p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_organization_member(p_organization_id)
    and (
      public.has_permission('supplier_invoice.create', p_organization_id, 'organization', null)
      or public.has_permission('supplier_invoice.review', p_organization_id, 'organization', null)
      or public.has_permission('supplier_invoice.approve', p_organization_id, 'organization', null)
      or public.has_permission('finance.manage', p_organization_id, 'organization', null)
      or (
        public.can_access_project(p_project_id)
        and (
          public.has_permission('supplier_invoice.create', p_organization_id, 'project', p_project_id)
          or public.has_permission('supplier_invoice.review', p_organization_id, 'project', p_project_id)
          or public.has_permission('supplier_invoice.approve', p_organization_id, 'project', p_project_id)
          or public.has_permission('finance.manage', p_organization_id, 'project', p_project_id)
        )
      )
    );
$$;

revoke all on function public.can_review_supplier_invoice(uuid, uuid) from public, anon;
grant execute on function public.can_review_supplier_invoice(uuid, uuid) to authenticated;

create or replace function public.evaluate_supplier_invoice_match(p_invoice_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inv public.supplier_invoices;
  v_po public.purchase_orders;
  v_invoiced numeric(18, 2);
  v_ordered_value numeric(18, 4);
  v_received_value numeric(18, 4);
  v_ordered numeric(18, 4);
  v_received numeric(18, 4);
  v_received_gross numeric(18, 2);
  v_flags jsonb := '[]'::jsonb;
begin
  select * into v_inv from public.supplier_invoices where id = p_invoice_id for update;
  if v_inv.id is null then raise exception 'NOT_FOUND'; end if;

  -- 090: security definer + granted to authenticated → must check org and permission.
  if not public.can_review_supplier_invoice(v_inv.project_id, v_inv.organization_id) then
    raise exception 'FORBIDDEN';
  end if;

  -- 090: never re-open an approved / paid / rejected / cancelled invoice.
  if v_inv.status not in ('received', 'under_review', 'matched', 'discrepancy') then
    raise exception 'SUPPLIER_INVOICE_PAST_REVIEW: match can only be evaluated before approval'
      using errcode = 'P0001';
  end if;

  if v_inv.purchase_order_id is not null then
    select * into v_po
    from public.purchase_orders
    where id = v_inv.purchase_order_id
      and organization_id = v_inv.organization_id;

    -- 090: cumulative — all live invoices on this PO (this one included).
    select coalesce(sum(si.total), 0) into v_invoiced
    from public.supplier_invoices si
    where si.purchase_order_id = v_inv.purchase_order_id
      and si.status not in ('cancelled', 'rejected');

    if v_invoiced > coalesce(v_po.total, 0) + 0.01 then
      v_flags := v_flags || jsonb_build_array(jsonb_build_object(
        'code', 'invoice_gt_po', 'severity', 'high',
        'invoiced_total', v_invoiced, 'po_total', coalesce(v_po.total, 0)
      ));
    end if;

    select coalesce(sum(quantity * unit_price), 0),
           coalesce(sum(received_quantity * unit_price), 0),
           coalesce(sum(quantity), 0),
           coalesce(sum(received_quantity), 0)
      into v_ordered_value, v_received_value, v_ordered, v_received
    from public.purchase_order_items
    where purchase_order_id = v_inv.purchase_order_id;

    -- Received value in PO-total terms (keeps discount and VAT proportional).
    v_received_gross := round(
      coalesce(v_po.total, 0) * case
        when v_ordered_value > 0 then v_received_value / v_ordered_value
        when v_ordered > 0 then v_received / v_ordered
        else 0
      end,
      2
    );

    if v_invoiced > 0 and v_received_gross <= 0.01 then
      v_flags := v_flags || jsonb_build_array(jsonb_build_object(
        'code', 'invoice_without_receipt', 'severity', 'medium'
      ));
    elsif v_invoiced > v_received_gross + 0.01 then
      v_flags := v_flags || jsonb_build_array(jsonb_build_object(
        'code', 'invoice_exceeds_receipt', 'severity', 'medium',
        'invoiced_total', v_invoiced, 'received_value', v_received_gross
      ));
    end if;
  else
    v_flags := v_flags || jsonb_build_array(jsonb_build_object('code', 'missing_po', 'severity', 'medium'));
  end if;

  update public.supplier_invoices
  set match_flags = v_flags,
      status = case
        when jsonb_array_length(v_flags) > 0 then 'discrepancy'::public.supplier_invoice_status
        when status in ('received', 'discrepancy') then 'matched'::public.supplier_invoice_status
        else status
      end
  where id = p_invoice_id;

  if jsonb_array_length(v_flags) > 0 then
    perform public.emit_domain_event(
      v_inv.organization_id, 'supplier_invoice.discrepancy', 'supplier_invoice', p_invoice_id,
      jsonb_build_object('flags', v_flags)
    );
  end if;

  return v_flags;
end;
$$;

-- =============================================================================
-- D. One active purchase order per quotation
--    Partial unique index (cancelled POs release the quotation). Created only when
--    the existing data has no duplicates; otherwise skipped with a NOTICE so the
--    migration still applies. Find duplicates with:
--      select quotation_id, array_agg(po_number order by created_at), count(*)
--      from public.purchase_orders
--      where quotation_id is not null and status <> 'cancelled'
--      group by quotation_id having count(*) > 1;
--    Cancel the surplus POs (or detach them), then re-run 090.
-- =============================================================================

do $$
declare
  v_duplicates integer;
begin
  if exists (
    select 1 from pg_indexes
    where schemaname = 'public' and indexname = 'purchase_orders_quotation_active_uidx'
  ) then
    return;
  end if;

  select count(*) into v_duplicates
  from (
    select quotation_id
    from public.purchase_orders
    where quotation_id is not null and status <> 'cancelled'
    group by quotation_id
    having count(*) > 1
  ) d;

  if v_duplicates > 0 then
    raise notice '090: purchase_orders_quotation_active_uidx NOT created — % quotation(s) already have more than one active PO. Resolve them and re-run 090.', v_duplicates;
    return;
  end if;

  create unique index purchase_orders_quotation_active_uidx
    on public.purchase_orders (quotation_id)
    where quotation_id is not null and status <> 'cancelled';
end;
$$;

-- =============================================================================
-- E. issue_purchase_order (from 044) — approved only
--    Every active approval_threshold_rules row carries required_roles and the app
--    always routes a draft PO through submitPurchaseOrderForApprovalAction, so no
--    PO is legitimately issued from draft; the draft bypass is removed.
-- =============================================================================

create or replace function public.issue_purchase_order(p_po_id uuid)
returns public.purchase_orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_po public.purchase_orders;
  v_count integer;
begin
  select * into v_po from public.purchase_orders where id = p_po_id for update;
  if v_po.id is null then raise exception 'NOT_FOUND'; end if;
  if not public.has_project_permission('purchase_order.issue', v_po.project_id) then
    raise exception 'FORBIDDEN';
  end if;
  -- 090: draft POs must pass threshold approval first.
  if v_po.status <> 'approved' then
    raise exception 'CONFLICT: purchase order must be approved before issue'
      using errcode = 'P0001';
  end if;

  select count(*) into v_count from public.purchase_order_items where purchase_order_id = v_po.id;
  if v_count = 0 then raise exception 'VALIDATION'; end if;

  update public.purchase_order_items
  set ordered_quantity = quantity
  where purchase_order_id = v_po.id;

  update public.purchase_orders
  set status = 'issued',
      issue_date = (timezone('utc', now()))::date,
      issued_at = timezone('utc', now())
  where id = v_po.id
  returning * into v_po;

  perform public.log_audit(
    v_po.organization_id, 'purchase_order.issued', 'purchase_order', v_po.id, null, to_jsonb(v_po)
  );
  perform public.emit_domain_event(
    v_po.organization_id, 'purchase_order.issued', 'purchase_order', v_po.id,
    jsonb_build_object('po_number', v_po.po_number, 'total', v_po.total)
  );

  return v_po;
end;
$$;

-- =============================================================================
-- F. post_goods_receipt (from 044) — draft only, PO must be receivable
-- =============================================================================

create or replace function public.post_goods_receipt(p_receipt_id uuid)
returns public.goods_receipts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gr public.goods_receipts;
  r record;
  v_new_received numeric(18, 4);
  v_po_status public.purchase_order_status;
begin
  select * into v_gr from public.goods_receipts where id = p_receipt_id for update;
  if v_gr.id is null then raise exception 'NOT_FOUND'; end if;
  if not public.has_project_permission('goods_receipt.manage', v_gr.project_id)
     and not public.has_project_permission('goods_receipt.create', v_gr.project_id) then
    raise exception 'FORBIDDEN';
  end if;

  -- 090: posting twice would add the accepted quantities to the PO again.
  if v_gr.status <> 'draft' then
    raise exception 'GOODS_RECEIPT_ALREADY_POSTED: only a draft receipt can be posted'
      using errcode = 'P0001';
  end if;

  select status into v_po_status
  from public.purchase_orders
  where id = v_gr.purchase_order_id
  for update;
  if v_po_status is null or v_po_status not in ('issued', 'partially_delivered') then
    raise exception 'CONFLICT: purchase order is not open for receipt'
      using errcode = 'P0001';
  end if;

  for r in
    select * from public.goods_receipt_items where goods_receipt_id = p_receipt_id
  loop
    select received_quantity + r.accepted_quantity into v_new_received
    from public.purchase_order_items
    where id = r.purchase_order_item_id
    for update;

    if v_new_received > (
      select quantity from public.purchase_order_items where id = r.purchase_order_item_id
    ) + 0.0001 then
      raise exception 'VALIDATION: received quantity exceeds ordered'
        using errcode = 'P0001';
    end if;

    update public.purchase_order_items
    set received_quantity = received_quantity + r.accepted_quantity
    where id = r.purchase_order_item_id;
  end loop;

  update public.goods_receipts
  set status = 'accepted'
  where id = p_receipt_id
  returning * into v_gr;

  -- Update PO delivery status
  update public.purchase_orders po
  set status = case
    when exists (
      select 1 from public.purchase_order_items i
      where i.purchase_order_id = po.id and i.received_quantity < i.quantity
    ) then 'partially_delivered'::public.purchase_order_status
    else 'delivered'::public.purchase_order_status
  end
  where po.id = v_gr.purchase_order_id
    and po.status in ('issued', 'partially_delivered');

  perform public.emit_domain_event(
    v_gr.organization_id, 'goods_receipt.received', 'goods_receipt', v_gr.id,
    jsonb_build_object('receipt_number', v_gr.receipt_number)
  );

  return v_gr;
end;
$$;

-- =============================================================================
-- G. decide_entity_approval (from 049 F) — status guards on valuation / variation /
--    supplier invoice branches
-- =============================================================================

create or replace function public.decide_entity_approval(
  p_request_id uuid,
  p_step_id uuid default null,
  p_official_code text default 'A',
  p_comment text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.approval_requests;
  v_step public.approval_steps;
  v_action public.approval_actions;
  v_next public.approval_steps;
  v_pr public.purchase_requests;
  v_cmp public.quotation_comparisons;
  v_po public.purchase_orders;
  v_invoice public.supplier_invoices;
  v_valuation public.client_valuations;
  v_variation public.variations;
  v_now timestamptz := timezone('utc', now());
  v_today date := (timezone('utc', now()))::date;
  v_supported boolean := false;
begin
  select * into v_request
  from public.approval_requests
  where id = p_request_id
  for update;

  if v_request.id is null then
    raise exception 'NOT_FOUND';
  end if;

  if v_request.entity_type in (
    'purchase_request',
    'quotation_comparison',
    'quotation_recommendation',
    'purchase_order',
    'supplier_invoice',
    'client_valuation',
    'variation'
  ) then
    v_supported := true;
  end if;

  if not v_supported then
    raise exception 'NOT_SUPPORTED';
  end if;

  if p_official_code = 'E' then
    raise exception 'VALIDATION';
  end if;

  if p_step_id is not null then
    select * into v_step
    from public.approval_steps
    where id = p_step_id
      and request_id = p_request_id
    for update;

    if v_step.id is null then
      raise exception 'NOT_FOUND';
    end if;
  else
    select * into v_step
    from public.approval_steps
    where request_id = p_request_id
      and status in ('pending', 'in_progress')
      and public.can_act_on_approval_step(id)
    order by
      case when status = 'in_progress' then 0 else 1 end,
      sequence
    limit 1
    for update;

    if v_step.id is null then
      raise exception 'FORBIDDEN';
    end if;

    if exists (
      select 1
      from public.approval_steps s
      where s.request_id = p_request_id
        and s.id <> v_step.id
        and s.status in ('pending', 'in_progress')
        and public.can_act_on_approval_step(s.id)
    ) then
      raise exception 'AMBIGUOUS_STEP';
    end if;
  end if;

  v_action := public.submit_approval_decision(v_step.id, p_official_code, p_comment);

  select * into v_request
  from public.approval_requests
  where id = p_request_id;

  select * into v_next
  from public.approval_steps
  where request_id = p_request_id
    and status in ('pending', 'in_progress')
  order by sequence
  limit 1;

  if v_request.status = 'completed' then
    if v_request.entity_type = 'purchase_request' then
      select * into v_pr from public.purchase_requests where id = v_request.entity_id for update;
      if v_pr.id is null then raise exception 'NOT_FOUND'; end if;

      if v_request.official_outcome in ('approved', 'approved_as_noted') then
        update public.purchase_requests
        set status = 'approved',
            approved_at = v_now,
            rejected_at = null
        where id = v_pr.id
        returning * into v_pr;

        perform public.log_audit(v_pr.organization_id, 'purchase_request.approved', 'purchase_request', v_pr.id, null, to_jsonb(v_pr));
        perform public.emit_domain_event(
          v_pr.organization_id,
          'purchase_request.approved',
          'purchase_request',
          v_pr.id,
          jsonb_build_object('pr_number', v_pr.pr_number)
        );
      elsif v_request.official_outcome = 'rejected' then
        update public.purchase_requests
        set status = 'rejected',
            approved_at = null,
            rejected_at = v_now
        where id = v_pr.id
        returning * into v_pr;

        perform public.log_audit(v_pr.organization_id, 'purchase_request.rejected', 'purchase_request', v_pr.id, null, to_jsonb(v_pr));
        perform public.emit_domain_event(
          v_pr.organization_id,
          'purchase_request.rejected',
          'purchase_request',
          v_pr.id,
          jsonb_build_object('pr_number', v_pr.pr_number)
        );
      elsif v_request.official_outcome = 'resubmit' then
        update public.purchase_requests
        set status = 'draft',
            approved_at = null,
            rejected_at = null
        where id = v_pr.id
        returning * into v_pr;

        perform public.log_audit(v_pr.organization_id, 'purchase_request.resubmitted', 'purchase_request', v_pr.id, null, to_jsonb(v_pr));
        perform public.emit_domain_event(
          v_pr.organization_id,
          'purchase_request.resubmitted',
          'purchase_request',
          v_pr.id,
          jsonb_build_object('pr_number', v_pr.pr_number)
        );
      end if;
    elsif v_request.entity_type in ('quotation_comparison', 'quotation_recommendation') then
      select * into v_cmp from public.quotation_comparisons where id = v_request.entity_id for update;
      if v_cmp.id is null then raise exception 'NOT_FOUND'; end if;

      if v_request.official_outcome in ('approved', 'approved_as_noted') then
        update public.quotation_comparisons
        set status = 'awarded'
        where id = v_cmp.id
        returning * into v_cmp;

        update public.rfqs
        set status = 'awarded'
        where id = v_cmp.rfq_id;

        if v_cmp.recommended_quotation_id is not null then
          update public.supplier_quotations
          set status = 'accepted'
          where id = v_cmp.recommended_quotation_id;
        end if;

        perform public.log_audit(v_cmp.organization_id, 'quotation.award_approved', 'quotation_comparison', v_cmp.id, null, to_jsonb(v_cmp));
        perform public.emit_domain_event(
          v_cmp.organization_id,
          'quotation.award_approved',
          'quotation_comparison',
          v_cmp.id,
          jsonb_build_object('rfq_id', v_cmp.rfq_id, 'quotation_id', v_cmp.recommended_quotation_id)
        );
      elsif v_request.official_outcome = 'rejected' then
        update public.quotation_comparisons
        set status = 'cancelled'
        where id = v_cmp.id
        returning * into v_cmp;

        update public.rfqs
        set status = 'under_comparison'
        where id = v_cmp.rfq_id;

        perform public.log_audit(v_cmp.organization_id, 'quotation.award_rejected', 'quotation_comparison', v_cmp.id, null, to_jsonb(v_cmp));
        perform public.emit_domain_event(
          v_cmp.organization_id,
          'quotation.award_rejected',
          'quotation_comparison',
          v_cmp.id,
          jsonb_build_object('rfq_id', v_cmp.rfq_id)
        );
      elsif v_request.official_outcome = 'resubmit' then
        update public.quotation_comparisons
        set status = 'recommended'
        where id = v_cmp.id
        returning * into v_cmp;

        update public.rfqs
        set status = 'under_comparison'
        where id = v_cmp.rfq_id;

        perform public.log_audit(v_cmp.organization_id, 'quotation.award_resubmitted', 'quotation_comparison', v_cmp.id, null, to_jsonb(v_cmp));
        perform public.emit_domain_event(
          v_cmp.organization_id,
          'quotation.award_resubmitted',
          'quotation_comparison',
          v_cmp.id,
          jsonb_build_object('rfq_id', v_cmp.rfq_id)
        );
      end if;
    elsif v_request.entity_type = 'purchase_order' then
      select * into v_po from public.purchase_orders where id = v_request.entity_id for update;
      if v_po.id is null then raise exception 'NOT_FOUND'; end if;

      if v_request.official_outcome in ('approved', 'approved_as_noted') then
        update public.purchase_orders
        set status = 'approved',
            approved_by = auth.uid()
        where id = v_po.id
        returning * into v_po;

        perform public.log_audit(v_po.organization_id, 'purchase_order.approved', 'purchase_order', v_po.id, null, to_jsonb(v_po));
        perform public.emit_domain_event(
          v_po.organization_id,
          'purchase_order.approved',
          'purchase_order',
          v_po.id,
          jsonb_build_object('po_number', v_po.po_number)
        );
      elsif v_request.official_outcome = 'rejected' then
        update public.purchase_orders
        set status = 'cancelled'
        where id = v_po.id
        returning * into v_po;

        perform public.log_audit(v_po.organization_id, 'purchase_order.rejected', 'purchase_order', v_po.id, null, to_jsonb(v_po));
        perform public.emit_domain_event(
          v_po.organization_id,
          'purchase_order.rejected',
          'purchase_order',
          v_po.id,
          jsonb_build_object('po_number', v_po.po_number)
        );
      elsif v_request.official_outcome = 'resubmit' then
        update public.purchase_orders
        set status = 'draft'
        where id = v_po.id
        returning * into v_po;

        perform public.log_audit(v_po.organization_id, 'purchase_order.resubmitted', 'purchase_order', v_po.id, null, to_jsonb(v_po));
        perform public.emit_domain_event(
          v_po.organization_id,
          'purchase_order.resubmitted',
          'purchase_order',
          v_po.id,
          jsonb_build_object('po_number', v_po.po_number)
        );
      end if;
    elsif v_request.entity_type = 'supplier_invoice' then
      select * into v_invoice from public.supplier_invoices where id = v_request.entity_id for update;
      if v_invoice.id is null then raise exception 'NOT_FOUND'; end if;
      -- 090: only invoices still under review can be decided.
      if v_invoice.status not in ('received', 'under_review', 'matched', 'discrepancy') then
        raise exception 'CONFLICT: supplier invoice is not awaiting review'
          using errcode = 'P0001';
      end if;
      if v_request.official_outcome in ('approved', 'approved_as_noted') then
        update public.supplier_invoices set status = 'approved_for_payment', reviewed_by = auth.uid() where id = v_invoice.id returning * into v_invoice;
        perform public.log_audit(v_invoice.organization_id, 'supplier_invoice.approved_for_payment', 'supplier_invoice', v_invoice.id, null, to_jsonb(v_invoice));
        perform public.emit_domain_event(v_invoice.organization_id, 'supplier_invoice.approved_for_payment', 'supplier_invoice', v_invoice.id, jsonb_build_object('invoice_number', v_invoice.invoice_number));
      elsif v_request.official_outcome = 'rejected' then
        update public.supplier_invoices set status = 'rejected', reviewed_by = auth.uid() where id = v_invoice.id returning * into v_invoice;
        perform public.log_audit(v_invoice.organization_id, 'supplier_invoice.rejected', 'supplier_invoice', v_invoice.id, null, to_jsonb(v_invoice));
        perform public.emit_domain_event(v_invoice.organization_id, 'supplier_invoice.rejected', 'supplier_invoice', v_invoice.id, jsonb_build_object('invoice_number', v_invoice.invoice_number));
      elsif v_request.official_outcome = 'resubmit' then
        update public.supplier_invoices set status = 'under_review', reviewed_by = auth.uid() where id = v_invoice.id returning * into v_invoice;
        perform public.log_audit(v_invoice.organization_id, 'supplier_invoice.resubmitted', 'supplier_invoice', v_invoice.id, null, to_jsonb(v_invoice));
        perform public.emit_domain_event(v_invoice.organization_id, 'supplier_invoice.resubmitted', 'supplier_invoice', v_invoice.id, jsonb_build_object('invoice_number', v_invoice.invoice_number));
      end if;
    elsif v_request.entity_type = 'client_valuation' then
      select * into v_valuation from public.client_valuations where id = v_request.entity_id for update;
      if v_valuation.id is null then raise exception 'NOT_FOUND'; end if;

      -- 090: an internal decision applies only to a valuation in internal review;
      -- otherwise a stale request could roll a certified valuation back to submitted.
      if v_valuation.status <> 'internal_review' then
        raise exception 'CONFLICT: valuation is not in internal review'
          using errcode = 'P0001';
      end if;

      -- Internal approval only — does NOT certify with client
      if v_request.official_outcome in ('approved', 'approved_as_noted') then
        update public.client_valuations
        set status = 'submitted',
            submitted_date = coalesce(submitted_date, v_today)
        where id = v_valuation.id
        returning * into v_valuation;

        perform public.log_audit(v_valuation.organization_id, 'client_valuation.internal_approved', 'client_valuation', v_valuation.id, null, to_jsonb(v_valuation));
        perform public.emit_domain_event(
          v_valuation.organization_id, 'client_valuation.submitted', 'client_valuation', v_valuation.id,
          jsonb_build_object('valuation_number', v_valuation.valuation_number, 'total_claim', v_valuation.total_claim)
        );
      elsif v_request.official_outcome = 'rejected' then
        update public.client_valuations set status = 'rejected' where id = v_valuation.id returning * into v_valuation;
        perform public.log_audit(v_valuation.organization_id, 'client_valuation.rejected', 'client_valuation', v_valuation.id, null, to_jsonb(v_valuation));
        perform public.emit_domain_event(v_valuation.organization_id, 'client_valuation.rejected', 'client_valuation', v_valuation.id, jsonb_build_object('valuation_number', v_valuation.valuation_number));
      elsif v_request.official_outcome = 'resubmit' then
        update public.client_valuations set status = 'internal_review' where id = v_valuation.id returning * into v_valuation;
        perform public.log_audit(v_valuation.organization_id, 'client_valuation.resubmitted', 'client_valuation', v_valuation.id, null, to_jsonb(v_valuation));
        perform public.emit_domain_event(v_valuation.organization_id, 'client_valuation.resubmitted', 'client_valuation', v_valuation.id, jsonb_build_object('valuation_number', v_valuation.valuation_number));
      end if;
    elsif v_request.entity_type = 'variation' then
      select * into v_variation from public.variations where id = v_request.entity_id for update;
      if v_variation.id is null then raise exception 'NOT_FOUND'; end if;

      -- 090: approve_variation enforces this for approvals; reject / resubmit must not
      -- overwrite a variation that was already decided (its budget effect would remain).
      if v_variation.status not in ('under_review', 'submitted', 'negotiation') then
        raise exception 'CONFLICT: variation is not awaiting approval'
          using errcode = 'P0001';
      end if;

      if v_request.official_outcome in ('approved', 'approved_as_noted') then
        v_variation := public.approve_variation(
          v_variation.id,
          coalesce(v_variation.submitted_amount, v_variation.cost_impact, 0)
        );
      elsif v_request.official_outcome = 'rejected' then
        update public.variations set status = 'rejected' where id = v_variation.id returning * into v_variation;
        perform public.log_audit(v_variation.organization_id, 'variation.rejected', 'variation', v_variation.id, null, to_jsonb(v_variation));
        perform public.emit_domain_event(v_variation.organization_id, 'variation.rejected', 'variation', v_variation.id, jsonb_build_object('vo_number', v_variation.vo_number));
      elsif v_request.official_outcome = 'resubmit' then
        update public.variations set status = 'under_review' where id = v_variation.id returning * into v_variation;
        perform public.log_audit(v_variation.organization_id, 'variation.resubmitted', 'variation', v_variation.id, null, to_jsonb(v_variation));
        perform public.emit_domain_event(v_variation.organization_id, 'variation.resubmitted', 'variation', v_variation.id, jsonb_build_object('vo_number', v_variation.vo_number));
      end if;
    end if;
  end if;

  return jsonb_build_object(
    'request_id', v_request.id,
    'step_id', v_step.id,
    'entity_type', v_request.entity_type,
    'entity_id', v_request.entity_id,
    'request_status', v_request.status,
    'official_outcome', v_request.official_outcome,
    'official_code', v_request.official_code,
    'next_step_id', v_next.id,
    'next_step_user_id', v_next.user_id
  );
end;
$$;

comment on function public.approve_variation(uuid, numeric) is
  '090: decides a variation once (status under_review/submitted/negotiation only); adds the approved amount to the budget and cancels any open approval request for the variation.';

comment on function public.record_supplier_payment(uuid, numeric, date, text, public.payment_method, text, text) is
  '090: records a supplier payment only for approved_for_payment / partially_paid invoices, with invoice row lock (FOR UPDATE) against concurrent overpayment.';

comment on function public.evaluate_supplier_invoice_match(uuid) is
  '090: org/permission-checked three-way match; refuses invoices past review; compares cumulative live invoices on the PO against PO total and received value.';

comment on function public.issue_purchase_order(uuid) is
  '090: issues only approved purchase orders.';

comment on function public.post_goods_receipt(uuid) is
  '090: posts a draft goods receipt once against an issued / partially delivered PO.';
