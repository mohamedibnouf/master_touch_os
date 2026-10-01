-- Master Touch OS — 067
-- Base internal system role: employee (موظف).
-- Additive. Does NOT modify prior migrations.
-- Does NOT backfill user_roles.
-- Does NOT change grants on any other role.

-- Deterministic system-role id: next after 013 seed 000000000017 (subcontractor).
-- Unique among 20000000-0000-0000-0000-000000000001 … 000000000017.

insert into public.roles (id, organization_id, code, name_ar, name_en, is_system, is_external)
values (
  '20000000-0000-0000-0000-000000000018',
  null,
  'employee',
  'موظف',
  'Employee',
  true,
  false
)
on conflict do nothing;

insert into public.role_permissions (role_id, permission_key)
select r.id, x.permission_key
from public.roles r
join (values
  ('attendance.view_self'),
  ('attendance.check_in'),
  ('attendance.check_out'),
  ('leave.view_self'),
  ('leave.request'),
  ('leave.cancel_self'),
  ('notification.read'),
  ('payroll.view_self')
) as x(permission_key) on true
where r.code = 'employee'
  and r.organization_id is null
on conflict do nothing;
