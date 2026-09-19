-- Master Touch OS — phase4_fix_060.sql
-- Equivalent to migrations/060_phase4_payroll_payslip_rls_repair.sql
-- Run in Supabase SQL Editor AFTER 059. Do NOT re-run 001–059.
-- Additive only: repairs employee payslip RLS recursion.
-- Master Touch OS â€” 060
-- Phase 4.5: Payroll payslip RLS repair (employee view_self)
-- Additive only. Does not modify migrations 001â€“059.
--
-- Problem: payroll_entries_select and payroll_periods_select both
-- reference each other under RLS for the employee view_self path,
-- causing recursive policy evaluation that denies legitimate
-- locked/paid payslip reads.
--
-- Fix: security definer helpers bypass RLS for the existence checks
-- while still enforcing auth.uid(), org membership, permission, and
-- locked/paid status.

create or replace function public.payroll_period_visible_to_self(p_period_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.payroll_periods pp
    join public.payroll_entries pe on pe.payroll_period_id = pp.id
    join public.employees e on e.id = pe.employee_id
    where pp.id = p_period_id
      and e.profile_id = auth.uid()
      and pp.status in ('locked', 'paid')
      and public.is_organization_member(pp.organization_id)
      and (
        public.has_permission('payroll.view_self', pp.organization_id, 'organization', null)
        or public.is_platform_admin()
      )
  );
$$;

revoke all on function public.payroll_period_visible_to_self(uuid) from public, anon;
grant execute on function public.payroll_period_visible_to_self(uuid) to authenticated;

create or replace function public.payroll_entry_visible_to_self(p_entry_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.payroll_entries pe
    join public.payroll_periods pp on pp.id = pe.payroll_period_id
    join public.employees e on e.id = pe.employee_id
    where pe.id = p_entry_id
      and e.profile_id = auth.uid()
      and pp.status in ('locked', 'paid')
      and public.is_organization_member(pe.organization_id)
      and (
        public.has_permission('payroll.view_self', pe.organization_id, 'organization', null)
        or public.is_platform_admin()
      )
  );
$$;

revoke all on function public.payroll_entry_visible_to_self(uuid) from public, anon;
grant execute on function public.payroll_entry_visible_to_self(uuid) to authenticated;

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
      or public.payroll_period_visible_to_self(id)
    )
  );

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
      or public.payroll_entry_visible_to_self(id)
    )
  );

