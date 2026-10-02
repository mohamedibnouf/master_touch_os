import { safeNotificationHref } from "./safety";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function parseAppBaseUrl(raw: string | undefined | null): URL | null {
  if (!raw?.trim()) return null;
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.username || url.password) return null;
    return url;
  } catch {
    return null;
  }
}

export function isPublicHttpsAppUrl(url: URL): boolean {
  if (url.protocol !== "https:") return false;
  const host = url.hostname.toLowerCase();
  if (LOCAL_HOSTS.has(host)) return false;
  if (host.endsWith(".local")) return false;
  return true;
}

/** Deep link for email: origin + validated app path only. */
export function buildNotificationEmailHref(base: URL, href: string | null | undefined): string {
  const path = safeNotificationHref(href);
  if (!path) return `${base.origin}/`;
  return `${base.origin}${path}`;
}

export function resolveEmailAppBaseUrl(
  raw: string | undefined | null,
  options: { requirePublicHttps: boolean },
): { ok: true; url: URL } | { ok: false; code: string } {
  const parsed = parseAppBaseUrl(raw);
  if (!parsed) return { ok: false, code: "invalid_app_url" };
  if (options.requirePublicHttps && !isPublicHttpsAppUrl(parsed)) {
    return { ok: false, code: "invalid_app_url" };
  }
  return { ok: true, url: parsed };
}
