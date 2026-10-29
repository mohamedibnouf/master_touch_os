-- Master Touch OS — 087
-- Security hardening: HR document isolation, profile self-update guard, tenant checks
-- on two security definer helpers.
-- Additive and idempotent (drop policy if exists / create or replace / if not exists).
-- Does NOT modify 001–086 files; redefines objects created there.
--
-- Safety:
--  * A. 053's documents_select_hr / document_versions_select_hr compared employee_documents
--    columns with themselves (`ed.document_id = document_id` is always true → cross-tenant
--    read of document_versions; `ed.document_id = id` bound to ed.id). Recreated with fully
--    qualified columns.
--  * B. HR identity documents (rows linked from employee_documents, and storage objects under
--    `<org>/hr/...`) are removed from the generic document.read policies and gated on
--    can_access_employee_document_row() (053) only — the same rules the HR screens and the
--    employee's own document view already use. Generic (project/org) documents are unchanged.
--    A document is only treated as HR once its employee_documents link exists, so the HR
--    upload flow (insert document → upload → insert version → insert link) keeps working.
--  * C. profiles: a signed-in user can no longer change is_active (or id / created_at) on
--    their own row. Locale, names, phone and WhatsApp opt-in (072 trigger) are unchanged.
--    Account activation now runs server-side with the service role after permission checks.
--  * D. compute_project_health() and employee_has_approved_leave_on() were security definer
--    and executable by any authenticated user for any tenant. They now require project access
--    / organization membership (service_role and direct DB sessions stay trusted).
--  * No data is changed. No table privileges are widened.

-- =============================================================================
-- 0. Trusted backend session helper (same semantics as 066 document_lifecycle_trusted_session)
-- =============================================================================

create or replace function public.security_trusted_session()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce(auth.role(), '') = 'service_role'
    or (
      current_user in ('postgres', 'supabase_admin')
      and coalesce(auth.role(), '') not in ('authenticated', 'anon')
    );
$$;

revoke all on function public.security_trusted_session() from public, anon, authenticated;

-- =============================================================================
-- A + B. HR document helpers
-- =============================================================================

create index if not exists employee_documents_document_idx
  on public.employee_documents (document_id);

create index if not exists document_versions_file_path_idx
  on public.document_versions (file_path);

-- True when the document is linked to an employee file (HR document). Bypasses RLS on
-- employee_documents on purpose: generic policies must exclude HR docs even for users who
-- cannot see the link row.
create or replace function public.is_hr_employee_document(p_document_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.employee_documents ed
    where ed.document_id = p_document_id
  );
$$;

revoke all on function public.is_hr_employee_document(uuid) from public, anon;
grant execute on function public.is_hr_employee_document(uuid) to authenticated, service_role;

-- True when the caller may read the HR document (053 can_access_employee_document_row).
create or replace function public.can_access_hr_document(p_document_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.employee_documents ed
    where ed.document_id = p_document_id
      and public.can_access_employee_document_row(
        ed.employee_id, ed.organization_id, ed.category, ed.visibility_scope
      )
  );
$$;

revoke all on function public.can_access_hr_document(uuid) from public, anon;
grant execute on function public.can_access_hr_document(uuid) to authenticated, service_role;

-- True when the storage object `<org>/hr/...` is a version file of an HR document the
-- caller may read. Objects without a version row (orphans) are not readable via RLS.
create or replace function public.can_access_hr_storage_object(p_object_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.document_versions dv
    join public.employee_documents ed
      on ed.document_id = dv.document_id
     and ed.organization_id = dv.organization_id
    where dv.file_path = p_object_name
      and dv.organization_id::text = split_part(p_object_name, '/', 1)
      and public.can_access_employee_document_row(
        ed.employee_id, ed.organization_id, ed.category, ed.visibility_scope
      )
  );
$$;

revoke all on function public.can_access_hr_storage_object(text) from public, anon;
grant execute on function public.can_access_hr_storage_object(text) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- A. Fix the mis-bound 053 HR policies.
-- -----------------------------------------------------------------------------

drop policy if exists documents_select_hr on public.documents;
create policy documents_select_hr on public.documents
  for select to authenticated
  using (
    exists (
      select 1 from public.employee_documents ed
      where ed.document_id = documents.id
        and ed.organization_id = documents.organization_id
        and public.can_access_employee_document_row(ed.employee_id, ed.organization_id, ed.category, ed.visibility_scope)
    )
  );

drop policy if exists document_versions_select_hr on public.document_versions;
create policy document_versions_select_hr on public.document_versions
  for select to authenticated
  using (
    exists (
      select 1 from public.employee_documents ed
      where ed.document_id = document_versions.document_id
        and ed.organization_id = document_versions.organization_id
        and public.can_access_employee_document_row(ed.employee_id, ed.organization_id, ed.category, ed.visibility_scope)
    )
  );

-- -----------------------------------------------------------------------------
-- B. Generic document policies exclude HR documents.
-- -----------------------------------------------------------------------------

-- 010 documents_select + HR exclusion.
drop policy if exists documents_select on public.documents;
create policy documents_select on public.documents
  for select to authenticated
  using (
    (
      public.has_permission('document.read', organization_id)
      or (project_id is not null and public.can_access_project(project_id))
    )
    and not public.is_hr_employee_document(documents.id)
  );

-- 065 document_versions_select (latest) + HR exclusion.
drop policy if exists document_versions_select on public.document_versions;
create policy document_versions_select on public.document_versions
  for select to authenticated
  using (
    (
      public.has_permission('document.read', organization_id)
      or exists (
        select 1
        from public.documents d
        where d.id = document_versions.document_id
          and d.organization_id = document_versions.organization_id
          and d.project_id is not null
          and public.can_access_project(d.project_id)
      )
    )
    and not public.is_hr_employee_document(document_versions.document_id)
  );

-- 012 documents_storage_select + `<org>/hr/...` exclusion.
drop policy if exists documents_storage_select on storage.objects;
create policy documents_storage_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'documents'
    and coalesce((storage.foldername(name))[2], '') <> 'hr'
    and public.is_organization_member((storage.foldername(name))[1]::uuid)
    and public.has_permission('document.read', (storage.foldername(name))[1]::uuid)
  );

-- HR files: readable only through the HR access rules (HR managers/officers, the employee
-- for employee_visible/finance_visible, finance for bank/contract/finance_visible).
drop policy if exists documents_storage_select_hr on storage.objects;
create policy documents_storage_select_hr on storage.objects
  for select to authenticated
  using (
    bucket_id = 'documents'
    and (storage.foldername(name))[2] = 'hr'
    and public.can_access_hr_storage_object(name)
  );

-- 012 documents_storage_update + `<org>/hr/...` exclusion (HR uploads never overwrite;
-- generic document.update must not be able to replace an employee's identity file).
drop policy if exists documents_storage_update on storage.objects;
create policy documents_storage_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'documents'
    and coalesce((storage.foldername(name))[2], '') <> 'hr'
    and public.has_permission('document.update', (storage.foldername(name))[1]::uuid)
  )
  with check (
    bucket_id = 'documents'
    and coalesce((storage.foldername(name))[2], '') <> 'hr'
    and public.has_permission('document.update', (storage.foldername(name))[1]::uuid)
  );

-- =============================================================================
-- C. profiles: self-updates limited to safe columns.
-- 011 protect_sensitive_profile_fields (latest) + is_active / id / created_at guard.
-- profiles_update_self (010) stays; this BEFORE UPDATE trigger enforces the columns.
-- =============================================================================

create or replace function public.protect_sensitive_profile_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.is_platform_admin is distinct from new.is_platform_admin
     and not public.is_platform_admin() then
    raise exception 'FORBIDDEN';
  end if;

  -- Account status and identity columns change only through the service role (server
  -- actions after permission checks), direct DB sessions, or a platform admin.
  if (
       old.is_active is distinct from new.is_active
       or old.id is distinct from new.id
       or old.created_at is distinct from new.created_at
     )
     and not public.security_trusted_session()
     and not public.is_platform_admin() then
    raise exception 'FORBIDDEN';
  end if;

  return new;
end;
$$;

revoke all on function public.protect_sensitive_profile_fields() from public, anon, authenticated;

drop trigger if exists profiles_protect_sensitive on public.profiles;
create trigger profiles_protect_sensitive
  before update on public.profiles
  for each row execute function public.protect_sensitive_profile_fields();

-- =============================================================================
-- D. Tenant checks on security definer helpers.
-- =============================================================================

-- 027 compute_project_health (latest) + can_access_project guard.
create or replace function public.compute_project_health(p_project_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_overdue_rfi integer := 0;
  v_overdue_docs integer := 0;
  v_open_ncr integer := 0;
  v_critical_ncr integer := 0;
  v_failed_ir integer := 0;
  v_late_stages integer := 0;
  v_resubmit integer := 0;
begin
  if not public.security_trusted_session() and not public.can_access_project(p_project_id) then
    raise exception 'FORBIDDEN';
  end if;

  select organization_id into v_org from public.projects where id = p_project_id;
  if v_org is null then
    return 'green';
  end if;

  select count(*) into v_overdue_rfi from public.rfis
  where project_id = p_project_id
    and status in ('submitted', 'under_review')
    and response_required_by is not null
    and response_required_by < timezone('utc', now());

  select count(*) into v_overdue_docs from public.documents
  where project_id = p_project_id
    and submission_status in ('submitted', 'under_review')
    and response_due_at is not null
    and response_due_at < timezone('utc', now());

  select count(*) into v_open_ncr from public.ncrs
  where project_id = p_project_id and status not in ('closed');

  select count(*) into v_critical_ncr from public.ncrs
  where project_id = p_project_id and severity = 'critical' and status not in ('closed');

  select count(*) into v_failed_ir from public.inspection_requests
  where project_id = p_project_id and status in ('failed', 'reinspection_required');

  select count(*) into v_late_stages from public.project_stages
  where project_id = p_project_id
    and status in ('in_progress', 'not_started')
    and planned_end is not null
    and planned_end < (timezone('utc', now()))::date;

  select count(*) into v_resubmit from public.documents
  where project_id = p_project_id and official_decision = 'C';

  if v_critical_ncr > 0 or v_overdue_rfi >= 5 or v_failed_ir >= 3 then
    return 'red';
  end if;

  if v_open_ncr > 0 or v_overdue_rfi > 0 or v_overdue_docs > 0
     or v_late_stages > 0 or v_resubmit > 0 or v_failed_ir > 0 then
    return 'amber';
  end if;

  return 'green';
end;
$$;

revoke all on function public.compute_project_health(uuid) from public, anon;
grant execute on function public.compute_project_health(uuid) to authenticated, service_role;

-- 057 employee_has_approved_leave_on (latest) + organization membership guard.
-- Returns false (not an error) for other tenants so attendance RPCs keep their contract.
create or replace function public.employee_has_approved_leave_on(
  p_employee_id uuid,
  p_date date
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select (
      public.security_trusted_session()
      or exists (
        select 1
        from public.employees e
        where e.id = p_employee_id
          and public.is_organization_member(e.organization_id)
      )
    )
    and exists (
      select 1
      from public.leave_requests lr
      where lr.employee_id = p_employee_id
        and lr.status = 'approved'
        and lr.start_date <= p_date
        and lr.end_date >= p_date
    );
$$;

revoke all on function public.employee_has_approved_leave_on(uuid, date) from public, anon;
grant execute on function public.employee_has_approved_leave_on(uuid, date) to authenticated, service_role;
