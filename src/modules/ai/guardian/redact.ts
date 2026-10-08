import { redactNotificationText, safeNotificationHref } from "@/modules/notifications/safety";
import type { DurableFinding } from "./types";

const SENSITIVE_EVIDENCE = /employee|iqama|passport|iban|salary|gosi|phone|name_ar|national/i;

export function sanitizeFindingEvidence(
  evidence: Record<string, string | number | boolean | null>,
): Record<string, string | number | boolean | null> {
  const out: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(evidence)) {
    if (SENSITIVE_EVIDENCE.test(key)) continue;
    if (typeof value === "string" && SENSITIVE_EVIDENCE.test(value)) continue;
    out[key] = value;
  }
  return out;
}

export function emailPayloadForFinding(finding: DurableFinding): { title: string; message: string; href: string | null } {
  if (finding.detector !== "rule") {
    throw new Error("model findings cannot generate guardian email");
  }
  const href = safeNotificationHref(finding.href) ?? "/management/risks";
  const title = redactNotificationText(`تنبيه مخاطر ${finding.severity}`);
  const message = redactNotificationText(
    "تنبيه مخاطر مسجّل. راجع سجل الحارس من الشاشات المعتمدة. لا تُرسل تفاصيل موظف أو رواتب أو حضور في البريد.",
  );
  return { title, message, href };
}

export function maySendCriticalEmail(finding: DurableFinding): boolean {
  return finding.detector === "rule" && finding.severity === "CRITICAL" && finding.status !== "dismissed";
}

export function maySendHighEmail(finding: DurableFinding, nowMs: number, delayMs: number): boolean {
  if (finding.detector !== "rule") return false;
  if (finding.severity !== "HIGH") return false;
  if (finding.status === "dismissed" || finding.status === "resolved") return false;
  const first = Date.parse(finding.firstSeenAt);
  if (!Number.isFinite(first)) return false;
  return nowMs - first >= delayMs;
}

export function withinCooldown(lastNotifiedAt: string | null, nowMs: number, cooldownMs: number): boolean {
  if (!lastNotifiedAt) return false;
  const t = Date.parse(lastNotifiedAt);
  if (!Number.isFinite(t)) return false;
  return nowMs - t < cooldownMs;
}
