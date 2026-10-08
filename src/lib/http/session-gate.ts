/** Interactive login vs cron Bearer. Used by proxy session middleware. */
export const NOTIFICATIONS_CRON_PATH = "/api/internal/notifications/run";
export const GUARDIAN_CRON_PATH = "/api/internal/guardian/run";

export function normalizeAppPathname(pathname: string): string {
  if (!pathname) return "/";
  if (pathname.length > 1 && pathname.endsWith("/")) return pathname.slice(0, -1);
  return pathname;
}

export function isNotificationsCronPath(pathname: string): boolean {
  return normalizeAppPathname(pathname) === NOTIFICATIONS_CRON_PATH;
}

export function isGuardianCronPath(pathname: string): boolean {
  return normalizeAppPathname(pathname) === GUARDIAN_CRON_PATH;
}

/** Exact daily + hourly cron paths only. Not a prefix match. */
export function isInternalCronPath(pathname: string): boolean {
  const path = normalizeAppPathname(pathname);
  return path === NOTIFICATIONS_CRON_PATH || path === GUARDIAN_CRON_PATH;
}

/** True when unauthenticated browsers must be sent to /login. */
export function requiresInteractiveLogin(pathname: string): boolean {
  const path = normalizeAppPathname(pathname);
  if (isInternalCronPath(path)) return false;
  if (path === "/login" || path === "/auth/callback" || path.startsWith("/auth/")) return false;
  return true;
}
