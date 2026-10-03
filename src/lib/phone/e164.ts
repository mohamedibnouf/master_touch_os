/** Shared E.164 contact normalization. No carrier lookup. No country guessing for foreign locals. */

const E164_RE = /^\+[1-9][0-9]{7,14}$/;
const SAUDI_MOBILE_E164 = /^\+9665[0-9]{8}$/;

export type PhoneNormalizeFailure = "invalid" | "ambiguous_local";

export type PhoneNormalizeResult =
  | { ok: true; e164: string | null }
  | { ok: false; reason: PhoneNormalizeFailure };

export function isValidE164(value: string): boolean {
  return E164_RE.test(value);
}

export function isValidSaudiMobileE164(value: string): boolean {
  return SAUDI_MOBILE_E164.test(value);
}

/** Mask for UI surfaces that should not show a full number. */
export function maskE164(e164: string): string {
  if (!isValidE164(e164)) return "****";
  return `${e164.slice(0, 4)}****${e164.slice(-3)}`;
}

export function normalizeSaudiMobileToE164(raw: string | null | undefined): PhoneNormalizeResult {
  const base = normalizePhoneToE164(raw);
  if (!base.ok) return base;
  if (base.e164 === null) return base;
  if (!isValidSaudiMobileE164(base.e164)) return { ok: false, reason: "invalid" };
  return base;
}

/**
 * Canonical stored format is E.164 (`+` + 8–15 digits).
 * Saudi local 05 / 5 / 9665 forms are allowed because operations are KSA-based.
 * Already-valid international E.164 is preserved. Other national formats are rejected.
 */
export function normalizePhoneToE164(raw: string | null | undefined): PhoneNormalizeResult {
  if (raw == null) return { ok: true, e164: null };
  const trimmed = raw.trim();
  if (trimmed === "") return { ok: true, e164: null };
  if (/[A-Za-z]/.test(trimmed)) return { ok: false, reason: "invalid" };
  if ((trimmed.match(/\+/g) ?? []).length > 1) return { ok: false, reason: "invalid" };
  if (/\bext\.?\b|\sx\s*\d/i.test(trimmed) || /#\d+$/.test(trimmed) || /;\d+$/.test(trimmed)) {
    return { ok: false, reason: "invalid" };
  }

  let s = trimmed.replace(/[\s().\-]/g, "");
  if (!s) return { ok: false, reason: "invalid" };
  if (/[^0-9+]/.test(s)) return { ok: false, reason: "invalid" };
  if (s.includes("+") && !s.startsWith("+")) return { ok: false, reason: "invalid" };

  if (s.startsWith("00")) {
    s = `+${s.slice(2)}`;
  }

  if (s.startsWith("+")) {
    if (!E164_RE.test(s)) return { ok: false, reason: "invalid" };
    if (s.startsWith("+966") && !SAUDI_MOBILE_E164.test(s)) return { ok: false, reason: "invalid" };
    return { ok: true, e164: s };
  }

  if (!/^[0-9]+$/.test(s)) return { ok: false, reason: "invalid" };
  if (/^05[0-9]{8}$/.test(s)) return { ok: true, e164: `+966${s.slice(1)}` };
  if (/^5[0-9]{8}$/.test(s)) return { ok: true, e164: `+966${s}` };
  if (/^9665[0-9]{8}$/.test(s)) return { ok: true, e164: `+${s}` };

  return { ok: false, reason: "ambiguous_local" };
}
