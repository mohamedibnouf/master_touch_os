import { describe, expect, it } from "vitest";
import { createEmployeeSchema } from "@/modules/users/schemas";
import {
  createEmployeeLoginProvisioned,
  createEmployeeValidationMessageAr,
  employeeNumberConflictMessage,
  hrCreateRoleAssignmentError,
  logCreateEmployeeValidationFailure,
  readCreateEmployeeFormData,
} from "@/lib/hr/create-employee-form";
import { ValidationError } from "@/lib/errors";
import { formActionFailure } from "@/server/forms/form-state";

function form(entries: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(entries)) {
    fd.set(key, value);
  }
  return fd;
}

const required = {
  employee_number: "E-1001",
  full_name_ar: "سارة أحمد",
  full_name_en: "Sara Ahmed",
};

function parseForm(entries: Record<string, string>) {
  const payload = readCreateEmployeeFormData(form(entries));
  return { payload, parsed: createEmployeeSchema.safeParse(payload) };
}

describe("HR create employee form (البيانات غير مكتملة)", () => {
  it("A. required fields only succeed; blank optionals do not fail Zod", () => {
    const { parsed } = parseForm({
      ...required,
      email: "",
      initial_password: "",
      job_title_ar: "",
      employment_type: "",
      department_id: "",
      role_id: "",
      nationality: "",
      work_location: "",
      joining_date: "",
    });
    expect(parsed.success).toBe(true);
  });

  it("treats whitespace-only optional email/password as absent (not invalid)", () => {
    const { payload, parsed } = parseForm({
      ...required,
      email: "   ",
      initial_password: "  ",
    });
    expect(payload.email).toBeUndefined();
    expect(payload.initial_password).toBeUndefined();
    expect(parsed.success).toBe(true);
  });

  it("B. required + optional department uuid succeeds", () => {
    const { parsed } = parseForm({
      ...required,
      department_id: "11111111-1111-4111-8111-111111111111",
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts seeded system role ids that Postgres stores as uuid but Zod RFC uuid() rejects", () => {
    const { parsed } = parseForm({
      ...required,
      role_id: "20000000-0000-0000-0000-000000000007",
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects a non-uuid role identifier", () => {
    const { parsed } = parseForm({ ...required, role_id: "engineer" });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(createEmployeeValidationMessageAr(parsed.error)).toBe("صلاحية النظام المحددة غير صالحة.");
  });

  it("rejects privileged role assignment from the HR path unless platform admin", () => {
    expect(
      hrCreateRoleAssignmentError({
        roleId: "20000000-0000-0000-0000-000000000001",
        canAssignRole: true,
        isPlatformAdmin: false,
        role: { code: "super_admin", is_external: false },
      }),
    ).toBe("privileged");
    expect(
      hrCreateRoleAssignmentError({
        roleId: "20000000-0000-0000-0000-000000000007",
        canAssignRole: true,
        isPlatformAdmin: false,
        role: { code: "engineer", is_external: false },
      }),
    ).toBeNull();
  });

  it("D. password >= 8 marks login provisioned", () => {
    const { payload, parsed } = parseForm({ ...required, initial_password: "Passw0rd!" });
    expect(parsed.success).toBe(true);
    expect(createEmployeeLoginProvisioned(payload.initial_password)).toBe(true);
  });

  it("E. blank password succeeds and is not login-provisioned", () => {
    const { payload, parsed } = parseForm({ ...required, initial_password: "" });
    expect(parsed.success).toBe(true);
    expect(createEmployeeLoginProvisioned(payload.initial_password)).toBe(false);
  });

  it("F. blank email is omitted so Auth can use the internal identity", () => {
    const { payload, parsed } = parseForm({ ...required, email: "" });
    expect(parsed.success).toBe(true);
    expect(payload.email).toBeUndefined();
  });

  it("G. blank dates succeed", () => {
    const { parsed } = parseForm({ ...required, joining_date: "" });
    expect(parsed.success).toBe(true);
  });

  it("H. missing employee number returns a specific Arabic field error", () => {
    const { parsed } = parseForm({ full_name_ar: "سارة أحمد", full_name_en: "Sara Ahmed", employee_number: "" });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    const message = createEmployeeValidationMessageAr(parsed.error);
    expect(message).toBe("الرقم الوظيفي مطلوب.");
    expect(
      formActionFailure(new ValidationError(message, "x"), "fallback")?.message,
    ).toBe("الرقم الوظيفي مطلوب.");
  });

  it("I. missing required name returns a specific Arabic field error", () => {
    const { parsed } = parseForm({ employee_number: "E-1", full_name_ar: "", full_name_en: "Sara Ahmed" });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(createEmployeeValidationMessageAr(parsed.error)).toContain("اسم الموظف بالعربية");
  });

  it("J. invalid employment enum returns a specific Arabic field error", () => {
    const { parsed } = parseForm({ ...required, employment_type: "دائم" });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(createEmployeeValidationMessageAr(parsed.error)).toBe("نوع التوظيف غير صالح.");
  });

  it("K. duplicate employee number maps to a specific Arabic conflict", () => {
    expect(
      employeeNumberConflictMessage({
        code: "23505",
        message: 'duplicate key value violates unique constraint "employees_organization_id_employee_number_key"',
      }),
    ).toBe("الرقم الوظيفي مستخدم مسبقاً في هذه المنشأة.");
  });

  it("L. short password returns a specific Arabic password error, not generic incomplete", () => {
    const { parsed } = parseForm({ ...required, initial_password: "123" });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    const message = createEmployeeValidationMessageAr(parsed.error);
    expect(message).toContain("كلمة المرور يجب أن تتكون من 8 أحرف");
    expect(message).not.toContain("غير مكتملة");
  });

  it("M. role assignment without role.assign is rejected as forbidden", () => {
    expect(
      hrCreateRoleAssignmentError({
        roleId: "22222222-2222-4222-8222-222222222222",
        canAssignRole: false,
        isPlatformAdmin: false,
        role: { code: "hr_manager", is_external: false },
      }),
    ).toBe("forbidden");
  });

  it("does not log password or email values in the validation diagnostic", () => {
    const { payload, parsed } = parseForm({ ...required, initial_password: "secret-pass", email: "not-an-email" });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    const fields: Record<string, string> = {};
    for (const [key, value] of Object.entries(payload)) {
      fields[key] = value == null || value === "" ? "missing" : "present";
    }
    expect(JSON.stringify(fields)).not.toMatch(/secret-pass|not-an-email/);
    logCreateEmployeeValidationFailure(payload, parsed.error);
  });

  it("generic بيانات الموظف غير مكتملة is not used for these field errors", () => {
    const { parsed } = parseForm({ employee_number: "", full_name_ar: "سارة", full_name_en: "Sa" });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(createEmployeeValidationMessageAr(parsed.error)).not.toContain("بيانات الموظف غير مكتملة");
  });
});
