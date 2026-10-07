"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { getServerEnv } from "@/lib/env";
import { bootstrapAdminIfNeeded } from "@/server/use-cases/platform";
import {
  EMPLOYEE_LOGIN_FAILURE_AR,
  LOGIN_RATE_LIMIT_AR,
  POST_LOGIN_PATH,
  safePostLoginPath,
  assertLoginRateLimit,
  isEmailIdentifier,
  isEmployeeLoginAllowed,
  normalizeEmployeeNumber,
  resolveLoginCandidates,
  type LoginCandidate,
} from "@/lib/auth/employee-login";

export type SignInState = { error: string | null };

async function clientIp(): Promise<string> {
  try {
    const h = await headers();
    const forwarded = h.get("x-forwarded-for");
    if (forwarded) return forwarded.split(",")[0]?.trim() || "unknown";
    return h.get("x-real-ip") ?? "unknown";
  } catch {
    return "unknown";
  }
}

async function resolveEmployeeAuthEmail(employeeNumber: string): Promise<string | null> {
  const admin = createAdminSupabaseClient();
  const number = normalizeEmployeeNumber(employeeNumber);
  const { data, error } = await admin
    .from("employees")
    .select("profile_id, organization_id, is_active, employee_number")
    .eq("employee_number", number)
    .limit(5);

  if (error || !data) return null;

  const resolved = resolveLoginCandidates(data as LoginCandidate[], number);
  if (resolved.kind !== "unique") return null;

  const { candidate } = resolved;
  const [{ data: profile }, { data: membership }] = await Promise.all([
    admin.from("profiles").select("is_active").eq("id", candidate.profile_id).maybeSingle(),
    admin
      .from("organization_members")
      .select("status")
      .eq("organization_id", candidate.organization_id)
      .eq("profile_id", candidate.profile_id)
      .maybeSingle(),
  ]);

  if (
    !isEmployeeLoginAllowed({
      employeeActive: candidate.is_active,
      profileActive: profile?.is_active === true,
      membershipActive: membership?.status === "active",
    })
  ) {
    return null;
  }

  const { data: userData, error: userError } = await admin.auth.admin.getUserById(candidate.profile_id);
  const email = userData.user?.email;
  if (userError || !email) return null;
  return email;
}

export async function signInAction(
  _prev: SignInState,
  formData: FormData,
): Promise<SignInState> {
  const identifier = String(formData.get("identifier") ?? formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!identifier || !password) {
    return { error: EMPLOYEE_LOGIN_FAILURE_AR };
  }

  const ip = await clientIp();
  if (!assertLoginRateLimit(ip)) {
    return { error: LOGIN_RATE_LIMIT_AR };
  }

  let email: string | null = null;
  if (isEmailIdentifier(identifier)) {
    email = identifier.toLowerCase();
  } else {
    try {
      email = await resolveEmployeeAuthEmail(identifier);
    } catch {
      return { error: EMPLOYEE_LOGIN_FAILURE_AR };
    }
    if (!email) {
      return { error: EMPLOYEE_LOGIN_FAILURE_AR };
    }
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    return { error: EMPLOYEE_LOGIN_FAILURE_AR };
  }

  const env = getServerEnv();
  if (env.BOOTSTRAP_ADMIN_EMAIL && env.BOOTSTRAP_ADMIN_EMAIL.toLowerCase() === email) {
    await bootstrapAdminIfNeeded(email);
  }

  revalidatePath("/", "layout");
  const nextRaw = String(formData.get("next") ?? "");
  redirect(safePostLoginPath(nextRaw || POST_LOGIN_PATH));
}

export async function signOutAction() {
  const supabase = await createServerSupabaseClient();
  await supabase.auth.signOut();
  redirect("/login");
}
