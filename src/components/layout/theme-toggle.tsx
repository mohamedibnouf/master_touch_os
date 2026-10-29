"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { THEME_COOKIE, THEME_COOKIE_MAX_AGE, nextTheme, type Theme } from "@/lib/theme";
import { cn } from "@/lib/utils";

const ICONS = { light: Sun, dark: Moon, system: Monitor } as const;

const ThemeContext = createContext<Theme>("system");

/** Root layout passes the cookie value so server and client render the same icon. */
export function ThemeProvider({ theme, children }: { theme: Theme; children: ReactNode }) {
  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

/**
 * Cycles light → dark → system. Applies instantly on <html data-theme> (no server
 * round trip) and stores the choice in a cookie that the root layout reads, so the
 * next page load renders in the right theme without a flash.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const { t } = useI18n();
  const [theme, setTheme] = useState<Theme>(useContext(ThemeContext));
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
    >
      <Icon className="size-4 motion-safe:animate-[mt-pop_.3s_ease-out]" key={theme} aria-hidden />
    </button>
  );
}
