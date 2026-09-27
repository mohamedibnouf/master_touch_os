import "server-only";

import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import {
  deriveEmployeeLoginUiStatus,
  type EmployeeLoginUiStatus,
} from "@/lib/auth/employee-login";

/** HR-only. Uses admin client solely to read Auth last_sign_in / metadata — never returns emails or secrets. */
export async function readEmployeeLoginUiStatus(input: {
  organizationId: string;
  employeeId: string;
  profileId: string;
  employeeActive: boolean;
  employeeNumber: string | null;
}): Promise<EmployeeLoginUiStatus> {
  const admin = createAdminSupabaseClient();
  const [{ data: profile }, { data: membership }, userResult] = await Promise.all([
    admin.from("profiles").select("is_active").eq("id", input.profileId).maybeSingle(),
    admin
      .from("organization_members")
      .select("status")
      .eq("organization_id", input.organizationId)
      .eq("profile_id", input.profileId)
      .maybeSingle(),
    admin.auth.admin.getUserById(input.profileId),
  ]);

  const meta = userResult.data.user?.user_metadata as Record<string, unknown> | undefined;
  const loginProvisioned = meta?.login_provisioned === true;
  const hasSignedIn = Boolean(userResult.data.user?.last_sign_in_at);

  return deriveEmployeeLoginUiStatus({
    employeeActive: input.employeeActive,
    profileActive: profile?.is_active === true,
    membershipActive: membership?.status === "active",
    employeeNumber: input.employeeNumber,
    loginProvisioned,
    hasSignedIn,
  });
}
