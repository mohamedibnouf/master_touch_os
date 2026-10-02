import { z } from "zod";
import { isPostgresUuid } from "@/lib/postgres-uuid";

const postgresUuid = z.string().refine(isPostgresUuid, { message: "Invalid uuid" });

export const upsertCustomRoleSchema = z.object({
  roleId: postgresUuid.optional(),
  name_ar: z.string().trim().min(2).max(160),
  name_en: z.string().trim().min(2).max(160),
  code: z.string().trim().max(64).optional(),
  department_id: postgresUuid.optional(),
  permission_keys: z.array(z.string().trim().min(1)).min(1),
});

export const setCustomRoleActiveSchema = z.object({
  roleId: postgresUuid,
  isActive: z.boolean(),
});

export const unassignRoleSchema = z.object({
  profileId: postgresUuid,
  userRoleId: postgresUuid,
});
