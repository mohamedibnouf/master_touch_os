import { describe, expect, it } from "vitest";
import {
  EMPLOYEE_LOGIN_FAILURE_AR,
  EMPLOYEE_NUMBER_UNIQUENESS,
  assertLoginRateLimit,
  deriveEmployeeLoginUiStatus,
  generateInternalAuthEmail,
  isEmailIdentifier,
  isEmployeeLoginAllowed,
  normalizeEmployeeNumber,
  resetLoginRateLimitsForTests,
  resolveLoginCandidates,
} from "@/lib/auth/employee-login";

describe("employee-number login mapping", () => {
  it("treats employee number as identifier only — uniqueness is per organization (003)", () => {
    expect(EMPLOYEE_NUMBER_UNIQUENESS).toBe("organization_scoped");
  });

  it("classifies email vs employee number without requiring the employee to use email", () => {
    expect(isEmailIdentifier("gm@mastertouch.sa")).toBe(true);
    expect(isEmailIdentifier("MT-00025")).toBe(false);
    expect(normalizeEmployeeNumber("  MT-00025  ")).toBe("MT-00025");
  });

  it("resolves a valid unique employee number", () => {
    const result = resolveLoginCandidates(
      [
        {
          profile_id: "p1",
          organization_id: "o1",
          is_active: true,
          employee_number: "MT-00025",
        },
      ],
      "MT-00025",
    );
    expect(result.kind).toBe("unique");
    if (result.kind === "unique") expect(result.candidate.profile_id).toBe("p1");
  });

  it("treats missing employee number as none (no enumeration payload)", () => {
    expect(resolveLoginCandidates([], "MT-00025").kind).toBe("none");
  });

  it("treats the same number in two organizations as ambiguous — does not pick an org", () => {
    const result = resolveLoginCandidates(
      [
        { profile_id: "a", organization_id: "org-a", is_active: true, employee_number: "MT-00025" },
        { profile_id: "b", organization_id: "org-b", is_active: true, employee_number: "MT-00025" },
      ],
      "MT-00025",
    );
    expect(result.kind).toBe("ambiguous");
  });

  it("uses one generic Arabic failure for missing, inactive, and ambiguous cases", () => {
    expect(EMPLOYEE_LOGIN_FAILURE_AR).toBe("الرقم الوظيفي أو كلمة المرور غير صحيحة.");
    expect(EMPLOYEE_LOGIN_FAILURE_AR).not.toMatch(/MT-00025|لا يوجد|غير موجود/i);
  });

  it("blocks inactive employees even when the number maps uniquely", () => {
    expect(
      isEmployeeLoginAllowed({ employeeActive: false, profileActive: true, membershipActive: true }),
    ).toBe(false);
    expect(
      isEmployeeLoginAllowed({ employeeActive: true, profileActive: false, membershipActive: true }),
    ).toBe(false);
    expect(
      isEmployeeLoginAllowed({ employeeActive: true, profileActive: true, membershipActive: false }),
    ).toBe(false);
    expect(
      isEmployeeLoginAllowed({ employeeActive: true, profileActive: true, membershipActive: true }),
    ).toBe(true);
  });

  it("does not generate a user-facing email; internal mailbox is not an employee login field", () => {
    const email = generateInternalAuthEmail("11111111-1111-1111-1111-111111111111", "MT-00025");
    expect(email).toContain("@login.mastertouch.internal");
    expect(email.startsWith("mt.")).toBe(true);
    expect(isEmailIdentifier(email)).toBe(true);
    expect(email).not.toContain(".@");
  });

  it("marks HR login state: no account ready vs ready vs disabled", () => {
    expect(
      deriveEmployeeLoginUiStatus({
        employeeActive: true,
        profileActive: true,
        membershipActive: true,
        employeeNumber: "MT-1",
        loginProvisioned: false,
        hasSignedIn: false,
      }),
    ).toBe("not_provisioned");
    expect(
      deriveEmployeeLoginUiStatus({
        employeeActive: true,
        profileActive: true,
        membershipActive: true,
        employeeNumber: "MT-1",
        loginProvisioned: true,
        hasSignedIn: false,
      }),
    ).toBe("ready");
    expect(
      deriveEmployeeLoginUiStatus({
        employeeActive: false,
        profileActive: true,
        membershipActive: true,
        employeeNumber: "MT-1",
        loginProvisioned: true,
        hasSignedIn: true,
      }),
    ).toBe("disabled");
  });

  it("does not store or accept employee number as a password substitute", () => {
    const candidate = {
      profile_id: "p",
      organization_id: "o",
      is_active: true,
      employee_number: "MT-00025",
    };
    expect(resolveLoginCandidates([candidate], "MT-00025").kind).toBe("unique");
    expect(candidate).not.toHaveProperty("password");
  });
});

describe("login rate limit", () => {
  it("allows a burst then rejects further attempts from the same key", () => {
    resetLoginRateLimitsForTests();
    for (let i = 0; i < 8; i += 1) {
      expect(assertLoginRateLimit("10.0.0.1")).toBe(true);
    }
    expect(assertLoginRateLimit("10.0.0.1")).toBe(false);
    expect(assertLoginRateLimit("10.0.0.2")).toBe(true);
  });
});
