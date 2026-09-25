"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import { signOutAction } from "@/modules/auth/actions";
import { Button } from "@/components/ui/primitives";
import type { AppNavFlags } from "./nav-flags";
import type { HeaderNotice } from "./header-notifications";
import { HeaderNotifications } from "./header-notifications";
import { Sidebar } from "./sidebar";

export function AppShellFrame({
  organizationNameAr,
  organizationNameEn,
  userName,
  jobTitle,
  flags,
  unreadCount,
  notices,
  children,
}: {
  organizationNameAr: string;
  organizationNameEn: string;
  userName: string;
  jobTitle: string;
  flags: AppNavFlags;
  unreadCount: number;
  notices: HeaderNotice[];
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

  return (
    <div className="flex min-h-screen min-w-0 overflow-x-clip">
      {drawerOpen ? (
        <button
          type="button"
          aria-label="إغلاق القائمة"
          className="fixed inset-0 z-40 bg-black/40 lg:hidden print:hidden"
          onClick={() => setDrawerOpen(false)}
        />
      ) : null}

      <Sidebar flags={flags} open={drawerOpen} onClose={() => setDrawerOpen(false)} />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-2 border-b border-line bg-white px-3 py-2.5 md:px-6 print:hidden">
          <button
            type="button"
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-line text-navy lg:hidden"
            aria-label="فتح القائمة"
            aria-expanded={drawerOpen}
            aria-controls="app-sidebar"
            onClick={() => setDrawerOpen(true)}
          >
            <Menu className="h-5 w-5" />
          </button>

          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-navy">{organizationNameAr}</p>
            <p className="truncate text-xs text-muted">{organizationNameEn}</p>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {flags.notifications ? (
              <HeaderNotifications unreadCount={unreadCount} items={notices} />
            ) : null}
            <div className="hidden min-w-0 text-left text-sm sm:block">
              <p className="max-w-[10rem] truncate font-medium md:max-w-[14rem]">{userName}</p>
              <p className="max-w-[10rem] truncate text-xs text-muted md:max-w-[14rem]">{jobTitle}</p>
            </div>
            <form action={signOutAction}>
              <Button type="submit" variant="secondary" className="min-h-11 px-3 md:min-h-0">
                خروج
              </Button>
            </form>
          </div>
        </header>

        <main className="min-w-0 flex-1 px-3 py-4 md:px-6 md:py-6 print:p-0">{children}</main>
      </div>
    </div>
  );
}
