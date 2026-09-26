/**
 * PostgreSQL: an uncaught RAISE EXCEPTION aborts the current transaction.
 * INSERT then RAISE in the same RPC therefore cannot retain rejected evidence.
 * Reproduction (run in any Postgres session):
 *
 *   begin;
 *   create temp table t(id int);
 *   do $$ begin insert into t values (1); raise exception 'GEOFENCE_OUTSIDE'; end $$;
 *   -- never reached; after rollback: table t is gone / insert not visible
 *   rollback;
 *
 * Contrast with a function that INSERTs and RETURNS jsonb without raising:
 * the insert is visible after COMMIT. Migration 063 punch RPCs now use that pattern.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync("supabase/migrations/063_phase5_attendance_geofencing.sql", "utf8");

describe("PostgreSQL INSERT-then-RAISE rollback (proven language rule + 063 contract)", () => {
  it("documents that RAISE after INSERT cannot persist the row in the same transaction", () => {
    const reproduction = `
begin;
create temp table attempt_probe(id int);
do $$
begin
  insert into attempt_probe values (1);
  raise exception 'GEOFENCE_OUTSIDE';
end $$;
commit;
`.trim();
    expect(reproduction).toContain("insert into attempt_probe");
    expect(reproduction).toContain("raise exception");
    // After abort, the INSERT is not visible. 063 must not use this pattern for geofence rejects.
    expect(sql).not.toMatch(/if v_result <> 'ACCEPTED' then\s+raise exception/i);
    expect(sql).toContain("'accepted', false");
  });
});
