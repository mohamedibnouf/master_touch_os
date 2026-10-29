import type { Locale } from "@/lib/i18n/config";

export const GPS_STAGE_COPY = {
  locating: "جارٍ تحديد موقعك…",
  verifying: "جارٍ التحقق من موقع الحضور…",
} as const;

export const GPS_STAGE_COPY_EN = {
  locating: "Finding your location…",
  verifying: "Verifying your attendance location…",
} as const;

export function gpsStageCopy(locale: Locale = "ar"): { locating: string; verifying: string } {
  return locale === "en" ? GPS_STAGE_COPY_EN : GPS_STAGE_COPY;
}
