import { z } from "zod";

export const checkInSchema = z.object({
  latitude: z.coerce.number().gte(-90).lte(90),
  longitude: z.coerce.number().gte(-180).lte(180),
  accuracyMeters: z.coerce.number().gte(0).max(50_000),
});

export const checkOutSchema = checkInSchema;

export const adjustAttendanceSchema = z.object({
  recordId: z.string().uuid(),
  checkInAt: z.string().datetime({ offset: true }).optional().nullable(),
  checkOutAt: z.string().datetime({ offset: true }).optional().nullable(),
  attendanceStatus: z
    .enum([
      "present",
      "late",
      "absent",
      "partial",
      "on_leave",
      "holiday",
      "off_day",
      "missing_checkout",
    ])
    .optional(),
  notes: z.string().max(2000).optional(),
  reason: z.string().min(3).max(500),
});

export const assignEmployeeShiftSchema = z.object({
  employeeId: z.string().uuid(),
  shiftId: z.string().uuid(),
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  effectiveTo: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .nullable(),
});

export const upsertAttendancePolicySchema = z.object({
  id: z.string().uuid().optional(),
  code: z.string().min(2).max(32),
  name_ar: z.string().min(2).max(120),
  name_en: z.string().min(2).max(120),
  description_ar: z.string().max(500).optional(),
  description_en: z.string().max(500).optional(),
  late_grace_minutes: z.coerce.number().int().min(0).default(15),
  early_leave_grace_minutes: z.coerce.number().int().min(0).default(15),
  minimum_work_minutes: z.coerce.number().int().min(0).default(240),
  allow_manual_check_in: z.coerce.boolean().default(true),
  allow_manual_check_out: z.coerce.boolean().default(true),
  require_hr_approval_for_adjustment: z.coerce.boolean().default(false),
  reconciliation_delay_hours: z.coerce.number().int().min(0).default(8),
  is_active: z.coerce.boolean().default(true),
});

export const upsertAttendanceShiftSchema = z.object({
  id: z.string().uuid().optional(),
  policy_id: z.string().uuid(),
  code: z.string().min(2).max(32),
  name_ar: z.string().min(2).max(120),
  name_en: z.string().min(2).max(120),
  start_time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
  end_time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
  break_minutes: z.coerce.number().int().min(0).default(60),
  crosses_midnight: z.coerce.boolean().default(false),
  working_days: z
    .union([z.array(z.coerce.number().int().min(0).max(6)), z.string()])
    .transform((v) => {
      if (Array.isArray(v)) return v;
      return v
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .map(Number);
    })
    .pipe(z.array(z.number().int().min(0).max(6)).min(1)),
  is_active: z.coerce.boolean().default(true),
});

export const assignEmployeeWorkplaceSchema = z.object({
  employeeId: z.string().uuid(),
  workplaceId: z.string().uuid(),
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  effectiveTo: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .nullable(),
});

export const upsertWorkplaceLocationSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(2).max(160),
  code: z.string().max(32).optional().nullable(),
  address: z.string().max(500).optional().nullable(),
  latitude: z.coerce.number().gte(-90).lte(90),
  longitude: z.coerce.number().gte(-180).lte(180),
  allowed_radius_meters: z.coerce.number().int().min(10).max(2000),
  max_accuracy_meters: z.coerce.number().int().min(10).max(1000).optional().nullable(),
  is_active: z.coerce.boolean().default(true),
  is_primary: z.coerce.boolean().default(false),
  timezone: z.string().min(1).max(64).optional().nullable(),
});

export const reconcileAttendanceSchema = z.object({
  attendanceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  employeeId: z.string().uuid().optional(),
});
