import { describe, expect, it } from "vitest";
import {
  calendarGridRange,
  compareTasks,
  cycleHours,
  defaultPointsForPriority,
  dueDayInRiyadh,
  isCompletedOnTime,
  isDueToday,
  isOverdue,
  minutesBetween,
  pointsEarned,
  riyadhDueDateToIso,
  riyadhRangeToUtc,
  runningMinutes,
  sortOrderBetween,
  splitMinutes,
  taskCapabilities,
  taskDisplayTitle,
  taskEntityHref,
} from "./logic";
import { createTaskSchema, parseTaskFilters, updateTaskSchema, addManualTimeEntrySchema } from "./schemas";
import type { Task } from "./types";

const P = "11111111-1111-4111-8111-111111111111";
const ID = "22222222-2222-4222-8222-222222222222";

function task(partial: Partial<Task> = {}): Task {
  return {
    id: ID,
    organization_id: P,
    list_id: P,
    parent_task_id: null,
    title: "مهمة",
    title_en: null,
    description: null,
    status: "todo",
    priority: "normal",
    start_date: null,
    due_at: null,
    completed_at: null,
    estimate_minutes: null,
    points: 2,
    entity_type: null,
    entity_id: null,
    source: "manual",
    source_key: null,
    sort_order: 0,
    created_by: null,
    created_at: "2026-10-01T06:00:00.000Z",
    updated_at: "2026-10-01T06:00:00.000Z",
    ...partial,
  };
}

describe("tasks logic — points", () => {
  it("default points by priority", () => {
    expect(defaultPointsForPriority("urgent")).toBe(5);
    expect(defaultPointsForPriority("high")).toBe(3);
    expect(defaultPointsForPriority("normal")).toBe(2);
    expect(defaultPointsForPriority("low")).toBe(1);
  });

  it("points earned: full on time, half late, zero when not done", () => {
    const due = "2026-10-10T20:59:59.000Z";
    expect(pointsEarned(task({ status: "done", points: 4, due_at: due, completed_at: "2026-10-10T10:00:00Z" }))).toBe(4);
    expect(pointsEarned(task({ status: "done", points: 4, due_at: due, completed_at: "2026-10-11T10:00:00Z" }))).toBe(2);
    expect(pointsEarned(task({ status: "done", points: 3, completed_at: "2026-10-11T10:00:00Z" }))).toBe(3);
    expect(pointsEarned(task({ status: "in_progress", points: 3 }))).toBe(0);
    expect(isCompletedOnTime(task({ status: "cancelled", completed_at: null }))).toBe(false);
  });

  it("cycle hours rounds to one decimal and ignores open tasks", () => {
    expect(cycleHours("2026-10-01T00:00:00Z", "2026-10-01T01:30:00Z")).toBe(1.5);
    expect(cycleHours("2026-10-01T00:00:00Z", null)).toBeNull();
  });
});

describe("tasks logic — Riyadh dates", () => {
  const now = new Date("2026-10-31T22:30:00Z"); // 2026-11-01 01:30 in Riyadh

  it("overdue only for open tasks past their due instant", () => {
    expect(isOverdue(task({ due_at: "2026-10-31T20:00:00Z" }), now)).toBe(true);
    expect(isOverdue(task({ due_at: "2026-10-31T20:00:00Z", status: "done" }), now)).toBe(false);
    expect(isOverdue(task({ due_at: "2026-11-01T20:00:00Z" }), now)).toBe(false);
    expect(isOverdue(task({ due_at: null }), now)).toBe(false);
  });

  it("due today uses the Riyadh calendar day, not UTC", () => {
    // 2026-11-01 23:59:59 Riyadh is still "today" in Riyadh although UTC is 2026-10-31.
    expect(isDueToday(task({ due_at: riyadhDueDateToIso("2026-11-01") }), now)).toBe(true);
    expect(isDueToday(task({ due_at: riyadhDueDateToIso("2026-10-31") }), now)).toBe(false);
  });

  it("due date → end of the Riyadh day; due day of an instant", () => {
    expect(riyadhDueDateToIso("2026-10-29")).toBe("2026-10-29T20:59:59.000Z");
    expect(dueDayInRiyadh("2026-10-29T21:30:00Z")).toBe("2026-10-30");
    expect(dueDayInRiyadh(null)).toBeNull();
    expect(() => riyadhDueDateToIso("2026-02-31")).toThrow();
  });

  it("Riyadh range → UTC bounds (end exclusive)", () => {
    expect(riyadhRangeToUtc("2026-10-01", "2026-10-31")).toEqual({
      startIso: "2026-09-30T21:00:00.000Z",
      endIso: "2026-10-31T21:00:00.000Z",
    });
  });

  it("calendar grid starts on Saturday and covers whole weeks", () => {
    const grid = calendarGridRange(2026, 11);
    expect(grid.days.length % 7).toBe(0);
    expect(new Date(`${grid.from}T00:00:00Z`).getUTCDay()).toBe(6);
    expect(grid.days).toContain("2026-11-01");
    expect(grid.days).toContain("2026-11-30");
  });

  it("timer minutes", () => {
    expect(runningMinutes("2026-10-31T22:00:00Z", now)).toBe(30);
    expect(minutesBetween("2026-10-31T22:00:00Z", "2026-10-31T22:44:40Z")).toBe(45);
    expect(splitMinutes(135)).toEqual({ hours: 2, minutes: 15 });
  });
});

describe("tasks logic — sorting", () => {
  it("sorts by priority then manual order", () => {
    const rows = [
      task({ id: "a", priority: "low", sort_order: 1 }),
      task({ id: "b", priority: "urgent", sort_order: 5 }),
      task({ id: "c", priority: "urgent", sort_order: 2 }),
    ];
    expect([...rows].sort(compareTasks("priority")).map((r) => r.id)).toEqual(["c", "b", "a"]);
  });

  it("sorts by due with missing due dates last", () => {
    const rows = [
      task({ id: "a", due_at: null }),
      task({ id: "b", due_at: "2026-10-05T00:00:00Z" }),
      task({ id: "c", due_at: "2026-10-01T00:00:00Z" }),
    ];
    expect([...rows].sort(compareTasks("due")).map((r) => r.id)).toEqual(["c", "b", "a"]);
  });

  it("sortOrderBetween uses midpoints and steps", () => {
    expect(sortOrderBetween(null, null)).toBe(1024);
    expect(sortOrderBetween(10, null)).toBe(1034);
    expect(sortOrderBetween(null, 10)).toBe(-1014);
    expect(sortOrderBetween(10, 20)).toBe(15);
  });
});

describe("tasks logic — links, titles, capabilities", () => {
  it("entity hrefs map to app routes", () => {
    expect(taskEntityHref("project", ID)).toBe(`/projects/${ID}`);
    expect(taskEntityHref("workflow_instance_step", ID, { projectId: P })).toBe(`/projects/${P}?tab=stages&stage=${ID}`);
    expect(taskEntityHref("workflow_instance_step", ID)).toBeNull();
    expect(taskEntityHref("approval_request", ID)).toBe("/approvals");
    expect(taskEntityHref("purchase_order", ID)).toBe(`/procurement/purchase-orders/${ID}`);
    expect(taskEntityHref("supplier_invoice", ID)).toBe(`/finance/supplier-invoices/${ID}`);
    expect(taskEntityHref("rfi", ID, { projectId: P })).toBe(`/engineering?module=rfi&project=${P}`);
    expect(taskEntityHref("ncr", ID)).toBe("/engineering?module=ncr");
    expect(taskEntityHref("leave_request", ID)).toBe(`/leave/${ID}`);
    expect(taskEntityHref("employee", ID)).toBe(`/employees/${ID}`);
    expect(taskEntityHref("document", ID)).toBe(`/documents/${ID}`);
    expect(taskEntityHref(null, null)).toBeNull();
  });

  it("display title prefers English for en when present", () => {
    expect(taskDisplayTitle({ title: "تصميم", title_en: "Design" }, "en")).toBe("Design");
    expect(taskDisplayTitle({ title: "تصميم", title_en: "Design" }, "ar")).toBe("تصميم");
    expect(taskDisplayTitle({ title: "تصميم", title_en: null }, "en")).toBe("تصميم");
  });

  it("capabilities mirror the RLS rules", () => {
    const base = { userId: P, canCreate: true, canManage: false };
    expect(taskCapabilities({ ...base, task: { source: "manual", created_by: P }, assigneeIds: [] })).toMatchObject({
      canEdit: true,
      canDelete: true,
    });
    expect(taskCapabilities({ ...base, task: { source: "manual", created_by: ID }, assigneeIds: [P] })).toMatchObject({
      canEdit: true,
      canDelete: false,
    });
    expect(taskCapabilities({ ...base, task: { source: "manual", created_by: ID }, assigneeIds: [] })).toMatchObject({
      canEdit: false,
      canComment: true,
    });
    expect(
      taskCapabilities({ ...base, canManage: true, task: { source: "workflow_step", created_by: null }, assigneeIds: [] }),
    ).toMatchObject({ canEdit: true, canDelete: false, isAutoTask: true });
  });
});

describe("tasks schemas", () => {
  it("quick-add needs only title + listId", () => {
    const r = createTaskSchema.safeParse({ title: "  اتصال بالمورد ", listId: P });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.title).toBe("اتصال بالمورد");
    expect(createTaskSchema.safeParse({ title: "x" }).success).toBe(false);
    expect(createTaskSchema.safeParse({ title: "x", parentTaskId: P }).success).toBe(true);
    expect(createTaskSchema.safeParse({ title: "", listId: P }).success).toBe(false);
  });

  it("assignee ids accept csv or repeated values", () => {
    const r = createTaskSchema.safeParse({ title: "x", listId: P, assigneeIds: `${P},${ID}` });
    expect(r.success && r.data.assigneeIds).toEqual([P, ID]);
    const r2 = createTaskSchema.safeParse({ title: "x", listId: P, assigneeIds: [P] });
    expect(r2.success && r2.data.assigneeIds).toEqual([P]);
  });

  it("update: absent = unchanged, blank = cleared", () => {
    const r = updateTaskSchema.safeParse({ taskId: ID, description: "", dueDate: "" });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.description).toBeNull();
      expect(r.data.dueDate).toBeNull();
      expect(r.data.title).toBeUndefined();
      expect(r.data.estimateMinutes).toBeUndefined();
    }
    expect(updateTaskSchema.safeParse({ taskId: ID, entityType: "project" }).success).toBe(false);
  });

  it("manual time entry needs 1–1440 minutes", () => {
    expect(addManualTimeEntrySchema.safeParse({ taskId: ID, hours: "1", minutes: "30" }).success).toBe(true);
    expect(addManualTimeEntrySchema.safeParse({ taskId: ID, minutes: "0" }).success).toBe(false);
    expect(addManualTimeEntrySchema.safeParse({ taskId: ID, hours: "25" }).success).toBe(false);
  });

  it("parseTaskFilters drops invalid values", () => {
    expect(
      parseTaskFilters(
        { assignee: "me", status: "todo,bogus,done", priority: "urgent", dueFrom: "2026-10-01", q: " pump ", list: "nope" },
        P,
      ),
    ).toEqual({ assigneeId: P, status: ["todo", "done"], priority: ["urgent"], dueFrom: "2026-10-01", search: "pump" });
    expect(parseTaskFilters({ assignee: "none" })).toEqual({ unassigned: true });
  });
});
