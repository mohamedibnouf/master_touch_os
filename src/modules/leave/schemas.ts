import { z } from "zod";

export const submitLeaveRequestSchema = z.object({
  leaveTypeId: z.string().uuid(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reason: z.string().max(2000).optional(),
  attachmentDocumentId: z.string().uuid().optional(),
  requestId: z.string().uuid().optional(),
});

export const decideLeaveRequestSchema = z.object({
  requestId: z.string().uuid(),
  decision: z.enum(["approved", "rejected"]),
  comment: z.string().max(1000).optional(),
});

export const cancelLeaveRequestSchema = z.object({
  requestId: z.string().uuid(),
});

export const adjustLeaveBalanceSchema = z.object({
  employeeId: z.string().uuid(),
  leaveTypeId: z.string().uuid(),
  year: z.coerce.number().int().min(2000).max(2100),
  adjustmentDays: z.coerce.number().refine((n) => n !== 0, "adjustment required"),
  reason: z.string().min(3).max(500),
});

export const upsertLeaveTypeSchema = z.object({
  id: z.string().uuid().optional(),
  code: z.string().min(2).max(32),
  name_ar: z.string().min(2).max(120),
  name_en: z.string().min(2).max(120),
  description_ar: z.string().max(500).optional(),
  description_en: z.string().max(500).optional(),
  is_paid: z.coerce.boolean().default(true),
  annual_entitlement_days: z.coerce.number().min(0).default(0),
  requires_attachment: z.coerce.boolean().default(false),
  minimum_notice_days: z.coerce.number().int().min(0).default(0),
  maximum_consecutive_days: z.coerce.number().int().positive().optional().nullable(),
  allow_carry_forward: z.coerce.boolean().default(false),
  maximum_carry_forward_days: z.coerce.number().min(0).optional().nullable(),
  allow_negative_balance: z.coerce.boolean().default(false),
  is_active: z.coerce.boolean().default(true),
});
