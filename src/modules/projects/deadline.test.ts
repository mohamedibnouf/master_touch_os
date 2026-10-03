import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  buildWorkflowDeadlineEvents,
  computeDueAtIso,
  deadlineEventDedupKey,
  deriveDeadlineState,
  formatOverdueSinceAr,
  formatRemainingAr,
  riyadhLocalDateTimeToUtcIso,
  uniqueProfileIds,
  utcIsoToRiyadhLocalInput,
  validateDeadlineChange,
  warningStartsAtIso,
} from "./deadline";
import { emailAudienceFor } from "@/modules/notifications/event-compat";
import { whatsappAudienceFor } from "@/modules/notifications/whatsapp-policy";

const due = "2026-10-10T14:00:00.000Z"; // 17:00 Asia/Riyadh

describe("deadline calculation", () => {
  it("SLA produces due_at from activation", () => {
    expect(computeDueAtIso("2026-10-07T14:00:00.000Z", 72)).toBe(due);
    expect(computeDueAtIso("2026-10-07T14:00:00.000Z", null)).toBeNull();
  });

  it("warning threshold is warning_hours before due_at", () => {
    expect(warningStartsAtIso(due, 24)).toBe("2026-10-09T14:00:00.000Z");
  });
});

describe("derived deadline states", () => {
  it("classifies on track, due soon, overdue, and completed", () => {
    expect(
      deriveDeadlineState({ engineStatus: "ready", dueAt: due, warningHours: 24, nowIso: "2026-10-08T14:00:00.000Z" }),
    ).toBe("ON_TRACK");
    expect(
      deriveDeadlineState({ engineStatus: "ready", dueAt: due, warningHours: 24, nowIso: "2026-10-09T14:00:00.000Z" }),
    ).toBe("DUE_SOON");
    expect(
      deriveDeadlineState({ engineStatus: "ready", dueAt: due, warningHours: 24, nowIso: "2026-10-10T14:00:01.000Z" }),
    ).toBe("OVERDUE");
    expect(
      deriveDeadlineState({
        engineStatus: "completed",
        dueAt: due,
        warningHours: 24,
        nowIso: "2026-10-10T18:00:00.000Z",
      }),
    ).toBe("COMPLETED");
  });

  it("keeps approval-gated ready steps overdue after due_at without completing them", () => {
    expect(
      deriveDeadlineState({ engineStatus: "ready", dueAt: due, warningHours: 24, nowIso: "2026-10-11T14:00:00.000Z" }),
    ).toBe("OVERDUE");
  });
});

describe("deadline update validation", () => {
  it("rejects dates before activation or in the past unless already overdue", () => {
    expect(
      validateDeadlineChange({
        startedAt: "2026-10-01T08:00:00.000Z",
        currentDueAt: due,
        nextDueAt: "2026-09-30T08:00:00.000Z",
        nowIso: "2026-10-04T08:00:00.000Z",
      }),
    ).toBe("before_activation");
    expect(
      validateDeadlineChange({
        startedAt: "2026-10-01T08:00:00.000Z",
        currentDueAt: due,
        nextDueAt: "2026-10-03T08:00:00.000Z",
        nowIso: "2026-10-04T08:00:00.000Z",
      }),
    ).toBe("in_past");
    expect(
      validateDeadlineChange({
        startedAt: "2026-10-01T08:00:00.000Z",
        currentDueAt: "2026-10-02T08:00:00.000Z",
        nextDueAt: "2026-10-03T08:00:00.000Z",
        nowIso: "2026-10-04T08:00:00.000Z",
      }),
    ).toBe("ok");
    expect(
      validateDeadlineChange({
        startedAt: "2026-10-01T08:00:00.000Z",
        currentDueAt: due,
        nextDueAt: "2026-10-15T14:00:00.000Z",
        nowIso: "2026-10-04T08:00:00.000Z",
      }),
    ).toBe("ok");
  });
});

describe("timezone conversion", () => {
  it("stores Riyadh local as UTC and displays it back", () => {
    expect(riyadhLocalDateTimeToUtcIso("2026-10-10T17:00")).toBe(due);
    expect(utcIsoToRiyadhLocalInput(due)).toBe("2026-10-10T17:00");
    expect(riyadhLocalDateTimeToUtcIso("not-a-date")).toBeNull();
  });
});

describe("remaining copy", () => {
  it("formats remaining and overdue durations in Arabic", () => {
    expect(formatRemainingAr(due, "2026-10-08T10:00:00.000Z")).toContain("يوم");
    expect(formatOverdueSinceAr(due, "2026-10-11T17:00:00.000Z")).toContain("يوم");
  });
});

describe("scheduler idempotency", () => {
  const step = {
    id: "s1",
    organizationId: "11111111-1111-1111-1111-111111111111",
    projectId: "p1",
    nameAr: "التصميم والهندسة",
    status: "ready",
    dueAt: due,
    warningHours: 24,
    recipientIds: uniqueProfileIds(["u1", "u1", "u2", null]),
  };

  it("emits warning once per deadline revision and skips completed steps", () => {
    const warn = buildWorkflowDeadlineEvents([step], "2026-10-09T15:00:00.000Z");
    expect(warn).toHaveLength(2);
    expect(warn[0]?.dedupKey).toBe(`${deadlineEventDedupKey("warning", "s1", due)}:u1`);
    expect(buildWorkflowDeadlineEvents([{ ...step, status: "completed" }], "2026-10-09T15:00:00.000Z")).toEqual([]);
    expect(buildWorkflowDeadlineEvents([{ ...step, status: "completed" }], "2026-10-11T15:00:00.000Z")).toEqual([]);
  });

  it("emits overdue once and allows a new warning after extension", () => {
    const overdue = buildWorkflowDeadlineEvents([step], "2026-10-10T15:00:00.000Z");
    expect(overdue.every((e) => e.eventType === "workflow.step.overdue")).toBe(true);
    const extended = "2026-10-15T14:00:00.000Z";
    const later = buildWorkflowDeadlineEvents(
      [{ ...step, dueAt: extended }],
      "2026-10-14T15:00:00.000Z",
    );
    expect(later[0]?.dedupKey).not.toBe(overdue[0]?.dedupKey);
    expect(later[0]?.eventType).toBe("workflow.step.deadline_warning");
  });

  it("deduplicates recipients", () => {
    expect(uniqueProfileIds(["a", "a", "b", null])).toEqual(["a", "b"]);
  });
});

describe("workflow email routing", () => {
  it("emails approvals, activation, warning, overdue, and workflow completion", () => {
    expect(emailAudienceFor("approval.created")).toBe("personal");
    expect(emailAudienceFor("approval.decided")).toBe("personal");
    expect(emailAudienceFor("workflow.step.activated")).toBe("personal");
    expect(emailAudienceFor("workflow.step.deadline_warning")).toBe("personal");
    expect(emailAudienceFor("workflow.step.overdue")).toBe("personal");
    expect(emailAudienceFor("workflow.step.overdue.management")).toBe("management");
    expect(emailAudienceFor("workflow.completed")).toBe("management");
    expect(emailAudienceFor("workflow.step.completed")).toBe("none");
    expect(whatsappAudienceFor("workflow.step.activated")).toBe("none");
    expect(whatsappAudienceFor("workflow.step.overdue")).toBe("none");
  });
});

describe("074 contract", () => {
  it("uses workflow.manage and does not rewrite 073", () => {
    const sql = readFileSync("supabase/migrations/074_workflow_step_deadlines.sql", "utf8");
    expect(sql).toMatch(/has_permission\('workflow\.manage'/);
    expect(sql).toMatch(/update_workflow_step_deadline/);
    expect(sql).toMatch(/workflow\.step\.deadline_changed/);
    expect(sql).toMatch(/new\.warning_at := new\.due_at - make_interval\(hours => v_warn\)/);
    expect(sql).toMatch(/if new\.due_at is null and v_sla is not null/);
    expect(sql).not.toMatch(/073_project_workflow/);
    expect(sql).not.toMatch(/now\(\) \+ make_interval\(hours => v_warn\)/);
    expect(sql).not.toMatch(/grant execute on function public\.update_workflow_step_deadline.*to public/);
    expect(sql).not.toMatch(/grant execute on function public\.update_workflow_step_deadline.*to anon/);
  });

  it("start action still requires workflow.start not workflow.manage", () => {
    const src = readFileSync("src/server/use-cases/platform.ts", "utf8");
    const start = src.slice(
      src.indexOf("export async function startWorkflowAction"),
      src.indexOf("export async function completeWorkflowStepAction"),
    );
    expect(start).toContain('authorize(await getAuthContext(), "workflow.start")');
    const update = src.slice(src.indexOf("export async function updateWorkflowStepDeadlineAction"));
    expect(update).toContain('authorize(await getAuthContext(), "workflow.manage")');
  });
});
