import "server-only";

import { cache } from "react";
import { cookies } from "next/headers";
import { LOCALE_COOKIE, resolveLocale, type Locale } from "./config";
import { ar, type Dictionary } from "./dictionaries/ar";
import { en } from "./dictionaries/en";

const DICTIONARIES: Record<Locale, Dictionary> = { ar, en };

/** Request-scoped locale from the mt_locale cookie (Arabic by default). */
export const getLocale = cache(async (): Promise<Locale> => {
  try {
    const store = await cookies();
    return resolveLocale(store.get(LOCALE_COOKIE)?.value);
  } catch {
    return resolveLocale(undefined);
  }
});

export function getDictionary(locale: Locale): Dictionary {
  return DICTIONARIES[locale];
}

/** Locale + dictionary for Server Components: `const { t, locale } = await getI18n()`. */
export async function getI18n(): Promise<{ locale: Locale; t: Dictionary }> {
  const locale = await getLocale();
  return { locale, t: getDictionary(locale) };
}
