"use client";

import { useTransition } from "react";
import { Languages, Loader2 } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { setLocaleAction } from "@/modules/i18n/actions";
import { cn } from "@/lib/utils";

export function LanguageSwitch({ className, tone = "light" }: { className?: string; tone?: "light" | "dark" }) {
  const { t, locale } = useI18n();
  const [pending, startTransition] = useTransition();
  const next = locale === "ar" ? "en" : "ar";

  return (
    <button
      type="button"
      onClick={() => startTransition(() => setLocaleAction(next))}
      disabled={pending}
      aria-label={t.common.switchToOtherLabel}
      title={t.common.switchToOtherLabel}
      lang={next}
      data-testid="language-switch"
      className={cn(
        "inline-flex h-9 items-center gap-1.5 rounded-[var(--radius-control)] border px-2.5 text-sm font-medium duration-150 transition-colors disabled:opacity-60",
        tone === "light"
          ? "border-line bg-surface text-ink hover:border-border-strong hover:bg-surface-muted"
          : "border-white/10 bg-white/5 text-white/85 hover:bg-white/10 hover:text-white",
        className,
      )}
    >
      {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Languages className="size-4" aria-hidden />}
      <span className="hidden sm:inline">{t.common.switchToOther}</span>
      <span className="sm:hidden">{t.common.switchToOtherShort}</span>
    </button>
  );
}
