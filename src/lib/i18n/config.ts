export const LOCALES = ["ar", "en"] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "ar";
export const LOCALE_COOKIE = "mt_locale";
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

export function resolveLocale(value: unknown): Locale {
  return isLocale(value) ? value : DEFAULT_LOCALE;
}

export function dirFor(locale: Locale): "rtl" | "ltr" {
  return locale === "ar" ? "rtl" : "ltr";
}

/** BCP 47 tag for Intl formatting; "ar-SA" matches the existing Arabic screens. */
export function intlLocale(locale: Locale): string {
  return locale === "ar" ? "ar-SA" : "en-GB";
}

/** Picks the field matching the locale, falling back to the other language. */
export function pickLocalized(locale: Locale, ar: string | null | undefined, en: string | null | undefined): string {
  const primary = locale === "ar" ? ar : en;
  const fallback = locale === "ar" ? en : ar;
  return (primary?.trim() || fallback?.trim() || "").trim();
}

/** Replaces {name} placeholders. */
export function format(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => (key in vars ? String(vars[key]) : match));
}
