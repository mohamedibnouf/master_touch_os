import { NextResponse, type NextRequest } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { safePostLoginPath } from "@/lib/auth/employee-login";
import { CHANGE_PASSWORD_PATH } from "@/lib/auth/password-policy";

/** Exchanges an auth code (e.g. from a password-reset e-mail) and continues to `next`. */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const requested = url.searchParams.get("next") ?? "";
  // safePostLoginPath rejects /auth/* on purpose; the reset flow's own page is the one exception.
  let next = requested === CHANGE_PASSWORD_PATH ? CHANGE_PASSWORD_PATH : safePostLoginPath(requested);
  if (code) {
    const supabase = await createServerSupabaseClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) next = "/auth/forgot-password?expired=1";
  }
  return NextResponse.redirect(new URL(next, url.origin));
}
