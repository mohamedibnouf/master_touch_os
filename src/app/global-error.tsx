"use client";

import { useSyncExternalStore } from "react";
import { LOCALE_COOKIE, dirFor, format, resolveLocale, type Locale } from "@/lib/i18n/config";
import { workspaceAr } from "@/lib/i18n/dictionaries/workspace.ar";
import { workspaceEn } from "@/lib/i18n/dictionaries/workspace.en";

// Renders outside the root layout (no I18nProvider), so the locale comes straight from the cookie.
function readLocaleCookie(): Locale {
  const match = document.cookie.split("; ").find((part) => part.startsWith(`${LOCALE_COOKIE}=`));
  return resolveLocale(match ? decodeURIComponent(match.slice(LOCALE_COOKIE.length + 1)) : undefined);
}

const noopSubscribe = () => () => {};

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const locale = useSyncExternalStore<Locale>(noopSubscribe, readLocaleCookie, () => "ar");
  const te = (locale === "en" ? workspaceEn : workspaceAr).errors;
  return (
    <html lang={locale} dir={dirFor(locale)}>
      <body className="min-h-screen bg-white p-6 text-[#111318]">
        <div className="mx-auto max-w-lg rounded-[14px] border border-[#E8EAED] bg-white p-6">
          <h1 className="text-lg font-semibold">{te.globalTitle}</h1>
          <p className="mt-2 text-sm text-[#667085]">{te.globalBody}</p>
          {error.digest ? (
            <p className="mt-2 text-xs text-[#667085]">{format(te.reference, { digest: error.digest })}</p>
          ) : null}
          <button
            type="button"
            className="mt-4 inline-flex min-h-10 items-center justify-center rounded-[9px] bg-[#2563EB] px-4 text-sm text-white"
            onClick={() => reset()}
          >
            {te.retry}
          </button>
        </div>
      </body>
    </html>
  );
}
