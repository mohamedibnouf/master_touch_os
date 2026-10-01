"use server";

import "server-only";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { DatabaseError, ForbiddenError, ValidationError } from "@/lib/errors";
import { runFormAction, type FormActionState } from "@/server/forms/form-state";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getAuthContext } from "@/server/context";
import { authorize, hasPermission } from "@/server/policies/authorize";
import { AuditService } from "@/server/services/audit.service";
import { EventService } from "@/server/services/event.service";
import { StorageService } from "@/server/services/storage.service";
import { generateCorrelationId } from "@/lib/utils";
import {
  createEmployeeLoginProvisioned,
  createEmployeeValidationMessageAr,
  hrCreateRoleAssignmentError,
  logCreateEmployeeValidationFailure,
  readCreateEmployeeFormData,
} from "@/lib/hr/create-employee-form";
import {
  BASE_EMPLOYEE_ROLE_CODE,
  isTrustedBaseEmployeeRole,
  resolveCreateEmployeeRolePlan,
} from "@/lib/hr/roles";
import {
  assertCreateEmployeeAuthRequest,
  buildCreateEmployeeAuthRequest,
  buildCreateEmployeeInsertPayload,
  buildCreateEmployeeMembershipPayload,
  mapAuthCreateUserFailure,
  mapDepartmentInsertFailure,
  mapEmployeeInsertFailure,
  mapMembershipInsertFailure,
  mapRoleInsertFailure,
} from "@/lib/hr/create-employee-runtime";
import {
  activateEmployeeContractSchema,
  assignDepartmentSchema,
  createCompensationVersionSchema,
  createEmployeeContractSchema,
  createEmployeeSchema,
  deactivateEmployeeBankSchema,
  provisionEmployeeLoginSchema,
  setEmployeeActiveSchema,
  updateEmployeeEmploymentSchema,
  updateEmployeeProfileSchema,
  uploadEmployeeDocumentSchema,
  upsertComplianceSchema,
  upsertDepartmentSchema,
  upsertEmployeeBankSchema,
} from "@/modules/users/schemas";

function emptyToNull(value: string | null | undefined) {
  if (value == null) return null;
  const t = String(value).trim();
  return t === "" ? null : t;
}

async function syncHrAlerts(employeeId: string) {
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.rpc("sync_employee_hr_alert_hooks", {
    p_employee_id: employeeId,
  });
  if (error) {
    // Soft-fail if migration 052 not applied yet in a given environment.
    if (!/could not find|does not exist|schema cache/i.test(error.message ?? "")) {
      throw new DatabaseError(error);
    }
  }
}

/**
 * HR-scoped employee onboard.
 * Auth account creation requires Admin API (service role) — same pattern as createUserAction.
 * Authorization is least-privilege: employee.create (or user.create), NOT broad user admin.
 * Role assignment requires role.assign when a role is selected.
 * Login-provisioned creates with an empty role default to the system employee role.
 */
export async function createEmployeeAction(
  _prev: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  return runFormAction("تعذر إنشاء الموظف. حاول مرة أخرى.", async () => {
  const ctx = await getAuthContext();
  if (!ctx) throw new ForbiddenError();
  const canCreate =
    hasPermission(ctx, "employee.create") || hasPermission(ctx, "user.create");
  if (!canCreate) throw new ForbiddenError({ permission: "employee.create" });

  const payload = readCreateEmployeeFormData(formData);
  const parsed = createEmployeeSchema.safeParse(payload);
  if (!parsed.success) {
    logCreateEmployeeValidationFailure(payload, parsed.error);
    throw new ValidationError(
      createEmployeeValidationMessageAr(parsed.error),
      "Employee create validation failed.",
    );
  }

  const loginProvisioned = createEmployeeLoginProvisioned(parsed.data.initial_password);
  const rolePlan = resolveCreateEmployeeRolePlan({
    selectedRoleId: parsed.data.role_id,
    loginProvisioned,
  });

  const admin = createAdminSupabaseClient();
  let roleIdToAssign: string | undefined;

  if (rolePlan.mode === "selected") {
    if (!hasPermission(ctx, "role.assign")) {
      throw new ForbiddenError({ permission: "role.assign" });
    }
    const { data: roleRow } = await admin
      .from("roles")
      .select("code, is_external")
      .eq("id", rolePlan.roleId)
      .maybeSingle<{ code: string; is_external: boolean }>();
    const roleBlock = hrCreateRoleAssignmentError({
      roleId: rolePlan.roleId,
      canAssignRole: true,
      isPlatformAdmin: ctx.profile.is_platform_admin,
      role: roleRow,
    });
    if (roleBlock === "external") {
      throw new ValidationError("لا يمكن منح الأدوار الخارجية صلاحية داخلية.", "External roles cannot be granted internal access.");
    }
    if (roleBlock === "privileged") {
      throw new ValidationError("لا يمكن منح هذا الدور من مسار الموارد البشرية.", "That role cannot be assigned from the HR path.");
    }
    roleIdToAssign = rolePlan.roleId;
  } else if (rolePlan.mode === "default_employee") {
    const { data: employeeRole } = await admin
      .from("roles")
      .select("id, code, is_external")
      .eq("code", BASE_EMPLOYEE_ROLE_CODE)
      .is("organization_id", null)
      .maybeSingle<{ id: string; code: string; is_external: boolean }>();
    if (!isTrustedBaseEmployeeRole(employeeRole)) {
      throw new ValidationError(
        "تعذر تعيين صلاحية الموظف الأساسية. تأكد من تطبيق تهيئة صلاحية موظف.",
        "Base employee role is not available.",
      );
    }
    roleIdToAssign = employeeRole.id;
  }

  const employeeNumber = parsed.data.employee_number.trim();
  const authRequest = buildCreateEmployeeAuthRequest({
    organizationId: ctx.organization.id,
    employeeNumber,
    fullNameAr: parsed.data.full_name_ar,
    fullNameEn: parsed.data.full_name_en,
    email: parsed.data.email,
    initialPassword: parsed.data.initial_password,
  });
  assertCreateEmployeeAuthRequest(authRequest);

  const { data: created, error } = await admin.auth.admin.createUser(authRequest.params);
  if (error || !created?.user) mapAuthCreateUserFailure(error ?? new Error("auth.createUser empty"));
  const profileId = created.user.id;

  const membership = buildCreateEmployeeMembershipPayload(ctx.organization.id, profileId);
  const { error: memberError } = await admin.from("organization_members").upsert(membership, {
    onConflict: "organization_id,profile_id",
  });
  if (memberError) mapMembershipInsertFailure(memberError);

  const { data: employee, error: employeeError } = await admin
    .from("employees")
    .insert(
      buildCreateEmployeeInsertPayload({
        organizationId: ctx.organization.id,
        profileId,
        employeeNumber,
        jobTitleAr: parsed.data.job_title_ar,
        jobTitleEn: parsed.data.job_title_en,
        employmentType: parsed.data.employment_type,
        nationality: parsed.data.nationality,
        workLocation: parsed.data.work_location,
        joiningDate: parsed.data.joining_date,
      }),
    )
    .select("id")
    .single<{ id: string }>();
  if (employeeError) mapEmployeeInsertFailure(employeeError);

  if (parsed.data.department_id && employee) {
    const { error: deptError } = await admin.from("employee_departments").insert({
      organization_id: ctx.organization.id,
      employee_id: employee.id,
      department_id: parsed.data.department_id,
      is_primary: true,
    });
    if (deptError) mapDepartmentInsertFailure(deptError);
  }

  if (roleIdToAssign) {
    const { error: roleError } = await admin.from("user_roles").insert({
      organization_id: ctx.organization.id,
      profile_id: profileId,
      role_id: roleIdToAssign,
      scope_type: "organization",
      granted_by: ctx.userId,
    });
    if (roleError) mapRoleInsertFailure(roleError);
  }

  const supabase = await createServerSupabaseClient();
  await new AuditService(supabase).log({
    organizationId: ctx.organization.id,
    action: "employee.created",
    entityType: "employee",
    entityId: employee?.id ?? profileId,
    newValues: { employee_number: employeeNumber },
  });
  await new EventService(supabase).publish({
    type: "employee.created",
    organizationId: ctx.organization.id,
    actorId: ctx.userId,
    entityType: "employee",
    entityId: employee?.id ?? profileId,
    payload: { employee_number: employeeNumber },
    correlationId: generateCorrelationId(),
    occurredAt: new Date().toISOString(),
  });

  if (employee?.id) {
    try {
      await syncHrAlerts(employee.id);
    } catch {
      /* ignore if 052 not applied */
    }
  }

  revalidatePath("/employees");
  if (employee?.id) {
    revalidatePath(`/employees/${employee.id}`);
    redirect(`/employees/${employee.id}`);
  }
  });
}

export async function updateEmployeeEmploymentAction(
  _prev: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  return runFormAction("تعذر تحديث بيانات التوظيف. حاول مرة أخرى.", async () => {
  const ctx = authorize(await getAuthContext(), "employee.manage");
  const parsed = updateEmployeeEmploymentSchema.safeParse({
    employeeId: formData.get("employeeId"),
    employee_number: formData.get("employee_number"),
    job_title_ar: formData.get("job_title_ar"),
    job_title_en: formData.get("job_title_en"),
    employment_type: formData.get("employment_type") || null,
    employment_status: formData.get("employment_status"),
    joining_date: formData.get("joining_date"),
    contract_start: formData.get("contract_start"),
    contract_end: formData.get("contract_end"),
    probation_end: formData.get("probation_end"),
    work_location: formData.get("work_location"),
    nationality: formData.get("nationality"),
    date_of_birth: formData.get("date_of_birth"),
    gender: formData.get("gender") || null,
    direct_manager_employee_id: formData.get("direct_manager_employee_id") || null,
  });
  if (!parsed.success) {
    throw new ValidationError("بيانات التوظيف غير مكتملة.", "Employment data is incomplete.");
  }

  const supabase = await createServerSupabaseClient();
  const patch = {
    employee_number: emptyToNull(parsed.data.employee_number),
    job_title_ar: emptyToNull(parsed.data.job_title_ar),
    job_title_en: emptyToNull(parsed.data.job_title_en),
    employment_type: emptyToNull(parsed.data.employment_type) as string | null,
    employment_status: parsed.data.employment_status,
    joining_date: emptyToNull(parsed.data.joining_date),
    contract_start: emptyToNull(parsed.data.contract_start),
    contract_end: emptyToNull(parsed.data.contract_end),
    probation_end: emptyToNull(parsed.data.probation_end),
    work_location: emptyToNull(parsed.data.work_location),
    nationality: emptyToNull(parsed.data.nationality),
    date_of_birth: emptyToNull(parsed.data.date_of_birth),
    gender: emptyToNull(parsed.data.gender),
    direct_manager_employee_id: emptyToNull(parsed.data.direct_manager_employee_id),
  };

  const { error } = await supabase
    .from("employees")
    .update(patch)
    .eq("id", parsed.data.employeeId)
    .eq("organization_id", ctx.organization.id);
  if (error) throw new DatabaseError(error);

  await new AuditService(supabase).log({
    organizationId: ctx.organization.id,
    action: "employee.employment_updated",
    entityType: "employee",
    entityId: parsed.data.employeeId,
    newValues: {
      employment_status: patch.employment_status,
      employment_type: patch.employment_type,
      job_title_ar: patch.job_title_ar,
    },
  });

  await syncHrAlerts(parsed.data.employeeId);
  revalidatePath("/employees");
  revalidatePath(`/employees/${parsed.data.employeeId}`);
  });
}

export async function updateEmployeeProfileAction(
  _prev: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  return runFormAction("تعذر إتمام العملية. حاول مرة أخرى.", async () => {
  const ctx = authorize(await getAuthContext(), "employee.manage");
  const parsed = updateEmployeeProfileSchema.safeParse({
    employeeId: formData.get("employeeId"),
    full_name_ar: formData.get("full_name_ar"),
    full_name_en: formData.get("full_name_en"),
    phone: formData.get("phone"),
  });
  if (!parsed.success) {
    throw new ValidationError("بيانات الهوية غير مكتملة.", "Profile data is incomplete.");
  }

  const supabase = await createServerSupabaseClient();
  const { data: emp, error: empErr } = await supabase
    .from("employees")
    .select("id, profile_id")
    .eq("id", parsed.data.employeeId)
    .eq("organization_id", ctx.organization.id)
    .maybeSingle();
  if (empErr) throw new DatabaseError(empErr);
  if (!emp) throw new ValidationError("الموظف غير موجود.", "Employee not found.");

  const { error } = await supabase
    .from("profiles")
    .update({
      full_name_ar: parsed.data.full_name_ar,
      full_name_en: parsed.data.full_name_en,
      phone: emptyToNull(parsed.data.phone),
    })
    .eq("id", emp.profile_id);
  if (error) throw new DatabaseError(error);

  await new AuditService(supabase).log({
    organizationId: ctx.organization.id,
    action: "employee.profile_updated",
    entityType: "employee",
    entityId: emp.id,
  });

  revalidatePath("/employees");
  revalidatePath(`/employees/${emp.id}`);
  });
}

export async function assignEmployeeDepartmentAction(
  _prev: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  return runFormAction("تعذر إتمام العملية. حاول مرة أخرى.", async () => {
  const ctx = authorize(await getAuthContext(), "employee.manage");
  const parsed = assignDepartmentSchema.safeParse({
    employeeId: formData.get("employeeId"),
    departmentId: formData.get("departmentId"),
    isPrimary: formData.get("isPrimary") !== "false",
  });
  if (!parsed.success) {
    throw new ValidationError("تعذر تعيين الإدارة.", "The department could not be assigned.");
  }

  const supabase = await createServerSupabaseClient();
  if (parsed.data.isPrimary) {
    await supabase
      .from("employee_departments")
      .update({ is_primary: false })
      .eq("organization_id", ctx.organization.id)
      .eq("employee_id", parsed.data.employeeId);
  }

  const { error } = await supabase.from("employee_departments").upsert(
    {
      organization_id: ctx.organization.id,
      employee_id: parsed.data.employeeId,
      department_id: parsed.data.departmentId,
      is_primary: parsed.data.isPrimary,
    },
    { onConflict: "employee_id,department_id" },
  );
  if (error) throw new DatabaseError(error);

  await new AuditService(supabase).log({
    organizationId: ctx.organization.id,
    action: "employee.department_assigned",
    entityType: "employee",
    entityId: parsed.data.employeeId,
    newValues: { departmentId: parsed.data.departmentId, isPrimary: parsed.data.isPrimary },
  });

  revalidatePath("/employees");
  revalidatePath(`/employees/${parsed.data.employeeId}`);
  revalidatePath("/departments");
  });
}

export async function upsertEmployeeComplianceAction(
  _prev: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  return runFormAction("تعذر إتمام العملية. حاول مرة أخرى.", async () => {
  const ctx = await getAuthContext();
  if (!ctx) throw new ForbiddenError();
  const canManage =
    hasPermission(ctx, "employee_compliance.manage") || hasPermission(ctx, "employee.manage");
  if (!canManage) throw new ForbiddenError({ permission: "employee_compliance.manage" });

  const parsed = upsertComplianceSchema.safeParse({
    employeeId: formData.get("employeeId"),
    iqama_number: formData.get("iqama_number"),
    iqama_expiry: formData.get("iqama_expiry"),
    passport_number: formData.get("passport_number"),
    passport_expiry: formData.get("passport_expiry"),
    work_permit_expiry: formData.get("work_permit_expiry"),
    insurance_provider: formData.get("insurance_provider"),
    insurance_expiry: formData.get("insurance_expiry"),
    gosi_number: formData.get("gosi_number"),
  });
  if (!parsed.success) {
    throw new ValidationError("بيانات الامتثال غير مكتملة.", "Compliance data is incomplete.");
  }

  const supabase = await createServerSupabaseClient();
  const payload = {
    organization_id: ctx.organization.id,
    employee_id: parsed.data.employeeId,
    iqama_number: emptyToNull(parsed.data.iqama_number),
    iqama_expiry: emptyToNull(parsed.data.iqama_expiry),
    passport_number: emptyToNull(parsed.data.passport_number),
    passport_expiry: emptyToNull(parsed.data.passport_expiry),
    work_permit_expiry: emptyToNull(parsed.data.work_permit_expiry),
    insurance_provider: emptyToNull(parsed.data.insurance_provider),
    insurance_expiry: emptyToNull(parsed.data.insurance_expiry),
    gosi_number: emptyToNull(parsed.data.gosi_number),
  };

  const { error } = await supabase.from("employee_compliance").upsert(payload, {
    onConflict: "employee_id",
  });
  if (error) throw new DatabaseError(error);

  await new AuditService(supabase).log({
    organizationId: ctx.organization.id,
    action: "employee.compliance_updated",
    entityType: "employee",
    entityId: parsed.data.employeeId,
    newValues: {
      has_iqama: Boolean(payload.iqama_number),
      iqama_expiry: payload.iqama_expiry,
      passport_expiry: payload.passport_expiry,
      work_permit_expiry: payload.work_permit_expiry,
      insurance_expiry: payload.insurance_expiry,
      // numbers omitted from audit
    },
  });

  await syncHrAlerts(parsed.data.employeeId);
  revalidatePath(`/employees/${parsed.data.employeeId}`);
  });
}

export async function upsertDepartmentAction(
  _prev: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  return runFormAction("تعذر حفظ الإدارة. حاول مرة أخرى.", async () => {
  const ctx = await getAuthContext();
  if (!ctx) throw new ForbiddenError();

  const parsed = upsertDepartmentSchema.safeParse({
    departmentId: formData.get("departmentId") || undefined,
    code: formData.get("code"),
    name_ar: formData.get("name_ar"),
    name_en: formData.get("name_en"),
    description: formData.get("description") || undefined,
    parent_department_id: formData.get("parent_department_id") || null,
    manager_user_id: formData.get("manager_user_id") || null,
    is_active: formData.get("is_active") !== "false",
  });
  if (!parsed.success) {
    throw new ValidationError("بيانات الإدارة غير مكتملة.", "Department data is incomplete.");
  }

  const isCreate = !parsed.data.departmentId;
  authorize(ctx, isCreate ? "department.create" : "department.update");

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.rpc("upsert_department", {
    p_organization_id: ctx.organization.id,
    p_department_id: emptyToNull(parsed.data.departmentId),
    p_code: parsed.data.code,
    p_name_ar: parsed.data.name_ar,
    p_name_en: parsed.data.name_en,
    p_description: emptyToNull(parsed.data.description),
    p_parent_department_id: emptyToNull(parsed.data.parent_department_id),
    p_manager_user_id: emptyToNull(parsed.data.manager_user_id),
    p_is_active: parsed.data.is_active,
  });
  if (error) throw new DatabaseError(error);

  revalidatePath("/departments");
  });
}

export async function setEmployeeActiveAction(
  _prev: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  return runFormAction("تعذر إتمام العملية. حاول مرة أخرى.", async () => {
  const ctx = await getAuthContext();
  if (!ctx) throw new ForbiddenError();
  const can =
    hasPermission(ctx, "employee.manage") || hasPermission(ctx, "user.disable");
  if (!can) throw new ForbiddenError({ permission: "employee.manage" });

  const parsed = setEmployeeActiveSchema.safeParse({
    employeeId: formData.get("employeeId"),
    isActive: formData.get("isActive") === "true",
  });
  if (!parsed.success) {
    throw new ValidationError("تعذر تحديث حالة الموظف.", "Employee status could not be updated.");
  }

  const supabase = await createServerSupabaseClient();
  const { data: emp, error: empErr } = await supabase
    .from("employees")
    .select("id, profile_id")
    .eq("id", parsed.data.employeeId)
    .eq("organization_id", ctx.organization.id)
    .maybeSingle();
  if (empErr) throw new DatabaseError(empErr);
  if (!emp) throw new ValidationError("الموظف غير موجود.", "Employee not found.");
  if (emp.profile_id === ctx.userId) {
    throw new ValidationError("لا يمكنك إيقاف حسابك الحالي.", "You cannot disable your own account.");
  }

  // Soft access revocation — never delete auth user or history.
  await supabase
    .from("profiles")
    .update({ is_active: parsed.data.isActive })
    .eq("id", emp.profile_id);

  await supabase
    .from("organization_members")
    .update({ status: parsed.data.isActive ? "active" : "suspended" })
    .eq("organization_id", ctx.organization.id)
    .eq("profile_id", emp.profile_id);

  const { error } = await supabase
    .from("employees")
    .update({
      is_active: parsed.data.isActive,
      employment_status: parsed.data.isActive ? "active" : "terminated",
      terminated_at: parsed.data.isActive ? null : new Date().toISOString(),
    })
    .eq("id", emp.id)
    .eq("organization_id", ctx.organization.id);
  if (error) throw new DatabaseError(error);

  await new AuditService(supabase).log({
    organizationId: ctx.organization.id,
    action: parsed.data.isActive ? "employee.activated" : "employee.deactivated",
    entityType: "employee",
    entityId: emp.id,
  });
  await new EventService(supabase).publish({
    type: "employee.deactivated",
    organizationId: ctx.organization.id,
    actorId: ctx.userId,
    entityType: "employee",
    entityId: emp.id,
    payload: { isActive: parsed.data.isActive },
    correlationId: generateCorrelationId(),
    occurredAt: new Date().toISOString(),
  });

  revalidatePath("/employees");
  revalidatePath(`/employees/${emp.id}`);
  });
}

export async function provisionEmployeeLoginAction(
  _prev: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  return runFormAction("تعذر تفعيل حساب الدخول. حاول مرة أخرى.", async () => {
    const ctx = await getAuthContext();
    if (!ctx) throw new ForbiddenError();
    const can =
      hasPermission(ctx, "employee.manage") || hasPermission(ctx, "employee.create");
    if (!can) throw new ForbiddenError({ permission: "employee.manage" });

    const parsed = provisionEmployeeLoginSchema.safeParse({
      employeeId: formData.get("employeeId"),
      password: formData.get("password"),
    });
    if (!parsed.success) {
      throw new ValidationError("كلمة المرور يجب ألا تقل عن 8 أحرف.", "Password must be at least 8 characters.");
    }

    const supabase = await createServerSupabaseClient();
    const { data: emp, error: empErr } = await supabase
      .from("employees")
      .select("id, profile_id, employee_number, is_active")
      .eq("id", parsed.data.employeeId)
      .eq("organization_id", ctx.organization.id)
      .maybeSingle();
    if (empErr) throw new DatabaseError(empErr);
    if (!emp) throw new ValidationError("الموظف غير موجود.", "Employee not found.");
    if (!emp.is_active) {
      throw new ValidationError("لا يمكن تفعيل الدخول لموظف موقوف.", "Cannot provision login for an inactive employee.");
    }
    if (!emp.employee_number) {
      throw new ValidationError("أضف الرقم الوظيفي أولاً.", "Set an employee number first.");
    }

    const admin = createAdminSupabaseClient();
    const { data: userData, error: getErr } = await admin.auth.admin.getUserById(emp.profile_id);
    if (getErr || !userData.user) throw new DatabaseError(getErr);

    const { error: updErr } = await admin.auth.admin.updateUserById(emp.profile_id, {
      password: parsed.data.password,
      user_metadata: {
        ...(userData.user.user_metadata ?? {}),
        employee_number: emp.employee_number,
        login_provisioned: true,
      },
    });
    if (updErr) throw new DatabaseError(updErr);

    const { data: existingGrants } = await admin
      .from("user_roles")
      .select("id")
      .eq("organization_id", ctx.organization.id)
      .eq("profile_id", emp.profile_id)
      .limit(1);
    if (!existingGrants?.length) {
      const { data: employeeRole } = await admin
        .from("roles")
        .select("id, code, is_external")
        .eq("code", BASE_EMPLOYEE_ROLE_CODE)
        .is("organization_id", null)
        .maybeSingle<{ id: string; code: string; is_external: boolean }>();
      if (isTrustedBaseEmployeeRole(employeeRole)) {
        const { error: roleError } = await admin.from("user_roles").insert({
          organization_id: ctx.organization.id,
          profile_id: emp.profile_id,
          role_id: employeeRole.id,
          scope_type: "organization",
          granted_by: ctx.userId,
        });
        if (roleError) mapRoleInsertFailure(roleError);
      }
    }

    await new AuditService(supabase).log({
      organizationId: ctx.organization.id,
      action: "employee.login_provisioned",
      entityType: "employee",
      entityId: emp.id,
    });

    revalidatePath(`/employees/${emp.id}`);
  });
}

/**
 * Phase 4.2: Contracts Actions
 */
export async function createEmployeeContractAction(
  _prev: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  return runFormAction("تعذر إتمام العملية. حاول مرة أخرى.", async () => {
  const ctx = await getAuthContext();
  if (!ctx) throw new ForbiddenError();
  const canManage =
    hasPermission(ctx, "employee_contract.manage") || hasPermission(ctx, "employee.manage");
  if (!canManage) throw new ForbiddenError({ permission: "employee_contract.manage" });

  const parsed = createEmployeeContractSchema.safeParse({
    employeeId: formData.get("employeeId"),
    contract_number: formData.get("contract_number"),
    contract_type: formData.get("contract_type"),
    start_date: formData.get("start_date"),
    end_date: formData.get("end_date") || undefined,
    probation_end_date: formData.get("probation_end_date") || undefined,
    notice_period_days: formData.get("notice_period_days") || 30,
    working_hours_per_week: formData.get("working_hours_per_week") || 40,
    currency: formData.get("currency") || "SAR",
    initial_basic_salary: formData.get("initial_basic_salary") || undefined,
    initial_housing_allowance: formData.get("initial_housing_allowance") || 0,
    initial_transport_allowance: formData.get("initial_transport_allowance") || 0,
    initial_other_allowances: formData.get("initial_other_allowances") || 0,
    notes: formData.get("notes") || undefined,
  });

  if (!parsed.success) {
    throw new ValidationError("بيانات العقد غير مكتملة أو غير صالحة.", "Contract data is incomplete or invalid.");
  }

  const supabase = await createServerSupabaseClient();
  const { data: contract, error } = await supabase
    .from("employee_contracts")
    .insert({
      organization_id: ctx.organization.id,
      employee_id: parsed.data.employeeId,
      contract_number: parsed.data.contract_number,
      contract_type: parsed.data.contract_type,
      status: "draft",
      start_date: parsed.data.start_date,
      end_date: emptyToNull(parsed.data.end_date),
      probation_end_date: emptyToNull(parsed.data.probation_end_date),
      notice_period_days: parsed.data.notice_period_days,
      working_hours_per_week: parsed.data.working_hours_per_week,
      currency: parsed.data.currency,
      initial_basic_salary: parsed.data.initial_basic_salary ?? null,
      initial_housing_allowance: parsed.data.initial_housing_allowance,
      initial_transport_allowance: parsed.data.initial_transport_allowance,
      initial_other_allowances: parsed.data.initial_other_allowances,
      notes: emptyToNull(parsed.data.notes),
      created_by: ctx.userId,
    })
    .select("id")
    .single<{ id: string }>();

  if (error) throw new DatabaseError(error);

  await new AuditService(supabase).log({
    organizationId: ctx.organization.id,
    action: "employee_contract.created",
    entityType: "employee",
    entityId: parsed.data.employeeId,
    newValues: { contract_number: parsed.data.contract_number, contract_id: contract.id },
  });

  revalidatePath(`/employees/${parsed.data.employeeId}`);
  });
}

export async function activateEmployeeContractAction(
  _prev: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  return runFormAction("تعذر إتمام العملية. حاول مرة أخرى.", async () => {
  const ctx = await getAuthContext();
  if (!ctx) throw new ForbiddenError();
  const canManage =
    hasPermission(ctx, "employee_contract.manage") || hasPermission(ctx, "employee.manage");
  if (!canManage) throw new ForbiddenError({ permission: "employee_contract.manage" });

  const parsed = activateEmployeeContractSchema.safeParse({
    contractId: formData.get("contractId"),
    employeeId: formData.get("employeeId"),
  });

  if (!parsed.success) {
    throw new ValidationError("معرف العقد غير صالح.", "Invalid contract identifier.");
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.rpc("activate_employee_contract", {
    p_organization_id: ctx.organization.id,
    p_contract_id: parsed.data.contractId,
  });

  if (error) throw new DatabaseError(error);

  revalidatePath(`/employees/${parsed.data.employeeId}`);
  });
}

/**
 * Phase 4.2: Versioned Compensation Actions
 */
export async function createCompensationVersionAction(
  _prev: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  return runFormAction("تعذر إتمام العملية. حاول مرة أخرى.", async () => {
  const ctx = await getAuthContext();
  if (!ctx) throw new ForbiddenError();
  const canManage =
    hasPermission(ctx, "employee_compensation.manage") || hasPermission(ctx, "employee.manage");
  if (!canManage) throw new ForbiddenError({ permission: "employee_compensation.manage" });

  const parsed = createCompensationVersionSchema.safeParse({
    employeeId: formData.get("employeeId"),
    effective_from: formData.get("effective_from"),
    currency: formData.get("currency") || "SAR",
    basic_salary: formData.get("basic_salary"),
    housing_allowance: formData.get("housing_allowance") || 0,
    transport_allowance: formData.get("transport_allowance") || 0,
    other_allowances: formData.get("other_allowances") || 0,
    change_reason: formData.get("change_reason") || undefined,
  });

  if (!parsed.success) {
    throw new ValidationError("بيانات الراتب والبدلات غير صالحة.", "Compensation data is invalid.");
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.rpc("create_employee_compensation_version", {
    p_organization_id: ctx.organization.id,
    p_employee_id: parsed.data.employeeId,
    p_effective_from: parsed.data.effective_from,
    p_currency: parsed.data.currency,
    p_basic_salary: parsed.data.basic_salary,
    p_housing_allowance: parsed.data.housing_allowance,
    p_transport_allowance: parsed.data.transport_allowance,
    p_other_allowances: parsed.data.other_allowances,
    p_change_reason: emptyToNull(parsed.data.change_reason),
  });

  if (error) throw new DatabaseError(error);

  revalidatePath(`/employees/${parsed.data.employeeId}`);
  });
}

/**
 * Phase 4.2: Secure HR Documents Actions
 */
export async function uploadEmployeeDocumentAction(
  _prev: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  return runFormAction("تعذر إتمام العملية. حاول مرة أخرى.", async () => {
  const ctx = await getAuthContext();
  if (!ctx) throw new ForbiddenError();
  const canManage =
    hasPermission(ctx, "employee_document.manage") || hasPermission(ctx, "employee.manage");
  if (!canManage) throw new ForbiddenError({ permission: "employee_document.manage" });

  const file = formData.get("file") as File | null;
  if (!file || !(file instanceof File) || file.size === 0) {
    throw new ValidationError("الرجاء اختيار ملف صالح.", "Please select a valid file.");
  }

  const parsed = uploadEmployeeDocumentSchema.safeParse({
    employeeId: formData.get("employeeId"),
    title: formData.get("title") || file.name,
    category: formData.get("category"),
    visibility_scope: formData.get("visibility_scope") || "employee_visible",
    document_number: formData.get("document_number") || undefined,
    issue_date: formData.get("issue_date") || undefined,
    expiry_date: formData.get("expiry_date") || undefined,
    notes: formData.get("notes") || undefined,
  });

  if (!parsed.success) {
    throw new ValidationError("بيانات الوثيقة غير مكتملة.", "Document metadata is incomplete.");
  }

  const supabase = await createServerSupabaseClient();
  const storage = new StorageService(supabase);
  storage.validate(file);

  // 1. Create entry in documents table
  const { data: doc, error: docErr } = await supabase
    .from("documents")
    .insert({
      organization_id: ctx.organization.id,
      title: parsed.data.title,
      category: "other",
      current_revision: "A",
      status: "approved",
      confidentiality: parsed.data.visibility_scope === "restricted" ? "restricted" : "confidential",
      uploaded_by: ctx.userId,
    })
    .select("id")
    .single<{ id: string }>();

  if (docErr || !doc) throw new DatabaseError(docErr);

  // 2. Upload file to secure HR path
  const uploaded = await storage.upload({
    organizationId: ctx.organization.id,
    projectId: `hr/employees/${parsed.data.employeeId}`,
    documentId: doc.id,
    revision: "A",
    file,
  });

  // 3. Create document version record
  const { error: versionErr } = await supabase.from("document_versions").insert({
    organization_id: ctx.organization.id,
    document_id: doc.id,
    revision: "A",
    file_path: uploaded.path,
    file_name: file.name,
    mime_type: file.type,
    size_bytes: file.size,
    checksum: uploaded.checksum,
    uploaded_by: ctx.userId,
  });
  if (versionErr) throw new DatabaseError(versionErr);

  // 4. Create employee_documents linkage
  const { error: linkErr } = await supabase.from("employee_documents").insert({
    organization_id: ctx.organization.id,
    employee_id: parsed.data.employeeId,
    document_id: doc.id,
    category: parsed.data.category,
    visibility_scope: parsed.data.visibility_scope,
    document_number: emptyToNull(parsed.data.document_number),
    issue_date: emptyToNull(parsed.data.issue_date),
    expiry_date: emptyToNull(parsed.data.expiry_date),
    notes: emptyToNull(parsed.data.notes),
    uploaded_by: ctx.userId,
  });
  if (linkErr) throw new DatabaseError(linkErr);

  await new AuditService(supabase).log({
    organizationId: ctx.organization.id,
    action: "employee_document.uploaded",
    entityType: "employee",
    entityId: parsed.data.employeeId,
    newValues: {
      document_id: doc.id,
      category: parsed.data.category,
      visibility_scope: parsed.data.visibility_scope,
    },
  });

  revalidatePath(`/employees/${parsed.data.employeeId}`);
  });
}

export async function getEmployeeDocumentDownloadUrlAction(input: {
  employeeId: string;
  documentId: string;
}): Promise<string> {
  const ctx = await getAuthContext();
  if (!ctx) throw new ForbiddenError();

  const supabase = await createServerSupabaseClient();
  const { data: link, error } = await supabase
    .from("employee_documents")
    .select("category, visibility_scope, documents(id, document_versions(file_path))")
    .eq("organization_id", ctx.organization.id)
    .eq("employee_id", input.employeeId)
    .eq("document_id", input.documentId)
    .maybeSingle();

  if (error || !link) throw new ForbiddenError();

  const doc = Array.isArray(link.documents) ? link.documents[0] : link.documents;
  const versions = doc?.document_versions as Array<{ file_path: string }> | undefined;
  const path = versions?.[0]?.file_path;
  if (!path) throw new ValidationError("ملف الوثيقة غير موجود.", "Document file not found.");

  const storage = new StorageService(supabase);
  const signed = await storage.signedUrl(path, 300);

  // Audit sensitive categories
  if (["bank", "passport", "iqama", "id"].includes(link.category)) {
    await new AuditService(supabase).log({
      organizationId: ctx.organization.id,
      action: "document.downloaded",
      entityType: "employee_document",
      entityId: input.documentId,
      newValues: { category: link.category, employee_id: input.employeeId },
    });
  }

  return signed;
}

/**
 * Phase 4.2: Employee Banking Actions
 */
export async function upsertEmployeeBankAction(
  _prev: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  return runFormAction("تعذر إتمام العملية. حاول مرة أخرى.", async () => {
  const ctx = await getAuthContext();
  if (!ctx) throw new ForbiddenError();
  const canManage =
    hasPermission(ctx, "employee_bank.manage") ||
    hasPermission(ctx, "finance.manage") ||
    hasPermission(ctx, "employee.manage");
  if (!canManage) throw new ForbiddenError({ permission: "employee_bank.manage" });

  const parsed = upsertEmployeeBankSchema.safeParse({
    employeeId: formData.get("employeeId"),
    bank_name: formData.get("bank_name"),
    iban: formData.get("iban"),
    account_name: formData.get("account_name"),
    swift_code: formData.get("swift_code") || undefined,
    is_primary: formData.get("is_primary") === "true" || formData.get("is_primary") === "on",
    accountId: formData.get("accountId") || undefined,
  });

  if (!parsed.success) {
    throw new ValidationError("بيانات الحساب البنكي غير مكتملة أو غير صالحة.", "Bank account details are incomplete or invalid.");
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.rpc("upsert_employee_banking", {
    p_organization_id: ctx.organization.id,
    p_employee_id: parsed.data.employeeId,
    p_bank_name: parsed.data.bank_name,
    p_iban: parsed.data.iban,
    p_account_name: parsed.data.account_name,
    p_swift_code: emptyToNull(parsed.data.swift_code),
    p_is_primary: parsed.data.is_primary,
    p_account_id: emptyToNull(parsed.data.accountId),
  });

  if (error) throw new DatabaseError(error);

  revalidatePath(`/employees/${parsed.data.employeeId}`);
  });
}

export async function deactivateEmployeeBankAction(
  _prev: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  return runFormAction("تعذر إتمام العملية. حاول مرة أخرى.", async () => {
  const ctx = await getAuthContext();
  if (!ctx) throw new ForbiddenError();
  const canManage =
    hasPermission(ctx, "employee_bank.manage") ||
    hasPermission(ctx, "finance.manage") ||
    hasPermission(ctx, "employee.manage");
  if (!canManage) throw new ForbiddenError({ permission: "employee_bank.manage" });

  const parsed = deactivateEmployeeBankSchema.safeParse({
    employeeId: formData.get("employeeId"),
    accountId: formData.get("accountId"),
  });

  if (!parsed.success) {
    throw new ValidationError("معرف الحساب البنكي غير صالح.", "Invalid bank account identifier.");
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.rpc("deactivate_employee_bank_account", {
    p_organization_id: ctx.organization.id,
    p_account_id: parsed.data.accountId,
  });

  if (error) throw new DatabaseError(error);

  revalidatePath(`/employees/${parsed.data.employeeId}`);
  });
}
