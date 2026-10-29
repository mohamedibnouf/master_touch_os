import { intlLocale, type Locale } from "@/lib/i18n/config";

/** "12,345.00 SAR" — amounts are always shown in SAR with two decimals. */
export function formatSar(amount: number | string | null | undefined, locale: Locale = "ar"): string {
  const n = Number(amount ?? 0);
  return `${n.toLocaleString(intlLocale(locale), { minimumFractionDigits: 2, maximumFractionDigits: 2 })} SAR`;
}

/** Stable "YYYY/MM" period label (also used by E2E selectors). */
export function formatPeriodLabel(year: number, month: number): string {
  return `${year}/${String(month).padStart(2, "0")}`;
}

/** Gregorian month name for the period picker (never the Hijri calendar ar-SA defaults to). */
export function monthName(month: number, locale: Locale = "ar"): string {
  return new Intl.DateTimeFormat(intlLocale(locale), {
    month: "long",
    calendar: "gregory",
    timeZone: "Asia/Riyadh",
  }).format(new Date(Date.UTC(2000, month - 1, 15)));
}
