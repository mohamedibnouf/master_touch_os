import type { Locale } from "@/lib/i18n/config";
import { projectCommercialAr } from "@/lib/i18n/dictionaries/project-commercial.ar";
import { projectCommercialEn } from "@/lib/i18n/dictionaries/project-commercial.en";

/** Labels for the shared commercial components; Arabic unless a caller passes a locale. */
export function commercialComponentLabels(locale: Locale = "ar") {
  return (locale === "en" ? projectCommercialEn : projectCommercialAr).components;
}
