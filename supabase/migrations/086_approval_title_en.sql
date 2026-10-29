-- Master Touch OS — 086
-- English approval request titles (approval_requests.title_en) for bilingual UI.
-- Additive. Safe to apply before or after the app deploy: the app reads title_en only
-- when the column exists and ignores a missing set_approval_request_title_en().
--
-- Safety:
--  * Nullable column; existing rows and the Arabic `title` are untouched.
--  * Length is bounded by a CHECK constraint (<= 240, same as the app's title limit).
--  * set_approval_request_title_en() is security definer with a pinned search_path.
--  * Only the request's creator (requested_by) or a member holding approval.create
--    in the request's organization may set it. Org membership is always required.
--  * Only title_en is written; status, steps, decisions and recipients are unchanged.
--  * EXECUTE is revoked from public/anon and granted to authenticated only.
--  * Does not modify earlier migrations.

alter table public.approval_requests add column if not exists title_en text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'approval_requests_title_en_length_chk'
      and conrelid = 'public.approval_requests'::regclass
  ) then
    alter table public.approval_requests
      add constraint approval_requests_title_en_length_chk
      check (title_en is null or char_length(title_en) between 1 and 240);
  end if;
end;
$$;

-- Sets (or clears, with null / blank) the English title of one approval request.
create or replace function public.set_approval_request_title_en(
  p_request_id uuid,
  p_title_en text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_organization_id uuid;
  v_requested_by uuid;
  v_title text := nullif(btrim(coalesce(p_title_en, '')), '');
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  if p_request_id is null then
    raise exception 'INVALID_INPUT';
  end if;
  if v_title is not null and char_length(v_title) > 240 then
    raise exception 'INVALID_INPUT';
  end if;

  select organization_id, requested_by
    into v_organization_id, v_requested_by
  from public.approval_requests
  where id = p_request_id
  for update;
  if not found then
    raise exception 'NOT_FOUND';
  end if;

  if not public.is_organization_member(v_organization_id) then
    raise exception 'FORBIDDEN';
  end if;
  if v_requested_by is distinct from v_uid
     and not public.has_permission('approval.create', v_organization_id) then
    raise exception 'FORBIDDEN';
  end if;

  update public.approval_requests
     set title_en = v_title
   where id = p_request_id;
end;
$$;

revoke all on function public.set_approval_request_title_en(uuid, text) from public, anon;
grant execute on function public.set_approval_request_title_en(uuid, text) to authenticated;
