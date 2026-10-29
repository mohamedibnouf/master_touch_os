import { describe, expect, it } from "vitest";
import { generateInternalAuthEmail, isInternalAuthEmail } from "@/lib/auth/employee-login";
import { mustChangePassword, passwordPolicyError } from "@/lib/auth/password-policy";
import { resetLoginRejectReason } from "@/lib/hr/account-security";

const base = {
  actorProfileId: "hr",
  targetProfileId: "emp",
  targetIsPlatformAdmin: false,
  targetRoleCodes: ["employee"],
  otherOrganizationMemberships: 0,
  targetHasInternalEmail: true,
  loginProvisioned: true,
  hasSignedIn: true,
  membershipActive: true,
};

describe("HR password reset guard", () => {
  it("allows an ordinary employee-number account", () => {
    expect(resetLoginRejectReason(base)).toBeNull();
  });

  it("never lets HR take over protected or real-mailbox accounts", () => {
    expect(resetLoginRejectReason({ ...base, actorProfileId: "emp" })).toBe("self");
    expect(resetLoginRejectReason({ ...base, targetIsPlatformAdmin: true })).toBe("platform_admin");
    expect(resetLoginRejectReason({ ...base, targetRoleCodes: ["general_manager"] })).toBe("privileged");
    expect(resetLoginRejectReason({ ...base, otherOrganizationMemberships: 1 })).toBe("other_org");
    expect(resetLoginRejectReason({ ...base, targetHasInternalEmail: false })).toBe("real_email");
  });

  it("requires an active, already provisioned login", () => {
    expect(resetLoginRejectReason({ ...base, loginProvisioned: false, hasSignedIn: false })).toBe("not_provisioned");
    expect(resetLoginRejectReason({ ...base, membershipActive: false })).toBe("inactive");
  });
});

describe("password helpers", () => {
  it("recognises generated employee-number e-mails", () => {
    expect(isInternalAuthEmail(generateInternalAuthEmail("11111111-1111-1111-1111-111111111111", "MT-0025"))).toBe(true);
    expect(isInternalAuthEmail("manager@mastertouch.sa")).toBe(false);
    expect(isInternalAuthEmail(null)).toBe(false);
  });

  it("enforces length and confirmation in the user's language", () => {
    expect(passwordPolicyError("short", "short", "en")).toMatch(/at least 8/);
    expect(passwordPolicyError("longenough1", "different1", "ar")).toBe("كلمتا المرور غير متطابقتين.");
    expect(passwordPolicyError("longenough1", "longenough1", "en")).toBeNull();
  });

  it("reads the forced-change flag from user metadata", () => {
    expect(mustChangePassword({ must_change_password: true })).toBe(true);
    expect(mustChangePassword({ must_change_password: false })).toBe(false);
    expect(mustChangePassword(undefined)).toBe(false);
  });
});
