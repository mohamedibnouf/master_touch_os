import { describe, expect, it } from "vitest";
import { notificationEntityHref, resolveNotificationHref, workflowStageHref } from "./href";

describe("notificationEntityHref", () => {
  it("maps known operational entities", () => {
    expect(notificationEntityHref("leave_request", "abc")).toBe("/leave/abc");
    expect(notificationEntityHref("project", "p1")).toBe("/projects/p1");
    expect(notificationEntityHref("payroll_period", "p1")).toBe("/payroll");
    expect(notificationEntityHref("document", "doc-1")).toBe("/documents/doc-1");
  });

  it("returns null when the entity is unknown or incomplete", () => {
    expect(notificationEntityHref(null, "x")).toBeNull();
    expect(notificationEntityHref("mystery", "x")).toBeNull();
  });

  it("resolves stored workflow stages href without rewriting historical rows", () => {
    const projectId = "11111111-1111-1111-1111-111111111111";
    expect(workflowStageHref(projectId)).toBe(`/projects/${projectId}?tab=stages`);
    expect(
      resolveNotificationHref({
        type: "leave_request.submitted",
        entityType: "leave_request",
        entityId: "abc",
        storedHref: "/leave/abc",
      }),
    ).toBe("/leave/abc");
  });
});
