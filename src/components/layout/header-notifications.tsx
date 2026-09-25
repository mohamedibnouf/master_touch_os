"use client";

import Link from "next/link";
import { Bell } from "lucide-react";

export type HeaderNotice = {
  id: string;
  title: string;
  created_at: string;
  read_at: string | null;
  href: string | null;
};

export function HeaderNotifications({
  unreadCount,
  items,
}: {
  unreadCount: number;
  items: HeaderNotice[];
}) {
  return (
    <details className="relative" data-testid="header-notifications">
      <summary
        className="relative flex h-11 w-11 cursor-pointer list-none items-center justify-center rounded-md border border-line text-navy marker:hidden [&::-webkit-details-marker]:hidden"
        aria-label={unreadCount > 0 ? `التنبيهات، ${unreadCount} غير مقروء` : "التنبيهات"}
      >
        <Bell className="h-4 w-4" />
        {unreadCount > 0 ? (
          <span
            data-testid="header-unread-count"
            className="absolute -top-1 -start-1 inline-flex min-w-5 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-semibold text-white"
          >
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        ) : null}
      </summary>
      <div className="absolute end-0 z-30 mt-2 w-[min(22rem,calc(100vw-2rem))] rounded-lg border border-line bg-white p-2 shadow-lg">
        {items.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-muted">لا توجد تنبيهات.</p>
        ) : (
          <ul className="max-h-80 space-y-1 overflow-y-auto">
            {items.map((item) => (
              <li key={item.id}>
                <Link
                  href={item.href ?? "/notifications"}
                  className="block rounded-md px-3 py-2 hover:bg-paper"
                >
                  <p className={`text-sm ${item.read_at ? "text-muted" : "font-medium text-navy"}`}>
                    {item.title}
                  </p>
                  <p className="text-xs text-muted">
                    {new Date(item.created_at).toLocaleString("ar-SA", { timeZone: "Asia/Riyadh" })}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
        <Link href="/notifications" className="mt-2 block rounded-md px-3 py-2 text-center text-sm text-navy hover:bg-paper">
          كل التنبيهات
        </Link>
      </div>
    </details>
  );
}
