"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getLocale } from "@/lib/i18n/server";
import { isInternalAuthEmail, isEmailIdentifier, POST_LOGIN_PATH } from "@/lib/auth/employee-login";
import { consumeLoginAttempt } from "@/server/services/login-rate-limit.service";
import { logger } from "@/lib/logger";
import { PASSWORD_COPY, passwordPolicyError, type PasswordFormState } from "@/lib/auth/password-policy";

async function appOrigin(): Promise<string> {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (configured) return configured.replace(/\/$/, "");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get("x-real-ip")?.trim() || h.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

/**
 * Sends a password-reset e-mail. Always answers with the same neutral message so the
 * form can't be used to discover which addresses have accounts. Employee-number
 * accounts have no mailbox; they are told to ask HR.
 */
export async function requestPasswordResetAction(_prev: PasswordFormState, formData: FormData): Promise<PasswordFormState> {
  const locale = await getLocale();
  const copy = PASSWORD_COPY[locale];
  const identifier = String(formData.get("email") ?? "").trim().toLowerCase();

  if (!isEmailIdentifier(identifier)) {
    return { ok: false, message: copy.useHrForEmployeeNumber };
  }

  const [ipAllowed, idAllowed] = await Promise.all([
    consumeLoginAttempt("ip", await clientIp()),
    consumeLoginAttempt("identifier", `reset:${identifier}`),
  ]);
  if (!ipAllowed || !idAllowed) return { ok: false, message: copy.rateLimited };

  if (!isInternalAuthEmail(identifier)) {
    const supabase = await createServerSupabaseClient();
    const { error } = await supabase.auth.resetPasswordForEmail(identifier, {
      redirectTo: `${await appOrigin()}/auth/callback?next=/auth/change-password`,
    });
    if (error) logger.warn("password reset email failed", { code: error.code ?? null, status: error.status ?? null });
  }
  return { ok: true, message: copy.resetSent };
}

const changeSchema = z.object({
  password: z.string(),
  confirm: z.string(),
  current: z.string().optional(),
});

/**
 * Sets a new password for the signed-in user. The current password is required unless
 * the session came from a reset link or HR issued a temporary password
 * (user_metadata.must_change_password), which the proxy enforces at sign-in.
 */
export async function changePasswordAction(_prev: PasswordFormState, formData: FormData): Promise<PasswordFormState> {
  const locale = await getLocale();
  const copy = PASSWORD_COPY[locale];
  const parsed = changeSchema.safeParse({
    password: formData.get("password"),
    confirm: formData.get("confirm"),
    current: formData.get("current") ?? undefined,
  });
  if (!parsed.success) return { ok: false, message: copy.invalid };

  const policyError = passwordPolicyError(parsed.data.password, parsed.data.confirm, locale);
  if (policyError) return { ok: false, message: policyError };

  const supabase = await createServerSupabaseClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const claims = claimsData?.claims;
  if (!claims?.sub) redirect("/login");

  const forced = (claims.user_metadata as Record<string, unknown> | undefined)?.must_change_password === true;
  const fromRecovery = Array.isArray(claims.amr) && claims.amr.some((m) => (m as { method?: string }).method === "recovery");

  if (!forced && !fromRecovery) {
    const email = typeof claims.email === "string" ? claims.email : "";
    if (!parsed.data.current || !email) return { ok: false, message: copy.currentRequired };
    const { error } = await supabase.auth.signInWithPassword({ email, password: parsed.data.current });
    if (error) return { ok: false, message: copy.currentWrong };
  }

  const { error } = await supabase.auth.updateUser({
    password: parsed.data.password,
    data: { must_change_password: false },
  });
  if (error) {
    logger.warn("password change failed", { code: error.code ?? null });
    return { ok: false, message: error.code === "same_password" ? copy.samePassword : copy.failed };
  }
  // Re-issue the JWT so the proxy no longer sees must_change_password.
  await supabase.auth.refreshSession();

  revalidatePath("/", "layout");
  redirect(POST_LOGIN_PATH);
}
