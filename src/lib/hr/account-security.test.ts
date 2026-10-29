import { describe, expect, it } from "vitest";
import {
  ACCOUNT_STATUS_REJECT_MESSAGES,
  EMPLOYMENT_OPTIONAL_FORM_FIELDS,
  PROVISION_LOGIN_REJECT_MESSAGES,
  accountStatusRejectReason,
  omitAbsentFormFields,
  provisionLoginRejectReason,
  riyadhTerminationTimestamp,
  terminationPatch,
} from "./account-security";

const freshAccount = {
  loginProvisioned: false,
  hasSignedIn: false,
  targetIsPlatformAdmin: false,
  targetRoleCodes: ["employee"],
  otherOrganizationMemberships: 0,
};

describe("provisionLoginRejectReason", () => {
  it("allows only an unused, unprivileged, single-org account", () => {
    expect(provisionLoginRejectReason(freshAccount)).toBeNull();
    expect(provisionLoginRejectReason({ ...freshAccount, targetRoleCodes: [] })).toBeNull();
  });

  it("refuses resetting an existing login (account takeover)", () => {
    expect(provisionLoginRejectReason({ ...freshAccount, loginProvisioned: true })).toBe("already_provisioned");
    expect(provisionLoginRejectReason({ ...freshAccount, hasSignedIn: true })).toBe("already_provisioned");
  });

  it("refuses platform admins, privileged role holders and other-org accounts", () => {
    expect(provisionLoginRejectReason({ ...freshAccount, targetIsPlatformAdmin: true })).toBe("platform_admin");
    expect(provisionLoginRejectReason({ ...freshAccount, targetRoleCodes: ["general_manager"] })).toBe("privileged");
    expect(provisionLoginRejectReason({ ...freshAccount, targetRoleCodes: ["employee", "super_admin"] })).toBe(
      "privileged",
    );
    expect(provisionLoginRejectReason({ ...freshAccount, otherOrganizationMemberships: 1 })).toBe("other_org");
  });

  it("has bilingual messages for every reason", () => {
    for (const message of Object.values(PROVISION_LOGIN_REJECT_MESSAGES)) {
      expect(message.ar.length).toBeGreaterThan(0);
      expect(message.en.length).toBeGreaterThan(0);
    }
  });
});

describe("accountStatusRejectReason", () => {
  const base = {
    actorProfileId: "actor",
    actorIsPlatformAdmin: false,
    actorRoleCodes: ["hr_manager"],
    targetProfileId: "target",
    targetIsPlatformAdmin: false,
    targetRoleCodes: ["employee"],
  };

  it("allows changing a regular account", () => {
    expect(accountStatusRejectReason(base)).toBeNull();
  });

  it("refuses self, platform admin and privileged targets for non-privileged actors", () => {
    expect(accountStatusRejectReason({ ...base, targetProfileId: "actor" })).toBe("self");
    expect(accountStatusRejectReason({ ...base, targetIsPlatformAdmin: true })).toBe("platform_admin");
    expect(accountStatusRejectReason({ ...base, targetRoleCodes: ["general_manager"] })).toBe("privileged");
  });

  it("lets privileged actors manage privileged targets but only platform admins touch platform admins", () => {
    expect(
      accountStatusRejectReason({ ...base, actorRoleCodes: ["general_manager"], targetRoleCodes: ["general_manager"] }),
    ).toBeNull();
    expect(
      accountStatusRejectReason({ ...base, actorRoleCodes: ["general_manager"], targetIsPlatformAdmin: true }),
    ).toBe("platform_admin");
    expect(
      accountStatusRejectReason({ ...base, actorIsPlatformAdmin: true, targetIsPlatformAdmin: true }),
    ).toBeNull();
    expect(Object.keys(ACCOUNT_STATUS_REJECT_MESSAGES)).toEqual(["self", "platform_admin", "privileged"]);
  });
});

describe("termination date", () => {
  it("uses the Riyadh calendar day so terminated_at::date matches in UTC and Riyadh", () => {
    // 22:30 UTC on Oct 28 is already Oct 29 in Riyadh.
    const ts = riyadhTerminationTimestamp(new Date("2026-10-28T22:30:00Z"));
    expect(ts).toBe("2026-10-29T12:00:00+03:00");
    expect(new Date(ts).toISOString().slice(0, 10)).toBe("2026-10-29");
  });

  it("stamps on termination/resignation, keeps an existing stamp, clears on reactivation", () => {
    const now = new Date("2026-10-29T08:00:00Z");
    expect(terminationPatch({ previousStatus: "active", nextStatus: "terminated", previousTerminatedAt: null, now })).toEqual({
      terminated_at: "2026-10-29T12:00:00+03:00",
    });
    expect(terminationPatch({ previousStatus: "probation", nextStatus: "resigned", previousTerminatedAt: null, now })).toEqual({
      terminated_at: "2026-10-29T12:00:00+03:00",
    });
    expect(
      terminationPatch({ previousStatus: "terminated", nextStatus: "resigned", previousTerminatedAt: "2026-01-01T09:00:00Z", now }),
    ).toBeUndefined();
    expect(
      terminationPatch({ previousStatus: "terminated", nextStatus: "active", previousTerminatedAt: "2026-01-01T09:00:00Z", now }),
    ).toEqual({ terminated_at: null });
    expect(terminationPatch({ previousStatus: "active", nextStatus: "on_leave", previousTerminatedAt: null, now })).toBeUndefined();
  });
});

describe("omitAbsentFormFields", () => {
  it("never nulls columns the form did not carry", () => {
    const form = new FormData();
    form.set("employment_status", "active");
    form.set("contract_start", "");
    const patch = omitAbsentFormFields(
      { employment_status: "active", contract_start: null, contract_end: null, direct_manager_employee_id: null },
      form,
      EMPLOYMENT_OPTIONAL_FORM_FIELDS,
    );
    expect(patch).toEqual({ employment_status: "active", contract_start: null });
    expect("contract_end" in patch).toBe(false);
    expect("direct_manager_employee_id" in patch).toBe(false);
  });
});
