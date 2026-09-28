"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import {
  Banknote,
  Bell,
  Building2,
  CalendarDays,
  ClipboardList,
  FileText,
  FolderKanban,
  LayoutDashboard,
  Search,
  Settings,
  Stamp,
  Users,
  Wrench,
  ShoppingCart,
  Wallet,
  Clock,
  Gauge,
  Sparkles,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { AppNavFlags } from "./nav-flags";

type NavItem = { href: string; label: string; icon: typeof LayoutDashboard; show: keyof AppNavFlags | "always" };

type NavGroup = { id: string; label: string; items: NavItem[] };

const groups: NavGroup[] = [
  {
    id: "home",
    label: "الرئيسية",
    items: [{ href: "/", label: "عملي اليوم", icon: LayoutDashboard, show: "always" }],
  },
  {
    id: "my",
    label: "عملي",
    items: [
      { href: "/attendance", label: "الحضور", icon: Clock, show: "attendance" },
      { href: "/leave", label: "الإجازات", icon: CalendarDays, show: "leave" },
      { href: "/approvals", label: "الموافقات", icon: Stamp, show: "approvals" },
      { href: "/notifications", label: "التنبيهات", icon: Bell, show: "notifications" },
      { href: "/notifications/preferences", label: "تفضيلات التنبيه", icon: Bell, show: "notifications" },
      { href: "/my/payslips", label: "قسائمي", icon: Banknote, show: "payslips" },
    ],
  },
  {
    id: "projects",
    label: "المشاريع",
    items: [
      { href: "/projects", label: "المشاريع", icon: FolderKanban, show: "projects" },
      { href: "/engineering", label: "الهندسة", icon: Wrench, show: "engineering" },
      { href: "/document-control", label: "مراقبة الوثائق", icon: ClipboardList, show: "documentControl" },
      { href: "/documents", label: "المستندات", icon: FileText, show: "documents" },
      { href: "/search", label: "بحث موحّد", icon: Search, show: "search" },
    ],
  },
  {
    id: "commercial",
    label: "التشغيل",
    items: [
      { href: "/procurement", label: "المشتريات", icon: ShoppingCart, show: "procurement" },
      { href: "/finance", label: "المالية", icon: Wallet, show: "finance" },
    ],
  },
  {
    id: "people",
    label: "الأفراد",
    items: [
      { href: "/employees", label: "الموظفون", icon: Users, show: "employees" },
      { href: "/departments", label: "الإدارات", icon: Building2, show: "departments" },
      { href: "/hr/leave", label: "إدارة الإجازات", icon: CalendarDays, show: "hrLeave" },
      { href: "/hr/attendance", label: "إدارة الحضور", icon: Clock, show: "hrAttendance" },
      { href: "/payroll", label: "الرواتب", icon: Banknote, show: "payroll" },
    ],
  },
  {
    id: "management",
    label: "الإدارة",
    items: [
      { href: "/management", label: "مركز القيادة", icon: Gauge, show: "management" },
      { href: "/management/analyst", label: "المحلل الذكي", icon: Sparkles, show: "analyst" },
    ],
  },
  {
    id: "system",
    label: "النظام",
    items: [{ href: "/settings", label: "الإعدادات", icon: Settings, show: "settings" }],
  },
];

const financeSubLinks = [
  { href: "/finance", label: "لوحة المالية", exact: true },
  { href: "/finance/supplier-invoices", label: "فواتير الموردين" },
  { href: "/finance/client-valuations", label: "مستخلصات العملاء" },
  { href: "/finance/client-invoices", label: "فواتير العملاء" },
  { href: "/finance/variations", label: "أوامر التغيير" },
  { href: "/finance/receivables", label: "ذمم العملاء" },
];

export function Sidebar({
  flags,
  open = false,
  onClose,
}: {
  flags: AppNavFlags;
  open?: boolean;
  onClose?: () => void;
}) {
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

  return (
    <aside
      id="app-sidebar"
      aria-hidden={isDesktop ? false : !open}
      className={cn(
        "flex w-72 shrink-0 flex-col bg-navy text-white print:hidden",
        "fixed inset-y-0 start-0 z-50 h-dvh max-xl:duration-200 max-xl:ease-out max-xl:transition-transform",
        "xl:static xl:z-auto xl:h-auto xl:min-h-dvh xl:self-stretch xl:translate-x-0 xl:transition-none",
        "pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]",
        open ? "max-xl:translate-x-0" : "max-xl:-translate-x-full max-xl:rtl:translate-x-full",
      )}
      style={{
        background:
          "linear-gradient(180deg, #24365e 0%, #1b2a4a 28%, #162238 100%)",
      }}
    >
      <div className="flex items-start justify-between gap-3 px-5 pb-5 pt-6">
        <div className="min-w-0">
          <div className="mb-3 h-1 w-8 rounded-full bg-bronze" aria-hidden />
          <p className="text-[11px] font-semibold tracking-[0.22em] text-bronze">MASTER TOUCH</p>
          <p className="mt-1.5 text-[15px] font-semibold leading-snug">نظام التشغيل</p>
        </div>
        <button
          type="button"
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--radius-control)] text-white/90 duration-150 hover:bg-white/10 xl:hidden"
          aria-label="إغلاق القائمة"
          onClick={onClose}
        >
          <X className="h-5 w-5" />
        </button>
      </div>
      <div className="mx-5 h-px bg-white/10" aria-hidden />
      <nav className="flex-1 space-y-6 overflow-y-auto overscroll-contain px-3 py-5" aria-label="التنقل الرئيسي">
        {visibleGroups.map((group) => (
          <div key={group.id}>
            {group.id !== "home" ? (
              <p className="px-3 pb-2 text-[11px] font-medium text-white/70">{group.label}</p>
            ) : null}
            <div className="space-y-1">
              {group.items.map((item) => {
                const Icon = item.icon;
                const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
                const isFinance = item.href === "/finance";
                return (
                  <div key={item.href}>
                    <Link
                      href={item.href}
                      onClick={onClose}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "relative flex min-h-11 items-center gap-3 rounded-[var(--radius-control)] px-2.5 py-2 text-sm duration-150 transition-colors xl:min-h-10",
                        active
                          ? "bg-white/12 font-medium text-white"
                          : "text-white/80 hover:bg-white/8 hover:text-white",
                      )}
                    >
                      {active ? (
                        <span className="absolute inset-y-2 start-0 w-0.5 rounded-full bg-bronze" aria-hidden />
                      ) : null}
                      <span
                        className={cn(
                          "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
                          active ? "bg-white/12 text-bronze" : "bg-white/6 text-white/85",
                        )}
                        aria-hidden
                      >
                        <Icon className="h-4 w-4" />
                      </span>
                      <span className="truncate">{item.label}</span>
                    </Link>
                    {isFinance && onFinance ? (
                      <div className="me-2 mt-1 space-y-0.5 border-s border-white/10 pe-2">
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
                                "block rounded-[var(--radius-control)] py-2 pe-3 ps-6 text-xs duration-150 transition-colors",
                                subActive ? "bg-white/10 font-medium text-white" : "text-white/70 hover:bg-white/6 hover:text-white",
                              )}
                            >
                              {sub.label}
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
    </aside>
  );
}
