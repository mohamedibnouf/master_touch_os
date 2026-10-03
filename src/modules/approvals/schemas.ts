import { z } from "zod";
import { isPostgresUuid } from "@/lib/postgres-uuid";

/** Seed workflow IDs are PostgreSQL uuids, not RFC 4122. Zod 4 `.uuid()` rejects them. */
const postgresUuid = z.string().refine(isPostgresUuid, { message: "Invalid uuid" });

export const createApprovalSchema = z.object({
  title: z.string().trim().min(2).max(240),
  entityType: z.string().min(2).max(60),
  entityId: z.string().uuid(),
  approverProfileId: z.string().uuid(),
  dueAt: z.string().optional(),
});

export const decideApprovalSchema = z.object({
  stepId: z.string().uuid(),
  officialCode: z.enum(["A", "B", "C", "D", "E"]),
  comment: z.string().trim().max(2000).optional(),
});

export const startWorkflowSchema = z.object({
  definitionId: postgresUuid,
  entityType: z.string().min(2).max(60),
  entityId: postgresUuid,
});

export const completeWorkflowStepSchema = z.object({
  instanceStepId: z.string().uuid(),
  outcome: z.enum(["complete", "reject", "resubmit"]),
});

export const updateWorkflowStepDeadlineSchema = z.object({
  instanceStepId: postgresUuid,
  dueAtLocal: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
});
