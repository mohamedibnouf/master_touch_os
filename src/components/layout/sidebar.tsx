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
  Shield,
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
    items: [{ href: "/", label: "لوحة العمل", icon: LayoutDashboard, show: "always" }],
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
    label: "الموارد البشرية",
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
    items: [
      { href: "/settings", label: "الإعدادات", icon: Settings, show: "settings" },
      { href: "/settings/roles", label: "الأدوار والصلاحيات", icon: Shield, show: "roles" },
    ],
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
  userName,
  jobTitle,
}: {
  flags: AppNavFlags;
  open?: boolean;
  onClose?: () => void;
  userName?: string;
  jobTitle?: string;
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
        "flex w-[16.5rem] shrink-0 flex-col border-e border-line bg-white text-ink print:hidden",
        "fixed inset-y-0 start-0 z-50 h-dvh max-xl:duration-200 max-xl:ease-out max-xl:transition-transform",
        "xl:static xl:z-auto xl:h-auto xl:min-h-dvh xl:self-stretch xl:translate-x-0 xl:transition-none",
        "pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]",
        open ? "max-xl:translate-x-0" : "max-xl:-translate-x-full max-xl:rtl:translate-x-full",
      )}
    >
      <div className="flex items-start justify-between gap-3 px-4 pb-4 pt-5">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-ink">Master Touch</p>
          <p className="mt-0.5 text-xs text-muted">نظام التشغيل</p>
        </div>
        <button
          type="button"
          className="mt-icon-btn xl:hidden"
          aria-label="إغلاق القائمة"
          onClick={onClose}
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="mx-4 h-px bg-line" aria-hidden />
      <nav className="flex-1 space-y-5 overflow-y-auto overscroll-contain px-3 py-4" aria-label="التنقل الرئيسي">
        {visibleGroups.map((group) => (
          <div key={group.id}>
            {group.id !== "home" ? (
              <p className="px-2.5 pb-1.5 text-[11px] font-medium text-muted">{group.label}</p>
            ) : null}
            <div className="space-y-0.5">
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
                        "flex min-h-10 items-center gap-2.5 rounded-[var(--radius-control)] px-2.5 py-1.5 text-sm duration-150 transition-colors",
                        active
                          ? "bg-primary/10 font-medium text-primary"
                          : "text-ink/80 hover:bg-surface-muted hover:text-ink",
                      )}
                    >
                      <Icon className="h-4 w-4 shrink-0" aria-hidden />
                      <span className="truncate">{item.label}</span>
                    </Link>
                    {isFinance && onFinance ? (
                      <div className="me-2 mt-1 space-y-0.5 border-s border-line pe-2">
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
                                "block rounded-[var(--radius-control)] py-1.5 pe-3 ps-6 text-xs duration-150 transition-colors",
                                subActive ? "bg-primary/10 font-medium text-primary" : "text-muted hover:bg-surface-muted hover:text-ink",
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
      {userName ? (
        <div className="border-t border-line px-4 py-3">
          <p className="truncate text-sm font-medium text-ink" dir="auto">
            {userName}
          </p>
          {jobTitle ? (
            <p className="truncate text-xs text-muted" dir="auto">
              {jobTitle}
            </p>
          ) : null}
        </div>
      ) : null}
    </aside>
  );
}
