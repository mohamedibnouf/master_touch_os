# Trial onboarding — Phase 5.5.1

Do **not** create production users from this document automatically.
Do **not** set `profiles.is_platform_admin`.
Do **not** reseed permission catalogs.

Use Settings → users (requires `user.read` / `role.assign`) or the existing
Auth + `organization_members` + `user_roles` + `employees` flow.

## 1. Shared steps (every trial person)

1. Create the Auth user (email confirmed).
2. Insert `organization_members` for Master Touch org, `status = active`.
3. Insert `employees` linked to `profile_id` (needed for attendance, leave, payslips).
4. Assign **one** seeded system role via `user_roles` (`scope_type = organization`).
5. Confirm they can sign in at `/login` and land on `/` (employee home).

## 2. Role mapping (existing catalog)

| Trial persona | Seeded role code | What they should see |
| --- | --- | --- |
| Employee | `engineer` or `viewer` + HR self perms | Home, attendance/leave if the role includes them. `viewer` is read-only and **does not** include check-in. Prefer `engineer` for a working employee trial. |
| Engineer | `engineer` | Projects/docs/engineering, own attendance/leave/payslips. **No** org employee directory, payroll admin, finance, or Command Center. |
| Project manager | `project_manager` | Projects + team leave/attendance + approvals. Not Command Center unless also granted `reports.management.read`. |
| HR | `hr_manager` or `hr_officer` | People, leave/attendance administration, payroll as cataloged. |
| Finance | `finance_manager` / `finance_officer` | Finance + commercial. Payroll admin only if the role includes payroll keys. |
| General manager | `general_manager` | Full internal catalog except `settings.manage`. Command Center + Analyst. |
| Super admin (IT only) | `super_admin` | Settings/user admin. Keep this to a tiny ops set. |

## 3. Smoke checklist per user

- Login / logout
- Home shows **their** work, not payroll amounts (unless they have payroll view-all)
- Attendance check-in (if permitted)
- Leave request (if permitted)
- Bell → notifications
- Approvals inbox (if `approval.review` / `approve`)
- Projects list (if `project.read`)
- No sidebar leak of Finance/Payroll admin without permission

## 4. Install (PWA)

- Android Chrome: menu → Install app / Add to Home screen
- Desktop Chrome/Edge: install icon in the address bar
- iOS Safari: Share → Add to Home Screen (no Web Push in this sprint)
