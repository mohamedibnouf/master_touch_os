import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("Vercel function region", () => {
  it("does not pin regions in vercel.json (restore last known-good Production routing)", () => {
    const cfg = JSON.parse(readFileSync("vercel.json", "utf8")) as { regions?: string[]; crons?: unknown[] };
    expect(cfg.regions).toBeUndefined();
    expect(Array.isArray(cfg.crons)).toBe(true);
  });
});
