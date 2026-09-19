import { z } from "zod";

export const createPayrollPeriodSchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
  month: z.coerce.number().int().min(1).max(12),
});

export const payrollPeriodIdSchema = z.object({
  periodId: z.string().uuid(),
});

export const cancelPayrollPeriodSchema = z.object({
  periodId: z.string().uuid(),
  reason: z.string().min(3).max(500),
});

export const addPayrollManualEarningSchema = z.object({
  entryId: z.string().uuid(),
  code: z.string().min(2).max(32),
  descriptionAr: z.string().min(2).max(120),
  descriptionEn: z.string().min(2).max(120),
  amount: z.coerce.number().positive(),
  reason: z.string().min(3).max(500),
});

export const addPayrollManualDeductionSchema = addPayrollManualEarningSchema;

export const recordPayrollPaymentSchema = z.object({
  entryId: z.string().uuid(),
  paymentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  paymentMethod: z.enum(["bank_transfer", "cash", "cheque", "other"]).default("bank_transfer"),
  paymentReference: z.string().max(120).optional(),
  amount: z.coerce.number().positive(),
  notes: z.string().max(1000).optional(),
});

export const updatePayrollSettingsSchema = z.object({
  currency: z.string().min(3).max(8).default("SAR"),
  standardPayableDays: z.coerce.number().positive().default(30),
  deductUnpaidLeave: z.coerce.boolean().default(true),
  deductAbsence: z.coerce.boolean().default(false),
  deductLateMinutes: z.coerce.boolean().default(false),
  roundingPrecision: z.coerce.number().int().min(0).max(6).default(2),
  defaultPaymentMethod: z.enum(["bank_transfer", "cash", "cheque", "other"]).default("bank_transfer"),
});
