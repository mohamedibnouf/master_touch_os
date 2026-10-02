/** Shared cron gate for `/api/internal/notifications/run`. Not an RPC. */
import { timingSafeEqual } from "node:crypto";

function usableSecret(value: string | undefined): string | null {
  const secret = value ?? "";
  if (secret.length < 16) return null;
  return secret;
}

/** Vercel Cron sends `Authorization: Bearer ${CRON_SECRET}`. Alias supported. */
export function notificationsCronSecret(): string | null {
  return usableSecret(process.env.CRON_SECRET) ?? usableSecret(process.env.NOTIFICATIONS_CRON_SECRET);
}

function bearerEquals(header: string, secret: string): boolean {
  const expected = `Bearer ${secret}`;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function isNotificationsCronAuthorized(authorizationHeader: string | null): boolean {
  if (!authorizationHeader) return false;
  const primary = usableSecret(process.env.CRON_SECRET);
  const alias = usableSecret(process.env.NOTIFICATIONS_CRON_SECRET);
  if (primary && bearerEquals(authorizationHeader, primary)) return true;
  if (alias && bearerEquals(authorizationHeader, alias)) return true;
  return false;
}
