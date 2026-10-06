const BLOCKED = /(iban|swift|salary|راتب|iban|حساب\s*بنك|account[_\s-]?number)/i;
const LONG_DIGIT = /\b\d{8,}\b/g;
const SAR_AMOUNT = /\b\d+[.,]?\d*\s*(sar|ر\.س|ريال)\b/gi;

export function redactNotificationText(input: string): string {
  let out = input.replace(LONG_DIGIT, "[redacted]");
  out = out.replace(SAR_AMOUNT, "[amount withheld]");
  if (BLOCKED.test(out)) {
    out = out.replace(BLOCKED, "[redacted]");
  }
  return out.slice(0, 500);
}

export function assertNoSensitivePayload(metadata: Record<string, unknown> | undefined): void {
  if (!metadata) return;
  const json = JSON.stringify(metadata).toLowerCase();
  if (json.includes("iban") || json.includes("account_number") || json.includes("net_pay") || json.includes("salary_amount")) {
    throw new Error("sensitive metadata is not allowed on notification events");
  }
}

/** Same-origin app path only. Rejects protocol-relative and absolute URLs. */
export function safeNotificationHref(href: string | null | undefined): string | null {
  if (!href) return null;
  const trimmed = href.trim().slice(0, 300);
  if (!trimmed.startsWith("/")) return null;
  if (trimmed.startsWith("//")) return null;
  if (trimmed.includes("://") || trimmed.includes("\\")) return null;
  if (trimmed.toLowerCase().includes("javascript:")) return null;
  if (trimmed.includes("..")) return null;
  if (!/^\/[A-Za-z0-9_\-./?=&%~]*$/.test(trimmed)) return null;
  return trimmed;
}

export function validatePushSubscription(input: {
  endpoint?: string;
  keys?: { p256dh?: string; auth?: string };
}): { endpoint: string; p256dh: string; auth: string } {
  const endpoint = input.endpoint?.trim() ?? "";
  const p256dh = input.keys?.p256dh?.trim() ?? "";
  const auth = input.keys?.auth?.trim() ?? "";
  if (!endpoint.startsWith("https://")) {
    throw new Error("invalid push endpoint");
  }
  if (p256dh.length < 8 || auth.length < 8) {
    throw new Error("invalid push keys");
  }
  return { endpoint, p256dh, auth };
}
