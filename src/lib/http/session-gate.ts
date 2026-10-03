/** Interactive login vs cron Bearer. Used by proxy session middleware. */
export const NOTIFICATIONS_CRON_PATH = "/api/internal/notifications/run";

export function normalizeAppPathname(pathname: string): string {
  if (!pathname) return "/";
  if (pathname.length > 1 && pathname.endsWith("/")) return pathname.slice(0, -1);
  return pathname;
}

export function isNotificationsCronPath(pathname: string): boolean {
  return normalizeAppPathname(pathname) === NOTIFICATIONS_CRON_PATH;
}

/** True when unauthenticated browsers must be sent to /login. */
export function requiresInteractiveLogin(pathname: string): boolean {
  const path = normalizeAppPathname(pathname);
  if (isNotificationsCronPath(path)) return false;
  if (path === "/login" || path === "/auth/callback" || path.startsWith("/auth/")) return false;
  return true;
}
