-- Master Touch OS — 089
-- Payroll, leave and banking integrity fixes.
-- Additive and idempotent (create or replace / drop policy if exists). No tables or
-- columns are added or dropped. Does NOT modify 001–088 files; redefines objects created
-- there, each copied from its latest definition and patched minimally (look for "089:").
--
-- Safety:
--  * A/B. Payroll engine (calculate_payroll_period, recompute_payroll_entry_totals):
--    - unpaid-leave calendar days are normalised onto the payable-days basis
--      (standard_payable_days for full-period employees) and capped at payable days, so a
--      full unpaid 31-day month no longer yields negative net and a full unpaid February
--      no longer pays 2 days;
--    - the absence deduction bills every absent day (reconciliation already marks
--      approved-leave days on_leave, so subtracting unpaid leave cancelled real absences);
--    - calculated deductions are capped at what is left after kept manual lines, and
--      net_pay = max(0, earnings - deductions).
--    Existing periods are NOT recalculated by this migration. Draft/calculated periods
--    change only when someone runs "Calculate" again; locked/paid periods are immutable.
--  * C. approve_payroll_period requires reviewed_at/reviewed_by and a reviewer different
--    from the approver (PAYROLL_NOT_REVIEWED / PAYROLL_SELF_APPROVAL). An organisation
--    with a single person holding both payroll.review and payroll.approve can no longer
--    approve alone: a second user (e.g. general_manager or finance_officer) must review.
--  * D. add_payroll_manual_earning / add_payroll_manual_deduction clear a completed review
--    when the period is under_review (audited as payroll.review_reset); a manual deduction
--    larger than the entry's current net pay is rejected (PAYROLL_NET_NEGATIVE).
--    record_payroll_payment is unchanged: it already accepts a 0 payment when net_pay = 0,
--    which lets fully-unpaid entries be closed so the period can reach "paid".
--  * E. submit_leave_request checks minimum notice against the Riyadh date;
--    decide_leave_request rejects the requester deciding their own request
--    (LEAVE_SELF_DECISION), at any stage and for any role.
--  * F. get_employee_banking returns the full IBAN only to platform admins and holders of
--    employee_bank.read / employee_bank.manage / employee.manage; finance.read and
--    finance.manage callers get masked_iban only (iban = null). The employee_bank_accounts
--    select policy no longer admits finance.read / finance.manage (raw table reads by
--    operations/general managers). Bank-account writes are unchanged.
--  * G. employee_compensation_versions select policy drops finance.read; keeps
--    employee_compensation.read/manage, finance.manage, employee.manage, adds
--    payroll.view_all (payroll preparers/reviewers already see these amounts on payroll
--    entries) and the employee's own rows.
--  * Function signatures and return types are unchanged; grants are re-stated as before.
--  * No data is changed.

-- =============================================================================
-- A. Payroll: net pay never negative (latest body: 059)
-- =============================================================================

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
    gross_pay = v_earnings,
    -- 089: net pay never goes below zero (a 0 net entry is paid with a 0 payment).
    net_pay = greatest(v_earnings - v_deductions, 0),
    updated_at = timezone('utc', now())
  where id = p_entry_id
  returning * into v_entry;

  return v_entry;
end;
$$;

revoke all on function public.recompute_payroll_entry_totals(uuid) from public, anon, authenticated;

-- =============================================================================
-- B. Payroll engine: unpaid-leave basis, absence billing, deduction caps (latest body: 059)
-- =============================================================================

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

-- =============================================================================
-- C. Payroll maker-checker: approval requires review by another user (latest body: 059)
-- =============================================================================

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

  -- 089: maker-checker. Approval needs a completed review by a different user.
  if v_period.reviewed_at is null or v_period.reviewed_by is null then
    raise exception 'PAYROLL_NOT_REVIEWED' using errcode = 'P0001';
  end if;

  if v_period.reviewed_by = auth.uid() then
    raise exception 'PAYROLL_SELF_APPROVAL' using errcode = 'P0001';
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

-- =============================================================================
-- D. Manual adjustments reset a completed review; deductions cannot make net negative (059)
-- =============================================================================

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

  -- 089: an adjustment made after review invalidates that review (maker-checker).
  if v_period.status = 'under_review' and v_period.reviewed_at is not null then
    update public.payroll_periods set
      reviewed_at = null,
      reviewed_by = null,
      updated_at = timezone('utc', now())
    where id = v_period.id;

    perform public.log_audit(
      v_period.organization_id, 'payroll.review_reset', 'payroll_period', v_period.id,
      jsonb_build_object('reviewed_by', v_period.reviewed_by, 'reviewed_at', v_period.reviewed_at),
      jsonb_build_object('reason', 'manual_earning_added', 'entry_id', v_entry.id),
      null, null, null
    );
  end if;

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

  -- 089: a manual deduction may not push net pay below zero.
  if round(p_amount, 2) > greatest(coalesce(v_entry.net_pay, 0), 0) then
    raise exception 'PAYROLL_NET_NEGATIVE' using errcode = 'P0001';
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

  -- 089: an adjustment made after review invalidates that review (maker-checker).
  if v_period.status = 'under_review' and v_period.reviewed_at is not null then
    update public.payroll_periods set
      reviewed_at = null,
      reviewed_by = null,
      updated_at = timezone('utc', now())
    where id = v_period.id;

    perform public.log_audit(
      v_period.organization_id, 'payroll.review_reset', 'payroll_period', v_period.id,
      jsonb_build_object('reviewed_by', v_period.reviewed_by, 'reviewed_at', v_period.reviewed_at),
      jsonb_build_object('reason', 'manual_deduction_added', 'entry_id', v_entry.id),
      null, null, null
    );
  end if;

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

-- =============================================================================
-- E. Leave: Riyadh-date minimum notice; no self-decision (latest bodies: 056)
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
  -- 089: minimum notice is measured from today's date in Riyadh, not the UTC date.
  if p_start_date < ((timezone('Asia/Riyadh', now()))::date + v_notice) then
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

  -- 089: segregation of duties. Nobody approves or rejects their own request,
  -- including HR (leave.manage) and platform admins.
  if v_emp.profile_id = auth.uid() then
    raise exception 'LEAVE_SELF_DECISION' using errcode = 'P0001';
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

-- =============================================================================
-- F. Banking: full IBAN only for banking/HR permissions (latest body: 055)
-- =============================================================================

create or replace function public.get_employee_banking(
  p_employee_id uuid
)
returns table (
  id uuid,
  organization_id uuid,
  employee_id uuid,
  bank_name text,
  iban text,
  masked_iban text,
  account_name text,
  swift_code text,
  is_primary boolean,
  is_active boolean,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_emp public.employees;
  v_is_self boolean;
  v_can_manage boolean;
  v_can_read boolean;
  v_can_see_full boolean;
begin
  select * into v_emp from public.employees e where e.id = p_employee_id;
  if v_emp.id is null then
    return;
  end if;

  if not public.is_organization_member(v_emp.organization_id) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  v_is_self := (v_emp.profile_id = auth.uid());
  v_can_manage := public.has_permission('employee_bank.manage', v_emp.organization_id, 'organization', null)
               or public.has_permission('finance.manage', v_emp.organization_id, 'organization', null)
               or public.has_permission('employee.manage', v_emp.organization_id, 'organization', null);
  v_can_read := public.has_permission('employee_bank.read', v_emp.organization_id, 'organization', null)
             or public.has_permission('finance.read', v_emp.organization_id, 'organization', null);

  if not (public.is_platform_admin() or v_can_manage or v_can_read or v_is_self) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  -- 089: the full IBAN is limited to banking/HR permissions. finance.read and
  -- finance.manage (e.g. operations_manager, general_manager) get the masked IBAN only.
  v_can_see_full := public.is_platform_admin()
    or public.has_permission('employee_bank.read', v_emp.organization_id, 'organization', null)
    or public.has_permission('employee_bank.manage', v_emp.organization_id, 'organization', null)
    or public.has_permission('employee.manage', v_emp.organization_id, 'organization', null);

  return query
  select
    b.id,
    b.organization_id,
    b.employee_id,
    b.bank_name,
    case
      when v_can_see_full then b.iban
      else null::text
    end as iban,
    case
      when length(b.iban) >= 8 then
        substr(b.iban, 1, 4) || ' **** **** **** ' || substr(b.iban, length(b.iban) - 3, 4)
      else '****'
    end as masked_iban,
    b.account_name,
    b.swift_code,
    b.is_primary,
    b.is_active,
    b.created_at,
    b.updated_at
  from public.employee_bank_accounts b
  where b.employee_id = p_employee_id
    and b.organization_id = v_emp.organization_id
  order by b.is_primary desc, b.created_at desc;
end;
$$;

grant execute on function public.get_employee_banking(uuid) to authenticated;

-- =============================================================================
-- G. RLS: bank accounts and compensation versions (latest policies: 054)
-- =============================================================================

-- Raw bank rows (full IBAN): banking/HR permissions and the employee's own rows only.
drop policy if exists employee_bank_accounts_select on public.employee_bank_accounts;
create policy employee_bank_accounts_select on public.employee_bank_accounts
  for select to authenticated
  using (
    public.is_platform_admin()
    or (
      public.is_organization_member(employee_bank_accounts.organization_id)
      and (
        public.has_permission('employee_bank.read', employee_bank_accounts.organization_id, 'organization', null)
        or public.has_permission('employee_bank.manage', employee_bank_accounts.organization_id, 'organization', null)
        or public.has_permission('employee.manage', employee_bank_accounts.organization_id, 'organization', null)
        or exists (
          select 1 from public.employees e
          where e.id = employee_bank_accounts.employee_id
            and e.organization_id = employee_bank_accounts.organization_id
            and e.profile_id = auth.uid()
        )
      )
    )
  );

-- Compensation history: HR / compensation / payroll roles and the employee's own rows.
-- finance.read (operations_manager, general_manager, ...) no longer reads salaries here.
drop policy if exists employee_compensation_versions_select on public.employee_compensation_versions;
create policy employee_compensation_versions_select on public.employee_compensation_versions
  for select to authenticated
  using (
    public.is_platform_admin()
    or (
      public.is_organization_member(employee_compensation_versions.organization_id)
      and (
        public.has_permission('employee_compensation.read', employee_compensation_versions.organization_id, 'organization', null)
        or public.has_permission('employee_compensation.manage', employee_compensation_versions.organization_id, 'organization', null)
        or public.has_permission('finance.manage', employee_compensation_versions.organization_id, 'organization', null)
        or public.has_permission('employee.manage', employee_compensation_versions.organization_id, 'organization', null)
        or public.has_permission('payroll.view_all', employee_compensation_versions.organization_id, 'organization', null)
        or exists (
          select 1 from public.employees e
          where e.id = employee_compensation_versions.employee_id
            and e.organization_id = employee_compensation_versions.organization_id
            and e.profile_id = auth.uid()
        )
      )
    )
  );
