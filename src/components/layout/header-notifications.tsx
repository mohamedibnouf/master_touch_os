"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { Bell } from "lucide-react";
import { formatRiyadhDateTimeAr } from "@/modules/projects/deadline";
import { NotificationNavLink } from "@/components/notifications/notification-nav-link";

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
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="relative" data-testid="header-notifications" ref={rootRef}>
      <button
        type="button"
        className="mt-icon-btn relative cursor-pointer"
        aria-label={unreadCount > 0 ? `التنبيهات، ${unreadCount} غير مقروء` : "التنبيهات"}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
      >
        <Bell className="h-4 w-4" aria-hidden />
        {unreadCount > 0 ? (
          <span
            data-testid="header-unread-count"
            className="absolute -top-1 -start-1 inline-flex min-w-5 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-semibold text-white"
          >
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        ) : null}
      </button>
      {open ? (
        <div
          id={panelId}
          role="dialog"
          aria-label="التنبيهات"
          className="absolute end-0 z-30 mt-2 w-[min(22rem,calc(100vw-2rem))] rounded-[var(--radius-surface)] border border-line bg-white p-2 shadow-[var(--shadow-2)]"
        >
          {items.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted">لا توجد تنبيهات.</p>
          ) : (
            <ul className="max-h-80 space-y-1 overflow-y-auto">
              {items.map((item) => (
                <li key={item.id}>
                  {item.href ? (
                    <NotificationNavLink
                      id={item.id}
                      href={item.href}
                      unread={!item.read_at}
                      className="block rounded-[var(--radius-control)] px-3 py-2 duration-150 hover:bg-surface-muted"
                    >
                      <p
                        className={`text-sm ${item.read_at ? "text-muted" : "font-medium text-ink"}`}
                        dir="auto"
                      >
                        {item.title}
                      </p>
                      <p className="text-xs text-muted">{formatRiyadhDateTimeAr(item.created_at)}</p>
                    </NotificationNavLink>
                  ) : (
                    <div className="rounded-[var(--radius-control)] px-3 py-2">
                      <p
                        className={`text-sm ${item.read_at ? "text-muted" : "font-medium text-ink"}`}
                        dir="auto"
                      >
                        {item.title}
                      </p>
                      <p className="text-xs text-muted">{formatRiyadhDateTimeAr(item.created_at)}</p>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
          <Link
            href="/notifications"
            className="mt-2 block rounded-[var(--radius-control)] px-3 py-2 text-center text-sm font-medium text-primary duration-150 hover:bg-surface-muted"
            onClick={() => setOpen(false)}
          >
            كل التنبيهات
          </Link>
        </div>
      ) : null}
    </div>
  );
}
