import { describe, expect, it } from "vitest";
import { navigationTargetKey, shouldShowNavigationPending } from "./navigation-pending";

describe("navigation pending includes search", () => {
  it("treats tab query changes as pending navigation", () => {
    const current = navigationTargetKey("/projects/abc", "?tab=overview");
    const next = navigationTargetKey("/projects/abc", "?tab=stages");
    expect(shouldShowNavigationPending(current, next)).toBe(true);
    expect(shouldShowNavigationPending(current, current)).toBe(false);
  });
});
