"use client";

import type { ReactNode } from "react";
import {
  markNotificationReadBestEffort,
  planActionableNotificationTap,
} from "@/lib/notifications/tap";

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
  const plan = planActionableNotificationTap({ href, unread });
  if (!plan.href) {
    return <div className={className}>{children}</div>;
  }

  return (
    <a
      href={plan.href}
      className={className}
      data-testid="notification-nav-link"
      data-notification-href={plan.href}
      onClick={() => {
        if (plan.markRead) markNotificationReadBestEffort(id);
      }}
    >
      {children}
    </a>
  );
}
