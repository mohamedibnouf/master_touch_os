"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import {
  Banknote,
  Bell,
  BellRing,
  Building2,
  CalendarDays,
  CalendarCheck,
  ClipboardList,
  FileText,
  FolderKanban,
  LayoutDashboard,
  Search,
  Settings,
  Stamp,
  Users,
  Wrench,
  Shield,
  ShoppingCart,
  Wallet,
  Clock,
  Timer,
  Gauge,
  Sparkles,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/client";
import type { Dictionary } from "@/lib/i18n/dictionaries/ar";
import type { AppNavFlags } from "./nav-flags";

type NavItemKey = keyof Dictionary["nav"]["items"];
type NavGroupKey = keyof Dictionary["nav"]["groups"];
type FinanceKey = keyof Dictionary["nav"]["finance"];

type NavItem = { href: string; key: NavItemKey; icon: typeof LayoutDashboard; show: keyof AppNavFlags | "always" };

type NavGroup = { id: NavGroupKey; items: NavItem[] };

const groups: NavGroup[] = [
  {
    id: "home",
    items: [{ href: "/", key: "dashboard", icon: LayoutDashboard, show: "always" }],
  },
  {
    id: "my",
    items: [
      { href: "/attendance", key: "attendance", icon: Clock, show: "attendance" },
      { href: "/leave", key: "leave", icon: CalendarDays, show: "leave" },
      { href: "/approvals", key: "approvals", icon: Stamp, show: "approvals" },
      { href: "/notifications", key: "notifications", icon: Bell, show: "notifications" },
      { href: "/notifications/preferences", key: "notificationPreferences", icon: BellRing, show: "notifications" },
      { href: "/my/payslips", key: "payslips", icon: Banknote, show: "payslips" },
    ],
  },
  {
    id: "projects",
    items: [
      { href: "/projects", key: "projects", icon: FolderKanban, show: "projects" },
      { href: "/engineering", key: "engineering", icon: Wrench, show: "engineering" },
      { href: "/document-control", key: "documentControl", icon: ClipboardList, show: "documentControl" },
      { href: "/documents", key: "documents", icon: FileText, show: "documents" },
      { href: "/search", key: "search", icon: Search, show: "search" },
    ],
  },
  {
    id: "commercial",
    items: [
      { href: "/procurement", key: "procurement", icon: ShoppingCart, show: "procurement" },
      { href: "/finance", key: "finance", icon: Wallet, show: "finance" },
    ],
  },
  {
    id: "people",
    items: [
      { href: "/employees", key: "employees", icon: Users, show: "employees" },
      { href: "/departments", key: "departments", icon: Building2, show: "departments" },
      { href: "/hr/leave", key: "hrLeave", icon: CalendarCheck, show: "hrLeave" },
      { href: "/hr/attendance", key: "hrAttendance", icon: Timer, show: "hrAttendance" },
      { href: "/payroll", key: "payroll", icon: Banknote, show: "payroll" },
    ],
  },
  {
    id: "management",
    items: [
      { href: "/management", key: "management", icon: Gauge, show: "management" },
      { href: "/management/analyst", key: "analyst", icon: Sparkles, show: "analyst" },
    ],
  },
  {
    id: "system",
    items: [
      { href: "/settings", key: "settings", icon: Settings, show: "settings" },
      { href: "/settings/roles", key: "roles", icon: Shield, show: "roles" },
    ],
  },
];

const financeSubLinks: { href: string; key: FinanceKey; exact?: boolean }[] = [
  { href: "/finance", key: "dashboard", exact: true },
  { href: "/finance/supplier-invoices", key: "supplierInvoices" },
  { href: "/finance/client-valuations", key: "clientValuations" },
  { href: "/finance/client-invoices", key: "clientInvoices" },
  { href: "/finance/variations", key: "variations" },
  { href: "/finance/receivables", key: "receivables" },
];

/** Longest matching nav href wins, so /settings/roles does not also light up /settings. */
function activeHref(pathname: string, hrefs: string[]): string | null {
  let best: string | null = null;
  for (const href of hrefs) {
    const match = href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
    if (match && (!best || href.length > best.length)) best = href;
  }
  return best;
}

export function Sidebar({
  flags,
  open = false,
  onClose,
  userName,
  jobTitle,
  initials,
}: {
  flags: AppNavFlags;
  open?: boolean;
  onClose?: () => void;
  userName?: string;
  jobTitle?: string;
  initials?: string;
}) {
  const { t } = useI18n();
  const pathname = usePathname();
  const onFinance = pathname.startsWith("/finance");
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1280px)");
    const sync = () => setIsDesktop(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  const visibleGroups = groups
    .map((g) => ({
      ...g,
      items: g.items.filter((item) => item.show === "always" || flags[item.show]),
    }))
    .filter((g) => g.items.length > 0);
  const current = activeHref(
    pathname,
    visibleGroups.flatMap((g) => g.items.map((item) => item.href)),
  );

  return (
    <aside
      id="app-sidebar"
      aria-hidden={isDesktop ? false : !open}
      className={cn(
        "flex w-[17rem] shrink-0 flex-col bg-sidebar text-sidebar-ink print:hidden",
        "fixed inset-y-0 start-0 z-50 h-dvh max-xl:duration-200 max-xl:ease-out max-xl:transition-transform",
        "xl:sticky xl:top-0 xl:z-auto xl:translate-x-0 xl:transition-none",
        "pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]",
        open ? "max-xl:translate-x-0" : "max-xl:-translate-x-full max-xl:rtl:translate-x-full",
      )}
    >
      <div className="flex items-center justify-between gap-3 px-4 pb-4 pt-5">
        <Link href="/" onClick={onClose} className="flex min-w-0 items-center gap-3 rounded-lg outline-offset-4">
          <Image
            src="/icons/icon-192x192.png"
            alt=""
            width={36}
            height={36}
            priority
            className="size-9 shrink-0 rounded-[0.6rem] ring-1 ring-white/10"
          />
          <span className="min-w-0">
            <span className="block truncate text-[0.9375rem] font-semibold tracking-tight text-white">
              {t.common.appName}
            </span>
            <span className="block truncate text-xs text-sidebar-muted">{t.common.appTagline}</span>
          </span>
        </Link>
        <button
          type="button"
          className="inline-flex size-9 items-center justify-center rounded-lg text-sidebar-muted hover:bg-white/5 hover:text-white xl:hidden"
          aria-label={t.shell.closeMenu}
          onClick={onClose}
        >
          <X className="size-4" />
        </button>
      </div>

      <nav
        className="mt-sidebar-scroll flex-1 space-y-6 overflow-y-auto overscroll-contain px-3 pb-4 pt-2"
        aria-label={t.shell.mainNav}
      >
        {visibleGroups.map((group) => (
          <div key={group.id}>
            {group.id !== "home" ? (
              <p className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-wide text-sidebar-muted/80">
                {t.nav.groups[group.id]}
              </p>
            ) : null}
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const Icon = item.icon;
                const active = current === item.href;
                const isFinance = item.href === "/finance";
                return (
                  <div key={item.href}>
                    <Link
                      href={item.href}
                      onClick={onClose}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "group relative flex min-h-10 items-center gap-3 rounded-[var(--radius-control)] px-3 py-2 text-sm duration-150 transition-colors",
                        active
                          ? "bg-white/[0.08] font-medium text-white"
                          : "text-sidebar-ink/75 hover:bg-white/[0.04] hover:text-white",
                      )}
                    >
                      {active ? (
                        <span
                          aria-hidden
                          className="absolute inset-y-2 start-0 w-[3px] rounded-full bg-brand shadow-[0_0_12px_var(--brand-glow)]"
                        />
                      ) : null}
                      <Icon
                        className={cn(
                          "size-[1.125rem] shrink-0 duration-150 transition-colors",
                          active ? "text-brand" : "text-sidebar-muted group-hover:text-sidebar-ink",
                        )}
                        aria-hidden
                      />
                      <span className="truncate">{t.nav.items[item.key]}</span>
                    </Link>
                    {isFinance && onFinance ? (
                      <div className="ms-[1.3rem] mt-1 space-y-0.5 border-s border-sidebar-line ps-3">
                        {financeSubLinks.map((sub) => {
                          const subActive = sub.exact ? pathname === sub.href : pathname.startsWith(sub.href);
                          return (
                            <Link
                              key={sub.href}
                              href={sub.href}
                              onClick={onClose}
                              aria-current={subActive ? "page" : undefined}
                              data-testid={`sidebar-${sub.href.replaceAll("/", "-").slice(1)}`}
                              className={cn(
                                "block rounded-[var(--radius-control)] px-3 py-1.5 text-[0.8125rem] duration-150 transition-colors",
                                subActive
                                  ? "bg-white/[0.06] font-medium text-white"
                                  : "text-sidebar-muted hover:bg-white/[0.04] hover:text-white",
                              )}
                            >
                              {t.nav.finance[sub.key]}
                            </Link>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {userName ? (
        <div className="m-3 flex items-center gap-3 rounded-[var(--radius-surface)] bg-sidebar-elevated px-3 py-2.5 ring-1 ring-sidebar-line">
          <span
            className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand to-primary text-xs font-semibold text-white"
            aria-hidden
          >
            {initials}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium text-white" dir="auto">
              {userName}
            </span>
            {jobTitle ? (
              <span className="block truncate text-xs text-sidebar-muted" dir="auto">
                {jobTitle}
              </span>
            ) : null}
          </span>
        </div>
      ) : null}
    </aside>
  );
}
