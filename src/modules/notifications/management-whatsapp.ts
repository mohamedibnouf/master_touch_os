import { isValidE164, normalizePhoneToE164 } from "@/lib/phone/e164";

/** Mirrors 072 CHECK + trigger. Blank clears. Malformed is not treated as clear. */
export function parseManagementNotificationWhatsapp(
  raw: string | null | undefined,
): { ok: true; value: string | null } | { ok: false; reason: "invalid" } {
  if (raw == null || String(raw).trim() === "") return { ok: true, value: null };
  const result = normalizePhoneToE164(raw);
  if (!result.ok || !result.e164) return { ok: false, reason: "invalid" };
  return { ok: true, value: result.e164 };
}

export function normalizeManagementNotificationWhatsapp(raw: string | null | undefined): string | null {
  const parsed = parseManagementNotificationWhatsapp(raw);
  return parsed.ok ? parsed.value : null;
}

export function managementNotificationWhatsappCheckPasses(value: string | null): boolean {
  if (value === null) return true;
  return isValidE164(value);
}

export function authorizeManagementWhatsappChange(input: {
  trustedSession: boolean;
  authUid: string | null;
  hasSettingsManageOnTargetOrg: boolean;
  previous: string | null;
  next: string | null;
}): "allow" | "deny" {
  const previous = parseManagementNotificationWhatsapp(input.previous);
  const next = parseManagementNotificationWhatsapp(input.next);
  const prevVal = previous.ok ? previous.value : input.previous;
  const nextVal = next.ok ? next.value : input.next;
  if (prevVal === nextVal) return "allow";
  if (input.trustedSession) return "allow";
  if (!input.authUid || !input.hasSettingsManageOnTargetOrg) return "deny";
  return "allow";
}

export function managementWhatsappAuditPayload(previous: string | null, next: string | null): {
  previousValues: { set: boolean };
  newValues: { set: boolean };
} {
  return {
    previousValues: { set: previous !== null },
    newValues: { set: next !== null },
  };
}
