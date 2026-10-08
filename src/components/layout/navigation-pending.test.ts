import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("navigation pending bar", () => {
  it("does not use useSearchParams (avoids client Suspense stall on the app shell)", () => {
    const src = readFileSync("src/components/layout/navigation-pending.tsx", "utf8");
    expect(src).toContain("usePathname");
    expect(src).not.toContain("useSearchParams");
    const frame = readFileSync("src/components/layout/app-shell-frame.tsx", "utf8");
    expect(frame).toContain("<NavigationPendingBar />");
    expect(frame).not.toMatch(/Suspense[\s\S]{0,80}NavigationPendingBar/);
  });
});
