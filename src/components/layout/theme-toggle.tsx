"use client";

import { useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { THEME_COOKIE, THEME_COOKIE_MAX_AGE, nextTheme, resolveTheme, type Theme } from "@/lib/theme";
import { cn } from "@/lib/utils";

const ICONS = { light: Sun, dark: Moon, system: Monitor } as const;

/**
 * Cycles light → dark → system. Applies instantly on <html data-theme> (no server
 * round trip) and stores the choice in a cookie that the root layout reads, so the
 * next page load renders in the right theme without a flash.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const { t } = useI18n();
  const [theme, setTheme] = useState<Theme>(() =>
    typeof document === "undefined" ? "system" : resolveTheme(document.documentElement.dataset.theme),
  );
  const Icon = ICONS[theme];
  const label = { light: t.common.themeLight, dark: t.common.themeDark, system: t.common.themeSystem }[theme];

  const onClick = () => {
    const next = nextTheme(theme);
    setTheme(next);
    document.documentElement.dataset.theme = next;
    document.cookie = `${THEME_COOKIE}=${next}; path=/; max-age=${THEME_COOKIE_MAX_AGE}; samesite=lax`;
  };

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn("mt-icon-btn", className)}
      aria-label={`${t.common.theme}: ${label}`}
      title={`${t.common.theme}: ${label}`}
      data-testid="theme-toggle"
      suppressHydrationWarning
    >
      <Icon className="size-4 transition-transform duration-300 motion-safe:animate-[mt-pop_.3s_ease-out]" key={theme} aria-hidden />
    </button>
  );
}
