import Link from "next/link";
import { cn } from "@/lib/utils";

const links = [
  { href: "/management", label: "نظرة تنفيذية", exact: true },
  { href: "/management/reports", label: "التقارير" },
  { href: "/management/analyst", label: "محلل AI" },
  { href: "/management/projects", label: "المشاريع" },
  { href: "/management/operations", label: "العمليات" },
  { href: "/management/people", label: "الأفراد" },
  { href: "/management/finance", label: "المالية" },
  { href: "/management/digest", label: "الملخص اليومي" },
  { href: "/management/performance", label: "حقائق الأداء" },
  { href: "/management/activity", label: "النشاط" },
];

export function ManagementNav({ pathname }: { pathname: string }) {
  return (
    <nav
      className="mb-6 flex flex-wrap gap-2 border-b border-line pb-3"
      data-testid="management-nav"
      aria-label="إدارة"
    >
      {links.map((link) => {
        const active = link.exact
          ? pathname === link.href
          : pathname === link.href || pathname.startsWith(`${link.href}/`);
        return (
          <Link
            key={link.href}
            href={link.href}
            className={cn(
              "rounded-md px-3 py-2 text-sm font-medium",
              active ? "bg-navy text-white" : "bg-white text-ink hover:bg-paper",
            )}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
