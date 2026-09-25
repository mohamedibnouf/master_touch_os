/** Shared cron gate for `/api/internal/notifications/run`. Not an RPC. */
export function notificationsCronSecret(): string | null {
  const secret = process.env.NOTIFICATIONS_CRON_SECRET || process.env.CRON_SECRET || "";
  if (secret.length < 16) return null;
  return secret;
}

export function isNotificationsCronAuthorized(authorizationHeader: string | null): boolean {
  const secret = notificationsCronSecret();
  if (!secret) return false;
  return authorizationHeader === `Bearer ${secret}`;
}
