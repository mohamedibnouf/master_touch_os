import { intlLocale, type Locale } from "@/lib/i18n/config";

const TIME_ZONE = "Asia/Riyadh";

function safeFormat(value: string | null | undefined, locale: Locale, options: Intl.DateTimeFormatOptions): string {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString(intlLocale(locale), { timeZone: TIME_ZONE, ...options });
  } catch {
    return value;
  }
}

/** Short time (HH:MM) in Riyadh time. */
export function formatAttendanceTime(value: string | null | undefined, locale: Locale): string {
  return safeFormat(value, locale, { hour: "2-digit", minute: "2-digit" });
}

/** Day, short month and time in Riyadh time. */
export function formatAttendanceDayTime(value: string | null | undefined, locale: Locale): string {
  return safeFormat(value, locale, { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "short" });
}

/** Short date + short time in Riyadh time. */
export function formatAttendanceDateTime(value: string | null | undefined, locale: Locale): string {
  return safeFormat(value, locale, { dateStyle: "short", timeStyle: "short" });
}
