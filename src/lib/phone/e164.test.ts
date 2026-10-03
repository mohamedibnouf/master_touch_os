import { describe, expect, it } from "vitest";
import { isValidE164, maskE164, normalizePhoneToE164, normalizeSaudiMobileToE164 } from "./e164";

describe("E.164 phone normalization", () => {
  it("normalizes Saudi 05 local", () => {
    expect(normalizePhoneToE164("0501234567")).toEqual({ ok: true, e164: "+966501234567" });
    expect(normalizeSaudiMobileToE164("05 012 345 67")).toEqual({ ok: true, e164: "+966501234567" });
  });

  it("normalizes Saudi 5XXXXXXXX", () => {
    expect(normalizePhoneToE164("501234567")).toEqual({ ok: true, e164: "+966501234567" });
  });

  it("normalizes 966 without plus", () => {
    expect(normalizePhoneToE164("966501234567")).toEqual({ ok: true, e164: "+966501234567" });
  });

  it("preserves +966 mobile", () => {
    expect(normalizePhoneToE164("+966501234567")).toEqual({ ok: true, e164: "+966501234567" });
  });

  it("accepts 00 international prefix for Saudi mobile", () => {
    expect(normalizePhoneToE164("00966501234567")).toEqual({ ok: true, e164: "+966501234567" });
  });

  it("accepts valid foreign E.164", () => {
    expect(normalizePhoneToE164("+14155552671")).toEqual({ ok: true, e164: "+14155552671" });
    expect(isValidE164("+442071838750")).toBe(true);
  });

  it("keeps blank and null as null", () => {
    expect(normalizePhoneToE164(null)).toEqual({ ok: true, e164: null });
    expect(normalizePhoneToE164("")).toEqual({ ok: true, e164: null });
    expect(normalizePhoneToE164("   ")).toEqual({ ok: true, e164: null });
  });

  it("rejects alphabetic, extensions, double plus, and unsafe formats", () => {
    expect(normalizePhoneToE164("0501234567ext9").ok).toBe(false);
    expect(normalizePhoneToE164("phone0501234567").ok).toBe(false);
    expect(normalizePhoneToE164("++966501234567").ok).toBe(false);
    expect(normalizePhoneToE164("+96650-ABC").ok).toBe(false);
    expect(normalizePhoneToE164("0501234567;123").ok).toBe(false);
  });

  it("rejects too short or too long", () => {
    expect(normalizePhoneToE164("05").ok).toBe(false);
    expect(normalizePhoneToE164("+9665").ok).toBe(false);
    expect(normalizePhoneToE164("+966501234567890123").ok).toBe(false);
  });

  it("does not guess country for arbitrary foreign locals", () => {
    expect(normalizePhoneToE164("07123456789")).toEqual({ ok: false, reason: "ambiguous_local" });
    expect(normalizePhoneToE164("4155552671")).toEqual({ ok: false, reason: "ambiguous_local" });
  });

  it("rejects Saudi landline E.164 (not mobile)", () => {
    expect(normalizePhoneToE164("+966112345678").ok).toBe(false);
  });

  it("masks E.164 without exposing the full number", () => {
    const masked = maskE164("+966501234567");
    expect(masked).not.toBe("+966501234567");
    expect(masked).toContain("****");
  });
});
