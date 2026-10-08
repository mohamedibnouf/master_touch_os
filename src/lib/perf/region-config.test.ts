import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("Vercel function region", () => {
  it("pins Production functions to sin1 via vercel.json (Next 16 preferredRegion is deprecated)", () => {
    const cfg = JSON.parse(readFileSync("vercel.json", "utf8")) as { regions?: string[]; crons?: unknown[] };
    expect(cfg.regions).toEqual(["sin1"]);
    expect(Array.isArray(cfg.crons)).toBe(true);
    const appLayout = readFileSync("src/app/(app)/layout.tsx", "utf8");
    expect(appLayout).not.toContain("preferredRegion");
  });
});
