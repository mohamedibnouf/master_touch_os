import { isPostgresUuid } from "@/lib/postgres-uuid";
import { safeNotificationHref } from "@/modules/notifications/safety";

export const NOTIFICATION_READ_PATH = "/api/notifications/read";

/**
 * Navigation is independent of mark-as-read. A failed read update must not
 * change or invent a destination.
 */
export function notificationTapDestination(
  storedOrResolvedHref: string | null | undefined,
  _markReadSucceeded: boolean,
): string | null {
  void _markReadSucceeded;
  return safeNotificationHref(storedOrResolvedHref);
}

export function parseNotificationReadId(raw: unknown): string | null {
  if (!raw || typeof raw !== "object") return null;
  const id = (raw as { id?: unknown }).id;
  if (typeof id !== "string" || !isPostgresUuid(id)) return null;
  return id;
}

export type NotificationTapPlan = {
  href: string | null;
  markRead: boolean;
  awaitMarkRead: false;
  preventDefault: false;
  usesServerAction: false;
};

export function planActionableNotificationTap(input: {
  href: string | null | undefined;
  unread: boolean;
}): NotificationTapPlan {
  const href = safeNotificationHref(input.href);
  return {
    href,
    markRead: Boolean(href && input.unread),
    awaitMarkRead: false,
    preventDefault: false,
    usesServerAction: false,
  };
}

/** Same-origin POST that does not go through a Next.js Server Action / RSC refresh. */
export function markNotificationReadBestEffort(id: string): void {
  if (typeof fetch !== "function" || !isPostgresUuid(id)) return;
  void fetch(NOTIFICATION_READ_PATH, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id }),
    credentials: "same-origin",
    keepalive: true,
  }).catch(() => undefined);
}
