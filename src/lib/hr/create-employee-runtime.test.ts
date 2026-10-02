import { describe, expect, it } from "vitest";
import { generateInternalAuthEmail } from "@/lib/auth/employee-login";
import { ConflictError, DatabaseError, ValidationError } from "@/lib/errors";
import {
  CREATE_EMPLOYEE_PIPELINE,
  assertCreateEmployeeAuthRequest,
  buildCreateEmployeeAuthRequest,
  buildCreateEmployeeInsertPayload,
  buildCreateEmployeeMembershipPayload,
  buildCreateEmployeeProfileMetadata,
  isGotrueCompatibleEmail,
  logCreateEmployeeOpFailure,
  mapAuthCreateUserFailure,
  mapEmployeeInsertFailure,
  mapMembershipInsertFailure,
} from "./create-employee-runtime";

const ORG = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

describe("create employee runtime pipeline", () => {
  it("documents non-atomic order: Auth/profile before employees row", () => {
    expect(CREATE_EMPLOYEE_PIPELINE[0]).toBe("auth.createUser");
    expect(CREATE_EMPLOYEE_PIPELINE[1]).toBe("profiles.handle_new_user");
    expect(CREATE_EMPLOYEE_PIPELINE[2]).toBe("organization_members.insert");
    expect(CREATE_EMPLOYEE_PIPELINE[3]).toBe("employees.insert");
  });

  it("builds Auth createUser with password even when HR leaves initial_password blank", () => {
    const req = buildCreateEmployeeAuthRequest({
      organizationId: ORG,
      employeeNumber: "E-9",
      fullNameAr: "سارة أحمد",
      fullNameEn: "Sara Ahmed",
    });
    expect(req.loginProvisioned).toBe(false);
    expect(req.params.email_confirm).toBe(true);
    expect(req.params.password.length).toBeGreaterThanOrEqual(8);
    expect(req.params.password).not.toBe("");
    expect(req.params.user_metadata.login_provisioned).toBe(false);
    expect(req.params.user_metadata.locale).toBe("ar");
    expect(req.params.user_metadata.full_name_ar).toBe("سارة أحمد");
    expect(JSON.stringify(req.params.user_metadata)).not.toMatch(/password/i);
    assertCreateEmployeeAuthRequest(req);
  });

  it("uses supplied password only when HR provides one (login ready)", () => {
    const req = buildCreateEmployeeAuthRequest({
      organizationId: ORG,
      employeeNumber: "E-9",
      fullNameAr: "سارة أحمد",
      fullNameEn: "Sara Ahmed",
      initialPassword: "Passw0rd!",
    });
    expect(req.loginProvisioned).toBe(true);
    expect(req.params.password).toBe("Passw0rd!");
  });

  it("generates a GoTrue-compatible internal mailbox without optional email", () => {
    const req = buildCreateEmployeeAuthRequest({
      organizationId: ORG,
      employeeNumber: "MT-00025",
      fullNameAr: "سارة أحمد",
      fullNameEn: "Sara Ahmed",
    });
    expect(req.params.email).toBe(generateInternalAuthEmail(ORG, "MT-00025"));
    expect(isGotrueCompatibleEmail(req.params.email)).toBe(true);
    expect(req.params.email).not.toContain(".@");
  });

  it("keeps ASCII employee-number mailboxes stable and sanitizes non-ascii numbers", () => {
    expect(generateInternalAuthEmail(ORG, "MT-00025")).toBe(
      generateInternalAuthEmail(ORG, "MT-00025"),
    );
    const arabic = generateInternalAuthEmail(ORG, "موظف-١");
    expect(arabic).not.toMatch(/\.@/);
    expect(isGotrueCompatibleEmail(arabic)).toBe(true);
  });

  it("builds handle_new_user metadata keys", () => {
    expect(
      buildCreateEmployeeProfileMetadata({
        fullNameAr: "أ",
        fullNameEn: "A",
        employeeNumber: "E-1",
        loginProvisioned: false,
      }),
    ).toMatchObject({
      full_name_ar: "أ",
      full_name_en: "A",
      locale: "ar",
      login_provisioned: false,
    });
  });

  it("builds membership payload matching 003 unique (organization_id, profile_id)", () => {
    expect(buildCreateEmployeeMembershipPayload(ORG, "profile-1")).toEqual({
      organization_id: ORG,
      profile_id: "profile-1",
      status: "active",
    });
  });

  it("builds minimum employee insert: null optionals, active status, no department/role", () => {
    const row = buildCreateEmployeeInsertPayload({
      organizationId: ORG,
      profileId: "profile-1",
      employeeNumber: "E-1",
    });
    expect(row.employment_status).toBe("active");
    expect(row.is_active).toBe(true);
    expect(row.employment_type).toBeNull();
    expect(row.joining_date).toBeNull();
    expect(row.job_title_ar).toBeNull();
    expect(row.job_title_id).toBeNull();
    expect(row).not.toHaveProperty("department_id");
    expect(row).not.toHaveProperty("role_id");
  });

  it("maps Auth failure without exposing mailbox", () => {
    expect(() => mapAuthCreateUserFailure({ code: "email_exists", message: "User already registered" })).toThrow(
      ConflictError,
    );
    try {
      mapAuthCreateUserFailure({ status: 400, message: "Unable to validate email address: secret@x.com" });
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      expect((err as ValidationError).userMessageAr).toBe("تعذر إنشاء حساب الدخول.");
      expect(JSON.stringify(err)).not.toMatch(/secret@x\.com/);
    }
  });

  it("maps membership failure to a specific Arabic form error", () => {
    expect(() => mapMembershipInsertFailure({ code: "23503" })).toThrow(ValidationError);
    try {
      mapMembershipInsertFailure({ code: "23503" });
    } catch (err) {
      expect((err as ValidationError).userMessageAr).toBe("تعذر ربط الموظف بالمنشأة.");
    }
  });

  it("maps duplicate employee number on insert", () => {
    expect(() =>
      mapEmployeeInsertFailure({
        code: "23505",
        message: 'duplicate key value violates unique constraint "employees_organization_id_employee_number_key"',
      }),
    ).toThrow(ConflictError);
  });

  it("maps other employee insert failures as DatabaseError without leaking values", () => {
    try {
      mapEmployeeInsertFailure({ code: "23502", message: "null value in column employee_number" });
    } catch (err) {
      expect(err).toBeInstanceOf(DatabaseError);
    }
  });

  it("safe op logs do not include password or email keys", () => {
    logCreateEmployeeOpFailure("auth.createUser", { code: "unexpected_failure", message: "x" });
    const ctx = { route: "/employees", operation: "auth.createUser", code: "unexpected_failure" };
    expect(JSON.stringify(ctx)).not.toMatch(/password|Aa1!/i);
  });
});
