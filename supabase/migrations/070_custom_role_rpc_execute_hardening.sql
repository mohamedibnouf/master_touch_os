-- Master Touch OS — 070
-- Custom-role RPC EXECUTE hardening (forward-only, ACL only).
-- Does NOT edit or rerun 069.
-- Does NOT change permission catalogs, grants, role rows, or function bodies.
--
-- 069 left named EXECUTE grants on SECURITY DEFINER helpers (notably anon)
-- because REVOKE FROM PUBLIC does not remove role-specific grants, and
-- CREATE OR REPLACE preserves existing ACLs / default privileges.
--
-- PostgreSQL: a SECURITY DEFINER function runs as its owner. Owner EXECUTE
-- remains after REVOKE FROM PUBLIC/anon/authenticated/service_role, so parent
-- RPCs may still invoke internal helpers.

-- =============================================================================
-- Internal helpers and trigger functions — deny by default
-- =============================================================================

revoke all on function public.assert_can_manage_custom_roles(uuid)
  from public, anon, authenticated, service_role;

revoke all on function public.assert_custom_role_permission_set(uuid, text[])
  from public, anon, authenticated, service_role;

revoke all on function public.replace_custom_role_permissions(uuid, text[])
  from public, anon, authenticated, service_role;

revoke all on function public.current_effective_permission_keys(uuid)
  from public, anon, authenticated, service_role;

revoke all on function public.non_delegable_permission_keys()
  from public, anon, authenticated, service_role;

revoke all on function public.normalize_custom_role_code(text, text)
  from public, anon, authenticated, service_role;

revoke all on function public.system_role_ddl_allowed()
  from public, anon, authenticated, service_role;

revoke all on function public.roles_custom_org_guard()
  from public, anon, authenticated, service_role;

revoke all on function public.roles_protect_system()
  from public, anon, authenticated, service_role;

revoke all on function public.role_permissions_protect_system()
  from public, anon, authenticated, service_role;

-- =============================================================================
-- Public custom-role mutation RPCs — authenticated only
-- App path: cookie session supabase.rpc(...) as authenticated.
-- service_role is not an application caller for these RPCs.
-- =============================================================================

revoke all on function public.create_organization_role(uuid, text, text, text, uuid, text[])
  from public, anon, authenticated, service_role;
grant execute on function public.create_organization_role(uuid, text, text, text, uuid, text[])
  to authenticated;

revoke all on function public.update_organization_role(uuid, uuid, text, text, uuid, text[])
  from public, anon, authenticated, service_role;
grant execute on function public.update_organization_role(uuid, uuid, text, text, uuid, text[])
  to authenticated;

revoke all on function public.set_organization_role_active(uuid, uuid, boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.set_organization_role_active(uuid, uuid, boolean)
  to authenticated;

-- =============================================================================
-- has_permission — existing RLS/authorization surface (069 body unchanged here)
-- Keep authenticated EXECUTE. Revoke PUBLIC/anon implicit exposure.
-- service_role named grant is left in place (existing platform role; RLS bypass).
-- =============================================================================

revoke all on function public.has_permission(text, uuid, public.role_scope_type, uuid)
  from public, anon;
grant execute on function public.has_permission(text, uuid, public.role_scope_type, uuid)
  to authenticated;

-- =============================================================================
-- Apply-time ACL assertions (no row changes)
-- =============================================================================

do $$
begin
  if has_function_privilege('anon', 'public.replace_custom_role_permissions(uuid, text[])'::regprocedure, 'execute')
     or has_function_privilege('authenticated', 'public.replace_custom_role_permissions(uuid, text[])'::regprocedure, 'execute')
     or has_function_privilege('service_role', 'public.replace_custom_role_permissions(uuid, text[])'::regprocedure, 'execute')
  then
    raise exception '070_HELPER_EXECUTE_EXPOSED' using errcode = 'P0001';
  end if;

  if has_function_privilege('anon', 'public.assert_can_manage_custom_roles(uuid)'::regprocedure, 'execute')
     or has_function_privilege('authenticated', 'public.assert_can_manage_custom_roles(uuid)'::regprocedure, 'execute')
     or has_function_privilege('anon', 'public.assert_custom_role_permission_set(uuid, text[])'::regprocedure, 'execute')
     or has_function_privilege('authenticated', 'public.assert_custom_role_permission_set(uuid, text[])'::regprocedure, 'execute')
  then
    raise exception '070_ASSERT_EXECUTE_EXPOSED' using errcode = 'P0001';
  end if;

  if has_function_privilege('anon', 'public.create_organization_role(uuid, text, text, text, uuid, text[])'::regprocedure, 'execute')
     or has_function_privilege('anon', 'public.update_organization_role(uuid, uuid, text, text, uuid, text[])'::regprocedure, 'execute')
     or has_function_privilege('anon', 'public.set_organization_role_active(uuid, uuid, boolean)'::regprocedure, 'execute')
  then
    raise exception '070_RPC_ANON_EXECUTE' using errcode = 'P0001';
  end if;

  if not has_function_privilege('authenticated', 'public.create_organization_role(uuid, text, text, text, uuid, text[])'::regprocedure, 'execute')
     or not has_function_privilege('authenticated', 'public.update_organization_role(uuid, uuid, text, text, uuid, text[])'::regprocedure, 'execute')
     or not has_function_privilege('authenticated', 'public.set_organization_role_active(uuid, uuid, boolean)'::regprocedure, 'execute')
  then
    raise exception '070_RPC_AUTHENTICATED_MISSING' using errcode = 'P0001';
  end if;

  if not has_function_privilege('postgres', 'public.replace_custom_role_permissions(uuid, text[])'::regprocedure, 'execute')
     or not has_function_privilege('postgres', 'public.assert_can_manage_custom_roles(uuid)'::regprocedure, 'execute')
     or not has_function_privilege('postgres', 'public.assert_custom_role_permission_set(uuid, text[])'::regprocedure, 'execute')
  then
    raise exception '070_OWNER_HELPER_EXECUTE_MISSING' using errcode = 'P0001';
  end if;

  if not has_function_privilege('authenticated', 'public.has_permission(text, uuid, public.role_scope_type, uuid)'::regprocedure, 'execute')
     or has_function_privilege('anon', 'public.has_permission(text, uuid, public.role_scope_type, uuid)'::regprocedure, 'execute')
  then
    raise exception '070_HAS_PERMISSION_ACL' using errcode = 'P0001';
  end if;

  if has_function_privilege('anon', 'public.system_role_ddl_allowed()'::regprocedure, 'execute')
     or has_function_privilege('authenticated', 'public.system_role_ddl_allowed()'::regprocedure, 'execute')
     or has_function_privilege('service_role', 'public.system_role_ddl_allowed()'::regprocedure, 'execute')
  then
    raise exception '070_DDL_BYPASS_EXECUTE_EXPOSED' using errcode = 'P0001';
  end if;
end
$$;
