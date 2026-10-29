"use client";

import { createContext, useContext, type ReactNode } from "react";
import { DEFAULT_LOCALE, dirFor, type Locale } from "./config";
import { ar, type Dictionary } from "./dictionaries/ar";

type I18nValue = { locale: Locale; dir: "rtl" | "ltr"; t: Dictionary };

const I18nContext = createContext<I18nValue>({ locale: DEFAULT_LOCALE, dir: dirFor(DEFAULT_LOCALE), t: ar });

/** Mounted once in the root layout with the dictionary resolved on the server. */
export function I18nProvider({ locale, dictionary, children }: { locale: Locale; dictionary: Dictionary; children: ReactNode }) {
  return <I18nContext.Provider value={{ locale, dir: dirFor(locale), t: dictionary }}>{children}</I18nContext.Provider>;
}

/** Client Components: `const { t, locale } = useI18n()`. */
export function useI18n(): I18nValue {
  return useContext(I18nContext);
}
