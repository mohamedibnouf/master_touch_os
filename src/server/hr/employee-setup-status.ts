import "server-only";

import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { deriveEmployeeSetupRows, type EmployeeSetupRow } from "@/lib/hr/employee-setup";
import type { EmployeeLoginUiStatus } from "@/lib/auth/employee-login";

export async function readEmployeeSetupRows(input: {
  organizationId: string;
  employeeId: string;
  profileId: string;
  employeeNumber: string | null;
  hasProfileName: boolean;
  hasDepartment: boolean;
  loginStatus: EmployeeLoginUiStatus | null;
  hasCompensation: boolean;
}): Promise<EmployeeSetupRow[]> {
  const supabase = createAdminSupabaseClient();
  const today = new Date().toISOString().slice(0, 10);

  const [roles, workplaces, shifts, leaveTypes] = await Promise.all([
    supabase
      .from("user_roles")
      .select("id")
      .eq("organization_id", input.organizationId)
      .eq("profile_id", input.profileId)
      .limit(1),
    supabase
      .from("employee_workplace_assignments")
      .select("id")
      .eq("organization_id", input.organizationId)
      .eq("employee_id", input.employeeId)
      .lte("effective_from", today)
      .or(`effective_to.is.null,effective_to.gte.${today}`)
      .limit(1),
    supabase
      .from("employee_shift_assignments")
      .select("id")
      .eq("organization_id", input.organizationId)
      .eq("employee_id", input.employeeId)
      .lte("effective_from", today)
      .or(`effective_to.is.null,effective_to.gte.${today}`)
      .limit(1),
    supabase
      .from("leave_types")
      .select("id")
      .eq("organization_id", input.organizationId)
      .eq("is_active", true)
      .limit(1),
  ]);

  return deriveEmployeeSetupRows({
    employeeId: input.employeeId,
    hasCoreIdentity: Boolean(input.employeeNumber && input.hasProfileName),
    loginStatus: input.loginStatus,
    hasDepartment: input.hasDepartment,
    hasRole: (roles.data ?? []).length > 0,
    hasWorkplaceAssignment: (workplaces.data ?? []).length > 0,
    hasShiftAssignment: (shifts.data ?? []).length > 0,
    hasLeaveTypes: (leaveTypes.data ?? []).length > 0,
    hasCompensation: input.hasCompensation,
  });
}
