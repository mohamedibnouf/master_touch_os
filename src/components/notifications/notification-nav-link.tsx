"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { markNotificationReadAction } from "@/server/use-cases/platform";
import { safeNotificationHref } from "@/modules/notifications/safety";

export function NotificationNavLink({
  id,
  href,
  unread,
  className,
  children,
}: {
  id: string;
  href: string;
  unread: boolean;
  className?: string;
  children: ReactNode;
}) {
  const safe = safeNotificationHref(href);
  if (!safe) {
    return <div className={className}>{children}</div>;
  }

  return (
    <Link
      href={safe}
      className={className}
      data-testid="notification-nav-link"
      data-notification-href={safe}
      onClick={() => {
        if (!unread) return;
        const fd = new FormData();
        fd.set("id", id);
        void markNotificationReadAction({ ok: true }, fd);
      }}
    >
      {children}
    </Link>
  );
}
