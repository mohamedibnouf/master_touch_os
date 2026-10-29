"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE, resolveLocale } from "@/lib/i18n/config";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";

/**
 * Stores the interface language for this browser and, when signed in, on the profile
 * (profiles.locale) so it follows the user across devices and drives the language of
 * their notifications and e-mails.
 */
export async function setLocaleAction(next: string): Promise<void> {
  const locale = resolveLocale(next);
  const store = await cookies();
  store.set(LOCALE_COOKIE, locale, {
    path: "/",
    maxAge: LOCALE_COOKIE_MAX_AGE,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    httpOnly: false,
  });

  try {
    const supabase = await createServerSupabaseClient();
    const { data } = await supabase.auth.getClaims();
    const userId = data?.claims?.sub;
    if (userId) {
      const { error } = await supabase.from("profiles").update({ locale }).eq("id", userId);
      if (error) logger.warn("profile locale update failed", { code: error.code ?? null });
    }
  } catch {
    // Signed-out pages (login) only keep the cookie.
  }

  revalidatePath("/", "layout");
}
