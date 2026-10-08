import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("dashboard does not block greeting on viz", () => {
  it("loads dashboard viz inside a Suspense child", () => {
    const src = readFileSync("src/app/(app)/page.tsx", "utf8");
    expect(src).toContain("DashboardVizBlock");
    expect(src).toContain("<Suspense fallback={<KpiRowSkeleton count={4} />}>");
    expect(src).toMatch(/async function DashboardVizBlock/);
  });
});
