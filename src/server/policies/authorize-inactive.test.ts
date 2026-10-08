import { describe, expect, it } from "vitest";
import { authorize, hasPermission, requireUser } from "./authorize";
import { isDisabledInteractiveAccount } from "@/lib/auth/interactive-account";
import type { AuthContext } from "@/types/models";
import { ForbiddenError, UnauthorizedError } from "@/lib/errors";
import { readFileSync } from "node:fs";

function ctx(partial: {
  profileActive?: boolean;
  membership?: AuthContext["membershipStatus"];
  employeeActive?: boolean | null;
}): AuthContext {
  return {
    userId: "u1",
    membershipStatus: partial.membership ?? "active",
    grants: [
      {
        roleCode: "employee",
        isExternal: false,
        organizationId: "11111111-1111-1111-1111-111111111111",
        scopeType: "organization",
        scopeId: null,
        permissions: ["notification.read"],
      },
    ],
    permissions: ["notification.read"],
    profile: {
      id: "u1",
      full_name_ar: "أ",
      full_name_en: "A",
      phone: null,
      locale: "ar",
      is_active: partial.profileActive ?? true,
      is_platform_admin: false,
      avatar_path: null,
      last_seen_at: null,
      created_at: "",
      updated_at: "",
    },
    organization: {
      id: "11111111-1111-1111-1111-111111111111",
      name_ar: "أ",
      name_en: "A",
      legal_name: null,
      commercial_registration: null,
      vat_number: null,
      logo_path: null,
      country: "SA",
      timezone: "Asia/Riyadh",
      default_currency: "SAR",
      status: "active",
      created_at: "",
      updated_at: "",
    },
    employee:
      partial.employeeActive === null || partial.employeeActive === undefined
        ? null
        : ({
            id: "e1",
            organization_id: "11111111-1111-1111-1111-111111111111",
            profile_id: "u1",
            is_active: partial.employeeActive,
          } as AuthContext["employee"]),
  };
}

describe("authorize inactive / membership parity after middleware slim", () => {
  it("rejects missing session", () => {
    expect(() => requireUser(null)).toThrow(UnauthorizedError);
  });

  it("rejects inactive profile, inactive employee, and revoked membership on actions/APIs", () => {
    expect(() => requireUser(ctx({ profileActive: false }))).toThrow(ForbiddenError);
    expect(() => requireUser(ctx({ employeeActive: false }))).toThrow(ForbiddenError);
    expect(() => requireUser(ctx({ membership: "removed" }))).toThrow(ForbiddenError);
    expect(hasPermission(ctx({ employeeActive: false }), "notification.read")).toBe(false);
    expect(() => authorize(ctx({ profileActive: false }), "notification.read")).toThrow(ForbiddenError);
  });

  it("allows GM without employee row", () => {
    const gm = ctx({ employeeActive: null });
    expect(isDisabledInteractiveAccount(gm)).toBe(false);
    expect(requireUser(gm).userId).toBe("u1");
  });

  it("AI actor and notification API go through requireUser/authorize", () => {
    const ai = readFileSync("src/server/use-cases/ai-platform.ts", "utf8");
    expect(ai).toContain("return requireUser(await getAuthContext())");
    const notify = readFileSync("src/server/use-cases/notification-read.ts", "utf8");
    expect(notify).toContain('authorize(ctx, "notification.read")');
  });
});
