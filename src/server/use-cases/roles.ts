"use server";

import "server-only";

import { revalidatePath } from "next/cache";
import { DatabaseError, ForbiddenError, ValidationError } from "@/lib/errors";
import { runFormAction, type FormActionState } from "@/server/forms/form-state";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getAuthContext } from "@/server/context";
import { authorize } from "@/server/policies/authorize";
import { RoleRepository } from "@/server/repositories/role.repository";
import { setCustomRoleActiveSchema, upsertCustomRoleSchema } from "@/modules/roles/schemas";
import { assertDelegablePermissionSet } from "@/lib/rbac/custom-roles";

function emptyToNull(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function mapRoleWriteFailure(error: unknown): never {
  const raw = error instanceof DatabaseError ? (error.causeError ?? error) : error;
  const rec = raw && typeof raw === "object" ? (raw as { code?: string; message?: string }) : {};
  const message = String(rec.message ?? "");
  if (message.includes("FORBIDDEN")) {
    throw new ForbiddenError({ permission: "role.manage" });
  }
  if (message.includes("SYSTEM_ROLE_IMMUTABLE") || message.includes("SYSTEM_ROLE_PERMISSIONS_IMMUTABLE")) {
    throw new ValidationError("لا يمكن تعديل أدوار النظام.", "System roles cannot be mutated.");
  }
  if (message.includes("ROLE_PERMISSION_NON_DELEGABLE")) {
    throw new ValidationError("لا يمكن تفويض هذه الصلاحية الإدارية في دور مخصص.", "That permission cannot be delegated.");
  }
  if (message.includes("ROLE_PERMISSION_NOT_HELD")) {
    throw new ValidationError("لا يمكن منح صلاحية لا تملكها.", "You cannot grant a permission you do not hold.");
  }
  if (message.includes("ROLE_PERMISSION_UNKNOWN") || message.includes("ROLE_PERMISSIONS_REQUIRED")) {
    throw new ValidationError("صلاحيات الدور غير صالحة.", "The permission set is not valid.");
  }
  if (message.includes("ROLE_CODE_RESERVED") || message.includes("ROLE_CODE_DUPLICATE")) {
    throw new ValidationError("رمز الدور محجوز أو مستخدم مسبقاً.", "The role code is reserved or already used.");
  }
  if (message.includes("ROLE_DEPARTMENT")) {
    throw new ValidationError("الإدارة المرتبطة بالدور غير صالحة.", "The associated department is not valid.");
  }
  if (message.includes("ROLE_NAMES_REQUIRED")) {
    throw new ValidationError("اسم الدور بالعربية والإنجليزية مطلوب.", "Arabic and English names are required.");
  }
  throw error instanceof DatabaseError ? error : new DatabaseError(error);
}

export async function upsertCustomRoleAction(
  _prev: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  return runFormAction("تعذر حفظ الدور. حاول مرة أخرى.", async () => {
    const ctx = authorize(await getAuthContext(), "role.manage");
    const parsed = upsertCustomRoleSchema.safeParse({
      roleId: formData.get("roleId") || undefined,
      name_ar: formData.get("name_ar"),
      name_en: formData.get("name_en"),
      code: formData.get("code") || undefined,
      department_id: formData.get("department_id") || undefined,
      permission_keys: formData.getAll("permission_keys").map(String),
    });
    if (!parsed.success) {
      throw new ValidationError("بيانات الدور غير مكتملة.", "Role data is incomplete.");
    }

    const subset = assertDelegablePermissionSet({
      requested: parsed.data.permission_keys,
      actorHolds: ctx.permissions,
    });
    if (!subset.ok) {
      throw new ValidationError("صلاحيات الدور غير مسموحة.", "The selected permissions are not allowed.");
    }

    const supabase = await createServerSupabaseClient();
    const repo = new RoleRepository(supabase);
    const departmentId = emptyToNull(parsed.data.department_id);
    try {
      if (parsed.data.roleId) {
        await repo.updateCustomRole({
          organizationId: ctx.organization.id,
          roleId: parsed.data.roleId,
          nameAr: parsed.data.name_ar,
          nameEn: parsed.data.name_en,
          departmentId,
          permissionKeys: subset.keys,
        });
      } else {
        await repo.createCustomRole({
          organizationId: ctx.organization.id,
          nameAr: parsed.data.name_ar,
          nameEn: parsed.data.name_en,
          code: emptyToNull(parsed.data.code),
          departmentId,
          permissionKeys: subset.keys,
        });
      }
    } catch (error) {
      if (error instanceof ValidationError || error instanceof ForbiddenError) throw error;
      mapRoleWriteFailure(error);
    }

    revalidatePath("/settings/roles");
    revalidatePath("/settings");
    revalidatePath("/employees");
  });
}

export async function setCustomRoleActiveAction(
  _prev: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  return runFormAction("تعذر تحديث حالة الدور. حاول مرة أخرى.", async () => {
    const ctx = authorize(await getAuthContext(), "role.manage");
    const parsed = setCustomRoleActiveSchema.safeParse({
      roleId: formData.get("roleId"),
      isActive: formData.get("isActive") === "true",
    });
    if (!parsed.success) {
      throw new ValidationError("تعذر تحديث حالة الدور.", "Could not update role status.");
    }

    const supabase = await createServerSupabaseClient();
    const repo = new RoleRepository(supabase);
    try {
      await repo.setCustomRoleActive(ctx.organization.id, parsed.data.roleId, parsed.data.isActive);
    } catch (error) {
      if (error instanceof ValidationError || error instanceof ForbiddenError) throw error;
      mapRoleWriteFailure(error);
    }

    revalidatePath("/settings/roles");
    revalidatePath("/settings");
    revalidatePath("/employees");
  });
}
