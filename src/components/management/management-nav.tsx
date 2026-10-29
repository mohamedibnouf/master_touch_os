import Link from "next/link";
import { cn } from "@/lib/utils";
import { getI18n } from "@/lib/i18n/server";
import type { Dictionary } from "@/lib/i18n/dictionaries/ar";

type NavKey = Exclude<keyof Dictionary["management"]["nav"], "ariaLabel">;

const links: Array<{ href: string; key: NavKey; exact?: boolean }> = [
  { href: "/management", key: "overview", exact: true },
  { href: "/management/risks", key: "risks" },
  { href: "/management/reports", key: "reports" },
  { href: "/management/analyst", key: "analyst" },
  { href: "/management/projects", key: "projects" },
  { href: "/management/operations", key: "operations" },
  { href: "/management/people", key: "people" },
  { href: "/management/finance", key: "finance" },
  { href: "/management/digest", key: "digest" },
  { href: "/management/performance", key: "performance" },
  { href: "/management/activity", key: "activity" },
];

export async function ManagementNav({ pathname }: { pathname: string }) {
  const { t } = await getI18n();
  const nav = t.management.nav;
  return (
    <nav
      className="-mx-1 flex gap-1 overflow-x-auto border-b border-line px-1 pb-2 print:hidden"
      data-testid="management-nav"
      aria-label={nav.ariaLabel}
    >
      {links.map((link) => {
        const active = link.exact
          ? pathname === link.href
          : pathname === link.href || pathname.startsWith(`${link.href}/`);
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "shrink-0 whitespace-nowrap rounded-[var(--radius-control)] px-3 py-1.5 text-sm font-medium transition-colors",
              active ? "bg-primary-soft text-primary" : "text-muted hover:bg-surface-muted hover:text-ink",
            )}
          >
            {nav[link.key]}
          </Link>
        );
      })}
    </nav>
  );
}
