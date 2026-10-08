import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("dashboard home", () => {
  it("loads viz on the page after auth, without a separate streaming auth shell", () => {
    const src = readFileSync("src/app/(app)/page.tsx", "utf8");
    expect(src).toContain("loadDashboardViz");
    expect(src).not.toContain("DashboardVizBlock");
    expect(src).toContain("HomeTodayCards");
  });
});
