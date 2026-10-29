import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("Vercel function region", () => {
  it("runs functions next to the Supabase database (ap-southeast-1 → sin1)", () => {
    // Every server render makes several Supabase round trips; running in Vercel's
    // default iad1 adds ~200ms to each one. The f4fff21 white-screen regression came
    // from the slim middleware sign-out loop, not from the region pin.
    const cfg = JSON.parse(readFileSync("vercel.json", "utf8")) as { regions?: string[]; crons?: unknown[] };
    expect(cfg.regions).toEqual(["sin1"]);
    expect(Array.isArray(cfg.crons)).toBe(true);
  });
});
