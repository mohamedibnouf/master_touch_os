"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import { signOutAction } from "@/modules/auth/actions";
import { Button } from "@/components/ui/primitives";
import type { AppNavFlags } from "./nav-flags";
import { Sidebar } from "./sidebar";
import { NavigationPendingBar } from "./navigation-pending";

function initialsFromName(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "م";
  if (parts.length === 1) return parts[0].slice(0, 1);
  return `${parts[0].slice(0, 1)}${parts[parts.length - 1].slice(0, 1)}`;
}

export function AppShellFrame({
  organizationNameAr,
  organizationNameEn,
  userName,
  jobTitle,
  flags,
  notificationsSlot,
  children,
}: {
  organizationNameAr: string;
  organizationNameEn: string;
  userName: string;
  jobTitle: string;
  flags: AppNavFlags;
  notificationsSlot: React.ReactNode;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [navOpen, setNavOpen] = useState(false);
  const routeKey = pathname;
  const [openForRoute, setOpenForRoute] = useState(routeKey);
  const drawerOpen = navOpen && openForRoute === routeKey;

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
    <div className="flex min-h-dvh min-w-0 overflow-x-clip bg-paper">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:start-3 focus:top-3 focus:z-[70] focus:rounded-md focus:bg-white focus:px-3 focus:py-2 focus:text-sm focus:text-navy"
      >
        تخطي إلى المحتوى
      </a>
      <NavigationPendingBar />
      {drawerOpen ? (
        <button
          type="button"
          aria-label="إغلاق القائمة"
          className="fixed inset-0 z-40 bg-navy/40 xl:hidden print:hidden"
          onClick={() => setDrawerOpen(false)}
        />
      ) : null}

      <Sidebar flags={flags} open={drawerOpen} onClose={() => setDrawerOpen(false)} />

      <div className="flex min-w-0 flex-1 flex-col">
        <header
          className="flex min-h-14 items-center gap-3 bg-navy px-3 text-white md:px-6 print:hidden"
          style={{
            paddingTop: "max(0.75rem, env(safe-area-inset-top))",
            paddingInlineStart: "max(0.75rem, env(safe-area-inset-left))",
            paddingInlineEnd: "max(0.75rem, env(safe-area-inset-right))",
          }}
        >
          <button
            type="button"
            className="mt-icon-btn mt-icon-btn-inverse xl:hidden"
            aria-label="فتح القائمة"
            aria-expanded={drawerOpen}
            aria-controls="app-sidebar"
            onClick={() => setDrawerOpen(true)}
          >
            <Menu className="h-5 w-5" />
          </button>

          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-semibold tracking-[0.18em] text-bronze">MASTER TOUCH</p>
            <p className="truncate text-sm font-medium text-white" title={organizationNameEn || organizationNameAr}>
              {organizationNameAr}
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-2.5">
            {flags.notifications ? notificationsSlot : null}
            <div className="hidden h-7 w-px bg-white/15 sm:block" aria-hidden />
            <div
              className="flex min-w-0 items-center gap-2.5 rounded-[var(--radius-control)] bg-white/8 py-1 pe-1.5 ps-1"
              data-testid="header-account"
              title={jobTitle}
            >
              <span
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/15 text-[11px] font-semibold text-white"
                aria-hidden
              >
                {initialsFromName(userName)}
              </span>
              <div className="hidden min-w-0 sm:block">
                <p className="max-w-[10rem] truncate text-sm font-medium leading-tight text-white md:max-w-[14rem]" dir="auto">
                  {userName}
                </p>
                <p className="max-w-[10rem] truncate text-xs text-white/65 md:max-w-[14rem]" dir="auto">
                  {jobTitle}
                </p>
              </div>
            </div>
            <form action={signOutAction}>
              <Button
                type="submit"
                variant="ghost"
                className="min-h-11 px-2.5 text-sm text-white/80 hover:bg-white/10 hover:text-white md:min-h-9"
              >
                خروج
              </Button>
            </form>
          </div>
        </header>

        <main
          id="main-content"
          className="min-w-0 w-full flex-1 px-4 py-4 md:px-8 md:py-5 print:max-w-none print:p-0"
          style={{ paddingBottom: "max(1.25rem, env(safe-area-inset-bottom))" }}
        >
          {children}
        </main>
      </div>
    </div>
  );
}
