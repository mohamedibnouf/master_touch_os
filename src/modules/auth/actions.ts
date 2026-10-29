"use server";

import { redirect } from "next/navigation";
import { cookies, headers } from "next/headers";
import { LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE, isLocale } from "@/lib/i18n/config";
import { revalidatePath } from "next/cache";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { getServerEnv } from "@/lib/env";
import { bootstrapAdminIfNeeded } from "@/server/services/bootstrap-admin.service";
import { consumeLoginAttempt } from "@/server/services/login-rate-limit.service";
import {
  EMPLOYEE_LOGIN_FAILURE_AR,
  LOGIN_RATE_LIMIT_AR,
  POST_LOGIN_PATH,
  safePostLoginPath,
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
    // Vercel sets x-real-ip itself; prefer it over the client-influenced x-forwarded-for.
    const realIp = h.get("x-real-ip")?.trim();
    if (realIp) return realIp;
    const forwarded = h.get("x-forwarded-for");
    if (forwarded) return forwarded.split(",")[0]?.trim() || "unknown";
    return "unknown";
  } catch {
    return "unknown";
  }
}

function normalizeLoginIdentifier(identifier: string): string {
  return isEmailIdentifier(identifier) ? identifier.toLowerCase() : normalizeEmployeeNumber(identifier);
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

  // Both buckets are always charged: per-IP stops spraying, per-identifier stops
  // distributed guessing against one account.
  const ip = await clientIp();
  const [ipAllowed, identifierAllowed] = await Promise.all([
    consumeLoginAttempt("ip", ip),
    consumeLoginAttempt("identifier", normalizeLoginIdentifier(identifier)),
  ]);
  if (!ipAllowed || !identifierAllowed) {
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
  const { data: signIn, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    return { error: EMPLOYEE_LOGIN_FAILURE_AR };
  }

  // Restore the language saved on the profile so it follows the user across devices.
  if (signIn.user) {
    const { data: profile } = await supabase.from("profiles").select("locale").eq("id", signIn.user.id).maybeSingle();
    if (isLocale(profile?.locale)) {
      (await cookies()).set(LOCALE_COOKIE, profile.locale, {
        path: "/",
        maxAge: LOCALE_COOKIE_MAX_AGE,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        httpOnly: false,
      });
    }
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
