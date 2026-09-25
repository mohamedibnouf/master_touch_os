import { approachingDate, dateOverdue, overdueReached, reminderWindowReached, shouldEscalateOverdue } from "./schedule";

export type ApprovalStepScan = {
  id: string;
  organizationId: string;
  requestId: string;
  userId: string | null;
  dueAt: string | null;
  status: string;
  managerProfileId: string | null;
};

export function buildApprovalReminderEvents(steps: ApprovalStepScan[], now: Date, todayYmd: string) {
  const out: Array<{
    organizationId: string;
    recipientId: string;
    entityId: string;
    dedupKey: string;
    eventType: "APPROVAL_REMINDER" | "APPROVAL_OVERDUE" | "ESCALATION_CREATED";
    managerProfileId: string | null;
  }> = [];
  for (const step of steps) {
    if (!step.userId || !step.dueAt) continue;
    if (!["pending", "in_progress"].includes(step.status)) continue;
    if (reminderWindowReached(step.dueAt, now, 24) && !overdueReached(step.dueAt, now)) {
      out.push({
        organizationId: step.organizationId,
        recipientId: step.userId,
        entityId: step.requestId,
        dedupKey: `approval-reminder:${step.id}:${todayYmd}`,
        eventType: "APPROVAL_REMINDER",
        managerProfileId: null,
      });
    }
    if (overdueReached(step.dueAt, now)) {
      out.push({
        organizationId: step.organizationId,
        recipientId: step.userId,
        entityId: step.requestId,
        dedupKey: `approval-overdue:${step.id}:${todayYmd}`,
        eventType: "APPROVAL_OVERDUE",
        managerProfileId: null,
      });
    }
    if (shouldEscalateOverdue(step.dueAt, now, 0) && step.managerProfileId) {
      out.push({
        organizationId: step.organizationId,
        recipientId: step.managerProfileId,
        entityId: step.requestId,
        dedupKey: `escalation:${step.id}:${step.managerProfileId}:1`,
        eventType: "ESCALATION_CREATED",
        managerProfileId: step.managerProfileId,
      });
    }
  }
  return out;
}

export function buildProjectDeadlineEvents(
  projects: Array<{ id: string; organizationId: string; ownerProfileId: string | null; plannedEndDate: string | null }>,
  todayYmd: string,
) {
  const out: Array<{ eventType: "PROJECT_DEADLINE_APPROACHING" | "PROJECT_OVERDUE"; dedupKey: string; recipientId: string; entityId: string; organizationId: string }> =
    [];
  for (const p of projects) {
    if (!p.ownerProfileId || !p.plannedEndDate) continue;
    if (approachingDate(p.plannedEndDate, todayYmd, 7)) {
      out.push({
        organizationId: p.organizationId,
        recipientId: p.ownerProfileId,
        entityId: p.id,
        eventType: "PROJECT_DEADLINE_APPROACHING",
        dedupKey: `project-deadline:${p.id}:${todayYmd}`,
      });
    }
    if (dateOverdue(p.plannedEndDate, todayYmd)) {
      out.push({
        organizationId: p.organizationId,
        recipientId: p.ownerProfileId,
        entityId: p.id,
        eventType: "PROJECT_OVERDUE",
        dedupKey: `project-overdue:${p.id}:${todayYmd}`,
      });
    }
  }
  return out;
}
