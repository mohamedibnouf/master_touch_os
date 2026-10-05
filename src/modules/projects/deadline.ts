export const RIYADH_TIME_ZONE = "Asia/Riyadh";
const RIYADH_OFFSET_MS = 3 * 60 * 60 * 1000;

export type DeadlineState = "ON_TRACK" | "DUE_SOON" | "OVERDUE" | "COMPLETED";

export function computeDueAtIso(activatedAtIso: string, slaHours: number | null): string | null {
  if (slaHours == null || !Number.isFinite(slaHours) || slaHours < 0) return null;
  const start = Date.parse(activatedAtIso);
  if (!Number.isFinite(start)) return null;
  return new Date(start + slaHours * 3_600_000).toISOString();
}

export function warningStartsAtIso(dueAtIso: string, warningHours: number | null): string | null {
  if (warningHours == null || !Number.isFinite(warningHours) || warningHours < 0) return null;
  const due = Date.parse(dueAtIso);
  if (!Number.isFinite(due)) return null;
  return new Date(due - warningHours * 3_600_000).toISOString();
}

export function deriveDeadlineState(input: {
  engineStatus: string;
  dueAt: string | null;
  warningHours: number | null;
  nowIso: string;
}): DeadlineState {
  if (input.engineStatus === "completed" || input.engineStatus === "skipped") return "COMPLETED";
  const active = input.engineStatus === "ready" || input.engineStatus === "in_progress";
  if (!active || !input.dueAt) return "ON_TRACK";
  const now = Date.parse(input.nowIso);
  const due = Date.parse(input.dueAt);
  if (!Number.isFinite(now) || !Number.isFinite(due)) return "ON_TRACK";
  if (now > due) return "OVERDUE";
  const warnAt = warningStartsAtIso(input.dueAt, input.warningHours);
  if (warnAt && now >= Date.parse(warnAt)) return "DUE_SOON";
  return "ON_TRACK";
}

export function deadlineRevisionKey(dueAtIso: string): string {
  const ms = Date.parse(dueAtIso);
  if (!Number.isFinite(ms)) return dueAtIso;
  return new Date(ms).toISOString();
}

export function deadlineEventDedupKey(kind: "warning" | "overdue", stepId: string, dueAtIso: string): string {
  return `workflow.step.${kind === "warning" ? "deadline_warning" : "overdue"}:${stepId}:${deadlineRevisionKey(dueAtIso)}`;
}

export function validateDeadlineChange(input: {
  startedAt: string | null;
  currentDueAt: string | null;
  nextDueAt: string;
  nowIso: string;
}): "ok" | "before_activation" | "in_past" | "invalid" {
  const next = Date.parse(input.nextDueAt);
  const now = Date.parse(input.nowIso);
  if (!Number.isFinite(next) || !Number.isFinite(now)) return "invalid";
  if (input.startedAt) {
    const started = Date.parse(input.startedAt);
    if (Number.isFinite(started) && next <= started) return "before_activation";
  }
  const currentDue = input.currentDueAt ? Date.parse(input.currentDueAt) : NaN;
  const alreadyOverdue = Number.isFinite(currentDue) && currentDue < now;
  if (!alreadyOverdue && next < now) return "in_past";
  return "ok";
}

export function riyadhLocalDateTimeToUtcIso(local: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const utcMs = Date.UTC(year, month - 1, day, hour, minute) - RIYADH_OFFSET_MS;
  return new Date(utcMs).toISOString();
}

export function utcIsoToRiyadhLocalInput(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: RIYADH_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(ms));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";

function toArabicDigits(value: string): string {
  return value.replace(/\d/g, (digit) => ARABIC_DIGITS[Number(digit)] ?? digit);
}

/** Riyadh datetime for UI — formatToParts so Node and the browser cannot disagree on Arabic commas. */
export function formatRiyadhDateTimeAr(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "—";
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: RIYADH_TIME_ZONE,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(new Date(ms));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const day = String(Number(get("day")));
  const month = String(Number(get("month")));
  const hour = String(Number(get("hour")));
  const period = get("dayPeriod").toLowerCase().includes("p") ? "م" : "ص";
  return toArabicDigits(`${day}/${month}/${get("year")} ${hour}:${get("minute")} ${period}`);
}

function dualAr(count: number, one: string, two: string, few: string, many: string): string {
  if (count === 1) return one;
  if (count === 2) return two;
  if (count >= 3 && count <= 10) return `${count} ${few}`;
  return `${count} ${many}`;
}

export function formatRemainingAr(dueAtIso: string, nowIso: string): string | null {
  const due = Date.parse(dueAtIso);
  const now = Date.parse(nowIso);
  if (!Number.isFinite(due) || !Number.isFinite(now) || now >= due) return null;
  const hours = Math.floor((due - now) / 3_600_000);
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  if (days === 0 && remHours === 0) return "أقل من ساعة";
  const parts: string[] = [];
  if (days > 0) parts.push(dualAr(days, "يوم", "يومان", "أيام", "يوماً"));
  if (remHours > 0) parts.push(dualAr(remHours, "ساعة", "ساعتان", "ساعات", "ساعة"));
  return parts.join(" و");
}

export function formatOverdueSinceAr(dueAtIso: string, nowIso: string): string | null {
  const due = Date.parse(dueAtIso);
  const now = Date.parse(nowIso);
  if (!Number.isFinite(due) || !Number.isFinite(now) || now <= due) return null;
  const hours = Math.floor((now - due) / 3_600_000);
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  if (days === 0 && remHours === 0) return "أقل من ساعة";
  const parts: string[] = [];
  if (days > 0) parts.push(dualAr(days, "يوم", "يومان", "أيام", "يوماً"));
  if (remHours > 0) parts.push(dualAr(remHours, "ساعة", "ساعتان", "ساعات", "ساعة"));
  return parts.join(" و");
}

export function uniqueProfileIds(ids: Array<string | null | undefined>): string[] {
  const out: string[] = [];
  for (const id of ids) {
    if (!id || out.includes(id)) continue;
    out.push(id);
  }
  return out;
}

export type WorkflowDeadlineScanStep = {
  id: string;
  organizationId: string;
  projectId: string | null;
  nameAr: string;
  status: string;
  dueAt: string | null;
  warningHours: number | null;
  recipientIds: string[];
};

export function buildWorkflowDeadlineEvents(
  steps: WorkflowDeadlineScanStep[],
  nowIso: string,
): Array<{
  organizationId: string;
  recipientId: string;
  entityId: string;
  projectId: string | null;
  eventType: "workflow.step.deadline_warning" | "workflow.step.overdue";
  dedupKey: string;
  nameAr: string;
  dueAt: string;
}> {
  const out: Array<{
    organizationId: string;
    recipientId: string;
    entityId: string;
    projectId: string | null;
    eventType: "workflow.step.deadline_warning" | "workflow.step.overdue";
    dedupKey: string;
    nameAr: string;
    dueAt: string;
  }> = [];
  for (const step of steps) {
    if (!step.dueAt) continue;
    if (step.status === "completed" || step.status === "cancelled" || step.status === "skipped" || step.status === "rejected") {
      continue;
    }
    if (step.status !== "ready" && step.status !== "in_progress") continue;
    const state = deriveDeadlineState({
      engineStatus: step.status,
      dueAt: step.dueAt,
      warningHours: step.warningHours,
      nowIso,
    });
    if (state !== "DUE_SOON" && state !== "OVERDUE") continue;
    const eventType = state === "OVERDUE" ? "workflow.step.overdue" : "workflow.step.deadline_warning";
    const kind = state === "OVERDUE" ? "overdue" : "warning";
    const dedupKey = deadlineEventDedupKey(kind, step.id, step.dueAt);
    for (const recipientId of uniqueProfileIds(step.recipientIds)) {
      out.push({
        organizationId: step.organizationId,
        recipientId,
        entityId: step.id,
        projectId: step.projectId,
        eventType,
        dedupKey: `${dedupKey}:${recipientId}`,
        nameAr: step.nameAr,
        dueAt: step.dueAt,
      });
    }
  }
  return out;
}
