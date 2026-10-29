"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE, resolveLocale } from "@/lib/i18n/config";

/** Stores the interface language for this browser and re-renders the current tree. */
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
  revalidatePath("/", "layout");
}
