import { describe, expect, it } from "vitest";
import {
  applyLegacyStageCompletion,
  buildProjectAttention,
  canCompleteLegacyStage,
  deriveStageProgress,
  formatOverdueDurationAr,
  mapEngineStatusToVisual,
  officialCodeToWorkflowOutcome,
  pickCurrentNodeId,
  resolveStageAssignment,
  waitingApprovalPhrase,
} from "./workflow-view";

describe("officialCodeToWorkflowOutcome", () => {
  it("maps A/B to complete, C to resubmit, D to reject, E to none", () => {
    expect(officialCodeToWorkflowOutcome("A")).toBe("complete");
    expect(officialCodeToWorkflowOutcome("B")).toBe("complete");
    expect(officialCodeToWorkflowOutcome("C")).toBe("resubmit");
    expect(officialCodeToWorkflowOutcome("D")).toBe("reject");
    expect(officialCodeToWorkflowOutcome("E")).toBeNull();
  });
});

describe("mapEngineStatusToVisual", () => {
  const now = "2026-10-03T12:00:00.000Z";

  it("maps completed and upcoming", () => {
    expect(
      mapEngineStatusToVisual({
        engineStatus: "completed",
        requiresApproval: false,
        dueAt: null,
        nowIso: now,
        openApproval: null,
        latestOfficialCode: null,
      }),
    ).toBe("completed");
    expect(
      mapEngineStatusToVisual({
        engineStatus: "pending",
        requiresApproval: false,
        dueAt: null,
        nowIso: now,
        openApproval: null,
        latestOfficialCode: null,
      }),
    ).toBe("upcoming");
  });

  it("keeps approval-required work current until a request is submitted", () => {
    expect(
      mapEngineStatusToVisual({
        engineStatus: "ready",
        requiresApproval: true,
        dueAt: null,
        nowIso: now,
        openApproval: null,
        latestOfficialCode: null,
      }),
    ).toBe("current");
  });

  it("shows waiting approval when an open request exists", () => {
    expect(
      mapEngineStatusToVisual({
        engineStatus: "ready",
        requiresApproval: true,
        dueAt: null,
        nowIso: now,
        openApproval: {
          requestId: "r1",
          stepId: "s1",
          status: "in_progress",
          approverUserId: "u1",
          approverLabel: "المدير العام",
        },
        latestOfficialCode: null,
      }),
    ).toBe("waiting_approval");
  });

  it("treats request-changes as distinct from hard rejection", () => {
    expect(
      mapEngineStatusToVisual({
        engineStatus: "ready",
        requiresApproval: true,
        dueAt: null,
        nowIso: now,
        openApproval: null,
        latestOfficialCode: "C",
      }),
    ).toBe("changes_requested");
    expect(
      mapEngineStatusToVisual({
        engineStatus: "rejected",
        requiresApproval: true,
        dueAt: null,
        nowIso: now,
        openApproval: null,
        latestOfficialCode: "D",
      }),
    ).toBe("rejected");
  });

  it("marks overdue without advancing", () => {
    expect(
      mapEngineStatusToVisual({
        engineStatus: "in_progress",
        requiresApproval: false,
        dueAt: "2026-10-01T00:00:00.000Z",
        nowIso: now,
        openApproval: null,
        latestOfficialCode: null,
      }),
    ).toBe("overdue");
  });
});

describe("legacy stage completion", () => {
  const stages = [
    { id: "a", sequence: 1, status: "in_progress" },
    { id: "b", sequence: 2, status: "not_started" },
    { id: "c", sequence: 3, status: "not_started" },
  ];

  it("completes current and activates next automatically", () => {
    const result = applyLegacyStageCompletion(stages, "a", "2026-10-03");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.updates).toEqual([
      { id: "a", status: "completed", actual_end: "2026-10-03", progress_percentage: 100 },
      { id: "b", status: "in_progress", actual_start: "2026-10-03" },
    ]);
  });

  it("rejects out-of-order completion", () => {
    expect(canCompleteLegacyStage(stages, "b")).toEqual({ ok: false, reason: "out_of_order" });
  });

  it("rejects double completion", () => {
    expect(canCompleteLegacyStage([{ id: "a", sequence: 1, status: "completed" }], "a")).toEqual({
      ok: false,
      reason: "already_completed",
    });
  });
});

describe("progress and attention", () => {
  it("derives percent from completed/skipped and excludes cancelled", () => {
    expect(
      deriveStageProgress([
        { visual: "completed", engineStatus: "completed" },
        { visual: "current", engineStatus: "ready" },
        { visual: "upcoming", engineStatus: "pending" },
      ]),
    ).toEqual({ completed: 1, total: 3, percent: 33 });
    expect(
      deriveStageProgress([
        { visual: "completed", engineStatus: "skipped" },
        { visual: "blocked", engineStatus: "cancelled" },
      ]),
    ).toEqual({ completed: 1, total: 1, percent: 100 });
  });

  it("asks the approver to act and hides actions from waiters", () => {
    const approve = buildProjectAttention({
      mode: "workflow",
      instanceStatus: "in_progress",
      current: {
        nameAr: "مراجعة المهندس",
        visual: "waiting_approval",
        canComplete: false,
        canSubmitApproval: false,
        canDecideApproval: true,
        approverLabel: "المدير العام",
        responsibleLabel: "أحمد",
        blockReason: "بانتظار موافقة المدير العام",
        latestOfficialCode: null,
      },
    });
    expect(approve.kind).toBe("approve");
    expect(approve.detail).toContain("مراجعة المهندس");

    expect(
      buildProjectAttention({ mode: "preview", instanceStatus: null, current: null }).title,
    ).toBe("مسار العمل لم يبدأ بعد");

    const wait = buildProjectAttention({
      mode: "workflow",
      instanceStatus: "in_progress",
      current: {
        nameAr: "مراجعة المهندس",
        visual: "waiting_approval",
        canComplete: false,
        canSubmitApproval: false,
        canDecideApproval: false,
        approverLabel: "المدير العام",
        responsibleLabel: "أحمد",
        blockReason: "بانتظار موافقة المدير العام",
        latestOfficialCode: null,
      },
    });
    expect(wait.kind).toBe("wait");
    expect(wait.title).toBe(waitingApprovalPhrase("المدير العام"));
  });

  it("picks the actionable node as current", () => {
    expect(
      pickCurrentNodeId([
        { id: "1", visual: "completed" },
        { id: "2", visual: "waiting_approval" },
        { id: "3", visual: "upcoming" },
      ]),
    ).toBe("2");
  });
});

describe("formatOverdueDurationAr", () => {
  it("localizes day counts", () => {
    expect(formatOverdueDurationAr("2026-10-01T00:00:00.000Z", "2026-10-03T01:00:00.000Z")).toBe(
      "متأخرة يومين",
    );
    expect(formatOverdueDurationAr("2026-10-04T00:00:00.000Z", "2026-10-03T01:00:00.000Z")).toBeNull();
  });
});

describe("resolveStageAssignment", () => {
  const maps = {
    profileNames: new Map([["u1", "محمد أحمد"]]),
    roleNames: new Map([["r1", "المدير العام"]]),
    departmentNames: new Map([["d1", "الهندسة"]]),
    jobTitles: new Map([["u1", "مدير المشروع"]]),
  };

  it("prefers assigned user over role and department", () => {
    expect(
      resolveStageAssignment({
        assignedUserId: "u1",
        assignedRoleId: "r1",
        assignedDepartmentId: "d1",
        ...maps,
      }),
    ).toEqual({ kind: "user", label: "محمد أحمد", subtitle: "مدير المشروع" });
  });

  it("uses role then department then unassigned", () => {
    expect(
      resolveStageAssignment({
        assignedUserId: null,
        assignedRoleId: "r1",
        assignedDepartmentId: "d1",
        ...maps,
      }),
    ).toEqual({ kind: "role", label: "المدير العام", subtitle: "دور" });
    expect(
      resolveStageAssignment({
        assignedUserId: null,
        assignedRoleId: null,
        assignedDepartmentId: "d1",
        ...maps,
      }),
    ).toEqual({ kind: "department", label: "الهندسة", subtitle: "قسم" });
    expect(
      resolveStageAssignment({
        assignedUserId: null,
        assignedRoleId: null,
        assignedDepartmentId: null,
        ...maps,
      }),
    ).toEqual({ kind: "none", label: "غير محدد", subtitle: null });
  });
});
