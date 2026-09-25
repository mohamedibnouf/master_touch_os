import { describe, expect, it } from "vitest";
import { notificationEntityHref } from "./href";

describe("notificationEntityHref", () => {
  it("maps known operational entities", () => {
    expect(notificationEntityHref("leave_request", "abc")).toBe("/leave/abc");
    expect(notificationEntityHref("project", "p1")).toBe("/projects/p1");
    expect(notificationEntityHref("payroll_period", "p1")).toBe("/payroll");
  });

  it("returns null when the entity is unknown or incomplete", () => {
    expect(notificationEntityHref(null, "x")).toBeNull();
    expect(notificationEntityHref("mystery", "x")).toBeNull();
  });
});
