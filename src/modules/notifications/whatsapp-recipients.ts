import { isValidE164, normalizePhoneToE164 } from "@/lib/phone/e164";

export function resolvePersonalWhatsAppE164(input: {
  phone: string | null | undefined;
  optIn: boolean;
}): string | null {
  if (!input.optIn) return null;
  const normalized = normalizePhoneToE164(input.phone);
  if (!normalized.ok || !normalized.e164 || !isValidE164(normalized.e164)) return null;
  return normalized.e164;
}

export function resolveManagementWhatsAppE164(raw: string | null | undefined): string | null {
  const normalized = normalizePhoneToE164(raw);
  if (!normalized.ok || !normalized.e164 || !isValidE164(normalized.e164)) return null;
  return normalized.e164;
}

/** Personal eligibility after provider + allowlist + category preference. */
export function personalWhatsAppDestinationAllowed(input: {
  phone: string | null | undefined;
  optIn: boolean;
  memberActive: boolean;
}): boolean {
  if (!input.memberActive) return false;
  return resolvePersonalWhatsAppE164({ phone: input.phone, optIn: input.optIn }) !== null;
}
