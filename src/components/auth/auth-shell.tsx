import Image from "next/image";
import type { ReactNode } from "react";
import { LanguageSwitch } from "@/components/layout/language-switch";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { getI18n } from "@/lib/i18n/server";

/** Compact frame for the secondary auth pages (forgot / change password). */
export async function AuthShell({
  title,
  description,
  children,
  testId,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  testId?: string;
}) {
  const { t } = await getI18n();
  return (
    <main className="flex min-h-dvh flex-col bg-background px-5 py-6 sm:px-10" data-testid={testId}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <Image src="/icons/icon-192x192.png" alt="" width={36} height={36} priority className="size-9 rounded-[0.6rem]" />
          <span className="text-[0.9375rem] font-semibold tracking-tight text-ink">{t.common.appName}</span>
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <LanguageSwitch />
        </div>
      </div>
      <div className="mt-page mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-10">
        <h1 className="text-[1.75rem] font-semibold leading-tight tracking-tight text-ink">{title}</h1>
        {description ? <p className="mt-2 text-sm leading-relaxed text-muted">{description}</p> : null}
        <div className="mt-8">{children}</div>
      </div>
    </main>
  );
}
