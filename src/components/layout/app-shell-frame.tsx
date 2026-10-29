"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { LogOut, Menu } from "lucide-react";
import { signOutAction } from "@/modules/auth/actions";
import { Button } from "@/components/ui/primitives";
import { useI18n } from "@/lib/i18n/client";
import type { AppNavFlags } from "./nav-flags";
import { Sidebar } from "./sidebar";
import { NavigationPendingBar } from "./navigation-pending";
import { LanguageSwitch } from "./language-switch";
import { ThemeToggle } from "./theme-toggle";

function initialsFromName(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "M";
  if (parts.length === 1) return parts[0].slice(0, 1);
  return `${parts[0].slice(0, 1)}${parts[parts.length - 1].slice(0, 1)}`;
}

export function AppShellFrame({
  organizationName,
  organizationNameAlt,
  userName,
  jobTitle,
  flags,
  notificationsSlot,
  children,
}: {
  organizationName: string;
  organizationNameAlt: string;
  userName: string;
  jobTitle: string;
  flags: AppNavFlags;
  notificationsSlot: React.ReactNode;
  children: React.ReactNode;
}) {
  const { t } = useI18n();
  const pathname = usePathname();
  const [navOpen, setNavOpen] = useState(false);
  const routeKey = pathname;
  const [openForRoute, setOpenForRoute] = useState(routeKey);
  const drawerOpen = navOpen && openForRoute === routeKey;
  const initials = initialsFromName(userName);

  const setDrawerOpen = (next: boolean) => {
    setOpenForRoute(routeKey);
    setNavOpen(next);
  };

  useEffect(() => {
    if (!drawerOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [drawerOpen]);

  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpenForRoute(routeKey);
        setNavOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawerOpen, routeKey]);

  return (
    <div className="flex min-h-dvh min-w-0 overflow-x-clip bg-background">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:start-3 focus:top-3 focus:z-[70] focus:rounded-md focus:bg-surface focus:px-3 focus:py-2 focus:text-sm focus:text-ink"
      >
        {t.shell.skipToContent}
      </a>
      <NavigationPendingBar />
      {drawerOpen ? (
        <button
          type="button"
          aria-label={t.shell.closeMenu}
          className="fixed inset-0 z-40 bg-ink/50 backdrop-blur-[2px] xl:hidden print:hidden"
          onClick={() => setDrawerOpen(false)}
        />
      ) : null}

      <Sidebar
        flags={flags}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        userName={userName}
        jobTitle={jobTitle}
        initials={initials}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <header
          className="sticky top-0 z-30 flex min-h-16 items-center gap-3 border-b border-line/80 bg-surface/85 px-3 text-ink backdrop-blur-md md:px-6 print:hidden"
          style={{
            paddingTop: "max(0.5rem, env(safe-area-inset-top))",
            paddingInlineStart: "max(0.75rem, env(safe-area-inset-left))",
            paddingInlineEnd: "max(0.75rem, env(safe-area-inset-right))",
          }}
        >
          <button
            type="button"
            className="mt-icon-btn xl:hidden"
            aria-label={t.shell.openMenu}
            aria-expanded={drawerOpen}
            aria-controls="app-sidebar"
            onClick={() => setDrawerOpen(true)}
          >
            <Menu className="size-5" />
          </button>

          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-ink" title={organizationNameAlt || organizationName} dir="auto">
              {organizationName}
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
            <ThemeToggle />
            <LanguageSwitch />
            {flags.notifications ? notificationsSlot : null}
            <div className="mx-1 hidden h-6 w-px bg-line sm:block" aria-hidden />
            <div
              className="flex min-w-0 items-center gap-2.5 py-1"
              data-testid="header-account"
              title={jobTitle}
            >
              <span
                className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand to-primary text-xs font-semibold text-white shadow-sm"
                aria-hidden
              >
                {initials}
              </span>
              <div className="hidden min-w-0 lg:block">
                <p className="max-w-[12rem] truncate text-sm font-medium leading-tight text-ink" dir="auto">
                  {userName}
                </p>
                <p className="max-w-[12rem] truncate text-xs text-muted" dir="auto">
                  {jobTitle}
                </p>
              </div>
            </div>
            <form action={signOutAction}>
              <Button type="submit" variant="ghost" className="px-2.5" aria-label={t.shell.signOut} title={t.shell.signOut}>
                <LogOut className="size-4 rtl:-scale-x-100" aria-hidden />
                <span className="hidden sm:inline">{t.shell.signOut}</span>
              </Button>
            </form>
          </div>
        </header>

        <main
          id="main-content"
          className="min-w-0 w-full flex-1 px-4 py-5 md:px-8 md:py-7 print:max-w-none print:p-0"
          style={{ paddingBottom: "max(1.5rem, env(safe-area-inset-bottom))" }}
        >
          {children}
        </main>
      </div>
    </div>
  );
}
