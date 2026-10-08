import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { isDisabledInteractiveAccount } from "./interactive-account";
import type { AuthContext } from "@/types/models";

function ctx(partial: { profileActive: boolean; employeeActive: boolean | null }): AuthContext {
  return {
    userId: "u1",
    membershipStatus: "active",
    grants: [],
    permissions: [],
    profile: {
      id: "u1",
      full_name_ar: "أ",
      full_name_en: "A",
      phone: null,
      locale: "ar",
      is_active: partial.profileActive,
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
      partial.employeeActive === null
        ? null
        : {
            id: "e1",
            organization_id: "11111111-1111-1111-1111-111111111111",
            profile_id: "u1",
            employee_number: "1",
            job_title_id: null,
            job_title_ar: null,
            job_title_en: null,
            employment_status: "active",
            employment_type: null,
            date_of_birth: null,
            gender: null,
            joining_date: null,
            is_active: partial.employeeActive,
            created_at: "",
            updated_at: "",
          },
  } as AuthContext;
}

describe("interactive account gate", () => {
  it("allows GM without an employee row", () => {
    expect(isDisabledInteractiveAccount(ctx({ profileActive: true, employeeActive: null }))).toBe(false);
  });

  it("blocks inactive profile and inactive employee", () => {
    expect(isDisabledInteractiveAccount(ctx({ profileActive: false, employeeActive: null }))).toBe(true);
    expect(isDisabledInteractiveAccount(ctx({ profileActive: true, employeeActive: false }))).toBe(true);
  });

  it("layout signs out disabled accounts; middleware no longer queries profiles/employees", () => {
    const layout = readFileSync("src/app/(app)/layout.tsx", "utf8");
    expect(layout).toContain("isDisabledInteractiveAccount");
    expect(layout).toContain("signOut");
    const mw = readFileSync("src/lib/supabase/middleware.ts", "utf8");
    expect(mw).toContain("getUser");
    expect(mw).not.toMatch(/from\("profiles"\)/);
    expect(mw).not.toMatch(/from\("employees"\)/);
  });
});
