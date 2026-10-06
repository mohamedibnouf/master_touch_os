import { safeNotificationHref } from "@/modules/notifications/safety";

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
